import path from "path";

import {
  TableMap,
  isPropertyBasedColumn,
  DataType,
  getProperties,
  BasicArrayTable,
  isBasicArrayTable,
  Table,
  isAdvancedArrayTable,
  isDefaultTable,
  COL_ARRAY_INDEX,
  COL_ARRAY_VALUES,
  COL_ARRAY_VALUE,
  AdvancedArrayTable,
  DefaultTable
} from "./resolveTables";
import { isComposite, PropertyMap } from "./resolveModels";
import { addNamedImport, ImportMap } from "./generateImports";

interface AdditionalArgs {
  name: string;
  type: string;
  column: string;
  arrayTableProperty: boolean;
  isOptional: boolean;
}

/**
 * Scenarios:
 * - A) Table is entry.. user needs to be able to update with primary key.
 *      when entry, table is updated based on primary key
 * - B) Table is a child only
 *      when one-to-one child, table is updated based on primary key if available.
 *      if no primary key available or one-to-many, all children will be deleted and replaced by what is entered
 * - C) Table is both an entry and a child to antoher entry -> create two methods (one when updated as entry, another as child)
 * - D) Table is a basic array table. All items will be deleted and replaced by what is entered if any value is provided.
 */
export const generateUpdateQueries = (
  tables: TableMap,
  targetPath: string,
  imports: ImportMap
) => {
  let body =
    "type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;\n\n";
  const tab = "  ";
  const targetDir = path.dirname(targetPath);

  Object.values(tables).forEach(table => {
    // todo: check if declared type can be exported
    const relativePath = path.relative(targetDir, table.declaredType.path);
    addNamedImport(table.declaredType, imports, targetDir);

    const additionalArguments = getAdditionalArgs(table, tables);
    const isChild = table.foreignKeys.length > 0;
    const isEntryAndChild = table.declaredType.isEntry && isChild;
    const isCompositeType = isComposite(table.declaredType);
    const hasPrimaryKeyDefined = table.primaryKey;

    body += `// update query based on ${table.declaredType.name} type definitions in ${relativePath}\n`;

    // D - basic array table
    if (isBasicArrayTable(table)) {
      body += generateUpdateBasicArrayQuery(table, additionalArguments, tab);
      // A - entry only
    } else if (table.declaredType.isEntry && !isEntryAndChild) {
      body += generateUpdateEntryQuery(table, tab, imports, tables, targetDir);

      // C - entry and child
    } else if (isEntryAndChild) {
      body += generateUpdateEntryQuery(table, tab, imports, tables, targetDir);
      if (isAdvancedArrayTable(table)) {
        body += generateUpdateOneToManyChildQuery(
          table,
          tab,
          imports,
          tables,
          targetDir
        );
      } else if (isDefaultTable(table)) {
        generateUpdateOneToOneChildQuery(
          table,
          tab,
          imports,
          tables,
          targetDir
        );
      }

      // B - child only (one to many)
    } else if (isAdvancedArrayTable(table)) {
      body += generateUpdateOneToManyChildQuery(
        table,
        tab,
        imports,
        tables,
        targetDir
      );
      // B - child only (one to one)
    } else {
      body += generateUpdateOneToOneChildQuery(
        table,
        tab,
        imports,
        tables,
        targetDir
      );
    }

    body += `${tab}return queries;\n`;
    body += `};\n\n`;
  });

  return body;
};

const generateUpdateBasicArrayQuery = (
  table: BasicArrayTable,
  additionalArgs: AdditionalArgs[],
  tab: string
) => {
  const valuesArg = additionalArgs.find(arg => arg.name === COL_ARRAY_VALUES);
  if (!valuesArg) {
    throw Error(
      `Could not resolve values argument for ${table.name} basic array table`
    );
  }
  const referencingPrimaryKey = additionalArgs.find(
    arg => arg.name !== COL_ARRAY_VALUES
  );
  if (!referencingPrimaryKey) {
    throw Error(
      `Could not resolve referencing primary key argument for ${table.name} basic array table`
    );
  }

  // delete first all old items
  let method = `export const ${getMethodName(table)} = (\n`;
  method += `${tab}${additionalArgs
    .map(
      arg =>
        `${arg.name}${arg.isOptional ? "?" : ""}: ${arg.type}${
          arg.name === COL_ARRAY_VALUES ? "[]" : ""
        }`
    )
    .join(`,\n${tab}`)}\n`;

  method += `): string[] => {\n`;
  method += `${tab}const queries: string[] = [];\n`;
  method += `${tab}queries.push(\n`;
  method += `${tab.repeat(2)}'DELETE FROM ${table.name} WHERE ${
    referencingPrimaryKey.column
  }=$\{${referencingPrimaryKey.name}}',\n`;
  method += `${tab});\n\n`;
  method += `${tab + valuesArg.name}.forEach((value, index) => {\n`;
  method += `${tab.repeat(2)}queries.push(\n`;
  method += `${tab.repeat(3)}\`INSERT INTO ${table.name}(${COL_ARRAY_INDEX}, ${
    referencingPrimaryKey.column
  }, ${COL_ARRAY_VALUE})) VALUES(`;
  method += `\${index}, \${${referencingPrimaryKey.name}}, `;
  if (valuesArg.type === "string") {
    method += `'\${value}'`;
  } else {
    method += `\${value}`;
  }
  method += `)\`,\n`;
  method += `${tab.repeat(2)});\n`;
  method += `${tab}});\n`;

  return method;
};

const generateUpdateEntryQuery = (
  table: AdvancedArrayTable | DefaultTable,
  tab: string,
  imports: ImportMap,
  tables: TableMap,
  targetDir: string
) => {
  const primaryKey = table.primaryKey;
  if (!primaryKey) {
    throw Error(
      `could not resolve table entry ${table.name} without primary key`
    );
  }

  let method = `export const ${getMethodName(table)} = (\n`;
  method += `${tab}input: Omit<Partial<${table.declaredType.name}>, '${primaryKey}'>,\n`;
  method += `${tab}${primaryKey}: number,\n`;
  method += `): string[] => {\n`;
  method += `${tab}const queries: string[] = [];\n`;
  method += `${tab}const columnToValue: string[] = [];\n`;

  const properties = getProperties(table.declaredType);
  method += getChildrenQueriesStatements(table, properties, false, tables, tab);

  method += getArrayTableQueriesStatements(table, false, tables, tab);

  const columnList = Object.values(table.columns);
  columnList.forEach(column => {
    // other columns will be passed as arguments
    if (isPropertyBasedColumn(column) && column.name !== primaryKey) {
      const { property } = column;

      method += `${tab}if (typeof input.${property.accessSyntax} !== 'undefined') {\n`;
      method +=
        tab.repeat(2) +
        getColumnToValuePush(
          column.name,
          `input.${property.accessSyntax}`,
          column.type === DataType.TEXT
        );
      method += `${tab}}\n`;
    }
  });

  method += `${tab}if (columnToValue.length === 0) {\n`;
  method += `${tab.repeat(2)}return [];\n`;
  method += `${tab}}\n\n`;

  method += `${tab}let query = 'UPDATE ${table.name} SET ';\n`;
  method += `${tab}query += columnToValue.join(', ');\n`;
  method += `${tab}query += \` WHERE ${primaryKey}=\${primaryKey}\``;
  method += `${tab}queries.push(query);\n\n`;

  return method;
};

const generateUpdateOneToManyChildQuery = (
  table: AdvancedArrayTable,
  tab: string,
  imports: ImportMap,
  tables: TableMap,
  targetDir: string
) => {
  if (table.foreignKeys.length === 0) {
    throw Error(
      `could not resolve one-to-many table ${table.name} without having foreign key`
    );
  }

  const isCompositeType = isComposite(table.declaredType);

  const foreignKey = table.foreignKeys[0];

  let method = `const ${getMethodNameForChild(table)} = (\n`;
  method += `${tab}input: ${table.declaredType.name},\n`;
  method += `${tab}${foreignKey.columnName}: number,\n`;
  method += `${tab}${COL_ARRAY_INDEX}: number,\n`;
  method += `): string[] => {\n`;
  method += `${tab}const queries: string[] = [];\n`;
  method += `${tab}const columnToValue: string[] = [];\n`;

  const properties = getProperties(table.declaredType);

  // TODO: add first delete queries and then insert queries

  method += getChildrenQueriesStatements(
    table,
    properties,
    isCompositeType,
    tables,
    tab
  );

  method += getArrayTableQueriesStatements(table, isCompositeType, tables, tab);

  method += `${tab}queries.push(query);\n\n`;

  return method;
};

const generateUpdateOneToOneChildQuery = (
  table: DefaultTable,
  tab: string,
  imports: ImportMap,
  tables: TableMap,
  targetDir: string
) => {
  if (table.foreignKeys.length === 0) {
    throw Error(
      `could not resolve one-to-many table ${table.name} without having foreign key`
    );
  }

  const isCompositeType = isComposite(table.declaredType);

  const foreignKey = table.foreignKeys[0];

  let method = `const ${getMethodNameForChild(table)} = (\n`;
  method += `${tab}input: ${table.declaredType.name},\n`;
  method += `${tab}${foreignKey.columnName}: number,\n`;
  method += `): string[] => {\n`;
  method += `${tab}const queries: string[] = [];\n`;
  method += `${tab}const columnToValue: string[] = [];\n`;

  const properties = getProperties(table.declaredType);

  // TODO: add first delete queries and then insert queries

  method += getChildrenQueriesStatements(
    table,
    properties,
    isCompositeType,
    tables,
    tab
  );

  method += getArrayTableQueriesStatements(table, isCompositeType, tables, tab);

  method += `${tab}queries.push(query);\n\n`;

  return method;
};

const getColumnToValuePush = (
  column: string,
  accessSyntax: string,
  isString: boolean
) => {
  return `columnToValue.push(\`${getColumnToValue(
    column,
    accessSyntax,
    isString
  )}\`);\n`;
};

const getColumnToValue = (
  column: string,
  accessSyntax: string,
  isString: boolean
) => {
  if (isString) {
    return `${column}='\${${accessSyntax}.replace(/\'/g,"''")}'`;
  }
  return `${column}=\${${accessSyntax}}`;
};

const resolveWhereClause = (
  table: AdvancedArrayTable | DefaultTable,
  additionalArgs: AdditionalArgs[]
) => {
  if (table.declaredType.isEntry) {
    if (isAdvancedArrayTable(table)) {
      const foreignKey = additionalArgs.find(arg => !arg.arrayTableProperty);
      if (!foreignKey) {
        throw Error(`could not resolve where clause for ${table.name}`);
      }
      return `query += \` WHERE ${table.primaryKey}=$\{primaryKey}\`;\n`;
    }
    return `query += \` WHERE ${table.primaryKey}=$\{primaryKey}\`;\n`;
  }
  const foreignKeys = additionalArgs.filter(arg => !arg.arrayTableProperty);
  if (foreignKeys.length === 0) {
    throw Error(`could not resolve where clause for ${table.name}`);
  }
  let clause = `query += \` WHERE `;
  clause += foreignKeys
    .map(fk => getColumnToValue(fk.column, fk.name, fk.type === "string"))
    .join(", ");
  clause += "`;\n";

  return clause;
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
      name: COL_ARRAY_VALUES,
      column: COL_ARRAY_VALUES,
      type: property.type,
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
      assignStmt = `${prefix}if (${objRef}.${property.accessSyntax}) {\n`;
      if (property.isArray) {
        const childPrimarykey = childTable.primaryKey;
        // if (!childPrimarykey) {
        //   throw Error(
        //     `Could not resolve primary key for advanced array table ${childTable.name}`
        //   );
        // }
        if (childPrimarykey) {
          const childId = `child.${childPrimarykey}`;

          assignStmt += `${prefix + tab}const updatedIds: number[] = [];\n`;
          assignStmt += `${prefix + tab}queries.push(\n`;
          assignStmt += `${prefix + tab.repeat(2)}...${objRef}.${
            property.accessSyntax
          }`;
          assignStmt += `.reduce((list, child`;
          if (isAdvancedArrayTable(childTable)) {
            assignStmt += ", index";
          }
          assignStmt += `) => {\n`;
          assignStmt += `${prefix +
            tab.repeat(
              3
            )}if (!${childId}) return list; // cannot update without primary key\n`;
          assignStmt += `${prefix +
            tab.repeat(3)}updatedIds.push(${childId});\n`;

          assignStmt += `${prefix + tab.repeat(3)}list.push(...${getMethodName(
            childTable
          )}(`;
          assignStmt += `child, ${childId}`;

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
          assignStmt += `${prefix + tab.repeat(3)}return list;\n`;
          assignStmt += `${prefix + tab.repeat(2)}}, [] as string[])\n`;
          assignStmt += `${prefix + tab});\n`;

          assignStmt += `${prefix +
            tab}// remove any non updated item in the array to prevent array index conflicts\n`;
          assignStmt += `${prefix + tab}queries.push(\n`;
          (assignStmt += `${prefix + tab.repeat(2)}\`DELETE FROM ${
            childTable.name
          } WHERE ${childPrimarykey} NOT IN (\${updatedIds.join(', ')})\``),
            (assignStmt += `${prefix + tab});\n`);
        }
      } else {
        assignStmt += `${prefix + tab}queries.push(\n`;
        assignStmt += `${prefix + tab.repeat(2)}...${getMethodName(
          childTable
        )}(${objRef}.${property.accessSyntax}`;
        if (childArgs.length > 0) {
          assignStmt += `, ${childArgs
            .map(ca => `${objRef}.${ca.name}`)
            .join(", ")}`;
        }
        assignStmt += `)\n${prefix + tab});\n`;
      }
      assignStmt += `${prefix}}\n`;
      return assignStmt;
    };

    result += getAssignmentStatement(tab);
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

      result += `${tab}if (${objRef}.${property.accessSyntax}) {\n`;
      prefix += tab;

      result += `${prefix}queries.push(\n`;
      result += `${prefix + tab}...${getMethodName(
        arrayTable
      )}(primaryKey, ${objRef}.${property.accessSyntax}),\n`;
      result += `${prefix});\n`;

      result += `${tab}}\n`;
    });
    result += "\n";
  }

  return result;
};

const getMethodName = (table: Table) => `update${table.name}Queries`;
const getMethodNameForChild = (table: Table) =>
  `update${table.name}AsChildQueries`;
