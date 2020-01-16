import fs from "fs-extra";
import path from "path";
import { resolveTypes } from "./resolver";
import { generateQueries } from "./generator";

export const generator = (
  rootFilePaths: string[],
  targetPath: string,
  tsConfigPath: string
) => {
  console.log("start");

  fs.ensureDirSync(path.dirname(targetPath));

  const tables = resolveTypes(rootFilePaths, tsConfigPath);
  generateQueries(tables, targetPath);

  console.log("done, output path:");
  console.log(path.relative(process.cwd(), targetPath));
};
