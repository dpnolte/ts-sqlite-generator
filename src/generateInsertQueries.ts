import path from "path";

import {
  TableMap,
  isPropertyBasedColumn,
  DataType,
  getProperties,
  BasicArrayTable,
  isBasicArrayTable,
  isDefaultTable,
  Table,
  isAdvancedArrayTable,
  COL_ARRAY_INDEX,
  COL_ARRAY_VALUE
} from "./resolveTables";
import { isComposite, PropertyMap } from "./resolveModels";
import { addNamedImport, ImportMap } from "./generateImports";
import { QueryExports } from "./generateExports";

interface AdditionalArgs {
  name: string;
  type: string;
  column: string;
  arrayTableProperty: boolean;
  isOptional: boolean;
}

export const generateInsertQueries = (
  tables: TableMap,
  targetPath: string,
  imports: ImportMap
) => {
  let body = "";
  const tab = "  ";
  const targetDir = path.dirname(targetPath);

  Object.values(tables).forEach(table => {
    // todo: check if declared type can be exported
    const relativePath = path.relative(targetDir, table.declaredType.path);
    addNamedImport(table.declaredType, imports, targetDir);

    const isCompositeType = isComposite(table.declaredType);
    const additionalArguments = getAdditionalArgs(table, tables);

    const methodName = getInsertMethodName(table);
    if (table.declaredType.isEntry) {
      QueryExports.add(methodName);
    }

    body += `// insert query based on ${table.declaredType.name} type definitions in ${relativePath}\n`;

    if (additionalArguments.length > 0) {
      body += `const ${methodName} = (\n`;
      if (!isBasicArrayTable(table)) {
        body += `${tab}input: ${table.declaredType.name},\n`;
      }
      body += `${tab}${additionalArguments
        .map(arg => `${arg.name}${arg.isOptional ? "?" : ""}: ${arg.type}`)
        .join(`,\n${tab}`)}\n`;
      body += `): string[] => {\n`;
    } else {
      body += `const ${methodName} = (`;
      if (isDefaultTable(table)) {
        body += `input: ${table.declaredType.name}`;
      }
      body += `): string[] => {\n`;
    }
    body += `${tab}const queries: string[] = [];\n`;
    body += `${tab}const columns: string[] = [];\n`;
    body += `${tab}const values: string[] = [];\n\n`;

    const properties = getProperties(table.declaredType);

    additionalArguments.forEach(arg => {
      body += `${tab}columns.push('${arg.column}');\n`;

      let prefix = tab;
      if (arg.isOptional) {
        body += `${tab}if(typeof ${arg.name} !== 'undefined') {\n`;
        prefix += tab;
      }
      if (arg.type === "string") {
        body += `${prefix}values.push(\`'\${${arg.name}.toString().replace(/\'/g,"''")}'\`);\n`;
      } else {
        body += `${prefix}values.push(${arg.name}.toString());\n`;
      }
      if (arg.isOptional) {
        body += `${tab}} else {\n`;
        body += `${tab.repeat(2)}values.push('NULL');\n`;
        body += `${tab}}\n`;
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
            value = `\`'\${${objRef}.${property.accessSyntax}.replace(/\'/g,"''")}'\``;
          } else {
            value = `${objRef}.${property.accessSyntax}.toString()`;
          }

          if (property.isOptional || isCompositeType) {
            body += `${tab}if (typeof ${objRef}.${property.accessSyntax} !== 'undefined') {\n`;
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

    body += getChildrenQueriesStatements(
      table,
      properties,
      isCompositeType,
      tables,
      tab
    );

    body += getArrayTableQueriesStatements(table, isCompositeType, tables, tab);

    body += `${tab}return queries;\n`;
    body += `};\n\n`;
  });

  return body;
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
      arrayTableProperty: false,
      isOptional: !column.notNull
    });
  });
  if (isBasicArrayTable(table)) {
    const { property } = table;
    additionalArguments.push({
      name: COL_ARRAY_VALUE,
      column: COL_ARRAY_VALUE,
      type: property.type,
      arrayTableProperty: true,
      isOptional: false
    });
    additionalArguments.push({
      name: COL_ARRAY_INDEX,
      column: COL_ARRAY_INDEX,
      type: "number",
      arrayTableProperty: true,
      isOptional: false
    });
  }
  if (isAdvancedArrayTable(table)) {
    additionalArguments.push({
      name: COL_ARRAY_INDEX,
      column: COL_ARRAY_INDEX,
      type: "number",
      arrayTableProperty: true,
      isOptional: table.declaredType.isEntry
    });
  }

  return additionalArguments.sort((a, b) => {
    if (!a.isOptional && b.isOptional) return -1;
    if (a.isOptional && !b.isOptional) return 1;
    return 0;
  });
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
        assignStmt += `${prefix +
          tab.repeat(2)}list.push(...${getInsertMethodName(childTable)}(`;
        assignStmt += `child`;
        if (childArgs.length > 0) {
          assignStmt += `, ${childArgs
            .map(ca => {
              if (ca.arrayTableProperty && ca.name === COL_ARRAY_INDEX) {
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
        assignStmt += `${prefix + tab}...${getInsertMethodName(
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
      result += `${prefix + tab.repeat(2)}...${getInsertMethodName(
        arrayTable
      )}(`;
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

export const getInsertMethodName = (table: Table) => `insert${table.name}`;
