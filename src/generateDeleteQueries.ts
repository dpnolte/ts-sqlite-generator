import path from "path";

import {
  Table,
  TableMap,
  DefaultTable,
  AdvancedArrayTable,
  isBasicArrayTable,
  getProperties
} from "./resolveTables";
import { QueryExports } from "./generateExports";

import { PropertyType, PropertyDeclaration } from "./resolveModels";
import { ImportMap } from "./generateImports";

export const generateDeleteQueries = (
  tables: TableMap,
  targetPath: string,
  imports: ImportMap
) => {
  let content = "";
  const targetDir = path.dirname(targetPath);

  Object.values(tables).forEach(table => {
    if (table.declaredType.isEntry && !isBasicArrayTable(table)) {
      const relativePath = path.relative(targetDir, table.declaredType.path);
      content += `// delete query based on ${table.declaredType.name} type definitions in ${relativePath}\n`;
      content += generateDeleteQueriesForEntry(table);
      content += generateDeleteQueriesForMultipleEntries(table);
    }
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

  let method = `const ${methodName} = (${primaryKey}s: number[]): string[] => {
  const queries: string[] = [];

  ${primaryKey}s.forEach(${primaryKey} => {
    queries.push(...${methodNameEntry}(${primaryKey}));
  });
  return queries;
}
`;
  return method;
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

const getMethodName = (table: Table) => `delete${table.name}`;
const getMethodNameForMultiple = (table: Table) => `delete${table.name}s`;
