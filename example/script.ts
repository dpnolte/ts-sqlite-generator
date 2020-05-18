import fs from "fs-extra";
import path from "path";
import sqlite3 from "sqlite3";
import { generator } from "../src";
import { Phase, ArticleType, Article } from "./models";

generator(
  [path.join(__dirname, "models.ts")],
  path.join(__dirname, "../tsconfig.json"),
  path.join(__dirname, "__generated__/schema.ts"),
  path.join(__dirname, "__generated__/helpers.ts")
);

// eslint-disable-next-line import/no-dynamic-require, @typescript-eslint/no-var-requires
const schema = require(path.join(__dirname, "__generated__/schema.ts"));
// eslint-disable-next-line import/no-dynamic-require, @typescript-eslint/no-var-requires
const { Queries } = require(path.join(__dirname, "__generated__/helpers.ts"));

const sqlite = sqlite3.verbose();
const dbPath = path.join(__dirname, "__generated__/test.db");

if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new sqlite.Database(dbPath);

const article: Article = {
  articleId: 1,
  title: "article 1",
  url: "http://blaat.com",
  content: "content. strange string. selected='selected'",
  type: ArticleType.B,
  position: "left",
  postDate: new Date(),
  flag: true,
  compositeType: {
    a: "a",
  },
  compositeTypeArray: [
    {
      a: "a",
    },
    {
      b: "b",
    },
    {
      c: "c",
    },
  ],
};
const phase: Phase = {
  name: "phase",
  phaseId: 1,
  values: ["hallo", "hoi", "hey"],
  articles: [{ ...article }],
};

const queries = [];
queries.push("PRAGMA foreign_keys = ON");
queries.push(...Queries.insertPhase(phase));
queries.push(
  ...Queries.insertArticle({
    ...article,
    articleId: 2,
    title: "article 2",
  })
);

queries.push(
  ...Queries.insertPhase({
    ...phase,
    phaseId: 2,
    articles: [{ ...article, articleId: 9 }],
  })
);

queries.push(...Queries.deletePhase(2));

// queries.push(
//   ...Queries.updatePhase(
//     {
//       name: "updated phase",
//       articles: [
//         {
//           ...article,
//           title: "updated article id from 1 to 3",
//           articleId: 3,
//           flag: false,
//           postDate: new Date(),
//         },
//       ],
//     },
//     1
//   )
// );

queries.push(
  ...Queries.replacePhase(
    {
      name: "replaced phase 1",
      articles: [
        {
          ...article,
          title: "replaced article id from 1 to 2",
          articleId: 2,
          flag: false,
          postDate: new Date(),
        },
      ],
    },
    1
  )
);

db.serialize(async () => {
  for (const query of schema.Schema) {
    db.exec(query, (err) => {
      if (err) {
        console.log("error", err, query);
      }
    });
  }
  for (const query of queries) {
    db.exec(query, (err) => {
      if (err) {
        console.log("error", err, query);
      }
    });
  }
});

db.close();
