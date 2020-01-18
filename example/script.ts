import fs from "fs-extra";
import path from "path";
import sqlite3 from "sqlite3";
import { generator } from "../src";
import { Phase, ArticleType } from "./models";

generator(
  [path.join(__dirname, "models.ts")],
  path.join(__dirname, "../tsconfig.json"),
  path.join(__dirname, "__generated__/schema.ts"),
  path.join(__dirname, "__generated__/helpers.ts")
);

// eslint-disable-next-line import/no-dynamic-require, @typescript-eslint/no-var-requires
const schema = require(path.join(__dirname, "__generated__/schema.ts"));
// eslint-disable-next-line import/no-dynamic-require, @typescript-eslint/no-var-requires
const helpers = require(path.join(__dirname, "__generated__/helpers.ts"));

const sqlite = sqlite3.verbose();
const dbPath = path.join(__dirname, "__generated__/test.db");

if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new sqlite.Database(dbPath);

const phase: Phase = {
  name: "phase",
  phaseId: 1,
  values: ["hallo", "hoi", "hey"],
  articles: [
    {
      articleId: 1,
      title: "article 1",
      url: "http://blaat.com",
      content: "content",
      type: ArticleType.B,
      position: "left",
      compositeType: {
        a: "a"
      },
      compositeTypeArray: [
        {
          a: "a"
        },
        {
          b: "b"
        },
        {
          c: "c"
        }
      ]
    }
  ]
};

const insertQueries = helpers.getInsertPhaseQueries(phase);

db.serialize(async () => {
  for (const query of schema.Schema) {
    db.exec(query, err => {
      if (err) {
        console.log("error", err, query);
      }
    });
  }
  for (const query of insertQueries) {
    db.exec(query, err => {
      if (err) {
        console.log("error", err, query);
      }
    });
  }
});

db.close();
