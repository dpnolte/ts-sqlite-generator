import fs from "fs-extra";

import { TableMap } from "./resolveTables";
import { generateSchemaQueries } from "./generateSchemaQueries";
import { generateInsertQueries } from "./generateInsertQueries";
import { generateReplaceQueries } from "./generateReplaceQueries";
import { ImportMap, generateImports } from "./generateImports";
import { generateDeleteQueries } from "./generateDeleteQueries";
import { generateExports } from "./generateExports";
import { generateUpdateQueries } from "./generateUpdateQueries";

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
  const replaceQueries = generateReplaceQueries(tables, helpersPath, imports);
  // update not yet supported
  // const updateQueries = generateUpdateQueries(tables, helpersPath, imports);
  const deleteQueries = generateDeleteQueries(tables, helpersPath, imports);

  let content = "// Auto-generated, do not edit!\n";
  content += "/* eslint-disable */\n";
  content += generateImports(imports);
  content += "\n";
  content += insertQueries;
  content += deleteQueries;
  content += replaceQueries;
  // update not yet supported
  // content += updateQueries;
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
