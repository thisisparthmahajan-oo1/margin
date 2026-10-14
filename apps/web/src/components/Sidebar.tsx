import { Archive, FileText, FolderClosed, Headphones, Heart, Inbox, MonitorPlay, Plus, Search, Settings, StickyNote, Tag } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { createFolder } from '../data/actions.ts';
import { useFolders, useHomeCount, useTags } from '../data/queries.ts';
import { useSyncStatus } from '../data/sync.ts';

const SYNC_LABELS = {
  idle: 'Up to date',
  syncing: 'Syncing',
  offline: 'Offline, changes will sync later',
  error: 'Couldn’t sync, will try again',
  unauthorized: 'Signed out',
} as const;

export function Sidebar() {
  const folders = useFolders();
  const tags = useTags();
  const homeCount = useHomeCount();
  const sync = useSyncStatus();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [newFolder, setNewFolder] = useState<string | null>(null);

  const submitSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = new FormData(e.currentTarget).get('q')?.toString().trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const submitFolder = async (e: FormEvent) => {
    e.preventDefault();
    const name = newFolder?.trim();
    setNewFolder(null);
    if (name) navigate(`/folder/${await createFolder(name)}`);
  };

  return (
    <nav className="sidebar" aria-label="Library">
      <NavLink to="/" className="wordmark">
        Margin
      </NavLink>

      <form className="search" role="search" onSubmit={submitSearch}>
        <Search size={15} aria-hidden />
        <input id="search-input" name="q" type="search" placeholder="Search" defaultValue={params.get('q') ?? ''} />
      </form>

      <ul className="nav">
        <li>
          <NavLink to="/" end>
            <Inbox size={17} /> Home {homeCount ? <span className="count">{homeCount}</span> : null}
          </NavLink>
        </li>
        <li>
          <NavLink to="/liked">
            <Heart size={17} /> Liked
          </NavLink>
        </li>
        <li>
          <NavLink to="/pdfs">
            <FileText size={17} /> PDFs
          </NavLink>
        </li>
        <li>
          <NavLink to="/videos">
            <MonitorPlay size={17} /> Videos
          </NavLink>
        </li>
        <li>
          <NavLink to="/podcasts">
            <Headphones size={17} /> Podcasts
          </NavLink>
        </li>
        <li>
          <NavLink to="/archive">
            <Archive size={17} /> Archive
          </NavLink>
        </li>
        <li>
          <NavLink to="/notes">
            <StickyNote size={17} /> Notes
          </NavLink>
        </li>
      </ul>

      <div className="nav-heading">
        <span>Folders</span>
        <button className="icon-button small" aria-label="New folder" onClick={() => setNewFolder('')}>
          <Plus size={15} />
        </button>
      </div>
      <ul className="nav">
        {folders.map((f) => (
          <li key={f.id}>
            <NavLink to={`/folder/${f.id}`}>
              <FolderClosed size={17} /> {f.name}
            </NavLink>
          </li>
        ))}
        {newFolder !== null && (
          <li>
            <form onSubmit={submitFolder}>
              <input
                autoFocus
                className="inline-input"
                placeholder="Folder name"
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                onBlur={submitFolder}
                onKeyDown={(e) => e.key === 'Escape' && setNewFolder(null)}
              />
            </form>
          </li>
        )}
        {folders.length === 0 && newFolder === null && <li className="nav-empty">Group articles into folders with Move.</li>}
      </ul>

      <div className="nav-heading">
        <span>Tags</span>
      </div>
      <ul className="nav">
        {tags.map((t) => (
          <li key={t.id}>
            <NavLink to={`/tag/${t.id}`}>
              <Tag size={17} /> {t.name}
            </NavLink>
          </li>
        ))}
        {tags.length === 0 && <li className="nav-empty">Mark items with Tags, e.g. “Don’t understand yet”.</li>}
      </ul>

      <div className="sidebar-foot">
        <span className={`sync-dot ${sync.state}`} title={SYNC_LABELS[sync.state]} />
        <span className="sync-label">{SYNC_LABELS[sync.state]}</span>
        <NavLink to="/settings" className="icon-button small" aria-label="Settings">
          <Settings size={16} />
        </NavLink>
      </div>
    </nav>
  );
}
