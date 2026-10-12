import type { ListKey, SortKey } from '@margin/shared';
import { Pencil, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { AddBar } from '../components/AddBar.tsx';
import { BookmarkRow } from '../components/BookmarkRow.tsx';
import { useListKeys } from '../components/useListKeys.ts';
import { deleteFolder, renameFolder } from '../data/actions.ts';
import { useBookmarks, useFolders } from '../data/queries.ts';
import { appSettings, useAppSettings } from '../data/settings.ts';

const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  shortest: 'Shortest',
  longest: 'Longest',
};

const EMPTY: Record<ListKey['kind'], string> = {
  home: 'Nothing to read yet. Paste a link above and it will be downloaded for offline reading.',
  liked: 'Articles you like show up here. Use the heart on any article.',
  archive: 'Articles you finish and archive are kept here.',
  folder: 'This folder is empty. Use Move on any article to put it here.',
};

export function ListPage({ list: fixedList }: { list?: ListKey }) {
  const { folderId } = useParams();
  const navigate = useNavigate();
  const folders = useFolders();
  const { sort } = useAppSettings();
  const list: ListKey = fixedList ?? { kind: 'folder', folderId: folderId! };
  const folder = list.kind === 'folder' ? folders.find((f) => f.id === list.folderId) : undefined;
  const items = useBookmarks(list, sort);
  const selected = useListKeys(items ?? []);

  const title = { home: 'Home', liked: 'Liked', archive: 'Archive', folder: folder?.name ?? 'Folder' }[list.kind];

  return (
    <section className="list-page">
      <header className="list-header">
        <h1>{title}</h1>
        {folder && (
          <div className="folder-tools">
            <button
              className="icon-button small"
              aria-label="Rename folder"
              onClick={() => {
                const name = prompt('Rename folder', folder.name)?.trim();
                if (name) void renameFolder(folder.id, name);
              }}
            >
              <Pencil size={15} />
            </button>
            <button
              className="icon-button small"
              aria-label="Delete folder"
              onClick={async () => {
                if (!confirm(`Delete the folder “${folder.name}”? Its articles move back to Home.`)) return;
                await deleteFolder(folder.id);
                navigate('/');
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        )}
        <label className="sort">
          <span className="visually-hidden">Sort by</span>
          <select value={sort} onChange={(e) => appSettings.set({ sort: e.target.value as SortKey })}>
            {Object.entries(SORT_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {list.kind === 'home' && <AddBar />}

      {items && items.length === 0 && <p className="empty">{EMPTY[list.kind]}</p>}
      <div className="rows">
        {items?.map((b, i) => <BookmarkRow key={b.id} bookmark={b} selected={i === selected} />)}
      </div>
    </section>
  );
}
