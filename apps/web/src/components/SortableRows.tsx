import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Bookmark } from '@margin/shared';
import { GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { reorderInFolder } from '../data/actions.ts';

/**
 * A folder's rows in your own order, moved by dragging each row's grip. Only the grip starts a
 * drag (it doesn't scroll), so a finger or pen anywhere else on the row scrolls the page as usual.
 */
export function SortableRows({ items, row }: { items: Bookmark[]; row: (b: Bookmark, dragHandle: ReactNode) => ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((b) => b.id === active.id);
    const to = items.findIndex((b) => b.id === over.id);
    const moved = arrayMove(items, from, to);
    void reorderInFolder(items[from]!, moved[to - 1] ?? null, moved[to + 1] ?? null);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        {items.map((b) => (
          <SortableRow key={b.id} bookmark={b} row={row} />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ bookmark: b, row }: { bookmark: Bookmark; row: (b: Bookmark, dragHandle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: b.id });
  const handle = (
    <button
      ref={setActivatorNodeRef}
      className="drag-handle"
      aria-label={`Move “${b.title ?? b.url}”`}
      title="Drag to reorder"
      {...attributes}
      {...listeners}
    >
      <GripVertical size={18} aria-hidden />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      className={`sortable-row${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {row(b, handle)}
    </div>
  );
}
