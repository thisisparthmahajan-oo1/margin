import type { AudioRef, BookmarkSource, VideoRef } from '@margin/shared';

/** A readable page: unsanitized HTML with possibly-relative URLs resolved against `baseUrl`. */
export interface ExtractedText {
  title: string;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  leadImage: string | null;
  html: string;
  baseUrl: string;
  publishedAt: number | null;
  /** The page has playable video (it isn't downloaded; it plays online). */
  hasVideo: boolean;
}

export type ExtractedArticle = { kind: 'article' } & ExtractedText;
/** A video page: the text is its description, `video` is what the player needs. */
export type ExtractedVideo = { kind: 'video'; video: VideoRef } & ExtractedText;
/** A podcast episode: the text is its show notes (or transcript), `audio` its show and length. */
export type ExtractedPodcast = { kind: 'podcast'; audio: AudioRef } & ExtractedText;
/** The link was a PDF file. */
export type ExtractedPdf = { kind: 'pdf'; bytes: Buffer; fileName: string };

/** What an extractor hands to the pipeline. */
export type Extracted = ExtractedArticle | ExtractedVideo | ExtractedPodcast | ExtractedPdf;

export interface Extractor {
  name: string;
  source: BookmarkSource;
  matches(url: URL): boolean;
  extract(url: URL): Promise<Extracted>;
}

/** A failure whose message is fit to show the user as the reason an item couldn't be saved. */
export class ExtractionError extends Error {}
