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
  COL_ARRAY_INDEX,
  COL_ARRAY_VALUE,
  DefaultTable,
  AdvancedArrayTable,
} from "./resolveTables";
import {
  isComposite,
  DeclarationTypeMinimal,
  RelationType,
  PropertyType,
} from "./resolveModels";
import { addNamedImport, ImportMap } from "./generateImports";
import { QueryExports } from "./generateExports";

const tab = "  ";

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
export const generateInsertQueries = (
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

    body += `// insert query based on ${table.declaredType.name} type definitions in ${relativePath}\n`;

    // D - basic array table
    if (isBasicArrayTable(table)) {
      body += generateInsertBasicArrayQuery(table, tables);
    } else {
      addNamedImport(table.declaredType, imports, targetDir);

      if (table.declaredType.isEntry) {
        // A + C
        body += generateInsertEntryQuery(
          table,
          tables,
          addDeclaredTypeAsImport
        );
        body += generateInsertMultipleEntryQuery(table);
      }

      if (table.parentTableName) {
        // B - child only (one to many)
        if (isAdvancedArrayTable(table)) {
          addNamedImport(table.declaredType, imports, targetDir);

          body += generateInsertOneToManyChildQuery(
            table,
            tables,
            addDeclaredTypeAsImport
          );
          // B - child only (one to one)
        } else {
          body += generateInsertOneToOneChildQuery(
            table,
            tables,
            addDeclaredTypeAsImport
          );
        }
      }
    }
  });

  return body;
};

const generateInsertBasicArrayQuery = (
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

  const parentTable = tables[parentTableName];
  const parentColumn = parentTable.columns[foreignKey.parentColumnName];

  const pushes = getColumnValuePushes([
    {
      columnName: parentTablePrimaryKey,
      value: `\${${parentTablePrimaryKey}}`,
      type: parentColumn.type,
    },
    {
      columnName: COL_ARRAY_VALUE,
      value: `\${${COL_ARRAY_VALUE}}`,
      type: table.columns[COL_ARRAY_VALUE].type,
    },
    {
      columnName: COL_ARRAY_INDEX,
      value: `\${${COL_ARRAY_INDEX}}`,
      type: DataType.INTEGER,
    },
  ]);

  const method = `const ${getInsertMethodNameFromChild(table)} = (
    ${parentTablePrimaryKey}: ${
    parentTable.columns[parentTablePrimaryKey].type === DataType.TEXT
      ? "string"
      : "number"
  },
    ${COL_ARRAY_VALUE}: ${table.property.type},
  ${COL_ARRAY_INDEX}: number,
  useReplace = false
): string[] => {
  const queries: string[] = [];
  const columns: string[] = [];
  const values: string[] = [];

${pushes}
  if (columns.length === 0 || values.length === 0) {
    return [];
  }

  let query = \`\${useReplace ? 'REPLACE' : 'INSERT'} INTO ${table.name}(\`;
  query += columns.join(", ");
  query += ") VALUES(";
  query += values.join(", ");
  query += ");";
  queries.push(query);

  return queries;
};
`;
  return method;
};

const generateInsertEntryQuery = (
  table: DefaultTable | AdvancedArrayTable,
  tables: TableMap,
  addDeclaredTypeAsImport: (declaredType: DeclarationTypeMinimal) => void
) => {
  const methodName = getInsertMethodName(table);
  QueryExports.add(methodName);

  const pushes = getColumnValuePushesFromColumns(
    table,
    addDeclaredTypeAsImport
  );

  const method = `const ${methodName} = (
    input: ${table.declaredType.name},
  ): string[] => {
  const queries: string[] = [];
  const columns: string[] = [];
  const values: string[] = [];

${pushes}
  if (columns.length === 0 || values.length === 0) {
    return [];
  }

  let query = "INSERT INTO ${table.name}(";
  query += columns.join(", ");
  query += ") VALUES(";
  query += values.join(", ");
  query += ");";
  queries.push(query);

${addChildrenQueries(table, tables, addDeclaredTypeAsImport, true)}
${addBasicArrayChildrenQueries(table, tables, addDeclaredTypeAsImport, true)}

  return queries;
  };
`;
  return method;
};

const generateInsertMultipleEntryQuery = (
  table: AdvancedArrayTable | DefaultTable
) => {
  const methodName = getInsertMultipleMethodName(table);
  const entryMethodName = getInsertMethodName(table);
  QueryExports.add(methodName);

  const method = `export const ${methodName} = (
  inputs: ${table.declaredType.name}[],
): string[] => {
  const queries: string[] = [];
  inputs.forEach(input => {
    queries.push(...${entryMethodName}(input));
  });

  return queries;
};
`;

  return method;
};

const generateInsertOneToManyChildQuery = (
  table: AdvancedArrayTable,
  tables: TableMap,
  addDeclaredTypeAsImport: (declaredType: DeclarationTypeMinimal) => void
) => {
  const { parentTablePrimaryKey, parentTableName } = table;
  const foreignKey = table.foreignKeys.find(
    (fk) => fk.parentColumnName === parentTablePrimaryKey
  );
  if (!parentTablePrimaryKey || !parentTableName || !foreignKey) {
    throw Error(
      `could not resolve parent primary key/foreign key for one-to-many table '${table.name}'`
    );
  }

  const parentTable = tables[parentTableName];
  const parentColumn = parentTable.columns[foreignKey.parentColumnName];

  let pushes = getColumnValuePushes([
    {
      columnName: parentTablePrimaryKey,
      value: `\${${parentTablePrimaryKey}}`,
      type: parentColumn.type,
    },
    {
      columnName: COL_ARRAY_INDEX,
      value: `\${${COL_ARRAY_INDEX}}`,
      type: DataType.INTEGER,
    },
  ]);

  pushes += getColumnValuePushesFromColumns(table, addDeclaredTypeAsImport);

  const method = `const ${getInsertMethodNameFromChild(table)} = (
    input: ${table.declaredType.name},
    ${parentTablePrimaryKey}: ${
    parentTable.columns[parentTablePrimaryKey].type === DataType.TEXT
      ? "string"
      : "number"
  },
    ${COL_ARRAY_INDEX}: number,
    useReplace = false,
  ): string[] => {
  const queries: string[] = [];
  const columns: string[] = [];
  const values: string[] = [];

${pushes}
  if (columns.length === 0 || values.length === 0) {
    return [];
  }

  let query = \`\${useReplace ? 'REPLACE' : 'INSERT'} INTO ${table.name}(\`;
  query += columns.join(", ");
  query += ") VALUES(";
  query += values.join(", ");
  query += ");";
  queries.push(query);

${addChildrenQueries(table, tables, addDeclaredTypeAsImport, false) ?? ""}
${
  addBasicArrayChildrenQueries(table, tables, addDeclaredTypeAsImport, false) ??
  ""
}

  return queries;
  };
`;
  return method;
};

const generateInsertOneToOneChildQuery = (
  table: DefaultTable,
  tables: TableMap,
  addDeclaredTypeAsImport: (declaredType: DeclarationTypeMinimal) => void
) => {
  const { parentTablePrimaryKey, parentTableName } = table;
  const foreignKey = table.foreignKeys.find(
    (fk) => fk.parentColumnName === parentTablePrimaryKey
  );
  if (!parentTablePrimaryKey || !parentTableName || !foreignKey) {
    throw Error(
      `could not resolve parent primary key/foreign key for one-to-many table '${table.name}'`
    );
  }

  const parentTable = tables[parentTableName];
  const parentColumn = parentTable.columns[foreignKey.parentColumnName];

  let pushes = getColumnValuePushes([
    {
      columnName: parentTablePrimaryKey,
      value: `\${${parentTablePrimaryKey}}`,
      type: parentColumn.type,
    },
  ]);

  pushes += getColumnValuePushesFromColumns(table, addDeclaredTypeAsImport);

  const method = `const ${getInsertMethodNameFromChild(table)} = (
    input: ${table.declaredType.name},
    ${parentTablePrimaryKey}: ${
    parentTable.columns[parentTablePrimaryKey].type === DataType.TEXT
      ? "string"
      : "number"
  },
    useReplace = false,
  ): string[] => {
  const queries: string[] = [];
  const columns: string[] = [];
  const values: string[] = [];

${pushes}
  if (columns.length === 0 || values.length === 0) {
    return [];
  }

  let query = \`\${useReplace ? 'REPLACE' : 'INSERT'} INTO ${table.name}(\`;
  query += columns.join(", ");
  query += ") VALUES(";
  query += values.join(", ");
  query += ");";
  queries.push(query);

${addChildrenQueries(table, tables, addDeclaredTypeAsImport, false) ?? ""}
${
  addBasicArrayChildrenQueries(table, tables, addDeclaredTypeAsImport, false) ??
  ""
}

  return queries;
  };
`;
  return method;
};

interface ColumnValueItem {
  columnName: string;
  value: string;
  type: DataType;
}
const getColumnValuePushes = (items: ColumnValueItem[]) => {
  let pushes = "";
  items.forEach((item) => {
    const value =
      item.type === DataType.TEXT ? `\`'${item.value}'\`` : `\`${item.value}\``;
    pushes += `  columns.push('${item.columnName}');
  values.push(${value});
`;
  });

  return pushes;
};

export const getColumnValuePushesFromColumns = (
  table: DefaultTable | AdvancedArrayTable,
  addDeclaredTypeAsImport: (declaredType: DeclarationTypeMinimal) => void,
  exclude: Set<string> = new Set<string>()
): string => {
  const columnList = Object.values(table.columns);
  let pushes = "";
  columnList.forEach((column) => {
    // other columns will be passed as arguments
    if (isPropertyBasedColumn(column) && !exclude.has(column.name)) {
      const { property } = column;

      const objRef = isComposite(table.declaredType)
        ? `(input as ${property.declaredType.name})`
        : "input";

      const selector = `${objRef}.${property.accessSyntax}`;

      if (isComposite(table.declaredType)) {
        addDeclaredTypeAsImport(property.declaredType);
      }

      let value: string;
      if (
        isPropertyBasedColumn(column) &&
        column.property.type === PropertyType.Date
      ) {
        value = `\`'\${${selector}.toISOString().replace(/\'/g,"''")}'\``;
      } else if (column.type === DataType.TEXT) {
        value = `\`'\${${selector}.replace(/\'/g,"''")}'\``;
      } else if (
        isPropertyBasedColumn(column) &&
        column.property.type === PropertyType.Boolean
      ) {
        value = `${selector} === true ? '1' : '0'`;
      } else {
        value = `${selector}.toString()`;
      }

      if (property.isOptional || isComposite(table.declaredType)) {
        pushes += `  if(typeof ${selector} !== 'undefined') {
    columns.push('${column.name}');
    values.push(${value});
  }
`;
      } else {
        pushes += `  if(typeof ${selector} !== 'undefined') {
    columns.push('${column.name}');
    values.push(${value});
  }
`;
      }
    }
  });
  return pushes;
};

const addChildrenQueries = (
  table: DefaultTable | AdvancedArrayTable,
  tables: TableMap,
  addDeclaredTypeAsImport: (declaredType: DeclarationTypeMinimal) => void,
  isInsertQueryForEntry: boolean
) => {
  const { primaryKey } = table;
  if (!primaryKey) {
    return "";
  }

  const useReplace = isInsertQueryForEntry ? "false" : "useReplace";

  let result = "";
  table.declaredType.children.forEach((relation) => {
    const childTable = tables[relation.child.name];
    const property = getProperties(table.declaredType)[relation.propertyName];
    let objRef = "input";
    if (isComposite(table.declaredType)) {
      addDeclaredTypeAsImport(property.declaredType);
      objRef = `(input as ${property.declaredType.name})`;
    }
    const selector = `${objRef}.${property.accessSyntax}`;
    const pk = `${objRef}.${primaryKey}`;
    const method = getInsertMethodNameFromChild(childTable);

    if (property.isOptional) {
      if (relation.type === RelationType.OneToOne) {
        result += `  if (${selector}) {
    queries.push(...${method}(${selector}, ${pk}, ${useReplace}));
  }
`;
      } else if (relation.type === RelationType.OneToMany) {
        result += `  if (${selector}) {
    queries.push(...${selector}.reduce((list, child, index, ${useReplace}) => {
      list.push(...${method}(child, ${pk}, index, ${useReplace}));
      return list;
    }, [] as string[]));
  }
`;
      }
      // non-optional
    } else {
      if (relation.type === RelationType.OneToOne) {
        result += `  queries.push(...${method}(${selector}, ${pk}, ${useReplace}));
`;
      } else if (relation.type === RelationType.OneToMany) {
        result += `  queries.push(...${selector}.reduce((list, child, index) => {
    list.push(...${method}(child, ${pk}, index, ${useReplace}));
    return list;
  }, [] as string[]));
`;
      }
    }
  });

  return result;
};

const addBasicArrayChildrenQueries = (
  table: Table,
  tables: TableMap,
  addDeclaredTypeAsImport: (declaredType: DeclarationTypeMinimal) => void,
  isInsertQueryForEntry: boolean
) => {
  let result = "";
  if (!table.primaryKey) return result;

  if (!isBasicArrayTable(table) && table.arrayTables.length > 0) {
    const useReplace = isInsertQueryForEntry ? "false" : "useReplace";
    table.arrayTables.forEach((arrayTableName) => {
      const arrayTable = tables[arrayTableName] as BasicArrayTable;
      const { property } = arrayTable;
      const objRef = isComposite(table.declaredType)
        ? `(input as ${property.declaredType.name})`
        : "input";
      if (isComposite(table.declaredType)) {
        addDeclaredTypeAsImport(table.declaredType);
      }

      const selector = `${objRef}.${property.accessSyntax}`;
      const pk = `${objRef}.${table.primaryKey}`;
      const method = getInsertMethodNameFromChild(arrayTable);

      if (property.isOptional) {
        result += `  if (${selector}) {
      queries.push(...${selector}.reduce((list, child, index) => {
        list.push(...${method}(${pk}, child, index, ${useReplace}));
        return list;
      }, [] as string[]));
    }
  `;

        // non-optional
      } else {
        result += `  queries.push(...${selector}.reduce((list, child, index) => {
      list.push(...${method}(${pk}, child, index, ${useReplace}));
      return list;
    }, [] as string[]));
  `;
      }
    });
    result += "\n";
  }

  return result;
};

export const getInsertMethodName = (table: Table) => `insert${table.name}`;
const getInsertMultipleMethodName = (table: Table) => `insert${table.name}s`;
export const getInsertMethodNameFromChild = (table: Table) =>
  `insert${table.name}AsChild`;
