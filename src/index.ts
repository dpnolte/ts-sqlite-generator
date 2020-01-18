import fs from "fs-extra";
import path from "path";
import { generateQueries } from "./generator";
import { resolveModels } from "./resolveModels";
import { Tags, resolveTables } from "./resolveTables";

const defaultTags: Tags = {
  model: "sqlite_table",
  primaryKey: "sqlite_primary_key",
  index: "sqlite_index",
  unique: "sqlite_uniq",
  autoIncrement: "sqlite_auto_increment",
  real: "sqlite_real",
  numeric: "sqlite_numeric"
};

export const generator = (
  rootFilePaths: string[],
  targetPath: string,
  tsConfigPath: string,
  tags?: Tags
) => {
  console.log("start");

  fs.ensureDirSync(path.dirname(targetPath));

  const rootTypes = resolveModels(
    rootFilePaths,
    tsConfigPath,
    tags?.model ?? defaultTags.model
  );

  const tables = resolveTables(rootTypes, tags ?? defaultTags);

  generateQueries(tables, targetPath);

  console.log("done, output path:");
  console.log(path.relative(process.cwd(), targetPath));
};
