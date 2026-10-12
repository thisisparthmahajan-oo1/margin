import { parseHTML } from 'linkedom';
import { parse, serialize } from 'parse5';

/**
 * Parses an HTML document into a DOM.
 * parse5 applies the HTML5 parsing rules (implied <html>/<head>/<body>, misnested tags), which
 * linkedom skips; pages that omit optional tags would otherwise confuse Readability.
 * linkedom then provides the light, bundle-friendly DOM we work on.
 */
export function parseDocument(html: string): Document {
  return parseHTML(serialize(parse(html))).document as unknown as Document;
}

/** A detached <body> holding `fragment`, for walking/rewriting article HTML. */
export function parseFragment(fragment: string): HTMLElement {
  return parseDocument(`<!doctype html><html><head></head><body>${fragment}</body></html>`).body;
}
