import { REQUEST_TEXT_MAX, type CuratorRequest } from '@margin/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteRequest, setRequestStatus, updateRequestText } from '../data/actions.ts';
import { db } from '../data/db.ts';
import { canOpen, domainOf } from '../data/queries.ts';

/**
 * One request: what you asked, the passage it came from, the agent's status line and the items it
 * linked as answers, with your actions (edit, complete or reopen, delete). Used in the Requests view
 * and in the reader's popover.
 */
export function RequestDetails({ request: r, showSource, onDeleted }: { request: CuratorRequest; showSource: boolean; onDeleted?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.text);
  // The source article and the answers, looked up locally; any of them may have been deleted.
  const items = useLiveQuery(async () => {
    const ids = [...(r.bookmarkId ? [r.bookmarkId] : []), ...r.answers.map((a) => a.bookmarkId)];
    const found = await db.bookmarks.bulkGet(ids);
    return new Map(found.flatMap((b) => (b ? [[b.id, b] as const] : [])));
  }, [r.bookmarkId, r.answers]);
  const source = r.bookmarkId ? items?.get(r.bookmarkId) : undefined;
  const open = r.status === 'open';

  const saveText = async () => {
    const next = text.trim();
    if (next && next !== r.text) await updateRequestText(r.id, next);
    setEditing(false);
  };

  return (
    <div className={`request${open ? '' : ' completed'}`}>
      {editing ? (
        <div className="request-edit">
          <textarea
            autoFocus
            rows={3}
            maxLength={REQUEST_TEXT_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void saveText();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <div className="request-actions">
            <button className="button subtle" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="button primary" onClick={saveText} disabled={!text.trim()}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="request-text">{r.text}</p>
      )}

      {showSource && r.bookmarkId && (
        <div className="request-source">
          {r.anchor && <blockquote>{r.anchor.exact}</blockquote>}
          {items === undefined ? null : source ? (
            <Link to={`/read/${source.id}?req=${r.id}`}>{source.title ?? domainOf(source.url)}</Link>
          ) : (
            <span className="removed">Source removed</span>
          )}
        </div>
      )}

      <p className="request-status">
        <span className={`request-chip${open ? ' open' : ''}`}>{open ? 'Open' : 'Completed'}</span>
        {r.reply ? (
          <span>
            {r.reply.text} · <time dateTime={new Date(r.reply.updatedAt).toISOString()}>{timeAgo(r.reply.updatedAt)}</time>
          </span>
        ) : (
          <span className="waiting">{open ? `Waiting for the ${r.for}` : 'No reply'}</span>
        )}
      </p>

      {r.answers.length > 0 && (
        <ul className="request-answers">
          {r.answers.map(({ bookmarkId }) => {
            const b = items?.get(bookmarkId);
            return (
              <li key={bookmarkId}>
                {b ? (
                  canOpen(b) ? (
                    <Link to={`/read/${b.id}`}>{b.title ?? domainOf(b.url)}</Link>
                  ) : (
                    <span>{b.title ?? domainOf(b.url)} (downloading)</span>
                  )
                ) : (
                  <span className="removed">Removed</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!editing && (
        <div className="request-actions">
          <button
            className="button subtle"
            onClick={async () => {
              if (!confirm('Delete this request? The curator stops working on it.')) return;
              await deleteRequest(r.id);
              onDeleted?.();
            }}
          >
            Delete
          </button>
          <span>
            <button
              className="button subtle"
              onClick={() => {
                setText(r.text);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button className="button" onClick={() => setRequestStatus(r.id, open ? 'completed' : 'open')}>
              {open ? 'Mark completed' : 'Reopen'}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "2 hours ago", "yesterday". */
export function timeAgo(at: number, now = Date.now()) {
  const seconds = Math.round((at - now) / 1000);
  for (const [unit, size] of [['day', 86_400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}
