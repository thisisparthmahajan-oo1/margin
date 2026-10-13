import type { Bookmark } from '@margin/shared';
import { Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MediaImg } from '../components/MediaImg.tsx';
import { isNative } from '../platform/native.ts';

const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

/**
 * A saved YouTube video. It isn't downloaded: on the web it plays inline; in the apps it opens in
 * YouTube (embedded players are unreliable inside app WebViews). Offline, the thumbnail stays.
 */
export function VideoHeader({ bookmark: b }: { bookmark: Bookmark }) {
  const [playing, setPlaying] = useState(false);
  const online = useOnline();
  if (!b.video) return null;
  const { videoId } = b.video;

  if (playing && online) {
    return (
      <div className="video-frame">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={b.title ?? 'Video'}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    );
  }

  const play = () => (isNative ? window.open(watchUrl(videoId), '_blank') : setPlaying(true));
  return (
    <figure className="video-poster">
      <button onClick={play} disabled={!online} aria-label={isNative ? 'Watch on YouTube' : 'Play video'}>
        {b.leadImage && <MediaImg src={b.leadImage} alt="" />}
        {online && (
          <span className="video-play" aria-hidden>
            <Play size={28} fill="currentColor" />
          </span>
        )}
      </button>
      {!online ? (
        <figcaption>Watch when you’re online. The description is saved below.</figcaption>
      ) : (
        isNative && <figcaption>Opens in YouTube</figcaption>
      )}
    </figure>
  );
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
