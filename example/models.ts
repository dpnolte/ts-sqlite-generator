interface ArticleBase {
  articleId: number;
  title: string;
}

/**
 * @sqlite_entry
 */
export interface Article extends ArticleBase {
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
  postDate: Date;
  flag: boolean;
}

/**
 * @sqlite_entry
 */
export interface Phase extends PhaseBase<Article> {}

export interface PhaseBase<TArticle extends ArticleBase = Article> {
  name: string;
  phaseId: number;
  subPhases: SubPhase<TArticle>[];
  optionalFieldsWork?: boolean;
  values: string[];
}

export interface SubPhase<TArticle extends ArticleBase = Article> {
  subPhaseId: number;
  articles: TArticle[];
}

export enum ArticleType {
  A,
  B,
  C,
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
