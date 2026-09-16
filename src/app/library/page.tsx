"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { useRouter } from "next/navigation";
import { Library as LibraryIcon, Search, LayoutGrid } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Simple Sortable Item Component
function SortableItem({ id, index }: { id: string, index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...listeners}
      className={`aspect-[3/4] relative cursor-grab active:cursor-grabbing rounded-xl bg-[#1a1d24] border ${isDragging ? 'border-blue-500 shadow-2xl scale-105' : 'border-gray-800'} flex items-center justify-center font-bold text-gray-500 overflow-hidden`}
    >
      <span className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white backdrop-blur-md z-10">
        {index + 1}
      </span>
      {/* We will load real covers later, for now we show IDs or Empty */}
      {id.startsWith("empty") ? (
        <span className="text-gray-700 text-3xl font-light">+</span>
      ) : (
        <span className="text-xs text-center p-2 text-white line-clamp-3">Work {id}</span>
      )}
    </div>
  );
}

export default function LibraryPage() {
  const { contentType } = useAppStore();
  const router = useRouter();
  
  // Initialize with 9 slots (some empty, some filled for demo)
  const [items, setItems] = useState([
    "101922", "11061", "empty-3", "21087", "empty-5", "empty-6", "empty-7", "empty-8", "empty-9"
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        const newItems = arrayMove(items, oldIndex, newIndex);
        // Here we would also sync the new array to Firestore's top_9_list
        return newItems;
      });
    }
  };

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <LibraryIcon className="text-blue-500" /> 
        Meine Bibliothek
      </h2>

      <form className="relative" onSubmit={(e) => {
        e.preventDefault();
        const val = (e.target as any).elements.q.value;
        if(val) router.push(`/search?q=${encodeURIComponent(val)}`);
      }}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
        <input 
          name="q"
          type="text" 
          placeholder={`In ${contentType} suchen oder neues hinzufügen...`}
          className="w-full rounded-lg border border-gray-800 bg-[#1a1d24] p-3 pl-10 text-white focus:border-blue-500 focus:outline-none"
        />
        <button type="submit" className="hidden" />
      </form>

      <section>
        <h3 className="mb-3 text-lg font-bold flex items-center gap-2">
          <LayoutGrid size={18} className="text-blue-500" />
          Meine Top 9
        </h3>
        <p className="text-xs text-gray-400 mb-4">Halte gedrückt und ziehe, um deine Favoriten anzuordnen.</p>
        
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-3 gap-3">
              {items.map((id, index) => (
                <SortableItem key={id} id={id} index={index} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>
      
      <section className="mt-4">
        <h3 className="mb-3 text-lg font-bold">Alle Werke</h3>
        <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-8 text-center text-gray-500">
          Noch keine Werke hinzugefügt.
        </div>
      </section>
    </div>
  );
}
