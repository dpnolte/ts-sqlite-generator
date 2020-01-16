import path from "path";
import { generator } from "../src";

generator(
  [path.join(__dirname, "models.ts")],
  path.join(__dirname, "__generated__/schema.ts"),
  path.join(__dirname, "../tsconfig.json")
);
