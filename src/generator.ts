import path from "path";
import fs from "fs-extra";

import { TableMap } from "./resolveTables";
import { generateSchemaQueries } from "./generateSchemaQueries";
import { generateInsertQueries } from "./generateInsertQueries";
import { generateUpdateQueries } from "./generateUpdateQueries";
import { ImportMap, generateImports } from "./generateImports";
import { generateDeleteQueries } from "./generateDeleteQueries";
import { generateExports } from "./generateExports";

export const generateQueries = (
  tables: TableMap,
  targetSchemaPath: string,
  targetHelpersPath?: string
) => {
  console.log("> generating queries");
  if (fs.existsSync(targetSchemaPath)) {
    fs.unlinkSync(targetSchemaPath);
  }
  if (targetHelpersPath && fs.existsSync(targetHelpersPath)) {
    fs.unlinkSync(targetHelpersPath);
  }

  const schemaQueries = generateSchemaQueries(tables, targetSchemaPath);
  fs.writeFileSync(targetSchemaPath, schemaQueries);

  const imports: ImportMap = {};
  const helpersPath = targetHelpersPath ?? targetSchemaPath;

  const insertQueries = generateInsertQueries(tables, helpersPath, imports);
  const updateQueries = generateUpdateQueries(tables, helpersPath, imports);
  const deleteQueries = generateDeleteQueries(tables, helpersPath, imports);

  let content = "// Auto-generated, do not edit!\n";
  content += generateImports(imports);
  content += "\n";
  content += insertQueries;
  content += deleteQueries;
  content += updateQueries;
  content += "\n";
  content += generateExports();

  const shouldAppend = !!targetHelpersPath;

  if (shouldAppend) {
    fs.appendFileSync(helpersPath, content);
  } else {
    fs.writeFileSync(helpersPath, content);
  }

  console.log("> finished generating queries");
};
