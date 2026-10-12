import { readabilityExtractor } from './readability.ts';
import type { Extractor } from './types.ts';
import { xArticleExtractor } from './x-article.ts';

/** Ordered: the first extractor whose `matches` returns true handles the URL. Readability is the catch-all. */
export const extractors: Extractor[] = [xArticleExtractor, readabilityExtractor];

export const extractorFor = (url: URL): Extractor => extractors.find((e) => e.matches(url)) ?? readabilityExtractor;

export { ExtractionError, type ExtractedArticle, type Extractor } from './types.ts';
