import type { Bookmark } from '@margin/shared';
import { Headphones } from 'lucide-react';
import { MediaImg } from '../components/MediaImg.tsx';

const PLAYED_ON: Record<NonNullable<Bookmark['audio']>['provider'], string | null> = {
  apple: 'Apple Podcasts',
  spotify: 'Spotify',
  web: null,
};

/**
 * A saved podcast episode. The audio isn't downloaded: the episode plays in its app or on its site,
 * and its show notes (or transcript) are the text below.
 */
export function PodcastHeader({ bookmark: b }: { bookmark: Bookmark }) {
  if (!b.audio) return null;
  const where = PLAYED_ON[b.audio.provider] ?? b.siteName ?? 'its site';
  return (
    <figure className="podcast-card">
      {b.leadImage && <MediaImg className="podcast-art" src={b.leadImage} alt="" />}
      <figcaption>
        <a className="podcast-listen" href={b.url} target="_blank" rel="noopener noreferrer">
          <Headphones size={16} aria-hidden /> Listen on {where}
        </a>
      </figcaption>
    </figure>
  );
}
