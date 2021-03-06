import fs from "fs-extra";
import path from "path";

import { TableMap } from "./resolveTables";

export const generateSchemaQueries = (tables: TableMap, targetPath: string) => {
  let content = "// Auto-generated, do not edit\n";
  content += "/* eslint-disable */\n\n";

  const queryNames: string[] = [];
  const tab = "  ";
  const targetDir = path.dirname(targetPath);

  Object.values(tables).forEach((table) => {
    const relativePath = path.relative(targetDir, table.declaredType.path);
    content += `// table based on ${table.declaredType.name} type definitions in ${relativePath}\n`;

    const queryName = `${table.name}SQL`;
    queryNames.push(queryName);
    content += `export const ${queryName} = \``;
    content += `CREATE TABLE IF NOT EXISTS ${table.name} (\n`;

    const columns = Object.values(table.columns);
    const lastColumnsIndex = columns.length - 1;

    columns.forEach((column, index) => {
      content += `${tab}${column.name} ${column.type}`;
      if (table.primaryKey === column.name) {
        content += " PRIMARY KEY";
      } else {
        if (column.notNull) {
          content += " NOT NULL";
        } else {
          content += " DEFAULT NULL";
        }
      }
      if (column.autoIncrement) {
        // avoid -->
        content += " AUTOINCREMENT";
      }
      if (column.unique) {
        content += " UNIQUE";
      }

      if (lastColumnsIndex === index && table.foreignKeys.length === 0) {
        content += "\n";
      } else {
        content += ",\n";
      }
    });

    if (table.foreignKeys.length > 0) {
      const lastForeignKeyIndex = table.foreignKeys.length - 1;
      table.foreignKeys.forEach((foreignKey, index) => {
        content += `${tab}FOREIGN KEY(${foreignKey.columnName}) `;
        content += `REFERENCES ${foreignKey.parentTableName}(${foreignKey.parentColumnName})`;
        content += " ON DELETE CASCADE";
        if (index === lastForeignKeyIndex) {
          content += "\n";
        } else {
          content += ",\n";
        }
      });
    }

    content += ");\n";
    content += "`;\n\n";

    table.indices.forEach((index, i) => {
      const indexNumber = i + 1;
      const indexName = `${table.name}_i${indexNumber}`;
      content += `export const ${table.name}_i${indexNumber}_SQL = "CREATE ${
        index.unique ? "UNIQUE " : ""
      }INDEX ${indexName} ON ${table.name}(${index.columnNames.join(
        ", "
      )})";\n\n`;
      queryNames.push(`${indexName}_SQL`);
    });
  });

  content += `export const Schema = [\n${tab}${queryNames.join(
    `,\n${tab}`
  )},\n];\n`;

  return content;
};
