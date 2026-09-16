"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { useRouter } from "next/navigation";
import { Library as LibraryIcon, Search, LayoutGrid } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { auth } from "@/lib/firebase";
import { getUserProfile, updateTop9List } from "@/lib/db/users";
import { getAllUserWorks } from "@/lib/db/works";
import { fetchAniList, GET_WORKS_BATCH } from "@/lib/anilist";
import { UserWork } from "@/types/database";
import Link from "next/link";

// Simple Sortable Item Component
function SortableItem({ id, index, workDetails, userWork }: { id: string, index: number, workDetails?: any, userWork?: any }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
    opacity: isDragging ? 0.8 : 1,
  };

  let behindCount = 0;
  if (workDetails && userWork) {
    const currentEp = userWork.current_episode || 0;
    let maxAiredEp = 0;
    if (workDetails.status === "RELEASING" && workDetails.nextAiringEpisode) {
      maxAiredEp = workDetails.nextAiringEpisode.episode - 1;
    } else if (workDetails.status === "FINISHED") {
      maxAiredEp = workDetails.episodes || 0;
    }
    behindCount = maxAiredEp - currentEp;
  }

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...listeners}
      className={`w-24 shrink-0 aspect-[3/4] relative cursor-grab active:cursor-grabbing rounded-xl bg-[#1a1d24] border ${isDragging ? 'border-blue-500 shadow-2xl scale-105' : 'border-gray-800'} flex items-center justify-center font-bold text-gray-500 overflow-hidden`}
    >
      <span className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white backdrop-blur-md z-10 pointer-events-none">
        {index + 1}
      </span>
      {behindCount > 0 && (
        <span className="absolute -top-1 -right-1 flex items-center justify-center rounded-full bg-red-600 text-[10px] px-1.5 py-0.5 font-bold text-white shadow-md z-10 pointer-events-none">
          {behindCount}
        </span>
      )}
      {id.startsWith("empty") ? (
        <span className="text-gray-700 text-3xl font-light pointer-events-none">+</span>
      ) : workDetails ? (
        <Link href={`/work/${id}`} className="absolute inset-0 block h-full w-full">
          <img src={workDetails.coverImage?.extraLarge || workDetails.coverImage?.large} alt="Cover" className="h-full w-full object-cover pointer-events-none" />
        </Link>
      ) : (
        <span className="text-xs text-center p-2 text-white line-clamp-3 pointer-events-none">Lade...</span>
      )}
    </div>
  );
}

export default function LibraryPage() {
  const { contentType } = useAppStore();
  const router = useRouter();
  
  const [items, setItems] = useState<string[]>(Array(9).fill("").map((_, i) => `empty-${i}`));
  const [allWorks, setAllWorks] = useState<UserWork[]>([]);
  const [aniListDetails, setAniListDetails] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          const [profile, works] = await Promise.all([
            getUserProfile(user.uid),
            getAllUserWorks(user.uid)
          ]);

          let currentTop9 = profile?.top_9_list || [];
          while(currentTop9.length < 9) {
            currentTop9.push(`empty-${currentTop9.length}`);
          }

          const worksInTop9 = currentTop9.filter(id => !id.startsWith("empty"));
          const worksNotInTop9 = works.filter(w => !worksInTop9.includes(w.work_id));

          for (let i = 0; i < currentTop9.length; i++) {
            if (currentTop9[i].startsWith("empty") && worksNotInTop9.length > 0) {
              const nextWork = worksNotInTop9.shift();
              if (nextWork) currentTop9[i] = nextWork.work_id;
            }
          }

          setItems(currentTop9);
          setAllWorks(works);

          const allIdsToFetch = works.map(w => parseInt(w.work_id, 10));
          if (allIdsToFetch.length > 0) {
            const data = await fetchAniList(GET_WORKS_BATCH, { ids: allIdsToFetch });
            const map: Record<string, any> = {};
            data.Page.media.forEach((m: any) => {
              map[m.id.toString()] = m;
            });
            setAniListDetails(map);
          }
        } catch (error) {
          console.error("Fehler beim Laden der Bibliothek:", error);
        } finally {
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prevItems) => {
        const oldIndex = prevItems.indexOf(active.id as string);
        const newIndex = prevItems.indexOf(over.id as string);
        const newItems = arrayMove(prevItems, oldIndex, newIndex);
        
        if (auth.currentUser) {
          updateTop9List(auth.currentUser.uid, newItems).catch(console.error);
        }
        
        return newItems;
      });
    }
  };

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24 max-w-5xl mx-auto">
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
          <SortableContext items={items} strategy={horizontalListSortingStrategy}>
            <div className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
              {items.map((id, index) => {
                const uWork = allWorks.find(w => w.work_id === id);
                return (
                  <div key={id} className="snap-center">
                    <SortableItem id={id} index={index} workDetails={aniListDetails[id]} userWork={uWork} />
                  </div>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </section>
      
      <section className="mt-4">
        <h3 className="mb-3 text-lg font-bold">Alle Werke</h3>
        
        {isLoading ? (
          <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-8 text-center text-gray-500 animate-pulse">
            Lade Bibliothek...
          </div>
        ) : allWorks.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-8 text-center text-gray-500">
            Noch keine Werke hinzugefügt. Suche oben, um anzufangen!
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {allWorks.map(work => {
              const details = aniListDetails[work.work_id];
              let behindCount = 0;
              if (details) {
                const currentEp = work.current_episode || 0;
                let maxAiredEp = 0;
                if (details.status === "RELEASING" && details.nextAiringEpisode) {
                  maxAiredEp = details.nextAiringEpisode.episode - 1;
                } else if (details.status === "FINISHED") {
                  maxAiredEp = details.episodes || 0;
                }
                behindCount = maxAiredEp - currentEp;
              }

              return (
                <Link href={`/work/${work.work_id}`} key={work.work_id} className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] transition hover:border-blue-500 hover:shadow-lg">
                  {details ? (
                    <img src={details.coverImage?.extraLarge || details.coverImage?.large} alt="Cover" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full items-center justify-center p-2 text-xs text-gray-500 text-center">Lade...</div>
                  )}
                  {behindCount > 0 && (
                    <div className="absolute -top-1 -right-1 flex items-center justify-center rounded-full bg-red-600 text-[10px] px-1.5 py-0.5 font-bold text-white shadow-md z-10 pointer-events-none">
                      {behindCount}
                    </div>
                  )}
                  {/* Status Badge */}
                  <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 to-transparent p-2 text-center text-[10px] font-bold text-white opacity-0 transition group-hover:opacity-100">
                    {work.status}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
