/** Plain text (a video description, show notes) -> paragraphs, with its links made clickable. */
export function plainTextHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${linkify(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

const linkify = (text: string) =>
  text
    .split(/(https?:\/\/[^\s<>"]+)/g)
    .map((part, i) => (i % 2 ? `<a href="${escapeHtml(part).replace(/"/g, '&quot;')}">${escapeHtml(part)}</a>` : escapeHtml(part)))
    .join('');

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
