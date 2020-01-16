import path from "path";
import fs from "fs-extra";
import ts from "typescript";

// @see https://www.sqlite.org/datatype3.html
enum DataType {
  NULL = "NULL",
  INTEGER = "INTEGER",
  NUMERIC = "NUMERIC",
  REAL = "REAL",
  TEXT = "TEXT",
  BLOB = "BLOB"
}

interface ForeignKey {
  fromTableColumnName: string;
  toTable: Table;
  toTableColumnName: string;
  hasPrimaryKey: boolean;
}

interface Column {
  name: string;
  type: DataType;
  notNull: boolean;
  primaryKeyByDocTag: boolean;
  primaryKey: boolean;
  foreignKey?: ForeignKey;
  index: boolean;
  autoIncrement: boolean;
  unique: boolean;
  isBasicArrayType: boolean;
  isDeclaredArrayType: boolean;
}

interface Columns {
  [name: string]: Column;
}

interface Table {
  name: string;
  columns: Columns;
  primaryKey?: string;
  rank: number;
  oneToManyFromTable?: string;
  oneToOneFromTable?: string;
}

export interface Tables {
  [tableName: string]: {
    table: Table;
    relativePath: string;
  };
}
interface CreateColumnOptions {
  name: string;
  isOptional: boolean;
  indexed: boolean;
  isArray?: boolean;
  primaryKeyByDocTag: boolean;
  primaryKey: boolean;
  foreignKey?: ForeignKey;
  autoIncrement?: boolean;
  unique?: boolean;
  isBasicArrayType: boolean;
  isDeclaredArrayType?: boolean;
}

interface Context {
  tables: Tables;
  checker: ts.TypeChecker;
}

interface TableContext {
  name: string;
  primaryKeys: string[];
  derivedPrimaryKeyByDocTag: boolean;
  enforceOptionalProperty: boolean;
  relativePath: string;
}

const isNodeExported = (node: ts.Node): boolean => {
  return (
    (ts.getCombinedModifierFlags(node as ts.Declaration) &&
      ts.ModifierFlags.Export) !== 0 ||
    (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
  );
};

const visitNode = (node: ts.Node, interfaces: ts.InterfaceDeclaration[]) => {
  // Only consider exported nodes
  if (!isNodeExported(node)) {
    return;
  }
  if (ts.isInterfaceDeclaration(node)) {
    if (hasTableTag(node)) {
      interfaces.push(node);
    }
  } else if (ts.isModuleDeclaration(node)) {
    console.log("module", node.name);
    // This is a namespace, visit its children
    ts.forEachChild(node, child => visitNode(child, interfaces));
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createEnumWithMarkerToString = <T extends number = number>(
  enumeration: any
) => {
  const map: Map<number, string> = new Map();

  Object.keys(enumeration).forEach(name => {
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

const hasTableTag = (node: ts.InterfaceDeclaration): boolean => {
  return hasDocTag(node, "sqlite_table");
};

const hasDocTag = (node: ts.Node, tagName: string): boolean => {
  const tags = ts.getJSDocTags(node);
  return tags.some(tag => tag.tagName.getText() === tagName);
};

const getRelativePath = (node: ts.Node) =>
  path.relative(process.cwd(), node.getSourceFile().fileName);

const resolveTableInterface = (
  node: ts.InterfaceDeclaration,
  context: Context,
  oneToManyFromTable?: string,
  oneToOneFromTable?: string
) => {
  const name = node.name.getText();
  const tableContext: TableContext = {
    primaryKeys: [],
    derivedPrimaryKeyByDocTag: false,
    enforceOptionalProperty: false,
    relativePath: getRelativePath(node),
    name
  };
  const columns = resolveColumns(node, context, tableContext);

  return createTable(
    name,
    context,
    tableContext,
    columns,
    oneToManyFromTable,
    oneToOneFromTable
  );
};

const createTable = (
  name: string,
  context: Context,
  tableContext: TableContext,
  columns: Columns,
  oneToManyFromTable?: string,
  oneToOneFromTable?: string
) => {
  const table: Table = {
    name,
    columns,
    primaryKey:
      tableContext.primaryKeys.length === 1
        ? tableContext.primaryKeys[0]
        : undefined,
    rank: Object.keys(context.tables).length,
    oneToManyFromTable,
    oneToOneFromTable
  };
  // eslint-disable-next-line no-param-reassign
  context.tables[table.name] = {
    table,
    relativePath: tableContext.relativePath
  };

  return table;
};

const createOneTableFromMultipleInterfaces = (
  node: ts.DeclarationStatement,
  interfaceDeclarations: ts.InterfaceDeclaration[],
  context: Context,
  oneToManyFromTable?: string,
  oneToOneFromTable?: string
) => {
  const name = node.name?.getText() ?? `Table${context.tables.length}`;
  const tableContext: TableContext = {
    name,
    primaryKeys: [],
    derivedPrimaryKeyByDocTag: false,
    enforceOptionalProperty: true,
    relativePath: getRelativePath(node.getSourceFile())
  };

  let columns: Columns = {};
  interfaceDeclarations.forEach(decl => {
    const otherColumns = resolveColumns(decl, context, tableContext);
    columns = {
      ...columns,
      ...otherColumns
    };
  });
  if (oneToManyFromTable) {
    const defaultOptions = {
      isOptional: false,
      isArray: false,
      indexed: false,
      primaryKeyByDocTag: false,
      primaryKey: false,
      isBasicArrayType: false
    };
    columns.index = createColumn(DataType.INTEGER, {
      name: "index",
      ...defaultOptions
    });
  }
  return createTable(
    name,
    context,
    tableContext,
    columns,
    oneToManyFromTable,
    oneToOneFromTable
  );
};

const resolveColumns = (
  node: ts.InterfaceDeclaration,
  context: Context,
  schemaContext: TableContext
): Columns => {
  let columns: Columns = {};
  // check if node is extending from another interface
  if (node.heritageClauses) {
    node.heritageClauses.forEach(heritageClause => {
      heritageClause.types.forEach(herigateTypeExpression => {
        const expressionType = context.checker.getTypeAtLocation(
          herigateTypeExpression.expression
        );
        const expressionSymbol =
          expressionType.symbol ?? expressionType.aliasSymbol;
        const interfaceDeclaration =
          (expressionSymbol?.declarations.find(decl =>
            ts.isInterfaceDeclaration(decl)
          ) as ts.InterfaceDeclaration) || undefined;
        if (interfaceDeclaration) {
          const baseColumns = resolveColumns(
            interfaceDeclaration,
            context,
            schemaContext
          );
          columns = {
            ...columns,
            ...baseColumns
          };
        }
      });
    });
  }

  node.members.forEach(member => {
    if (ts.isPropertySignature(member) && member.type && member.name) {
      const column = resolvePropertyToColumn(
        member,
        member.type,
        member.name,
        context,
        schemaContext
      );
      if (column) {
        columns[column.name] = column;
        if (column.primaryKey) {
          if (
            column.primaryKeyByDocTag &&
            !schemaContext.derivedPrimaryKeyByDocTag
          ) {
            // eslint-disable-next-line no-param-reassign
            schemaContext.primaryKeys = [];
            // eslint-disable-next-line no-param-reassign
            schemaContext.derivedPrimaryKeyByDocTag = column.primaryKeyByDocTag;
          }
          if (
            column.primaryKeyByDocTag ===
            schemaContext.derivedPrimaryKeyByDocTag
          ) {
            schemaContext.primaryKeys.push(column.name);
          }
        }
      }
    }
  });

  return columns;
};

const basicTypes = new Set(["string", "number", "boolean", "Date"]);

const resolvePropertyToColumn = (
  propertySignature: ts.PropertySignature,
  typeNode: ts.TypeNode,
  name: ts.PropertyName,
  context: Context,
  schemaContext: TableContext
): Column | null => {
  const isArray = ts.isArrayTypeNode(typeNode);
  const type = ts.isArrayTypeNode(typeNode)
    ? context.checker.getTypeAtLocation(typeNode.elementType)
    : context.checker.getTypeAtLocation(typeNode);

  const isOptional =
    schemaContext.enforceOptionalProperty || !!propertySignature.questionToken;
  const typeAsString = context.checker.typeToString(type);
  const symbol = type.aliasSymbol ?? type.getSymbol();

  const declarations =
    symbol && symbol.declarations ? symbol.declarations : undefined;

  const primaryKeyByDocTag = hasDocTag(propertySignature, "sqlite_primary_key");
  const primaryKey =
    primaryKeyByDocTag ||
    (!isOptional &&
      name
        .getText()
        .toLowerCase()
        .endsWith("id"));

  const indexed = !primaryKey && hasDocTag(propertySignature, "sqlite_index");
  const options: CreateColumnOptions = {
    name: name.getText(),
    isOptional,
    isArray,
    indexed,
    primaryKey,
    primaryKeyByDocTag,
    isBasicArrayType: isArray && basicTypes.has(typeAsString)
  };

  if (hasDocTag(propertySignature, "sqlite_numeric")) {
    return createColumn(DataType.NUMERIC, options);
  }
  if (hasDocTag(propertySignature, "sqlite_real")) {
    return createColumn(DataType.REAL, options);
  }
  switch (typeAsString) {
    case "string":
      return createColumn(DataType.TEXT, options);
    case "number":
      return createColumn(DataType.INTEGER, options);
    case "boolean":
      return createColumn(DataType.NUMERIC, options);
    case "Date":
      return createColumn(DataType.TEXT, options);
    default:
      if (!declarations) {
        console.log(
          `> Skipping '${name.getText()}', don't know how to get symbol.`
        );
        return null;
      }
      return resolveDeclaredType(
        name,
        type,
        declarations,
        options,
        context,
        schemaContext
      );
  }
};

const resolveDeclaredType = (
  name: ts.PropertyName,
  type: ts.Type,
  declarations: ts.Declaration[],
  options: CreateColumnOptions,
  context: Context,
  tableContext: TableContext
): Column | null => {
  const interfaceDeclaration =
    (declarations.find(declaration =>
      ts.isInterfaceDeclaration(declaration)
    ) as ts.InterfaceDeclaration) || undefined;

  if (interfaceDeclaration) {
    return createJoiningTableForDeclaredType(
      tableContext.name,
      interfaceDeclaration,
      context,
      {
        ...options,
        isDeclaredArrayType: options.isArray
      }
    );
  }

  const enumDeclaration =
    (declarations.find(declaration =>
      ts.isEnumDeclaration(declaration)
    ) as ts.EnumDeclaration) || undefined;

  if (enumDeclaration) {
    const firstEnumMemberType = typeof context.checker.getConstantValue(
      enumDeclaration.members[0]
    );
    if (firstEnumMemberType !== "number" && firstEnumMemberType !== "string") {
      console.log(
        `> Skipping '${name.getText()}', only support number and strint constant value types`
      );
      return null;
    }
    if (
      enumDeclaration.members.some(
        // eslint-disable-next-line valid-typeof
        member =>
          firstEnumMemberType !==
          typeof context.checker.getConstantValue(member)
      )
    ) {
      console.log(
        `> Skipping '${name.getText()}', no support for mixed enum constant value types`
      );
      return null;
    }

    if (firstEnumMemberType === "string") {
      return createColumn(DataType.TEXT, options);
    }
    if (firstEnumMemberType === "number") {
      return createColumn(DataType.NUMERIC, options);
    }

    console.log(
      `> Skipping '${name.getText()}', don't know how to handle enum  '${syntaxKindToString(
        enumDeclaration.kind
      )}'`
    );
    return null;
  }

  const enumMemberDeclaration =
    (declarations.find(decl => ts.isEnumMember(decl)) as ts.EnumMember) ||
    undefined;
  if (enumMemberDeclaration) {
    const value = context.checker.getConstantValue(enumMemberDeclaration);
    if (typeof value === "string") {
      return createColumn(DataType.TEXT, options);
    }
    if (typeof value === "number") {
      return createColumn(DataType.NUMERIC, options);
    }
    console.log(
      `> Skipping '${name.getText()}', don't know how to handle enum member with value type'${typeof value}'`
    );
    return null;
  }

  const typeAliasDeclaration =
    (declarations.find(declaration =>
      ts.isTypeAliasDeclaration(declaration)
    ) as ts.TypeAliasDeclaration) || undefined;

  if (typeAliasDeclaration) {
    if (type.isIntersection()) {
      console.log(
        `> Skipping '${name.getText()}' as intersection types are not supported (yet).`
      );
      return null;
    }
    if (type.isUnion() && type.types.length > 0) {
      const firstType = type.types[0];
      const isNumber = firstType.isNumberLiteral();
      const isString = firstType.isStringLiteral();
      if (isNumber || isString) {
        if (
          !type.types.every(
            subType =>
              subType.isNumberLiteral() === isNumber &&
              subType.isStringLiteral() === isString
          )
        ) {
          console.log(
            `> Skipping '${name.getText()}', miaxing literal type aliases is not supported`
          );
          return null;
        }
        if (isNumber) {
          return createColumn(DataType.INTEGER, options);
        }
        if (isString) {
          return createColumn(DataType.TEXT, options);
        }
        // for mixed interface types, we combine all the properties of these types in one schema
      } else {
        const interfaceDeclarations: ts.InterfaceDeclaration[] = [];
        type.types.forEach(subType => {
          const decl = subType
            .getSymbol()
            ?.declarations.find(subDecl => ts.isInterfaceDeclaration(subDecl));
          if (decl && ts.isInterfaceDeclaration(decl)) {
            interfaceDeclarations.push(decl);
          }
        });
        // every sub type is an interface
        if (interfaceDeclarations.length === type.types.length) {
          const table = createOneTableFromMultipleInterfaces(
            typeAliasDeclaration,
            interfaceDeclarations,
            context,
            options.isArray ? tableContext.name : undefined,
            options.isArray ? undefined : tableContext.name
          );
          if (!options.isArray) {
            return createForeignKeyColumn(table, options);
          }
          return null;
        }
      }
    }
  }

  console.log(
    `> Skipping '${name.getText()}', don't know how to handle kind(s) ${declarations
      .map(decl => syntaxKindToString(decl.kind))
      .join(", ")} with text '${declarations
      .map(decl => decl.getText())
      .join(" or ")}' .`
  );

  return null;
};

// called after any potential primary key is identified
const createTableForArrayOfBasicTypes = (
  ownerTable: Table,
  originalColumn: Column,
  context: Context,
  relativePath: string
) => {
  const primaryKey = ownerTable.primaryKey
    ? ownerTable.primaryKey
    : createPrimaryKeyIfNotExists(ownerTable);
  const newTableName =
    ownerTable.name +
    originalColumn.name[0].toUpperCase() +
    originalColumn.name.substr(1);
  const id = newTableName[0].toLowerCase() + newTableName.substr(1) + "Id";
  const defaultOptions = {
    isOptional: false,
    isArray: false,
    indexed: false,
    primaryKeyByDocTag: false,
    primaryKey: false,
    isBasicArrayType: false
  };
  const columns: Columns = {
    index: createColumn(DataType.INTEGER, {
      ...defaultOptions,
      name: "index"
    }),
    value: {
      ...originalColumn,
      name: "value",
      isBasicArrayType: false
    },
    [id]: createColumn(DataType.INTEGER, {
      ...defaultOptions,
      name: id
    }),
    [primaryKey]: createColumn(DataType.INTEGER, {
      ...defaultOptions,
      name: primaryKey,
      foreignKey: {
        fromTableColumnName: primaryKey,
        toTableColumnName: primaryKey,
        toTable: ownerTable,
        hasPrimaryKey: true
      }
    })
  };
  const table = createTable(
    newTableName,
    context,
    {
      name: newTableName,
      primaryKeys: [id],
      derivedPrimaryKeyByDocTag: true,
      enforceOptionalProperty: false,
      relativePath
    },
    columns
  );

  return table;
};

const createJoiningTableForDeclaredType = (
  fromTableName: string,
  interfaceDeclaration: ts.InterfaceDeclaration,
  context: Context,
  options: CreateColumnOptions
) => {
  resolveTableInterface(
    interfaceDeclaration,
    context,
    options.isDeclaredArrayType ? fromTableName : undefined,
    options.isDeclaredArrayType ? undefined : fromTableName
  );
  return null; // primary key will be added to referencing table
};

const createPrimaryKeyIfNotExists = (table: Table): string => {
  if (!table.primaryKey) {
    const name = table.name[0].toLowerCase() + table.name.substr(1) + "Id";
    table.columns[name] = createColumn(DataType.INTEGER, {
      name,
      primaryKey: true,
      primaryKeyByDocTag: true,
      isOptional: false,
      indexed: false,
      isBasicArrayType: false
    });
    table.primaryKey = name;
  }
  return table.primaryKey;
};

const createForeignKeyColumn = (
  toTable: Table,
  options: CreateColumnOptions
) => {
  const hasPrimaryKey = !!toTable.primaryKey;
  const primaryKey = toTable.primaryKey
    ? toTable.primaryKey
    : "will be set later";

  return createColumn(DataType.INTEGER, {
    ...options,
    name: primaryKey,
    foreignKey: {
      hasPrimaryKey,
      fromTableColumnName: primaryKey,
      toTable: toTable,
      toTableColumnName: primaryKey
    }
  });
};

const createColumn = (
  type: DataType,
  {
    name,
    isOptional,
    primaryKey,
    primaryKeyByDocTag,
    indexed: isIndexed,
    foreignKey,
    autoIncrement,
    unique,
    isBasicArrayType,
    isDeclaredArrayType
  }: CreateColumnOptions
): Column => {
  const index = isIndexed === true ? true : false;
  const notNull = !isOptional;
  return {
    name,
    type,
    primaryKey,
    primaryKeyByDocTag,
    notNull,
    foreignKey,
    index,
    autoIncrement: !!autoIncrement,
    unique: !!unique,
    isBasicArrayType,
    isDeclaredArrayType: !!isDeclaredArrayType
  };
};

const postProcessTables = (context: Context) => {
  Object.values(context.tables).forEach(item => {
    resolveColumnsNeedingPrimaryKey(item.table, context, item.relativePath);
  });
};

const resolveColumnsNeedingPrimaryKey = (
  table: Table,
  context: Context,
  relativePath: string
) => {
  if (table.oneToManyFromTable || table.oneToOneFromTable) {
    const ownerName =
      table.oneToManyFromTable ?? (table.oneToOneFromTable as string);
    // add left hand side table's primary key as foreign key
    const owner = context.tables[ownerName].table;
    const primaryKey = owner.primaryKey
      ? owner.primaryKey
      : createPrimaryKeyIfNotExists(owner);
    const primaryKeyType = owner.columns[primaryKey].type;
    table.columns[primaryKey] = createColumn(primaryKeyType, {
      name: primaryKey,
      isOptional: false,
      indexed: false,
      isBasicArrayType: false,
      primaryKey: false,
      primaryKeyByDocTag: false,
      foreignKey: {
        fromTableColumnName: primaryKey,
        toTable: owner,
        toTableColumnName: primaryKey,
        hasPrimaryKey: true
      }
    });

    table.oneToManyFromTable = undefined;
  }
  Object.keys(table.columns).forEach(originalColumnName => {
    const originalColumn = table.columns[originalColumnName];
    if (originalColumn.isBasicArrayType) {
      createTableForArrayOfBasicTypes(
        table,
        originalColumn,
        context,
        relativePath
      );
      delete table.columns[originalColumnName];
    } else if (
      originalColumn.foreignKey &&
      !originalColumn.foreignKey.hasPrimaryKey
    ) {
      const ownerTable =
        context.tables[originalColumn.foreignKey.toTable.name].table;
      const primaryKey = createPrimaryKeyIfNotExists(ownerTable);
      originalColumn.name = primaryKey;
      originalColumn.foreignKey = {
        ...originalColumn.foreignKey,
        hasPrimaryKey: true,
        fromTableColumnName: primaryKey,
        toTableColumnName: primaryKey
      };
      table.columns[primaryKey] = originalColumn;

      delete table.columns[originalColumnName];
    }
  });
};

export const resolveTypes = (
  rootFilePaths: string[],
  tsConfigPath: string
): Tables => {
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
      sourceFile =>
        !sourceFile.isDeclarationFile &&
        sourceFile.fileName.endsWith("models.ts")
    );

  console.log("> compiled");

  const tables: Tables = {};

  const context: Context = {
    tables,
    checker
  };

  modelFiles.forEach(sourceFile => {
    const relativePath = path.relative(process.cwd(), sourceFile.fileName);
    console.log(`> processing '${relativePath}'`);
    const interfaces: ts.InterfaceDeclaration[] = [];
    ts.forEachChild(sourceFile, node => visitNode(node, interfaces));

    interfaces.forEach(node => {
      resolveTableInterface(node, context);
    });

    console.log(`> finished '${relativePath}'`);
  });

  postProcessTables(context);

  return tables;
};
