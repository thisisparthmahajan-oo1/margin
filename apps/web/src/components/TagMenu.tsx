import type { Bookmark } from '@margin/shared';
import { Check } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { createTag, setTag } from '../data/actions.ts';
import { useTags } from '../data/queries.ts';
import { useDismiss } from './useDismiss.ts';

/** Tags on an item: tick any number. Stays open so several can be set at once. */
export function TagMenu({ bookmark, onClose }: { bookmark: Bookmark; onClose: () => void }) {
  const tags = useTags();
  const ref = useRef<HTMLDivElement>(null);
  const [newName, setNewName] = useState('');
  useDismiss(ref, onClose);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    await setTag(bookmark, await createTag(name), true);
  };

  return (
    <div className="menu tag-menu" ref={ref} role="menu" aria-label="Tags">
      {tags.map((t) => {
        const on = bookmark.tagIds.includes(t.id);
        return (
          <button key={t.id} role="menuitemcheckbox" aria-checked={on} onClick={() => setTag(bookmark, t.id, !on)}>
            {t.name} {on && <Check size={14} />}
          </button>
        );
      })}
      <form onSubmit={create}>
        <input
          autoFocus
          className="inline-input"
          aria-label="New tag"
          placeholder={tags.length ? 'New tag' : 'New tag, e.g. Don’t understand yet'}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
      </form>
    </div>
  );
}
