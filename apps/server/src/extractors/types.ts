import type { BookmarkSource } from '@margin/shared';

/** What an extractor hands to the pipeline: unsanitized HTML with possibly-relative URLs resolved against `baseUrl`. */
export interface ExtractedArticle {
  title: string;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  leadImage: string | null;
  html: string;
  baseUrl: string;
  publishedAt: number | null;
}

export interface Extractor {
  name: string;
  source: BookmarkSource;
  matches(url: URL): boolean;
  extract(url: URL): Promise<ExtractedArticle>;
}

export class ExtractionError extends Error {}
