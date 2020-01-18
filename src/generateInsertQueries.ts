import path from "path";
import fs from "fs-extra";

import {
  TableMap,
  isPropertyBasedColumn,
  DataType,
  getProperties,
  BasicArrayTable,
  isBasicArrayTable,
  isDefaultTable,
  Table,
  isAdvancedArrayTable
} from "./resolveTables";
import {
  isComposite,
  DeclarationTypeMinimal,
  PropertyMap
} from "./resolveModels";

interface Import {
  path: string;
  defaultImport?: string;
  namedImports: Set<string>;
}

interface ImportMap {
  [path: string]: Import;
}

interface AdditionalArgs {
  name: string;
  type: string;
  column: string;
  arrayTableProperty: boolean;
}

export const generateInsertQueries = (
  tables: TableMap,
  targetPath: string,
  append = true
) => {
  let body = "";
  const imports: ImportMap = {};
  const tab = "  ";
  const targetDir = path.dirname(targetPath);

  Object.values(tables).forEach(table => {
    // todo: check if declared type can be exported
    const relativePath = path.relative(targetDir, table.declaredType.path);
    addNamedImport(table.declaredType, imports, targetDir);

    const isCompositeType = isComposite(table.declaredType);
    const additionalArguments = getAdditionalArgs(table, tables);

    body += `// helper based on ${table.declaredType.name} type definitions in ${relativePath}\n`;

    if (additionalArguments.length > 0) {
      body += `export const ${getMethodName(table)} = (\n`;
      if (!isBasicArrayTable(table)) {
        body += `${tab}input: ${table.declaredType.name},\n`;
      }
      body += `${tab}${additionalArguments
        .map(arg => `${arg.name}: ${arg.type}`)
        .join(`,\n${tab}`)}\n`;
      body += `): string[] => {\n`;
    } else {
      body += `export const ${getMethodName(table)} = (`;
      if (isDefaultTable(table)) {
        body += `input: ${table.declaredType.name}`;
      }
      body += `): string[] => {\n`;
    }
    body += `${tab}const queries: string[] = [];\n`;
    body += `${tab}const columns: string[] = [];\n`;
    body += `${tab}const values: string[] = [];\n\n`;

    const properties = getProperties(table.declaredType);
    body += getChildrenQueriesStatements(
      table,
      properties,
      isCompositeType,
      tables,
      tab
    );

    body += getArrayTableQueriesStatements(table, isCompositeType, tables, tab);

    additionalArguments.forEach(additionalArg => {
      body += `${tab}columns.push('${additionalArg.column}');\n`;
      if (additionalArg.type === "string") {
        body += `${tab}values.push(\`'\${${additionalArg.name}.toString()}'\`);\n`;
      } else {
        body += `${tab}values.push(${additionalArg.name}.toString());\n`;
      }
    });

    if (!isBasicArrayTable(table)) {
      const columnList = Object.values(table.columns);
      columnList.forEach(column => {
        // other columns will be passed as arguments
        if (isPropertyBasedColumn(column)) {
          const { property } = column;

          const objRef = isCompositeType
            ? `(input as ${property.declaredType.name})`
            : "input";

          if (isCompositeType) {
            addNamedImport(property.declaredType, imports, targetDir);
          }

          let value: string;
          if (column.type === DataType.TEXT) {
            value = `\`'\${${objRef}.${property.accessSyntax}}'\``;
          } else {
            value = `${objRef}.${property.accessSyntax}.toString()`;
          }

          if (property.isOptional || isCompositeType) {
            body += `${tab}if (${objRef}.${property.accessSyntax}) {\n`;
            body += `${tab.repeat(2)}columns.push('${column.name}');\n`;
            body += `${tab.repeat(2)}values.push(${value});\n`;
            body += `${tab}}\n`;
          } else {
            body += `${tab}columns.push('${column.name}');\n`;
            body += `${tab}values.push(${value});\n`;
          }
        }
      });
    }
    body += `${tab}if (columns.length === 0 || values.length === 0) {\n`;
    body += `${tab.repeat(2)}return [];\n`;
    body += `${tab}}\n\n`;

    body += `${tab}let query = 'INSERT INTO ${table.name}(';\n`;
    body += `${tab}query += columns.join(', ');\n`;
    body += `${tab}query += ') VALUES(';\n`;
    body += `${tab}query += values.join(', ');\n`;
    body += `${tab}query += ');';\n`;
    body += `${tab}queries.push(query);\n\n`;

    body += `${tab}return queries;\n`;
    body += `};\n\n`;
  });

  let content = "// Auto-generated, do not edit!\n";
  Object.values(imports).forEach(importStmt => {
    content += "import ";
    if (importStmt.defaultImport) {
      content += `${importStmt.defaultImport} `;
    }
    const namedImports = Array.from(importStmt.namedImports);
    if (namedImports.length > 0) {
      content += `{ ${namedImports.join(", ")} } `;
    }
    content += `from '${importStmt.path}';\n`;
  });

  content += "\n";
  content += body;

  if (append) {
    fs.appendFileSync(targetPath, content);
  } else {
    fs.writeFileSync(targetPath, content);
  }
};

const addNamedImport = (
  declaredType: DeclarationTypeMinimal,
  imports: ImportMap,
  targetDir: string
) => {
  const importPath = path.join(
    path.relative(targetDir, path.dirname(declaredType.path)),
    path.parse(declaredType.path).name
  );

  if (!imports[importPath]) {
    imports[importPath] = {
      path: importPath,
      namedImports: new Set()
    };
  }
  imports[importPath].namedImports.add(declaredType.name);
};

const getAdditionalArgs = (table: Table, tables: TableMap) => {
  const additionalArguments: AdditionalArgs[] = [];
  table.foreignKeys.forEach(foreignKey => {
    const column = table.columns[foreignKey.columnName];
    const parent = tables[foreignKey.parentTableName].declaredType;
    const parentProperties = getProperties(parent);
    const property = parentProperties[column.name];

    additionalArguments.push({
      name: property.name,
      type: property.type,
      column: column.name,
      arrayTableProperty: false
    });
  });
  if (isBasicArrayTable(table)) {
    const { property } = table;
    additionalArguments.push({
      name: "value",
      column: "value",
      type: property.type,
      arrayTableProperty: true
    });
    additionalArguments.push({
      name: "arrayIndex",
      column: "arrayIndex",
      type: "number",
      arrayTableProperty: true
    });
  }
  if (isAdvancedArrayTable(table)) {
    additionalArguments.push({
      name: "arrayIndex",
      column: "arrayIndex",
      type: "number",
      arrayTableProperty: true
    });
  }

  return additionalArguments;
};

const getChildrenQueriesStatements = (
  table: Table,
  properties: PropertyMap,
  isCompositeType: boolean,
  tables: TableMap,
  tab: string
) => {
  let result = "";
  if (isBasicArrayTable(table)) {
    return result;
  }
  table.declaredType.children.forEach(child => {
    const property = properties[child.propertyName];
    const objRef = isCompositeType
      ? `(input as ${property.declaredType.name})`
      : "input";

    const childTable = tables[child.child.name];
    const childArgs = getAdditionalArgs(childTable, tables);

    const getAssignmentStatement = (prefix: string) => {
      let assignStmt: string;
      if (property.isArray) {
        assignStmt = `${prefix}queries.push(\n`;
        assignStmt += `${prefix + tab}...${objRef}.${property.accessSyntax}`;
        assignStmt += `.reduce((list, child`;
        if (isAdvancedArrayTable(childTable)) {
          assignStmt += ", index";
        }
        assignStmt += `) => {\n`;
        assignStmt += `${prefix + tab.repeat(2)}list.push(...${getMethodName(
          childTable
        )}(`;
        assignStmt += `child`;
        if (childArgs.length > 0) {
          assignStmt += `, ${childArgs
            .map(ca => {
              if (ca.arrayTableProperty && ca.name === "arrayIndex") {
                return "index";
              }
              return `${objRef}.${ca.name}`;
            })
            .join(", ")}`;
        }
        assignStmt += `));\n`;
        assignStmt += `${prefix + tab.repeat(2)}return list;\n`;
        assignStmt += `${prefix + tab}}, [] as string[])\n`;
        assignStmt += `${prefix});\n`;
      } else {
        assignStmt = `${prefix}queries.push(\n`;
        assignStmt += `${prefix + tab}...${getMethodName(
          childTable
        )}(${objRef}.${property.accessSyntax}`;
        if (childArgs.length > 0) {
          assignStmt += `, ${childArgs
            .map(ca => `${objRef}.${ca.name}`)
            .join(", ")}`;
        }
        assignStmt += `)\n${prefix});\n`;
      }
      return assignStmt;
    };

    if (property.isOptional || isCompositeType) {
      result += `${tab}if(${objRef}.${property.accessSyntax}) {\n`;
      result += getAssignmentStatement(tab.repeat(2));
      result += `${tab}}\n`;
    } else {
      result += getAssignmentStatement(tab);
    }
  });

  result += "\n";

  return result;
};

const getArrayTableQueriesStatements = (
  table: Table,
  isCompositeType: boolean,
  tables: TableMap,
  tab: string
) => {
  let result = "";

  if (!isBasicArrayTable(table) && table.arrayTables.length > 0) {
    table.arrayTables.forEach(arrayTableName => {
      const arrayTable = tables[arrayTableName] as BasicArrayTable;
      const { property } = arrayTable;
      const objRef = isCompositeType
        ? `(input as ${property.declaredType.name})`
        : "input";

      const additionalArgs = getAdditionalArgs(arrayTable, tables);

      let prefix = tab;
      if (property.isOptional || isCompositeType) {
        result += `${tab}if (${objRef}.${property.accessSyntax}) {\n`;
        prefix += tab;
      }
      result += `${prefix}${objRef}.${property.accessSyntax}.forEach((value, index) => {\n`;
      result += `${prefix + tab}queries.push(\n`;
      result += `${prefix + tab.repeat(2)}...${getMethodName(arrayTable)}(`;
      result += `${objRef}.${additionalArgs[0].name}, value, index)\n`;
      result += `${prefix + tab});\n`;
      result += `${tab}});\n`;
      if (property.isOptional || isCompositeType) {
        result += `${tab}}\n`;
      }
    });
    result += "\n";
  }

  return result;
};

const getMethodName = (table: Table) => `getInsert${table.name}Queries`;
