import fs from "fs-extra";
import path from "path";
import { generateQueries } from "./generator";
import { resolveModels } from "./resolveModels";
import { Tags, resolveTables } from "./resolveTables";

const defaultTags: Tags = {
  entry: "sqlite_entry",
  primaryKey: "sqlite_primary_key",
  index: "sqlite_index",
  unique: "sqlite_unique",
  autoIncrement: "sqlite_auto_increment",
  real: "sqlite_real",
  numeric: "sqlite_numeric",
};

export const generator = (
  rootFilePaths: string[],
  tsConfigPath: string,
  targetSchemaPath: string,
  targetHelpersPath?: string,
  tags?: Tags,
  strict = true
) => {
  console.log("start");

  fs.ensureDirSync(path.dirname(targetSchemaPath));
  if (targetHelpersPath) {
    fs.ensureDirSync(path.dirname(targetHelpersPath));
  }

  const rootTypes = resolveModels(
    rootFilePaths,
    tsConfigPath,
    tags ?? defaultTags,
    strict
  );

  const tables = resolveTables(rootTypes, tags ?? defaultTags);

  generateQueries(tables, targetSchemaPath, targetHelpersPath);

  console.log(`done, output path${targetHelpersPath ? "s" : ""}:`);
  console.log(path.relative(process.cwd(), targetSchemaPath));
  if (targetHelpersPath) {
    console.log(path.relative(process.cwd(), targetHelpersPath));
  }
};
