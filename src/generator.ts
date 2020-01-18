import { TableMap } from "./resolveTables";
import { generateSchemaQueries } from "./generateSchemaQueries";
import { generateInsertQueries } from "./generateInsertQueries";

export const generateQueries = (
  tables: TableMap,
  targetSchemaPath: string,
  targetHelpersPath?: string
) => {
  generateSchemaQueries(tables, targetSchemaPath);
  generateInsertQueries(
    tables,
    targetHelpersPath ?? targetSchemaPath,
    !targetHelpersPath
  );
};
