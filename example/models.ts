/**
 * @sqlite_entry
 */
export interface Phase {
  name: string;
  phaseId: number;
  articles: Article[];
  optionalFieldsWork?: boolean;
  values: string[];
}

/**
 * @sqlite_entry
 */
export interface Article {
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

export enum ArticleType {
  A,
  B,
  C
}

export type ArticlePosition = "left" | "center" | "right";

export interface SubTypeA {
  a: string;
}

export interface SubTypeB {
  b: string;
}

export interface SubTypeC {
  c: string;
}

export type CompositeType = SubTypeA | SubTypeB;

export type AnotherCompositeType = SubTypeA | SubTypeB | SubTypeC;
