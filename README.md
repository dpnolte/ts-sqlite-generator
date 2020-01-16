# ts-sqlite-generator

## install packages
```
yarn add -D ts-sqlite-generator typescript 
```

## checkout example and run it
See example folder.
Clone this repo and run 'yarn example'

# prepare interface
have at least one interface with doc tag @sqlite_table.
For example in src/store/models.ts:
```
/**
 * @sqlite_table.
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
   * @realm_index
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
import { generator } from 'realm-ts-schema-generator';

generator(
    [path.join(__dirname, '../src/store/models.ts')],
    path.join(__dirname, '../realm/__generated__/schemas.ts'),
    path.join(__dirname, '../tsconfig.json')
);
```

# run with ts-node
```
yarn ts-node -T scripts/generateSchemas.ts
```
