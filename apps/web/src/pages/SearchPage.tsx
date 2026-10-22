import type { Bookmark, SearchResponse } from '@margin/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookmarkRow } from '../components/BookmarkRow.tsx';
import { useOpenRequestBookmarkIds } from '../data/queries.ts';
import { api } from '../data/api.ts';
import { db } from '../data/db.ts';

/** Server full-text search (FTS5) when online; title/excerpt matching on the local copy when offline. */
export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const [remote, setRemote] = useState<{ q: string; hits: SearchResponse['hits'] } | null>(null);
  const [offline, setOffline] = useState(false);
  const asked = useOpenRequestBookmarkIds();

  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    api<SearchResponse>('GET', `/api/search?q=${encodeURIComponent(q)}`)
      .then((res) => !cancelled && (setRemote({ q, hits: res.hits }), setOffline(false)))
      .catch(() => !cancelled && setOffline(true));
    return () => {
      cancelled = true;
    };
  }, [q]);

  const local = useLiveQuery(async () => {
    const needle = q.toLowerCase();
    if (!needle) return [];
    return (await db.bookmarks.toArray()).filter((b) =>
      [b.title, b.excerpt, b.siteName, b.byline, b.url].some((f) => f?.toLowerCase().includes(needle)),
    );
  }, [q]);

  const remoteRows = useLiveQuery(async () => {
    if (!remote || remote.q !== q) return null;
    const rows = await db.bookmarks.bulkGet(remote.hits.map((h) => h.bookmarkId));
    return remote.hits
      .map((hit, i) => ({ hit, bookmark: rows[i] }))
      .filter((r): r is { hit: (typeof remote.hits)[number]; bookmark: Bookmark } => !!r.bookmark);
  }, [remote, q]);

  return (
    <section className="list-page">
      <header className="list-header">
        <h1>Search</h1>
      </header>
      {!q && <p className="empty">Type in the search box to find articles by any word in them.</p>}
      {q && offline && <p className="notice">You’re offline, so only titles and summaries are searched.</p>}
      <div className="rows">
        {remoteRows && !offline
          ? remoteRows.map(({ hit, bookmark }) => <BookmarkRow key={bookmark.id} bookmark={bookmark} snippet={<Snippet text={hit.snippet} />} hasOpenRequest={asked.has(bookmark.id)} />)
          : local?.map((b) => <BookmarkRow key={b.id} bookmark={b} hasOpenRequest={asked.has(b.id)} />)}
      </div>
      {q && (remoteRows && !offline ? remoteRows.length === 0 : local?.length === 0) && (
        <p className="empty">No articles match “{q}”.</p>
      )}
    </section>
  );
}

/** Server snippets mark matches with [[ ]]; render them as <mark> without injecting HTML. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[\[.*?\]\])/).map((part, i) =>
        part.startsWith('[[') ? <mark key={i}>{part.slice(2, -2)}</mark> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}
