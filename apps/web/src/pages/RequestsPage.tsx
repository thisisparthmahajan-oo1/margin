import { REQUEST_TEXT_MAX } from '@margin/shared';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RequestDetails } from '../components/RequestDetails.tsx';
import { createRequest } from '../data/actions.ts';
import { useRequests } from '../data/queries.ts';

/** Everything you've asked the curator: open requests first, then completed ones for history. */
export function RequestsPage() {
  const requests = useRequests();
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const { hash } = useLocation();

  // `/requests#<id>` (from an "Answers your request" chip) scrolls to that request.
  useEffect(() => {
    if (requests && hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'center' });
  }, [requests, hash]);

  const ask = async () => {
    if (!text.trim()) return;
    await createRequest(text.trim());
    setText('');
    setComposing(false);
  };

  const open = requests?.filter((r) => r.status === 'open') ?? [];
  const completed = requests?.filter((r) => r.status === 'completed') ?? [];

  return (
    <section className="list-page requests-page">
      <header className="list-header">
        <h1>Requests</h1>
        {!composing && (
          <button className="button" onClick={() => setComposing(true)}>
            <Plus size={15} aria-hidden /> New request
          </button>
        )}
      </header>

      {composing && (
        <div className="request-compose">
          <textarea
            autoFocus
            rows={3}
            maxLength={REQUEST_TEXT_MAX}
            placeholder="What should the curator find? E.g. a hands-on guide to semantic VAD"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask();
              if (e.key === 'Escape') setComposing(false);
            }}
          />
          <div className="request-actions">
            <button className="button subtle" onClick={() => setComposing(false)}>
              Cancel
            </button>
            <button className="button primary" onClick={ask} disabled={!text.trim()}>
              Ask
            </button>
          </div>
        </div>
      )}

      {requests?.length === 0 && !composing && (
        <p className="empty">
          Ask the curator for something: select a passage while reading and choose Ask curator, or start a new request here. It keeps
          working on a request until you mark it completed.
        </p>
      )}

      {[
        { label: 'Open', list: open },
        { label: 'Completed', list: completed },
      ].map(
        ({ label, list }) =>
          list.length > 0 && (
            <section key={label} className="requests-group">
              <h2 className="nav-heading">{label}</h2>
              <ul>
                {list.map((r) => (
                  <li key={r.id} id={r.id}>
                    <RequestDetails request={r} showSource />
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
    </section>
  );
}
