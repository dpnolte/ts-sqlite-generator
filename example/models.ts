/**
 * @sqlite_table
 */
interface Phase {
  name: string;
  phaseId: number;
  articles: Article[];
  optionalFieldsWork?: boolean;
  values: string[];
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
  compositeType: CompositeType;
  compositeTypeArray: AnotherCompositeType[];
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

interface SubTypeC {
  b: string;
}

type CompositeType = SubTypeA | SubTypeB;

type AnotherCompositeType = SubTypeA | SubTypeB | SubTypeC;
