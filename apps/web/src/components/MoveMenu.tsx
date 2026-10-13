import type { Bookmark } from '@margin/shared';
import { Check } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { createFolder, moveToFolder } from '../data/actions.ts';
import { useFolders } from '../data/queries.ts';
import { toast } from '../data/toast.ts';
import { useDismiss } from './useDismiss.ts';

export function MoveMenu({ bookmark, onClose }: { bookmark: Bookmark; onClose: () => void }) {
  const folders = useFolders();
  const ref = useRef<HTMLDivElement>(null);
  const [newName, setNewName] = useState('');

  useDismiss(ref, onClose);

  const move = async (folderId: string | null, label: string) => {
    await moveToFolder(bookmark, folderId);
    toast(`Moved to ${label}`);
    onClose();
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (name) await move(await createFolder(name), name);
  };

  const current = bookmark.archivedAt === null ? bookmark.folderId : undefined;

  return (
    <div className="menu" ref={ref} role="menu">
      <button role="menuitem" onClick={() => move(null, 'Home')}>
        Home {current === null && <Check size={14} />}
      </button>
      {folders.map((f) => (
        <button role="menuitem" key={f.id} onClick={() => move(f.id, f.name)}>
          {f.name} {current === f.id && <Check size={14} />}
        </button>
      ))}
      <form onSubmit={create}>
        <input
          className="inline-input"
          placeholder="New folder"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
      </form>
    </div>
  );
}
