# ts-sqlite-generator

## install packages
```
yarn add -D ts-sqlite-generator typescript 
```

## checkout example and run it
See example folder.
Clone this repo and run 'yarn example'

# prepare interface
have at least one interface with doc tag @sqlite_entry.
This tag indicates that this interface should be able to be inserted without any referencing foreign keys.
For example in src/store/models.ts:
```
/**
 * @sqlite_entry.
 */
interface Phase {
  name: string;
  phaseId: number;
  articles: Article[];
  optionalFieldsWork?: boolean;
}

interface Article {
  articleId: number;
  title: string;
  /**
   * @sqlite_index
   *
   */
  url: string;
  content: string;
  type: ArticleType;
  position: ArticlePosition;
  compoundType: CompoundType;
}

enum ArticleType {
  A,
  B,
  C
}

type ArticlePosition = "left" | "center" | "right";

interface SubTypeA {
  a: string;
}

interface SubTypeB {
  b: string;
}

type CompoundType = SubTypeA | SubTypeB;

```


## create schema generator script 

add a script file, for example 'scripts/generateSchemas.ts':
```
import path from 'path';
import { generator } from 'ts-sqlite-generator typescript';

generator(
  [path.join(__dirname, "models.ts")],
  path.join(__dirname, "../tsconfig.json"),
  path.join(__dirname, "__generated__/schema.ts"),
  path.join(__dirname, "__generated__/helpers.ts")
);
```

# run with ts-node
```
yarn ts-node -T scripts/generateSchemas.ts
```

# output
this results in queries being generated (CREATE TABLE, INSERT, UPDATE (todo))