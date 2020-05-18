import path from "path";
import fs from "fs-extra";
import ts, { preProcessFile } from "typescript";
import { Tags } from "./resolveTables";

export enum RelationType {
  OneToOne = "OneToOne",
  OneToMany = "OneToMany",
  ManyToMany = "ManyToMany",
}

export interface Relation {
  type: RelationType;
  child: DeclaredType;
  propertyName: string;
}

export enum DeclarationType {
  Interface,
  Composite,
}

export interface DeclarationTypeMinimal {
  name: string;
  path: string;
}

export interface DeclarationTypeBase extends DeclarationTypeMinimal {
  children: Relation[];
  type: DeclarationType;
  isEntry: boolean;
}

export interface InterfaceDeclaration extends DeclarationTypeBase {
  properties: PropertyMap;
  type: DeclarationType.Interface;
}

export interface CompositeDeclaration extends DeclarationTypeBase {
  interfaces: InterfaceDeclaration[];
  type: DeclarationType.Composite;
}

export type DeclaredType = CompositeDeclaration | InterfaceDeclaration;

type ResolvedTypeArgument = {
  type: ts.Type;
  declarations: ts.Declaration[];
};
type TypeParameterMapping = Record<
  string /* type parameter name */,
  ResolvedTypeArgument
>;

export enum PropertyType {
  String = "string",
  Number = "number",
  Boolean = "boolean",
  Date = "Date",
  Child = "child",
  Composite = "Composite",
}
const PropertyTypeValue = new Set<string>(Object.values(PropertyType));
const isPropertyType = (input: any): input is PropertyType =>
  typeof input === "string" && PropertyTypeValue.has(input);

export interface PropertyDeclaration {
  name: string;
  accessSyntax: string;
  declaredType: DeclarationTypeMinimal;
  type: PropertyType;
  tags: string[];
  isOptional: boolean;
  isArray: boolean;
  isBasicType: boolean;
  typeDeclarations: ts.Declaration[];
}

export interface PropertyMap {
  [name: string]: PropertyDeclaration;
}

export const isInterface = (
  declaredType: DeclaredType
): declaredType is InterfaceDeclaration =>
  declaredType.type === DeclarationType.Interface;

export const isComposite = (
  declaredType: DeclaredType
): declaredType is InterfaceDeclaration =>
  declaredType.type === DeclarationType.Composite;

export const resolveModels = (
  rootFilePaths: string[],
  tsConfigPath: string,
  tags: Tags,
  strict = true
) => {
  console.log("> compiling");

  const { config } = ts.parseConfigFileTextToJson(
    tsConfigPath,
    fs.readFileSync(tsConfigPath).toString()
  );
  const program = ts.createProgram(rootFilePaths, config);
  const checker = program.getTypeChecker();

  const modelFiles = program
    .getSourceFiles()
    .filter(
      (sourceFile) =>
        !sourceFile.isDeclarationFile &&
        sourceFile.fileName.endsWith("models.ts")
    );

  console.log("> compiled");
  console.log("> resolving models");

  const rootTypes: InterfaceDeclaration[] = [];
  modelFiles.forEach((sourceFile) => {
    const relativePath = path.relative(process.cwd(), sourceFile.fileName);
    console.log(`> processing '${relativePath}'`);
    const interfaces: ts.InterfaceDeclaration[] = [];
    ts.forEachChild(sourceFile, (node) =>
      visitNode(node, interfaces, tags, strict)
    );

    interfaces.forEach((node) => {
      rootTypes.push(resolveInterface(node, checker, tags, strict));
    });
  });

  console.log("> resolved models");
  return rootTypes;
};

const visitNode = (
  node: ts.Node,
  interfaces: ts.InterfaceDeclaration[],
  tags: Tags,
  strict: boolean
) => {
  if (ts.isInterfaceDeclaration(node)) {
    if (hasDocTag(node, tags.entry)) {
      if (strict && node.typeParameters && node.typeParameters.length > 0) {
        console.log(
          `Error for '${node.name.getText()}': Type parameters are not supported`
        );
        process.exit(1);
      }
      interfaces.push(node);
    }
  } else if (ts.isModuleDeclaration(node)) {
    console.log("module", node.name);
    // This is a namespace, visit its children
    ts.forEachChild(node, (child) =>
      visitNode(child, interfaces, tags, strict)
    );
  }
};

const getSourceFilePath = (node: ts.Node) => node.getSourceFile().fileName;

const hasDocTag = (node: ts.Node, tagName: string): boolean => {
  const tags = ts.getJSDocTags(node);
  return tags.some((tag) => tag.tagName.getText() === tagName);
};

const resolveInterface = (
  node: ts.InterfaceDeclaration,
  checker: ts.TypeChecker,
  tags: Tags,
  strict: boolean
): InterfaceDeclaration => {
  const name = node.name.getText();

  const properties = resolveProperties(node, checker, [], strict);
  const children = resolveRelationships(
    node.name.getText(),
    checker,
    properties,
    tags,
    strict
  );

  return {
    name,
    properties,
    children,
    type: DeclarationType.Interface,
    path: getSourceFilePath(node),
    isEntry: hasDocTag(node, tags.entry),
  };
};

const resolveProperties = (
  node: ts.InterfaceDeclaration,
  checker: ts.TypeChecker,
  parentTypeArguments: ResolvedTypeArgument[],
  strict: boolean
): PropertyMap => {
  let properties: PropertyMap = {};
  // check if node is inheriting properties
  if (node.heritageClauses) {
    node.heritageClauses.forEach((heritageClause) => {
      heritageClause.types.forEach((herigateTypeExpression) => {
        const expressionType = checker.getTypeAtLocation(
          herigateTypeExpression.expression
        );
        // resolve any provided type arguments to declarations
        const typeArguments: ResolvedTypeArgument[] = [];
        herigateTypeExpression.typeArguments?.forEach((typeArgument) => {
          const typeArgumentType = checker.getTypeAtLocation(typeArgument);
          typeArguments.push({
            type: typeArgumentType,
            declarations: typeArgumentType.symbol.declarations,
          });
        });
        const expressionSymbol =
          expressionType.symbol ?? expressionType.aliasSymbol;
        const interfaceDeclaration =
          (expressionSymbol?.declarations.find((decl) =>
            ts.isInterfaceDeclaration(decl)
          ) as ts.InterfaceDeclaration) || undefined;
        if (interfaceDeclaration) {
          const propertiesFromBaseType = resolveProperties(
            interfaceDeclaration,
            checker,
            typeArguments,
            strict
          );
          properties = {
            ...properties,
            ...propertiesFromBaseType,
          };
        }
      });
    });
  }

  const typeParameterMapping: TypeParameterMapping = {};
  if (node.typeParameters && node.typeParameters.length > 0) {
    if (node.typeParameters.length !== parentTypeArguments.length) {
      console.log(
        `Error for '${node.name.getText()}': Missing type arguments from parent`
      );
      if (strict) {
        process.exit(1);
      }
    }
    // get mapping of type parameter name to declaration type
    node.typeParameters.forEach((typeParameter, index) => {
      typeParameterMapping[typeParameter.name.getText()] =
        parentTypeArguments[index];
    });
  }

  node.members.forEach((member) => {
    if (ts.isPropertySignature(member) && member.type && member.name) {
      const property = resolveProperty(
        node,
        member,
        member.type,
        member.name,
        checker,
        typeParameterMapping,
        strict
      );
      if (property) {
        properties[property.name] = property;
      }
    }
  });

  return properties;
};

const resolveProperty = (
  declarationNode: ts.InterfaceDeclaration,
  propertySignature: ts.PropertySignature,
  typeNode: ts.TypeNode,
  nameNode: ts.PropertyName,
  checker: ts.TypeChecker,
  typeParameterMapping: TypeParameterMapping,
  strict: boolean
): PropertyDeclaration | null => {
  const isArray = ts.isArrayTypeNode(typeNode);
  const type = ts.isArrayTypeNode(typeNode)
    ? checker.getTypeAtLocation(typeNode.elementType)
    : checker.getTypeAtLocation(typeNode);

  const isOptional = !!propertySignature.questionToken;
  const originalTypeString = checker.typeToString(type);
  // when type is provided as type argument, use the provided type. We set it here so that primitives will be resolved (e.g., EntityModel<string>)
  const typeAsString = typeParameterMapping[originalTypeString]
    ? checker.typeToString(typeParameterMapping[originalTypeString].type)
    : originalTypeString;

  const symbol = type.aliasSymbol ?? type.getSymbol();

  const declarations =
    symbol && symbol.declarations ? symbol.declarations : undefined;

  const tags =
    ts.getJSDocTags(propertySignature).map((tag) => tag.tagName.getText()) ??
    [];
  const name = nameNode.getText();

  const propertyDefaultProps = {
    name,
    declaredType: {
      name: declarationNode.name.getText(),
      path: getSourceFilePath(declarationNode),
    },
    accessSyntax: name,
    isOptional,
    isArray,
    tags,
    typeDeclarations: declarations ?? [],
  };

  switch (typeAsString) {
    case "string":
      return {
        type: PropertyType.String,
        isBasicType: true,
        ...propertyDefaultProps,
      };
    case "number":
      return {
        type: PropertyType.Number,
        isBasicType: true,
        ...propertyDefaultProps,
      };
    case "boolean":
      return {
        type: PropertyType.Boolean,
        isBasicType: true,
        ...propertyDefaultProps,
      };
    case "Date":
      return {
        type: PropertyType.Date,
        isBasicType: true,
        ...propertyDefaultProps,
      };
    default:
      // is the type provided as type argument and is not a primitive?
      if (typeParameterMapping[originalTypeString]) {
        const typeArgument = typeParameterMapping[originalTypeString];
        const childType = resolveChildType(
          typeArgument.type.symbol.name,
          typeArgument.type,
          typeArgument.declarations,
          checker,
          strict
        );
        if (!childType) {
          console.log(
            `> Error for '${
              typeArgument.type.symbol.name
            }', don't know how to handle type argument kind(s) ${typeArgument.declarations
              .map((decl) => syntaxKindToString(decl.kind))
              .join(", ")} with text '${typeArgument.declarations
              .map((decl) => decl.getText())
              .join(" or ")}' .`
          );
          if (strict) {
            process.exit(1);
          }
        }
        if (isPropertyType(childType)) {
          return {
            type: childType,
            isBasicType: true,
            ...propertyDefaultProps,
            typeDeclarations: typeArgument.declarations,
          };
        } else if (Array.isArray(childType)) {
          return {
            type: PropertyType.Composite,
            isBasicType: false,
            ...propertyDefaultProps,
            typeDeclarations: typeArgument.declarations,
          };
        } else {
          return {
            type: PropertyType.Child,
            isBasicType: false,
            ...propertyDefaultProps,
            typeDeclarations: typeArgument.declarations,
          };
        }
      }
      if (!declarations) {
        console.log(`> Error for '${name}': don't know how to get symbol.`);
        if (strict) {
          process.exit(1);
        }
        return null;
      }
      const childType = resolveChildType(
        name,
        type,
        declarations,
        checker,
        strict
      );
      if (!childType) {
        console.log(
          `> Error for '${name}', don't know how to handle kind(s) ${declarations
            .map((decl) => syntaxKindToString(decl.kind))
            .join(", ")} with text '${declarations
            .map((decl) => decl.getText())
            .join(" or ")}' .`
        );
        if (strict) {
          process.exit(1);
        }
        return null;
      }
      if (isPropertyType(childType)) {
        return {
          type: childType,
          isBasicType: true,
          ...propertyDefaultProps,
        };
      } else if (Array.isArray(childType)) {
        return {
          type: PropertyType.Composite,
          isBasicType: false,
          ...propertyDefaultProps,
        };
      } else {
        return {
          type: PropertyType.Child,
          isBasicType: false,
          ...propertyDefaultProps,
        };
      }
  }
};

const resolveChildType = (
  name: string,
  type: ts.Type,
  declarations: ts.Declaration[],
  checker: ts.TypeChecker,
  strict: boolean
):
  | ts.InterfaceDeclaration[]
  | ts.InterfaceDeclaration
  | PropertyType
  | null => {
  const interfaceDeclaration = findInterfaceDeclaration(declarations);
  if (interfaceDeclaration) {
    return interfaceDeclaration;
  }

  const enumDeclaration =
    (declarations.find((declaration) =>
      ts.isEnumDeclaration(declaration)
    ) as ts.EnumDeclaration) || undefined;

  if (enumDeclaration) {
    const firstEnumMemberType = typeof checker.getConstantValue(
      enumDeclaration.members[0]
    );
    if (firstEnumMemberType !== "number" && firstEnumMemberType !== "string") {
      console.log(
        `> Skipping '${name}', only support number and strint constant value types`
      );
      if (strict) {
        process.exit(1);
      }
      return null;
    }
    if (
      enumDeclaration.members.some(
        // eslint-disable-next-line valid-typeof
        (member) =>
          firstEnumMemberType !== typeof checker.getConstantValue(member)
      )
    ) {
      console.log(
        `> Skipping '${name}', no support for mixed enum constant value types`
      );
      if (strict) {
        process.exit(1);
      }
      return null;
    }

    if (firstEnumMemberType === "string") {
      return PropertyType.String;
    }
    if (firstEnumMemberType === "number") {
      return PropertyType.Number;
    }

    console.log(
      `> Skipping '${name}', don't know how to handle enum  '${syntaxKindToString(
        enumDeclaration.kind
      )}'`
    );
    if (strict) {
      process.exit(1);
    }
    return null;
  }

  const enumMemberDeclaration =
    (declarations.find((decl) => ts.isEnumMember(decl)) as ts.EnumMember) ||
    undefined;
  if (enumMemberDeclaration) {
    const value = checker.getConstantValue(enumMemberDeclaration);
    if (typeof value === "string") {
      return PropertyType.String;
    }
    if (typeof value === "number") {
      return PropertyType.Number;
    }
    console.log(
      `> Skipping '${name}', don't know how to handle enum member with value type'${typeof value}'`
    );
    if (strict) {
      process.exit(1);
    }
    return null;
  }

  const typeAliasDeclaration = findTypeAliasDeclaration(declarations);
  if (typeAliasDeclaration) {
    if (type.isIntersection()) {
      console.log(
        `> Skipping '${name}' as intersection types are not supported (yet).`
      );
      if (strict) {
        process.exit(1);
      }
      return null;
    }
    if (type.isUnion() && type.types.length > 0) {
      const firstType = type.types[0];
      const isNumber = firstType.isNumberLiteral();
      const isString = firstType.isStringLiteral();
      if (isNumber || isString) {
        if (
          !type.types.every(
            (subType) =>
              subType.isNumberLiteral() === isNumber &&
              subType.isStringLiteral() === isString
          )
        ) {
          console.log(
            `> Skipping '${name}', miaxing literal type aliases is not supported`
          );
          if (strict) {
            process.exit(1);
          }
          return null;
        }
        if (isNumber) {
          return PropertyType.Number;
        }
        if (isString) {
          return PropertyType.String;
        }
        // for united interface types, we combine all the properties of these types in one composite type
      } else {
        const interfaceDeclarations: ts.InterfaceDeclaration[] = getInterfaceDeclarationsFromUnion(
          type
        );
        // every sub type is an interface?
        if (interfaceDeclarations.length === type.types.length) {
          return interfaceDeclarations;
        }
      }
    }
  }

  return null;
};

const getInterfaceDeclarationsFromUnion = (node: ts.UnionType) => {
  const interfaceDeclarations: ts.InterfaceDeclaration[] = [];
  node.types.forEach((subType) => {
    const decl = subType
      .getSymbol()
      ?.declarations.find((subDecl) => ts.isInterfaceDeclaration(subDecl));
    if (decl && ts.isInterfaceDeclaration(decl)) {
      interfaceDeclarations.push(decl);
    }
  });
  return interfaceDeclarations;
};

const findTypeAliasDeclaration = (declarations: ts.Declaration[]) => {
  return declarations.find((declaration) =>
    ts.isTypeAliasDeclaration(declaration)
  ) as ts.TypeAliasDeclaration | undefined;
};

const findInterfaceDeclaration = (declarations: ts.Declaration[]) => {
  return declarations.find((declaration) =>
    ts.isInterfaceDeclaration(declaration)
  ) as ts.InterfaceDeclaration | undefined;
};

const resolveRelationships = (
  parentName: string,
  checker: ts.TypeChecker,
  properties: PropertyMap,
  tags: Tags,
  strict: boolean
) => {
  const children: Relation[] = [];
  Object.values(properties).forEach((property) => {
    if (property.type === PropertyType.Child) {
      const interfaceDeclaration = findInterfaceDeclaration(
        property.typeDeclarations
      );
      if (!interfaceDeclaration) {
        throw Error(
          `Could not find interface declaration for ${parentName}'s child ${property.name}`
        );
      }

      const declaredType = resolveInterface(
        interfaceDeclaration,
        checker,
        tags,
        strict
      );

      children.push({
        type: property.isArray ? RelationType.OneToMany : RelationType.OneToOne,
        child: declaredType,
        propertyName: property.name,
      });
    } else if (property.type === PropertyType.Composite) {
      const typeAliasDeclaration = findTypeAliasDeclaration(
        property.typeDeclarations
      );
      if (!typeAliasDeclaration) {
        throw Error(
          `Could not find type alias declaration for ${parentName}'s composite ${property.name}`
        );
      }
      const type = checker.getTypeAtLocation(typeAliasDeclaration);
      if (!type.isUnion()) {
        throw Error(
          `Could not find type alias declaration for ${parentName}'s composite ${property.name}`
        );
      }
      const interfaceDeclarations = getInterfaceDeclarationsFromUnion(type);
      const declaredType = createCompositeTypeFromMultipleInterfaces(
        typeAliasDeclaration,
        interfaceDeclarations,
        checker,
        tags,
        strict
      );

      children.push({
        type: property.isArray ? RelationType.OneToMany : RelationType.OneToOne,
        child: declaredType,
        propertyName: property.name,
      });
    }
  });

  return children;
};

const createCompositeTypeFromMultipleInterfaces = (
  typeAliasDeclaration: ts.TypeAliasDeclaration,
  interfaceDeclarations: ts.InterfaceDeclaration[],
  checker: ts.TypeChecker,
  tags: Tags,
  strict: boolean
): CompositeDeclaration => {
  const name = typeAliasDeclaration.name.getText();

  let properties: PropertyMap = {};
  const interfaces: InterfaceDeclaration[] = [];
  interfaceDeclarations.forEach((decl) => {
    const interfaceDecl = resolveInterface(decl, checker, tags, strict);
    properties = {
      ...properties,
      ...interfaceDecl.properties,
    };
    interfaces.push(interfaceDecl);
  });

  const children = resolveRelationships(
    name,
    checker,
    properties,
    tags,
    strict
  );

  return {
    name,
    interfaces,
    children,
    type: DeclarationType.Composite,
    path: getSourceFilePath(typeAliasDeclaration),
    isEntry: false,
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createEnumWithMarkerToString = <T extends number = number>(
  enumeration: any
) => {
  const map: Map<number, string> = new Map();

  Object.keys(enumeration).forEach((name) => {
    const id = enumeration[name];
    if (typeof id === "number" && !map.has(id)) {
      map.set(id, name);
    }
  });
  return (value: T) => map.get(value) as string; // could be undefined if used the wrong enum member..
};
const syntaxKindToString = createEnumWithMarkerToString<ts.SyntaxKind>(
  ts.SyntaxKind
);
