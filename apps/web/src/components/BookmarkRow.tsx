import { lengthLabel, type Bookmark, type BookmarkSource } from '@margin/shared';
import { Archive, ArchiveRestore, Folder, FolderInput, Heart, RotateCw, Tag, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { deleteBookmark, retryBookmark, toggleArchive, toggleLike, updateBookmark } from '../data/actions.ts';
import { canOpen, domainOf, useFolders, useTags } from '../data/queries.ts';
import { toast } from '../data/toast.ts';
import { MediaImg } from './MediaImg.tsx';
import { MoveMenu } from './MoveMenu.tsx';
import { RelevanceButtons } from './RelevanceButtons.tsx';
import { TagMenu } from './TagMenu.tsx';

const PENDING: Record<BookmarkSource, string> = {
  web: 'Downloading the article…',
  x: 'Downloading the post…',
  youtube: 'Saving the video details…',
  podcast: 'Saving the episode details…',
  upload: 'Uploading and reading the PDF…',
};

/** Where an item is from, as shown under its title. */
export function originOf(b: Bookmark): string {
  switch (b.source) {
    case 'x':
      return `${b.byline ?? 'X'} on X`;
    case 'youtube':
      return b.byline ? `${b.byline} on YouTube` : 'YouTube';
    case 'podcast':
      return b.audio?.showName ?? b.siteName ?? 'Podcast';
    case 'upload':
      return 'PDF';
    case 'web':
      if (b.kind === 'pdf') return `PDF from ${domainOf(b.url)}`;
      return b.kind === 'podcast' && b.audio?.showName ? b.audio.showName : domainOf(b.url);
  }
}

export function BookmarkRow({
  bookmark: b,
  selected,
  snippet,
  showFolder = true,
}: {
  bookmark: Bookmark;
  selected?: boolean;
  snippet?: ReactNode;
  /** Off on the folder's own page, where it would only repeat the title. */
  showFolder?: boolean;
}) {
  const [moving, setMoving] = useState(false);
  const [tagging, setTagging] = useState(false);
  const tags = useTags().filter((t) => b.tagIds.includes(t.id));
  const folder = useFolders().find((f) => showFolder && f.id === b.folderId);

  const archive = async () => {
    await toggleArchive(b);
    toast(b.archivedAt ? 'Moved to Home' : 'Archived', {
      label: 'Undo',
      run: () => updateBookmark(b.id, { archived: b.archivedAt !== null }),
    });
  };
  const remove = async () => {
    if (confirm(`Delete “${b.title ?? b.url}”? Highlights and notes on it are deleted too.`)) await deleteBookmark(b.id);
  };

  const meta =
    b.status === 'ready' ? (
      <>
        <span>{originOf(b)}</span>
        {b.suggestion && (
          <span className="tag" title={b.suggestion.reason}>
            Suggested
          </span>
        )}
        {lengthLabel(b) && <span>{lengthLabel(b)}</span>}
        {b.hasVideo && b.kind !== 'video' && <span className="tag">Video</span>}
        {b.progress > 0.02 && b.progress < 0.98 && <span>{Math.round(b.progress * 100)}% read</span>}
        {folder && (
          <Link className="tag-chip folder-chip" to={`/folder/${folder.id}`} title="Folder">
            <Folder size={11} aria-hidden />
            {folder.name}
          </Link>
        )}
        {tags.map((t) => (
          <Link key={t.id} className="tag-chip" to={`/tag/${t.id}`}>
            {t.name}
          </Link>
        ))}
      </>
    ) : b.status === 'pending' ? (
      <span className="saving">{PENDING[b.source]}</span>
    ) : (
      <span className="failed">{b.error ?? 'Couldn’t download this page'}</span>
    );

  return (
    <article className={`row${selected ? ' selected' : ''}`} aria-current={selected || undefined}>
      {b.status === 'ready' && b.progress > 0 && (
        <div className="row-progress" style={{ transform: `scaleX(${b.progress})` }} aria-hidden />
      )}
      <div className="row-main">
        <div className="row-body">
          {canOpen(b) ? (
            <Link to={`/read/${b.id}`} className="row-link">
              <h2 className="row-title">{b.title}</h2>
              {snippet ? <p className="row-excerpt">{snippet}</p> : b.excerpt && <p className="row-excerpt">{b.excerpt}</p>}
            </Link>
          ) : (
            <div className="row-link">
              <h2 className="row-title muted">{b.title ?? domainOf(b.url)}</h2>
              <p className="row-excerpt url">{b.source === 'upload' ? b.file?.name : b.url}</p>
            </div>
          )}
          <div className="row-foot">
            <p className="row-meta">{meta}</p>
            <div className="row-actions">
              {b.status === 'failed' && (
                <button className="icon-button" aria-label="Try again" title="Try again" onClick={() => retryBookmark(b)}>
                  <RotateCw size={16} />
                </button>
              )}
              {b.suggestion && <RelevanceButtons bookmark={b} size={16} />}
              <button
                className={`icon-button${b.likedAt ? ' liked' : ''}`}
                aria-label={b.likedAt ? 'Unlike' : 'Like'}
                aria-pressed={!!b.likedAt}
                title="Like (l)"
                onClick={() => toggleLike(b)}
              >
                <Heart size={16} fill={b.likedAt ? 'currentColor' : 'none'} />
              </button>
              <button className="icon-button" aria-label={b.archivedAt ? 'Move to Home' : 'Archive'} title="Archive (a)" onClick={archive}>
                {b.archivedAt ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              </button>
              <span className="menu-anchor">
                <button
                  className={`icon-button${b.tagIds.length ? ' tagged' : ''}`}
                  aria-label="Tags"
                  title="Tags (t)"
                  data-action="tags"
                  onClick={() => setTagging(true)}
                >
                  <Tag size={16} />
                </button>
                {tagging && <TagMenu bookmark={b} onClose={() => setTagging(false)} />}
              </span>
              <span className="menu-anchor">
                <button className="icon-button" aria-label="Move to folder" title="Move" onClick={() => setMoving(true)}>
                  <FolderInput size={16} />
                </button>
                {moving && <MoveMenu bookmark={b} onClose={() => setMoving(false)} />}
              </span>
              <button className="icon-button" aria-label="Delete" title="Delete" onClick={remove}>
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>
        {b.leadImage && b.status === 'ready' && <MediaImg className="row-thumb" src={b.leadImage} alt="" loading="lazy" />}
      </div>
    </article>
  );
}
