import fs from "fs-extra";

import { Tables } from "./resolver";

// TODO add support for unique
export const generateQueries = (tables: Tables, targetPath: string) => {
  console.log("> generating create table queries");

  const sortedTables = Object.values(tables).sort(
    (a, b) => b.table.rank - a.table.rank
  );

  let content = "// Auto-generated, do not edit\n\n";

  const queryNames: string[] = [];
  const tab = "  ";
  sortedTables.forEach(item => {
    content += `// table based on interface from ${item.relativePath}\n`;
    const { table } = item;
    const queryName = `${table.name}SQL`;
    queryNames.push(queryName);
    content += `export const ${queryName} = \``;
    content += `CREATE TABLE IF NOT EXISTS ${table.name} (\n`;

    const indices: string[] = [];
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
        // avoid -->
        content += " UNIQUE";
      }
      if (column.foreignKey) {
        content += ",\n";
        content += `${tab}FOREIGN KEY (${column.foreignKey.fromTableColumnName})\n`;
        content += `${tab.repeat(2)}REFERENCES ${
          column.foreignKey.toTable.name
        } (${column.foreignKey.toTableColumnName})`;
      }

      if (lastColumnsIndex === index) {
        content += "\n";
      } else {
        content += ",\n";
      }

      if (column.index) {
        indices.push(column.name);
      }
    });
    content += ");\n";
    if (indices.length > 0) {
      indices.forEach((columnName, index) => {
        const nextIndex = index + 1;
        content += `CREATE INDEX ${table.name}_i${nextIndex} ON ${table.name}(${columnName});\n`;
      });
    }
    content += "`;\n\n";
  });

  content += `export const CreateTableQueries = [\n${tab}${queryNames.join(
    `,\n${tab}`
  )},\n];\n`;

  fs.writeFileSync(targetPath, content);

  console.log("> finished generating table queries");
};
