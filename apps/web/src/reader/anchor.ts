import type { TextQuoteAnchor } from '@margin/shared';

/**
 * Text-quote anchoring (W3C Web Annotation TextQuoteSelector). A highlight is stored as the exact
 * text plus a little context on each side, then re-found in the rendered article on every open.
 */

const CONTEXT = 32;

interface TextIndex {
  text: string;
  nodes: { node: Text; start: number }[];
}

function indexText(root: Node): TextIndex {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: TextIndex['nodes'] = [];
  let text = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += n.nodeValue ?? '';
  }
  return { text, nodes };
}

function offsetOf(index: TextIndex, container: Node, offset: number): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const entry = index.nodes.find((n) => n.node === container);
    return entry ? entry.start + offset : null;
  }
  // Element boundary: position before child `offset` = start of the first text node at/after it.
  const child = container.childNodes[offset];
  if (!child) {
    const after = index.nodes.filter((n) => container.contains(n.node)).at(-1);
    return after ? after.start + (after.node.nodeValue?.length ?? 0) : null;
  }
  const first = index.nodes.find((n) => child === n.node || child.contains(n.node));
  return first?.start ?? null;
}

export function describeRange(root: HTMLElement, range: Range): TextQuoteAnchor | null {
  if (!root.contains(range.commonAncestorContainer)) return null;
  const index = indexText(root);
  const start = offsetOf(index, range.startContainer, range.startOffset);
  const end = offsetOf(index, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  const exact = index.text.slice(start, end);
  if (!exact.trim()) return null;
  return {
    exact,
    prefix: index.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: index.text.slice(end, end + CONTEXT),
  };
}

/** Finds the occurrence of `exact` whose surrounding text best matches the stored context. */
export function locate(text: string, anchor: TextQuoteAnchor): { start: number; end: number } | null {
  let best: { start: number; score: number } | null = null;
  for (let i = text.indexOf(anchor.exact); i !== -1; i = text.indexOf(anchor.exact, i + 1)) {
    const score =
      commonSuffix(text.slice(Math.max(0, i - anchor.prefix.length), i), anchor.prefix) +
      commonPrefix(text.slice(i + anchor.exact.length, i + anchor.exact.length + anchor.suffix.length), anchor.suffix);
    if (!best || score > best.score) best = { start: i, score };
  }
  return best && { start: best.start, end: best.start + anchor.exact.length };
}

/** Wraps the anchored text in <mark> elements (one per text node it spans). Returns false if not found. */
export function highlight(root: HTMLElement, anchor: TextQuoteAnchor, attrs: Record<string, string>): boolean {
  const index = indexText(root);
  const pos = locate(index.text, anchor);
  if (!pos) return false;
  for (const { node, start } of index.nodes) {
    const len = node.nodeValue?.length ?? 0;
    const from = Math.max(pos.start, start) - start;
    const to = Math.min(pos.end, start + len) - start;
    if (to <= from || !node.nodeValue?.slice(from, to).trim()) continue;
    const target = node.splitText(from);
    target.splitText(to - from);
    const mark = root.ownerDocument.createElement('mark');
    Object.entries(attrs).forEach(([k, v]) => mark.setAttribute(k, v));
    target.replaceWith(mark);
    mark.appendChild(target);
  }
  return true;
}

export function clearHighlights(root: HTMLElement, selector: string) {
  root.querySelectorAll(selector).forEach((mark) => {
    mark.replaceWith(...mark.childNodes);
  });
  root.normalize();
}

const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};
const commonSuffix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
};
