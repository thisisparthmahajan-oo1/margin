import { formatBytes, lengthLabel, REQUEST_TEXT_MAX, type Bookmark, type Highlight, type TextQuoteAnchor } from '@margin/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ExternalLink,
  FolderInput,
  Headphones,
  Heart,
  Highlighter,
  MessageCircleQuestion,
  Pause,
  Play,
  Square,
  StickyNote,
  Tag,
  Type,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MoveMenu } from '../components/MoveMenu.tsx';
import { RequestDetails } from '../components/RequestDetails.tsx';
import { RelevanceButtons } from '../components/RelevanceButtons.tsx';
import { TagMenu } from '../components/TagMenu.tsx';
import { Toasts } from '../components/Toasts.tsx';
import {
  createHighlight,
  createRequest,
  deleteHighlight,
  saveProgress,
  toggleArchive,
  toggleLike,
  updateBookmark,
  updateHighlightNote,
} from '../data/actions.ts';
import { fileBlob } from '../data/files.ts';
import { localizeMedia } from '../data/media.ts';
import { canOpen, domainOf, requestPreview, useBookmark, useHighlights, useRequest, useRequestsFor } from '../data/queries.ts';
import { FONTS, THEMES, useAppSettings, useReaderSettings } from '../data/settings.ts';
import { toast } from '../data/toast.ts';
import { clearHighlights, describeRange, highlight } from '../reader/anchor.ts';
import { ReaderSettingsPanel } from '../reader/ReaderSettingsPanel.tsx';
import { useSpeech } from '../reader/useSpeech.ts';
import { PodcastHeader } from '../reader/PodcastHeader.tsx';
import { VideoHeader } from '../reader/VideoHeader.tsx';

// pdf.js is large; it's only loaded when a PDF's original pages are shown.
const PdfView = lazy(() => import('../reader/PdfView.tsx'));

type Panel = 'settings' | 'highlights' | 'move' | 'tags' | null;
/** A PDF reads as extracted text (with highlights, Listen, themes) or as its original pages. */
type View = 'text' | 'original';

export function ReaderPage() {
  const { id } = useParams();
  const bookmark = useBookmark(id);
  const settings = useReaderSettings();
  const theme = THEMES[settings.theme];

  // The reader owns the whole viewport, including overscroll and the browser chrome colour.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const previous = meta?.getAttribute('content');
    document.body.style.background = theme.bg;
    meta?.setAttribute('content', theme.bg);
    return () => {
      document.body.style.background = '';
      if (previous) meta?.setAttribute('content', previous);
    };
  }, [theme.bg]);

  const style = {
    '--r-bg': theme.bg,
    '--r-fg': theme.fg,
    '--r-muted': theme.muted,
    '--r-font': FONTS[settings.font].stack,
    '--r-size': `${settings.fontSize}px`,
    '--r-lh': settings.lineHeight,
    '--r-measure': `${settings.measure}ch`,
  } as CSSProperties;

  return (
    <div className={`reader theme-${settings.theme}`} style={style}>
      {bookmark === undefined ? null : bookmark === null || !canOpen(bookmark) ? (
        <div className="reader-missing">
          <p>{bookmark?.status === 'pending' ? 'This article is still downloading.' : 'This article isn’t available offline.'}</p>
          <Link to="/">Back to Home</Link>
        </div>
      ) : (
        <Reader bookmark={bookmark} />
      )}
      <Toasts />
    </div>
  );
}

function Reader({ bookmark: b }: { bookmark: Bookmark }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { autoArchive } = useAppSettings();
  const highlights = useHighlights(b.id);
  const requests = useRequestsFor(b.id);
  const answered = useRequest(b.suggestion?.requestId);
  const contentRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const [progress, setProgress] = useState(b.progress);
  const [selection, setSelection] = useState<{ top: number; left: number; range: Range } | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<{ id: string; top: number; left: number } | null>(null);
  /** Writing a request about a passage; nothing is saved until it's sent. */
  const [asking, setAsking] = useState<{ anchor: TextQuoteAnchor; top: number; left: number } | null>(null);
  const [activeRequest, setActiveRequest] = useState<{ id: string; top: number; left: number } | null>(null);
  const speech = useSpeech(contentRef);
  const hasText = b.contentHtml !== null && b.status === 'ready';
  const [view, setView] = useState<View>(hasText ? 'text' : 'original');
  const showing: View = hasText ? view : 'original';
  const pdf = useLiveQuery(async () => (b.file ? await fileBlob(b.file.key) : null), [b.file?.key]);

  const goBack = useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  }, [location.key, navigate]);

  // ---- content + highlights ----

  useLayoutEffect(() => {
    if (!contentRef.current) return;
    contentRef.current.innerHTML = b.contentHtml ?? '';
    void localizeMedia(contentRef.current);
  }, [b.contentHtml, showing]);

  useLayoutEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    // Clear both kinds before painting either: clearing re-joins text nodes the other kind's marks split.
    clearHighlights(root, 'mark[data-hl], mark[data-req]');
    for (const h of highlights) {
      highlight(root, h.anchor, { 'data-hl': h.id, class: h.note ? 'hl has-note' : 'hl' });
    }
    for (const r of requests) {
      if (r.anchor) highlight(root, r.anchor, { 'data-req': r.id, class: r.status === 'open' ? 'req' : 'req done' });
    }
  }, [highlights, requests, b.contentHtml, showing]);

  // ---- reading position ----

  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !contentRef.current) return;
    const target = params.get('hl');
    const askedId = params.get('req');
    if (target && !highlights.some((h) => h.id === target)) return; // wait for highlights to load
    if (askedId && !requests.some((r) => r.id === askedId)) return; // and requests
    restored.current = true;
    const mark =
      (target && contentRef.current.querySelector(`mark[data-hl="${CSS.escape(target)}"]`)) ||
      (askedId && contentRef.current.querySelector(`mark[data-req="${CSS.escape(askedId)}"]`));
    if (mark) {
      mark.scrollIntoView({ block: 'center' });
      if (askedId) openRequest(mark);
    } else if (b.progress > 0.01 && b.progress < 0.99) {
      window.scrollTo(0, b.progress * (document.documentElement.scrollHeight - window.innerHeight));
    } else window.scrollTo(0, 0);
  }, [b.progress, params, highlights, requests]);

  useEffect(() => {
    let lastY = window.scrollY;
    let saveTimer: ReturnType<typeof setTimeout>;
    let archived = false;
    const onScroll = () => {
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 1;
      setProgress(p);
      setToolbarHidden(y > lastY && y > 120);
      lastY = y;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void saveProgress(b.id, p);
        if (autoArchive && p > 0.99 && !archived && b.archivedAt === null) {
          archived = true;
          void updateBookmark(b.id, { archived: true });
          toast('Finished and archived', { label: 'Undo', run: () => updateBookmark(b.id, { archived: false }) });
        }
      }, 1000);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(saveTimer);
    };
  }, [b.id, b.archivedAt, autoArchive]);

  // ---- selection -> highlight toolbar ----

  // On touch screens the phone's own menu (Copy, Select all) sits right above the selection, where
  // the toolbar would go, so there the toolbar is docked at the bottom of the screen instead.
  const docked = useMediaQuery('(pointer: coarse)');
  /** A press on the toolbar is under way: on touch screens it can collapse the selection before the tap lands. */
  const pressingToolbar = useRef(false);

  useEffect(() => {
    const onSelectionEnd = () =>
      setTimeout(() => {
        const sel = window.getSelection();
        const root = contentRef.current;
        if (!sel || sel.isCollapsed || !root || !root.contains(sel.anchorNode)) {
          if (!pressingToolbar.current) setSelection(null);
          return;
        }
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setSelection({ top: rect.top + window.scrollY, left: rect.left + rect.width / 2, range: range.cloneRange() });
      }, 0);
    // Dragging the selection handles on a phone fires no touchend on the page, only selectionchange.
    const events = docked ? ['selectionchange'] : ['mouseup', 'touchend', 'keyup'];
    for (const e of events) document.addEventListener(e, onSelectionEnd);
    return () => {
      for (const e of events) document.removeEventListener(e, onSelectionEnd);
    };
  }, [docked]);

  const saveSelection = async (withNote: boolean) => {
    if (!selection || !contentRef.current) return;
    const anchor = describeRange(contentRef.current, selection.range);
    window.getSelection()?.removeAllRanges();
    const { top, left } = selection;
    setSelection(null);
    if (!anchor) return;
    const hid = await createHighlight(b.id, anchor);
    if (withNote) setActiveHighlight({ id: hid, top: top + 28, left });
  };

  const askAboutSelection = () => {
    if (!selection || !contentRef.current) return;
    const anchor = describeRange(contentRef.current, selection.range);
    window.getSelection()?.removeAllRanges();
    const { top, left } = selection;
    setSelection(null);
    if (anchor) setAsking({ anchor, top: top + 28, left });
  };

  const below = (mark: Element) => {
    const rect = mark.getBoundingClientRect();
    return { top: rect.bottom + window.scrollY + 8, left: rect.left + rect.width / 2 };
  };
  function openRequest(mark: Element) {
    setActiveHighlight(null);
    setActiveRequest({ id: mark.getAttribute('data-req')!, ...below(mark) });
  }

  const onContentClick = (e: React.MouseEvent) => {
    // The innermost mark wins where a highlight and a request overlap.
    const mark = (e.target as HTMLElement).closest('mark[data-hl], mark[data-req]');
    if (!mark) return;
    if (mark.hasAttribute('data-req')) openRequest(mark);
    else {
      setActiveRequest(null);
      setActiveHighlight({ id: mark.getAttribute('data-hl')!, ...below(mark) });
    }
  };

  // ---- keyboard ----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (panel || activeHighlight || activeRequest || asking) {
          setPanel(null);
          setActiveHighlight(null);
          setActiveRequest(null);
          setAsking(null);
        } else goBack();
      } else if (e.key === 'a') void archiveAndLeave();
      else if (e.key === 't') setPanel('tags');
      else if (e.key === 'l') void toggleLike(b);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const archiveAndLeave = async () => {
    await toggleArchive(b);
    if (b.archivedAt === null) {
      toast('Archived', { label: 'Undo', run: () => updateBookmark(b.id, { archived: false }) });
      goBack();
    } else toast('Moved to Home');
  };

  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  // Sites often give only a day, so the published date has no time; Margin knows when it saved to the minute.
  const published = b.publishedAt ? `Published ${new Date(b.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : null;
  const saved = `Saved ${new Date(b.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;

  return (
    <>
      <div className="reader-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden />
      <header className={`reader-toolbar${toolbarHidden && !panel ? ' hidden' : ''}`}>
        <button className="icon-button" aria-label="Back" onClick={goBack}>
          <ArrowLeft size={20} />
        </button>
        {b.kind === 'pdf' && hasText && (
          <div className="segmented view-switch" role="radiogroup" aria-label="Show">
            {(['text', 'original'] as const).map((v) => (
              <button key={v} role="radio" aria-checked={showing === v} onClick={() => setView(v)}>
                {v === 'text' ? 'Text' : 'Original'}
              </button>
            ))}
          </div>
        )}
        <div className="reader-tools">
          {showing === 'text' && (
            <>
              <button className="icon-button" aria-label="Text settings" aria-expanded={panel === 'settings'} onClick={() => togglePanel('settings')}>
                <Type size={19} />
              </button>
              <button
                className="icon-button"
                aria-label={`Highlights (${highlights.length})`}
                aria-expanded={panel === 'highlights'}
                onClick={() => togglePanel('highlights')}
              >
                <Highlighter size={19} />
                {highlights.length > 0 && <span className="badge">{highlights.length}</span>}
              </button>
            </>
          )}
          {speech.supported && showing === 'text' && (
            <button className="icon-button" aria-label="Listen" onClick={speech.state === 'stopped' ? speech.play : speech.stop}>
              <Headphones size={19} />
            </button>
          )}
          <RelevanceButtons bookmark={b} size={19} />
          <button
            className={`icon-button${b.likedAt ? ' liked' : ''}`}
            aria-label={b.likedAt ? 'Unlike' : 'Like'}
            aria-pressed={!!b.likedAt}
            onClick={() => toggleLike(b)}
          >
            <Heart size={19} fill={b.likedAt ? 'currentColor' : 'none'} />
          </button>
          <span className="menu-anchor">
            <button
              className={`icon-button${b.tagIds.length ? ' tagged' : ''}`}
              aria-label="Tags"
              aria-expanded={panel === 'tags'}
              onClick={() => togglePanel('tags')}
            >
              <Tag size={19} />
            </button>
            {panel === 'tags' && <TagMenu bookmark={b} onClose={() => setPanel(null)} />}
          </span>
          <span className="menu-anchor">
            <button className="icon-button" aria-label="Move to folder" onClick={() => togglePanel('move')}>
              <FolderInput size={19} />
            </button>
            {panel === 'move' && <MoveMenu bookmark={b} onClose={() => setPanel(null)} />}
          </span>
          <button className="icon-button" aria-label={b.archivedAt ? 'Move to Home' : 'Archive'} onClick={archiveAndLeave}>
            {b.archivedAt ? <ArchiveRestore size={19} /> : <Archive size={19} />}
          </button>
        </div>
        {panel === 'settings' && <ReaderSettingsPanel />}
        {panel === 'highlights' && (
          <HighlightsPanel
            highlights={highlights}
            onJump={(h) => {
              setPanel(null);
              contentRef.current
                ?.querySelector(`mark[data-hl="${CSS.escape(h.id)}"]`)
                ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }}
          />
        )}
      </header>

      <article
        className={`reader-article${showing === 'original' ? ' original' : ''}`}
        onClick={() => panel && panel !== 'move' && panel !== 'tags' && setPanel(null)}
      >
        <header className="article-head">
          <p className="article-source">
            {b.source === 'upload' ? (
              <span>PDF{b.file ? `, ${formatBytes(b.file.bytes)}` : ''}</span>
            ) : (
              <a href={b.url} target="_blank" rel="noopener noreferrer">
                {b.source === 'x' ? 'x.com' : (b.siteName ?? domainOf(b.url))}
                <ExternalLink size={13} aria-hidden />
              </a>
            )}
          </p>
          <h1 className="article-title">{b.title}</h1>
          <p className="article-byline">
            {[b.byline, published, saved, b.kind === 'article' ? `${lengthLabel(b)} read` : lengthLabel(b)].filter(Boolean).map((part) => (
              <span key={part}>{part}</span>
            ))}
          </p>
          {b.suggestion && (
            <p className="article-suggestion">
              {answered ? (
                <Link className="answers-request" to={`/requests#${answered.id}`}>
                  <strong>Answers your request:</strong> “{requestPreview(answered.text)}”
                </Link>
              ) : (
                <strong>Suggested</strong>
              )}{' '}
              {b.suggestion.reason}
            </p>
          )}
        </header>
        {b.kind === 'video' && <VideoHeader bookmark={b} />}
        {b.kind === 'podcast' && <PodcastHeader bookmark={b} />}
        {showing === 'text' ? (
          <div className="article-body" ref={contentRef} onClick={onContentClick} />
        ) : (
          <>
            {b.status === 'pending' && <p className="notice">Margin is still reading the text of this PDF. Its pages are below.</p>}
            {b.status === 'failed' && <p className="notice">{b.error} Its pages are below, from this device.</p>}
            {b.status === 'ready' && !hasText && (
              <p className="notice">This PDF has no selectable text (it may be a scan), so it’s shown as its original pages.</p>
            )}
            {pdf ? (
              <Suspense fallback={<p className="pdf-message">Opening the PDF…</p>}>
                <PdfView blob={pdf} />
              </Suspense>
            ) : (
              pdf === null && <p className="pdf-message">The PDF is downloading to this device. It opens here once it has arrived.</p>
            )}
          </>
        )}
        <footer className="article-end">
          <button className="button" onClick={archiveAndLeave}>
            {b.archivedAt ? 'Move to Home' : 'Archive this article'}
          </button>
        </footer>
      </article>

      {selection && (
        <div
          className={`selection-toolbar${docked ? ' docked' : ''}`}
          style={docked ? undefined : { top: selection.top - 48, left: selection.left }}
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={() => (pressingToolbar.current = true)}
          onClickCapture={() => setTimeout(() => (pressingToolbar.current = false))}
          onPointerCancel={() => (pressingToolbar.current = false)}
        >
          <button onClick={() => saveSelection(false)}>
            <Highlighter size={15} /> Highlight
          </button>
          <button onClick={() => saveSelection(true)}>
            <StickyNote size={15} /> Add note
          </button>
          <button onClick={askAboutSelection}>
            <MessageCircleQuestion size={15} /> Ask curator
          </button>
        </div>
      )}

      {asking && (
        <AskPopover
          top={asking.top}
          left={asking.left}
          onClose={() => setAsking(null)}
          onAsk={(text) => createRequest(text, { bookmarkId: b.id, anchor: asking.anchor })}
        />
      )}

      {activeRequest && (
        <RequestPopover
          key={activeRequest.id}
          top={activeRequest.top}
          left={activeRequest.left}
          onClose={() => setActiveRequest(null)}
        >
          {(() => {
            const r = requests.find((x) => x.id === activeRequest.id);
            return r && <RequestDetails request={r} showSource={false} onDeleted={() => setActiveRequest(null)} />;
          })()}
        </RequestPopover>
      )}

      {activeHighlight && (
        <HighlightPopover
          key={activeHighlight.id}
          highlight={highlights.find((h) => h.id === activeHighlight.id)}
          top={activeHighlight.top}
          left={activeHighlight.left}
          onClose={() => setActiveHighlight(null)}
        />
      )}

      {speech.state !== 'stopped' && (
        <div className="player" role="region" aria-label="Listening">
          <button className="icon-button" aria-label={speech.state === 'playing' ? 'Pause' : 'Resume'} onClick={speech.state === 'playing' ? speech.pause : speech.play}>
            {speech.state === 'playing' ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="rate" aria-label="Playback speed" onClick={speech.cycleRate}>
            {speech.rate}×
          </button>
          <span className="player-title">{b.title}</span>
          <button className="icon-button" aria-label="Stop listening" onClick={speech.stop}>
            <Square size={16} />
          </button>
        </div>
      )}
    </>
  );
}

function HighlightPopover({
  highlight: h,
  top,
  left,
  onClose,
}: {
  highlight: Highlight | undefined;
  top: number;
  left: number;
  onClose: () => void;
}) {
  const [note, setNote] = useState(h?.note ?? '');
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutsidePress(ref, onClose);

  if (!h) return null;
  const save = async () => {
    if ((h.note ?? '') !== note.trim()) await updateHighlightNote(h.id, note.trim() || null);
    onClose();
  };

  return (
    <div className="popover note-popover" ref={ref} style={{ top, left }}>
      <textarea
        autoFocus
        rows={3}
        placeholder="Add a note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
        }}
      />
      <div className="popover-actions">
        <button
          className="button subtle"
          onClick={async () => {
            await deleteHighlight(h.id);
            onClose();
          }}
        >
          Remove highlight
        </button>
        <button className="button primary" onClick={save}>
          Save note
        </button>
      </div>
    </div>
  );
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Closes on a press anywhere outside `ref`. */
function useCloseOnOutsidePress(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [ref, onClose]);
}

/** Writing a request about the selected passage. */
function AskPopover({ top, left, onClose, onAsk }: { top: number; left: number; onClose: () => void; onAsk: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutsidePress(ref, onClose);
  const send = async () => {
    if (!text.trim()) return;
    await onAsk(text.trim());
    onClose();
    toast('Asked the curator. Its answers appear in Requests.');
  };
  return (
    <div className="popover note-popover ask-popover" ref={ref} style={{ top, left }}>
      <textarea
        autoFocus
        rows={3}
        maxLength={REQUEST_TEXT_MAX}
        placeholder="What should the curator find or explain?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
        }}
      />
      <div className="popover-actions">
        <button className="button subtle" onClick={onClose}>
          Cancel
        </button>
        <button className="button primary" onClick={send} disabled={!text.trim()}>
          Ask
        </button>
      </div>
    </div>
  );
}

function RequestPopover({ top, left, onClose, children }: { top: number; left: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutsidePress(ref, onClose);
  return (
    <div className="popover request-popover" ref={ref} style={{ top, left }}>
      {children}
    </div>
  );
}

function HighlightsPanel({ highlights, onJump }: { highlights: Highlight[]; onJump: (h: Highlight) => void }) {
  return (
    <div className="panel highlights-panel" role="dialog" aria-label="Highlights">
      {highlights.length === 0 ? (
        <p className="panel-empty">Select any text in the article to highlight it or add a note.</p>
      ) : (
        <ul>
          {highlights.map((h) => (
            <li key={h.id}>
              <button onClick={() => onJump(h)}>
                <blockquote>{h.anchor.exact}</blockquote>
                {h.note && <p className="note">{h.note}</p>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
