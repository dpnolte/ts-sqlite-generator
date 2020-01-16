// Auto-generated, do not edit

// table based on interface from example/models.ts
export const PhaseValuesSQL = `CREATE TABLE IF NOT EXISTS PhaseValues (
  index INTEGER NOT NULL,
  value TEXT NOT NULL,
  phaseValuesId INTEGER PRIMARY KEY,
  phaseId INTEGER NOT NULL,
  FOREIGN KEY (phaseId)
    REFERENCES Phase (phaseId)
);
`;

// table based on interface from example/models.ts
export const PhaseSQL = `CREATE TABLE IF NOT EXISTS Phase (
  name TEXT NOT NULL,
  phaseId INTEGER PRIMARY KEY,
  optionalFieldsWork NUMERIC DEFAULT NULL
);
`;

// table based on interface from example/models.ts
export const ArticleSQL = `CREATE TABLE IF NOT EXISTS Article (
  articleId INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  content TEXT NOT NULL,
  type NUMERIC NOT NULL,
  position TEXT NOT NULL,
  phaseId INTEGER NOT NULL,
  FOREIGN KEY (phaseId)
    REFERENCES Phase (phaseId),
  compositeTypeId INTEGER NOT NULL,
  FOREIGN KEY (compositeTypeId)
    REFERENCES CompositeType (compositeTypeId)
);
CREATE INDEX Article_i1 ON Article(url);
`;

// table based on interface from example/models.ts
export const AnotherCompositeTypeSQL = `CREATE TABLE IF NOT EXISTS AnotherCompositeType (
  a TEXT DEFAULT NULL,
  b TEXT DEFAULT NULL,
  index INTEGER NOT NULL,
  articleId INTEGER NOT NULL,
  FOREIGN KEY (articleId)
    REFERENCES Article (articleId)
);
`;

// table based on interface from example/models.ts
export const CompositeTypeSQL = `CREATE TABLE IF NOT EXISTS CompositeType (
  a TEXT DEFAULT NULL,
  b TEXT DEFAULT NULL,
  articleId INTEGER NOT NULL,
  FOREIGN KEY (articleId)
    REFERENCES Article (articleId),
  compositeTypeId INTEGER PRIMARY KEY
);
`;

export const CreateTableQueries = [
  PhaseValuesSQL,
  PhaseSQL,
  ArticleSQL,
  AnotherCompositeTypeSQL,
  CompositeTypeSQL,
];
