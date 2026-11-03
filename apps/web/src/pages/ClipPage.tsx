import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { saveClip } from '../data/actions.ts';
import { decodeClip } from '../data/clip.ts';

/** Where the Save to Margin bookmarklet lands: /clip#u=…&h=… (see data/clip.ts). */
export function ClipPage() {
  const [state, setState] = useState<'saving' | 'saved' | 'damaged'>('saving');
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const hash = location.hash;
    // The page is in the address; drop it so it doesn't sit in history or get shared by accident.
    history.replaceState(history.state, '', location.pathname);
    void decodeClip(hash).then(async (clip) => {
      if (!clip) return setState('damaged');
      await saveClip(clip.url, clip.html);
      setState('saved');
    });
  }, []);

  return (
    <div className="reader-missing">
      <p>
        {state === 'saving'
          ? 'Saving…'
          : state === 'saved'
            ? 'Saved to Margin. It’ll be ready to read in a moment.'
            : 'This clip couldn’t be read. Try Save to Margin again.'}
      </p>
      {state !== 'saving' && (
        <p className="clip-actions">
          <button className="button" onClick={() => history.back()}>
            Back to the page
          </button>
          <Link className="button" to="/">
            Open Margin
          </Link>
        </p>
      )}
    </div>
  );
}
