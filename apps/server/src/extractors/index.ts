import { podcastExtractor } from './podcast.ts';
import { readabilityExtractor } from './readability.ts';
import type { Extractor } from './types.ts';
import { xArticleExtractor } from './x-article.ts';
import { youtubeExtractor } from './youtube.ts';

/** Ordered: the first extractor whose `matches` returns true handles the URL. Readability is the catch-all. */
export const extractors: Extractor[] = [xArticleExtractor, youtubeExtractor, podcastExtractor, readabilityExtractor];

export const extractorFor = (url: URL): Extractor => extractors.find((e) => e.matches(url)) ?? readabilityExtractor;

export {
  ExtractionError,
  type Extracted,
  type ExtractedArticle,
  type ExtractedPdf,
  type ExtractedPodcast,
  type ExtractedText,
  type ExtractedVideo,
  type Extractor,
} from './types.ts';
