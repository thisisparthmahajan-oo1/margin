import type { Bookmark, Relevance } from '@margin/shared';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { setRelevance } from '../data/actions.ts';

const CHOICES: { value: Relevance; label: string; Icon: typeof ThumbsUp }[] = [
  { value: 'relevant', label: 'Relevant', Icon: ThumbsUp },
  { value: 'not_relevant', label: 'Not relevant', Icon: ThumbsDown },
];

/** Was this worth suggesting? Teaches the Daily Curator; tapping the chosen one again clears it. */
export function RelevanceButtons({ bookmark: b, size }: { bookmark: Bookmark; size: number }) {
  return (
    <span className="relevance" role="group" aria-label="Was this relevant?">
      {CHOICES.map(({ value, label, Icon }) => (
        <button
          key={value}
          className={`icon-button${b.relevance === value ? ' chosen' : ''}`}
          aria-label={label}
          aria-pressed={b.relevance === value}
          title={label}
          onClick={() => setRelevance(b, value)}
        >
          <Icon size={size} fill={b.relevance === value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  );
}
