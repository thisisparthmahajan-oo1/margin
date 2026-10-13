import type { ListKey, SortKey } from '@margin/shared';
import { Pencil, Trash2 } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AddBar } from '../components/AddBar.tsx';
import { BookmarkRow } from '../components/BookmarkRow.tsx';
import { useListKeys } from '../components/useListKeys.ts';
import { deleteFolder, deleteTag, renameFolder, renameTag } from '../data/actions.ts';
import { addFiles, fromFileList } from '../data/addFiles.ts';
import { useBookmarks, useFolders, useTags } from '../data/queries.ts';
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
  pdfs: 'PDFs you add show up here. Use Add PDF, drop a file on this page, or share one to Margin from your phone.',
  videos: 'YouTube links you save, and X posts and articles with videos, show up here.',
  folder: 'This folder is empty. Use Move on any article to put it here.',
  tag: 'Nothing has this tag right now. Use the tag button on any item to add it.',
};

/** Rename/delete controls for a folder or tag page. */
function ListTools({ noun, name, onRename, onDelete }: { noun: string; name: string; onRename: (name: string) => void; onDelete: () => void }) {
  return (
    <div className="folder-tools">
      <button
        className="icon-button small"
        aria-label={`Rename ${noun}`}
        onClick={() => {
          const next = prompt(`Rename ${noun}`, name)?.trim();
          if (next) onRename(next);
        }}
      >
        <Pencil size={15} />
      </button>
      <button className="icon-button small" aria-label={`Delete ${noun}`} onClick={onDelete}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}

export function ListPage({ list: fixedList }: { list?: ListKey }) {
  const { folderId, tagId } = useParams();
  const navigate = useNavigate();
  const folders = useFolders();
  const tags = useTags();
  const { sort } = useAppSettings();
  const list: ListKey = fixedList ?? (tagId ? { kind: 'tag', tagId } : { kind: 'folder', folderId: folderId! });
  const folder = list.kind === 'folder' ? folders.find((f) => f.id === list.folderId) : undefined;
  const tag = list.kind === 'tag' ? tags.find((t) => t.id === list.tagId) : undefined;

  // Narrow any list to one tag (?tag=…), e.g. a folder's "Don't understand yet" items.
  const [params, setParams] = useSearchParams();
  const filterTagId = params.get('tag');
  const data = useBookmarks(list, sort, filterTagId);
  const items = data?.items;
  // Tags used in this list (on a tag's own page, the other tags), plus the active one.
  const filterTags = tags.filter(
    (t) => (data?.tagIds.has(t.id) && !(list.kind === 'tag' && t.id === list.tagId)) || t.id === filterTagId,
  );
  const setFilter = (id: string | null) => setParams(id ? { tag: id } : {});
  const selected = useListKeys(items ?? []);

  const title = {
    home: 'Home',
    liked: 'Liked',
    archive: 'Archive',
    pdfs: 'PDFs',
    videos: 'Videos',
    folder: folder?.name ?? 'Folder',
    tag: tag?.name ?? 'Tag',
  }[list.kind];

  // Drop PDFs anywhere on a list to add them.
  const [dropping, setDropping] = useState(false);
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const drop = {
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDropping(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDropping(false);
      void addFiles(fromFileList(e.dataTransfer.files));
    },
  };

  return (
    <section className={`list-page${dropping ? ' dropping' : ''}`} {...drop}>
      <header className="list-header">
        <h1>{title}</h1>
        {folder && (
          <ListTools
            noun="folder"
            name={folder.name}
            onRename={(name) => void renameFolder(folder.id, name)}
            onDelete={async () => {
              if (!confirm(`Delete the folder “${folder.name}”? Its articles move back to Home.`)) return;
              await deleteFolder(folder.id);
              navigate('/');
            }}
          />
        )}
        {tag && (
          <ListTools
            noun="tag"
            name={tag.name}
            onRename={(name) => void renameTag(tag.id, name)}
            onDelete={async () => {
              if (!confirm(`Delete the tag “${tag.name}”? It’s removed from every item; the items stay.`)) return;
              await deleteTag(tag.id);
              navigate('/');
            }}
          />
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

      {(list.kind === 'home' || list.kind === 'pdfs') && <AddBar />}

      {filterTags.length > 0 && (
        <div className="tag-filter" role="group" aria-label="Show only items tagged">
          {filterTags.map((t) => (
            <button key={t.id} aria-pressed={t.id === filterTagId} onClick={() => setFilter(t.id === filterTagId ? null : t.id)}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {items && items.length === 0 && (
        <p className="empty">{filterTagId ? 'Nothing in this list has that tag.' : EMPTY[list.kind]}</p>
      )}
      <div className="rows">
        {items?.map((b, i) => (
          <BookmarkRow key={b.id} bookmark={b} selected={i === selected} showFolder={list.kind !== 'folder'} />
        ))}
      </div>
    </section>
  );
}
