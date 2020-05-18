import path from "path";

import {
  TableMap,
  isPropertyBasedColumn,
  DataType,
  BasicArrayTable,
  isBasicArrayTable,
  Table,
  isAdvancedArrayTable,
  Column,
  COL_ARRAY_INDEX,
  COL_ARRAY_VALUES,
  COL_ARRAY_VALUE,
  AdvancedArrayTable,
  DefaultTable,
} from "./resolveTables";
import {
  Relation,
  PropertyType,
  DeclarationTypeMinimal,
} from "./resolveModels";
import { addNamedImport, ImportMap } from "./generateImports";
import { QueryExports } from "./generateExports";
import {
  getInsertMethodNameFromChild,
  getColumnValuePushesFromColumns,
} from "./generateInsertQueries";

const tab = "  ";

/**
 * Scenarios:
 * - A) Table is entry.. user needs to be able to replace with primary key.
 *      when entry, table is replaced based on primary key
 * - B) Table is a child only
 *      when one-to-one child, table is replaced based on primary key if available.
 *      if no primary key available or one-to-many, all children will be deleted and replaced by what is entered
 * - C) Table is both an entry and a child to antoher entry -> create two methods (one when replaced as entry, another as child)
 * - D) Table is a basic array table. All items will be deleted and replaced by what is entered if any value is provided.
 */
export const generateReplaceQueries = (
  tables: TableMap,
  targetPath: string,
  imports: ImportMap
) => {
  let body = "";
  const targetDir = path.dirname(targetPath);

  const addDeclaredTypeAsImport = (declaredType: DeclarationTypeMinimal) =>
    addNamedImport(declaredType, imports, targetDir);

  Object.values(tables).forEach((table) => {
    // todo: check if declared type can be exported
    const relativePath = path.relative(targetDir, table.declaredType.path);
    addNamedImport(table.declaredType, imports, targetDir);

    body += `// replace query based on ${table.declaredType.name} type definitions in ${relativePath}\n`;

    // D - basic array table
    if (isBasicArrayTable(table)) {
      body += generateReplaceBasicArrayQuery(table, tables);
    } else {
      addNamedImport(table.declaredType, imports, targetDir);

      if (table.declaredType.isEntry) {
        // A + C
        body += generateReplaceEntryQuery(
          table,
          tables,
          addDeclaredTypeAsImport
        );
        body += generateReplaceMultipleEntryQuery(table);
      }

      if (table.parentTableName) {
        // B - child only (one to many)
        if (isAdvancedArrayTable(table)) {
          addNamedImport(table.declaredType, imports, targetDir);

          body += generateReplaceOneToManyChildQuery(table, tables);
          // B - child only (one to one)
        } else {
          body += generateReplaceOneToOneChildQuery(table, tables);
        }
      }
    }
  });

  return body;
};

const generateReplaceBasicArrayQuery = (
  table: BasicArrayTable,
  tables: TableMap
) => {
  const { parentTablePrimaryKey, parentTableName } = table;
  const foreignKey = table.foreignKeys.find(
    (fk) => fk.columnName === parentTablePrimaryKey
  );
  if (!parentTableName || !parentTablePrimaryKey || !foreignKey) {
    throw Error(
      `Could not resolve parent primary key/foreign key for '${table.name}' as basic array table`
    );
  }

  const { columnName } = foreignKey;
  const parentTable = tables[parentTableName];
  const parentColumn = parentTable.columns[parentTablePrimaryKey];
  const id = `\${${parentTablePrimaryKey}}`;
  const value = wrapWithQuotesIfText(parentColumn, "${value}");

  const method = `const ${getMethodNameForChild(table)} = (
  ${COL_ARRAY_VALUES}: ${table.property.type}[],
  ${parentTablePrimaryKey}: number,
): string[] => {
  const queries: string[] = [];

  ${COL_ARRAY_VALUES}.forEach((value, index) => {
    queries.push(
      \`REPLACE INTO ${
        table.name
      }(${COL_ARRAY_INDEX}, ${columnName}, ${COL_ARRAY_VALUE}) VALUES(\${index}, ${id}, ${value})\`
    );
  });

  return queries;
};
`;

  return method;
};

const generateReplaceEntryQuery = (
  table: AdvancedArrayTable | DefaultTable,
  tables: TableMap,
  addDeclaredTypeAsImport: (declaredType: DeclarationTypeMinimal) => void
) => {
  const primaryKey = table.primaryKey;
  if (!primaryKey) {
    throw Error(
      `could not resolve table entry ${table.name} without primary key`
    );
  }

  const getters: ChildrenGetter[] = [];
  table.declaredType.children.forEach((relation) => {
    getters.push({
      accessSyntax: `input.${relation.propertyName}`,
      relation,
    });
  });
  const childrenGetters = addChildrenQueries(
    table,
    primaryKey,
    getters,
    tables,
    false
  );
  const arrayTableGetters = addBasicArrayChildrenQueries(table, false, tables);

  const methodName = getMethodName(table);
  QueryExports.add(methodName);

  const pushes = getColumnValuePushesFromColumns(
    table,
    addDeclaredTypeAsImport,
    new Set<string>([primaryKey])
  );

  const method = `const ${methodName} = (
    input: Omit<Partial<${table.declaredType.name}>, '${primaryKey}'>,
    ${primaryKey}: number,
  ): string[] => {
  const queries: string[] = [];
  const columns: string[] = [];
  const values: string[] = [];
  
  columns.push('${primaryKey}');
  values.push(${primaryKey}.toString());

${pushes}
  if (columns.length === 0 || values.length === 0) {
    return [];
  }

  let query = "REPLACE INTO ${table.name}(";
  query += columns.join(", ");
  query += ") VALUES(";
  query += values.join(", ");
  query += ");";
  queries.push(query);

  ${childrenGetters}
  ${arrayTableGetters}

  return queries;
  };
`;

  return method;
};

const generateReplaceMultipleEntryQuery = (
  table: AdvancedArrayTable | DefaultTable
) => {
  const primaryKey = table.primaryKey;
  if (!primaryKey) {
    throw Error(
      `could not resolve table entry ${table.name} without primary key`
    );
  }

  const methodName = getMethodNameForMultiple(table);
  const entryMethodName = getMethodName(table);
  QueryExports.add(methodName);

  const method = `export const ${methodName} = (
  inputs: { input: Omit<Partial<${table.declaredType.name}>, '${primaryKey}'>, ${primaryKey}: number }[],
): string[] => {
  const queries: string[] = [];
  inputs.forEach(inputAndId => {
    queries.push(...${entryMethodName}(inputAndId.input, inputAndId.${primaryKey}));
  });

  return queries;
};
`;

  return method;
};

const generateReplaceOneToManyChildQuery = (
  table: AdvancedArrayTable,
  tables: TableMap
) => {
  const { parentTablePrimaryKey } = table;
  const foreignKey = table.foreignKeys.find(
    (fk) => fk.parentColumnName === parentTablePrimaryKey
  );
  if (!parentTablePrimaryKey || !foreignKey) {
    throw Error(
      `could not resolve parent primary key/foreign key for one-to-many table '${table.name}'`
    );
  }

  const { columnName } = foreignKey;

  const getters: ChildrenGetter[] = [];
  table.declaredType.children.forEach((relation) => {
    getters.push({
      accessSyntax: `input.${relation.propertyName}`,
      relation,
    });
  });
  const childrenGetters = addChildrenQueries(
    table,
    table.primaryKey ? `input.${table.primaryKey}` : undefined,
    getters,
    tables,
    true
  );
  const arrayTableGetters = addBasicArrayChildrenQueries(table, false, tables);

  const method = `const ${getMethodNameForChild(table)} = (
  inputs: ${table.declaredType.name}[],
  ${columnName}: number
): string[] => {
  const queries: string[] = [];
  
  inputs.forEach((input, index) => {
    queries.push(
      ...${getInsertMethodNameFromChild(table)}(
        input,
        ${columnName},
        index,
        true
      )
    );
    ${childrenGetters}
  });

  ${arrayTableGetters}
  
  return queries;
}
`;
  return method;
};

const generateReplaceOneToOneChildQuery = (
  table: DefaultTable,
  tables: TableMap
) => {
  const { parentTablePrimaryKey } = table;
  const foreignKey = table.foreignKeys.find(
    (fk) => fk.parentColumnName === parentTablePrimaryKey
  );
  if (!parentTablePrimaryKey || !foreignKey) {
    throw Error(
      `could not resolve parent primary key/foreign key for one-to-many table '${table.name}'`
    );
  }

  const { columnName } = foreignKey;

  const getters: ChildrenGetter[] = [];
  table.declaredType.children.forEach((relation) => {
    getters.push({
      accessSyntax: `input.${relation.propertyName}`,
      relation,
    });
  });
  const childrenGetters = addChildrenQueries(
    table,
    table.primaryKey ? `input.${table.primaryKey}` : undefined,
    getters,
    tables,
    true
  );
  const arrayTableGetters = addBasicArrayChildrenQueries(table, false, tables);

  const method = `const ${getMethodNameForChild(table)} = (
  input: ${table.declaredType.name},
  ${columnName}: number,
): string[] => {
  const queries: string[] = [];

  queries.push(
    ...${getInsertMethodNameFromChild(table)}(
      input,
      ${columnName},
      true
    )
  );

  ${childrenGetters}
  ${arrayTableGetters}
  
  return queries;
}
`;
  return method;
};

const getColumnToValueArray = (
  table: Table,
  ignoreValuesList: (string | undefined)[] = []
) => {
  const ignoreValues = new Set(ignoreValuesList);
  const columnList = Object.values(table.columns);
  let array = `${tab}const columnToValue: string[] = [];\n`;
  columnList.forEach((column) => {
    // other columns will be passed as arguments
    if (isPropertyBasedColumn(column) && !ignoreValues.has(column.name)) {
      const { property } = column;

      array += `${tab}if (typeof input.${property.accessSyntax} !== 'undefined') {\n`;
      array +=
        tab.repeat(2) +
        getColumnToValuePush(column, `input.${property.accessSyntax}`);
      array += `${tab}}\n`;
    }
  });
  array += `${tab}if (columnToValue.length === 0) {\n`;
  array += `${tab.repeat(2)}return [];\n`;
  array += `${tab}}\n`;

  return array;
};

const getColumnToValuePush = (column: Column, accessSyntax: string) => {
  const isDate =
    isPropertyBasedColumn(column) && column.property.type === PropertyType.Date;
  return `columnToValue.push(\`${getColumnToValue(
    column.name,
    accessSyntax,
    !isDate && column.type === DataType.TEXT,
    isPropertyBasedColumn(column) &&
      column.property.type === PropertyType.Boolean,
    isDate
  )}\`);\n`;
};

const getColumnToValue = (
  columnName: string,
  accessSyntax: string,
  isString: boolean,
  isBoolean: boolean,
  isDate: boolean
) => {
  if (isString) {
    return `${columnName}='\${${accessSyntax}.replace(/\'/g,"''")}'`;
  }
  if (isBoolean) {
    return `${columnName}='\${${accessSyntax} === true ? '1' : '0'}'`;
  }
  if (isDate) {
    return `${columnName}='\${${accessSyntax}.toISOString().replace(/\'/g,"''")}'`;
  }
  return `${columnName}=\${${accessSyntax}}`;
};

interface ChildrenGetter {
  relation: Relation;
  accessSyntax: string;
}
const addChildrenQueries = (
  table: Table,
  primaryKeyPropertyName: string | undefined,
  getters: ChildrenGetter[],
  tables: TableMap,
  checkIfPrimaryKeyIsThere: boolean
) => {
  let result = "";
  if (isBasicArrayTable(table)) {
    return result;
  }
  getters.forEach((getter) => {
    const { accessSyntax, relation } = getter;
    const childTable = tables[relation.child.name];
    const childMethod = getMethodNameForChild(childTable);
    const condition = `${accessSyntax}${
      checkIfPrimaryKeyIsThere && primaryKeyPropertyName
        ? ` && ${primaryKeyPropertyName}`
        : ""
    }`;

    const args = `${accessSyntax}, ${primaryKeyPropertyName ?? "undefined"}`;

    result += `  if (${condition}) {
    queries.push(
      ...${childMethod}(${args})
    );
  }
  `;
  });

  return result;
};

const addBasicArrayChildrenQueries = (
  table: Table,
  isCompositeType: boolean,
  tables: TableMap
) => {
  let result = "";
  if (!table.primaryKey) return result;

  if (!isBasicArrayTable(table) && table.arrayTables.length > 0) {
    table.arrayTables.forEach((arrayTableName) => {
      const arrayTable = tables[arrayTableName] as BasicArrayTable;
      const { property } = arrayTable;
      const objRef = isCompositeType
        ? `(input as ${property.declaredType.name})`
        : "input";

      const selector = `${objRef}.${property.accessSyntax}`;
      let prefix = tab;

      result += `${tab}if (${selector}) {\n`;
      prefix += tab;

      result += `${prefix}queries.push(\n`;
      result += `${prefix + tab}...${getMethodNameForChild(
        arrayTable
      )}(${selector}, ${table.primaryKey}),\n`;
      result += `${prefix});\n`;

      result += `${tab}}\n`;
    });
    result += "\n";
  }

  return result;
};

export const wrapWithQuotesIfText = (column: Column, value: string) => {
  if (column.type === DataType.TEXT) {
    return `'${value}'`;
  }

  return value;
};

const getMethodName = (table: Table) => `replace${table.name}`;
const getMethodNameForMultiple = (table: Table) => `replace${table.name}s`;
const getMethodNameForChild = (table: Table) => `replace${table.name}AsChild`;
