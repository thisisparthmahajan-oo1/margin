import type { Bookmark, Highlight } from '@margin/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../data/db.ts';

/** Every highlight and note across the library, grouped by article, most recent first. */
export function NotesPage() {
  const groups = useLiveQuery(async () => {
    const highlights = await db.highlights.orderBy('createdAt').reverse().toArray();
    const bookmarks = new Map((await db.bookmarks.bulkGet([...new Set(highlights.map((h) => h.bookmarkId))])).filter(Boolean).map((b) => [b!.id, b!]));
    const byBookmark = new Map<string, { bookmark: Bookmark; highlights: Highlight[] }>();
    for (const h of highlights) {
      const bookmark = bookmarks.get(h.bookmarkId);
      if (!bookmark) continue;
      if (!byBookmark.has(h.bookmarkId)) byBookmark.set(h.bookmarkId, { bookmark, highlights: [] });
      byBookmark.get(h.bookmarkId)!.highlights.push(h);
    }
    return [...byBookmark.values()];
  }, []);

  return (
    <section className="list-page">
      <header className="list-header">
        <h1>Notes</h1>
      </header>
      {groups?.length === 0 && <p className="empty">Highlights and notes you make while reading are collected here.</p>}
      {groups?.map(({ bookmark, highlights }) => (
        <section key={bookmark.id} className="notes-group">
          <h2 className="row-title">
            <Link to={`/read/${bookmark.id}`}>{bookmark.title}</Link>
          </h2>
          <ul>
            {highlights.map((h) => (
              <li key={h.id}>
                <Link to={`/read/${bookmark.id}?hl=${h.id}`} className="note-item">
                  <blockquote>{h.anchor.exact}</blockquote>
                  {h.note && <p className="note">{h.note}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
