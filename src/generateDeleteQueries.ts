import path from "path";

import {
  Table,
  TableMap,
  DefaultTable,
  AdvancedArrayTable,
  isBasicArrayTable,
  BasicArrayTable,
  getProperties
} from "./resolveTables";
import { QueryExports } from "./generateExports";

import {
  PropertyType,
  PropertyDeclaration,
  isComposite
} from "./resolveModels";
import { ImportMap } from "./generateImports";

export const generateDeleteQueries = (
  tables: TableMap,
  targetPath: string,
  imports: ImportMap
) => {
  let content = "";
  const targetDir = path.dirname(targetPath);

  Object.values(tables).forEach(table => {
    // let deleted = false;
    // if (isBasicArrayTable(table)) {
    //   generateDeleteQueriesForBasicArray(table);
    //   deleted = true;
    // } else {

    if (table.declaredType.isEntry && !isBasicArrayTable(table)) {
      const relativePath = path.relative(targetDir, table.declaredType.path);
      content += `// delete query based on ${table.declaredType.name} type definitions in ${relativePath}\n`;
      content += generateDeleteQueriesForEntry(table);
      content += generateDeleteQueriesForMultipleEntries(table);
    }
    //     deleted = true;
    // //   }
    // // //   // table can be both an entry and a child
    // // //   if (table.parentTablePrimaryKey) {
    // // //     generateDeleteQueriesForChild(table, tables);
    // // //     deleted = true;
    // // //   }
    // // // }

    // // // if (!deleted) {
    // // //   throw Error(`Could not generate delete query for ${table.name}`);
    // // // }
  });
  return content;
};

const generateDeleteQueriesForEntry = (
  table: DefaultTable | AdvancedArrayTable
) => {
  const { primaryKey } = table;
  if (!primaryKey) {
    throw Error(`Could not resolve entry '${table.name}' without primary key`);
  }

  const methodName = getMethodName(table);
  QueryExports.add(methodName);

  const properties = getProperties(table.declaredType);
  const property = properties[primaryKey];
  const value = wrapWithQuotesIfString(property, `\${${property.name}}`);

  let method = `const ${methodName} = (${property.name}: ${property.type}): string[] => {
  const queries: string[] = [];

  queries.push(\`DELETE FROM ${table.name} WHERE ${property.name}=${value}\`);

  return queries;
}
`;
  return method;
};

const generateDeleteQueriesForMultipleEntries = (
  table: DefaultTable | AdvancedArrayTable
) => {
  const { primaryKey } = table;
  if (!primaryKey) {
    throw Error(`Could not resolve entry '${table.name}' without primary key`);
  }

  const methodNameEntry = getMethodName(table);
  const methodName = getMethodNameForMultiple(table);
  QueryExports.add(methodName);

  let method = `const ${methodName} = (inputs: ${table.declaredType.name}[]): string[] => {
  const queries: string[] = [];

  inputs.forEach(input => {
    queries.push(...${methodNameEntry}(input.${table.primaryKey}));
  });
  return queries;
}
`;
  return method;
};

const generateDeleteQueriesForChild = (
  table: DefaultTable | AdvancedArrayTable,
  tables: TableMap
) => {
  if (!table.parentTableName || !table.parentTablePrimaryKey) {
    throw Error(
      `Could not resolve child '${table.name}' without table parent name or primary key`
    );
  }

  const parentTable = tables[table.parentTableName];
  const properties = getProperties(parentTable.declaredType);
  const property = properties[table.parentTablePrimaryKey];

  let method = `const ${getMethodNameForChild(table)} = (${property.name}: ${
    property.type
  }): string[] => {
  const queries: string[] = [];

  return queries.push(\`DELETE FROM ${table.name} WHERE ${
    property.name
  }={${wrapWithQuotesIfString(property, `\`\${${property.name}}\``)}}\`)
}
`;
  return method;
};

const generateDeleteQueriesForBasicArray = (table: BasicArrayTable) => {
  const { property } = table;

  let method = `const ${getMethodNameForChild(table)} = (${property.name}: ${
    property.type
  }): string[] => {
  const queries: string[] = [];

  queries.push(\`DELETE FROM ${table.name} WHERE ${
    property.name
  }={${wrapWithQuotesIfString(property, `\`\${${property.name}}\``)}}\`)
}
`;
  return method;
};

const getDeleteQueriesForChildren = (table: Table, tables: TableMap) => {
  if (isBasicArrayTable(table)) {
    return "";
  }

  let statements = "";

  const properties = getProperties(table.declaredType);
  table.declaredType.children.forEach(child => {
    const property = properties[child.propertyName];
    const objRef = isComposite(table.declaredType)
      ? `(input as ${property.declaredType.name})`
      : "input";
    const propRef = `${objRef}.${property.accessSyntax}`;

    const childTable = tables[child.child.name];
    const methodName = getMethodNameForChild(childTable);

    if (property.isOptional || isComposite(childTable.declaredType)) {
      statements += `  if (typeof ${propRef} !== 'undefined') {
  queries.push(...${methodName}(${propRef}));
}
`;
    } else {
      statements += `  queries.push(...${methodName}(${propRef}));`;
    }
  });

  statements += "\n";

  return statements;
};

const getDeleteQueriesForArrayTables = (table: Table, tables: TableMap) => {
  if (isBasicArrayTable(table)) {
    return "";
  }

  let statements = "";

  return statements;
};

export const wrapWithQuotesIfString = (
  property: PropertyDeclaration,
  value: string
) => {
  if (
    property.type === PropertyType.String ||
    property.type === PropertyType.Date
  ) {
    return `'${value}'`;
  }

  return value;
};

const getMethodName = (table: Table) => `delete${table.name}Queries`;
const getMethodNameForMultiple = (table: Table) =>
  `delete${table.name}sQueries`;
const getMethodNameForChild = (table: Table) =>
  `delete${table.name}AsChildQueries`;
