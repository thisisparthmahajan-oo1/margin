import type { Bookmark } from '@margin/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toggleArchive, toggleLike } from '../data/actions.ts';

const isTyping = (e: KeyboardEvent) =>
  e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));

/** Instapaper-style list shortcuts: j/k move, Enter/o open, a archive, l like, / search, n new link. */
export function useListKeys(items: Bookmark[]) {
  const [selected, setSelected] = useState(-1);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const current = items[selected];
      const actions: Record<string, () => void> = {
        j: () => setSelected((i) => Math.min(items.length - 1, i + 1)),
        k: () => setSelected((i) => Math.max(0, i - 1)),
        Enter: () => current?.status === 'ready' && navigate(`/read/${current.id}`),
        o: () => current?.status === 'ready' && navigate(`/read/${current.id}`),
        a: () => current && void toggleArchive(current),
        l: () => current && void toggleLike(current),
        '/': () => document.getElementById('search-input')?.focus(),
        n: () => document.getElementById('add-input')?.focus(),
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [items, selected, navigate]);

  useEffect(() => {
    document.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return selected;
}
