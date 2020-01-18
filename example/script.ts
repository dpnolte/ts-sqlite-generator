import fs from "fs-extra";
import path from "path";
import sqlite3 from "sqlite3";
import { generator } from "../src";

generator(
  [path.join(__dirname, "models.ts")],
  path.join(__dirname, "__generated__/schema.ts"),
  path.join(__dirname, "../tsconfig.json")
);

// eslint-disable-next-line import/no-dynamic-require, @typescript-eslint/no-var-requires
const schema = require(path.join(__dirname, "__generated__/schema.ts"));

const sqlite = sqlite3.verbose();
const dbPath = path.join(__dirname, "__generated__/test.db");

if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new sqlite.Database(dbPath);

db.serialize(async () => {
  for (const query of schema.Schema) {
    db.exec(query, err => {
      if (err) {
        console.log("error", err, query);
      }
    });
  }
});

db.close();
