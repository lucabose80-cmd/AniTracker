"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { useRouter } from "next/navigation";
import { Library as LibraryIcon, Search, LayoutGrid } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent, useDraggable } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { auth } from "@/lib/firebase";
import { getUserProfile, updateTop9List } from "@/lib/db/users";
import { fetchAniListBatch } from "@/lib/anilist";
import { UserWork } from "@/types/database";
import { getAllUserWorks } from "@/lib/db/works";
import { getCalendarOverrides } from "@/lib/db/calendar";
import Link from "next/link";
import { ArrowUp, ArrowDown, Minus, Save, Share, Play, Check, Bookmark } from "lucide-react";
import { createActivity } from "@/lib/db/feed";

// Simple Sortable Item Component
function SortableItem({ id, index, workDetails, userWork, previousRank, globalOverride, onRemove }: { id: string, index: number, workDetails?: any, userWork?: any, previousRank?: number, globalOverride?: any, onRemove: (id: string) => void }) {
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
    if (globalOverride?.manualMaxEpisode !== undefined && globalOverride?.manualMaxEpisode !== null) {
      maxAiredEp = globalOverride.manualMaxEpisode;
    } else if (userWork.manual_max_episode !== undefined && userWork.manual_max_episode !== null) {
      maxAiredEp = userWork.manual_max_episode;
    } else if (workDetails.type === "MANGA") {
      maxAiredEp = workDetails.chapters || 0;
    } else {
      if (workDetails.status === "RELEASING" && workDetails.nextAiringEpisode) {
        maxAiredEp = workDetails.nextAiringEpisode.episode - 1;
      } else if (workDetails.status === "FINISHED") {
        maxAiredEp = workDetails.episodes || 0;
      }
    }
    behindCount = Math.max(0, maxAiredEp - currentEp);
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
      {!id.startsWith("empty") && previousRank !== undefined && (
        <div className="absolute bottom-1 right-1 flex items-center justify-center rounded bg-black/80 px-1 py-0.5 z-10">
          {previousRank === -1 ? (
            <span className="text-[10px] font-bold text-blue-400">NEU</span>
          ) : previousRank === index ? (
            <Minus size={12} className="text-gray-400" />
          ) : previousRank > index ? (
            <div className="flex items-center text-[10px] font-bold text-green-500">
              <ArrowUp size={10} /> {previousRank - index}
            </div>
          ) : (
            <div className="flex items-center text-[10px] font-bold text-red-500">
              <ArrowDown size={10} /> {index - previousRank}
            </div>
          )}
        </div>
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
      {!id.startsWith("empty") && (
        <button 
          onPointerDown={(e) => { e.stopPropagation(); onRemove(id); }}
          className="absolute top-1 right-1 bg-red-600/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] hover:bg-red-500 z-20 shadow-md"
        >
          X
        </button>
      )}
    </div>
  );
}

function DraggableLibraryItem({ id, children }: { id: string, children: React.ReactNode }) {
  const {attributes, listeners, setNodeRef, transform, isDragging} = useDraggable({
    id: `library-${id}`,
  });
  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : 1,
    opacity: isDragging ? 0.8 : 1,
  } : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing">
      {children}
    </div>
  );
}

export default function LibraryPage() {
  const { contentType } = useAppStore();
  const router = useRouter();
  
  const [items, setItems] = useState<string[]>(Array(9).fill("").map((_, i) => `empty-${i}`));
  const [allWorks, setAllWorks] = useState<UserWork[]>([]);
  const [aniListDetails, setAniListDetails] = useState<Record<string, any>>({});
  const [globalOverrides, setGlobalOverrides] = useState<Record<string, any>>({});
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"CURRENT" | "COMPLETED" | "PLANNING">("CURRENT");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          const profile = await getUserProfile(user.uid);
          setUserProfile(profile);
          const works = await getAllUserWorks(user.uid);
          setAllWorks(works);

          const allIdsToFetch = works.map((w: UserWork) => parseInt(w.work_id, 10));
          if (allIdsToFetch.length > 0) {
            const [mediaList, overrides] = await Promise.all([
              fetchAniListBatch(allIdsToFetch),
              getCalendarOverrides()
            ]);
            
            setGlobalOverrides(overrides);
            
            const map: Record<string, any> = {};
            mediaList.forEach((m: any) => {
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

  // Sync Weekly Ranking list when contentType or aniListDetails changes
  useEffect(() => {
    if (!userProfile || Object.keys(aniListDetails).length === 0) return;

    const rankingData = contentType === "ANIME" ? userProfile.weekly_ranking_anime : userProfile.weekly_ranking_manga;
    let currentRanking = rankingData?.current ? [...rankingData.current] : [];
    
    // Filter works of current content type
    const worksOfType = allWorks.filter(w => aniListDetails[w.work_id]?.type === contentType);
    
    // Auto-populate with "CURRENT" works if the ranking has empty slots
    const currentWorks = worksOfType.filter(w => w.status === "CURRENT");
    const worksInRanking = currentRanking.filter(id => !id.startsWith("empty"));
    const worksNotYetRanked = currentWorks.filter(w => !worksInRanking.includes(w.work_id));

    // Remove duplicates or old deleted works
    let validRanking = currentRanking.filter(id => id.startsWith("empty") || allWorks.some(w => w.work_id === id));
    
    while(validRanking.length < 9) {
      validRanking.push(`empty-${validRanking.length}`);
    }

    for (let i = 0; i < 9; i++) {
      if (validRanking[i].startsWith("empty") && worksNotYetRanked.length > 0) {
        const nextWork = worksNotYetRanked.shift();
        if (nextWork) validRanking[i] = nextWork.work_id;
      }
    }

    setItems(validRanking.slice(0, 9));
  }, [contentType, userProfile, aniListDetails, allWorks]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    
    let newItems = [...items];
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    // Drag from library into Ranking
    if (activeIdStr.startsWith("library-")) {
      const workId = activeIdStr.replace("library-", "");
      if (newItems.includes(workId)) return; // Already in ranking
      
      const overIndex = newItems.indexOf(overIdStr);
      if (overIndex !== -1) {
        newItems[overIndex] = workId;
        setItems(newItems);
        
        if (auth.currentUser) {
          try {
            const { updateWeeklyRanking } = await import("@/lib/db/users");
            await updateWeeklyRanking(auth.currentUser.uid, contentType as "ANIME" | "MANGA", newItems);
          } catch(e) {
            console.error(e);
          }
        }
      }
      return;
    }

    // Sort within Ranking
    if (active.id !== over.id) {
      const oldIndex = newItems.indexOf(activeIdStr);
      const newIndex = newItems.indexOf(overIdStr);
      newItems = arrayMove(newItems, oldIndex, newIndex);
      setItems(newItems);
      
      if (auth.currentUser) {
        try {
          const { updateWeeklyRanking } = await import("@/lib/db/users");
          await updateWeeklyRanking(auth.currentUser.uid, contentType as "ANIME" | "MANGA", newItems);
        } catch(e) {
          console.error(e);
        }
      }
    }
  };

  const handleRemoveFromRanking = async (idToRemove: string) => {
    const newItems = [...items];
    const idx = newItems.indexOf(idToRemove);
    if (idx !== -1) {
      let maxEmpty = -1;
      newItems.forEach(item => {
        if (item.startsWith("empty-")) {
          const num = parseInt(item.split("-")[1]);
          if (num > maxEmpty) maxEmpty = num;
        }
      });
      newItems[idx] = `empty-${maxEmpty + 1}`;
    }
    
    setItems(newItems);
    if (auth.currentUser) {
      try {
        const { updateWeeklyRanking } = await import("@/lib/db/users");
        await updateWeeklyRanking(auth.currentUser.uid, contentType as "ANIME" | "MANGA", newItems);
      } catch(e) {
        console.error(e);
      }
    }
  };

  const handleSaveSnapshot = async () => {
    if (!auth.currentUser) return;
    try {
      const { saveWeeklyRankingSnapshot } = await import("@/lib/db/users");
      await saveWeeklyRankingSnapshot(auth.currentUser.uid, contentType as "ANIME" | "MANGA", items);
      
      const validItems = items.filter(id => !id.startsWith("empty"));
      // Post to Social Feed
      await createActivity(auth.currentUser.uid, "WEEKLY_RANKING", validItems[0], `Wochen-Ranking für ${contentType} veröffentlicht!`, validItems.join(","));
      
      // Update local profile state to reflect arrows resetting
      setUserProfile((prev: any) => ({
        ...prev,
        [contentType === "ANIME" ? "weekly_ranking_anime" : "weekly_ranking_manga"]: {
          current: items,
          previous: items,
          last_updated: new Date().toISOString()
        }
      }));
      
      alert("Wochen-Ranking erfolgreich gespeichert und geteilt!");
    } catch (e) {
      console.error(e);
      alert("Fehler beim Speichern des Wochen-Rankings.");
    }
  };

  const filteredWorks = allWorks.filter(w => aniListDetails[w.work_id]?.type === contentType);

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

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-bold flex items-center gap-2">
                <LayoutGrid size={18} className="text-blue-500" />
                Wochen-Ranking ({contentType})
              </h3>
              <p className="text-xs text-gray-400">Sortiere deine aktuellen Favoriten dieser Woche.</p>
            </div>
            <button 
              onClick={handleSaveSnapshot}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-lg"
            >
              <Share size={14} /> Speichern & Teilen
            </button>
          </div>
          
          <SortableContext items={items} strategy={horizontalListSortingStrategy}>
            <div className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
              {items.map((id, index) => {
                const uWork = allWorks.find(w => w.work_id === id);
                const prevRanking = contentType === "ANIME" ? userProfile?.weekly_ranking_anime?.previous : userProfile?.weekly_ranking_manga?.previous;
                const prevRank = prevRanking ? prevRanking.indexOf(id) : undefined;
                return (
                  <div key={id} className="snap-center">
                    <SortableItem id={id} index={index} workDetails={aniListDetails[id]} userWork={uWork} previousRank={prevRank} globalOverride={globalOverrides[id]} onRemove={handleRemoveFromRanking} />
                  </div>
                );
              })}
            </div>
          </SortableContext>
        </section>
        
        <section className="mt-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold">Alle Werke</h3>
          </div>
          
          <div className="flex bg-[#1a1d24] border border-gray-800 rounded-lg p-1 mb-4 w-full sm:w-fit mx-auto sm:mx-0">
            <button
              onClick={() => setActiveTab("CURRENT")}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-1 text-xs font-bold rounded-md transition ${activeTab === "CURRENT" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              <Play size={12} /> Aktiv
            </button>
            <button
              onClick={() => setActiveTab("COMPLETED")}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-1 text-xs font-bold rounded-md transition ${activeTab === "COMPLETED" ? "bg-green-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              <Check size={12} /> Fertig
            </button>
            <button
              onClick={() => setActiveTab("PLANNING")}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-1 text-xs font-bold rounded-md transition ${activeTab === "PLANNING" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              <Bookmark size={12} /> Wunschliste
            </button>
          </div>
          
          {isLoading ? (
            <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-8 text-center text-gray-500 animate-pulse">
              Lade Bibliothek...
            </div>
          ) : filteredWorks.filter(w => w.status === activeTab).length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-8 text-center text-gray-500">
              Keine Werke in dieser Kategorie gefunden.
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {filteredWorks.filter(w => w.status === activeTab).map(work => {
                const details = aniListDetails[work.work_id];
                const globalOverride = globalOverrides[work.work_id];
                let behindCount = 0;
                if (details) {
                  const currentEp = work.current_episode || 0;
                  let maxAiredEp = 0;
                  if (globalOverride?.manualMaxEpisode !== undefined && globalOverride?.manualMaxEpisode !== null) {
                    maxAiredEp = globalOverride.manualMaxEpisode;
                  } else if (work.manual_max_episode !== undefined && work.manual_max_episode !== null) {
                    maxAiredEp = work.manual_max_episode;
                  } else if (details.type === "MANGA") {
                    maxAiredEp = details.chapters || 0;
                  } else {
                    if (details.status === "RELEASING" && details.nextAiringEpisode) {
                      maxAiredEp = details.nextAiringEpisode.episode - 1;
                    } else if (details.status === "FINISHED") {
                      maxAiredEp = details.episodes || 0;
                    }
                  }
                  behindCount = Math.max(0, maxAiredEp - currentEp);
                }

                return (
                  <DraggableLibraryItem key={work.work_id} id={work.work_id}>
                    <div 
                      className="block group relative aspect-[3/4] overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] transition hover:border-blue-500 hover:shadow-lg"
                      onClick={(e) => {
                        // Very simple drag detection: If the user dragged, dnd-kit will preventDefault on the wrapper.
                        // However, we just navigate manually.
                        router.push(`/work/${work.work_id}`);
                      }}
                    >
                      {details ? (
                        <img src={details.coverImage?.extraLarge || details.coverImage?.large} alt="Cover" className="h-full w-full object-cover transition duration-300 group-hover:scale-105 pointer-events-none" />
                      ) : (
                        <div className="flex h-full items-center justify-center p-2 text-xs text-gray-500 text-center">Lade...</div>
                      )}
                      {behindCount > 0 && (
                        <div className="absolute top-1 right-1 flex items-center justify-center rounded-full bg-red-600 text-[10px] px-1.5 py-0.5 font-bold text-white shadow-md z-10 pointer-events-none">
                          {behindCount}
                        </div>
                      )}
                      {/* Status Badge */}
                      <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 to-transparent p-2 text-center text-[10px] font-bold text-white opacity-0 transition group-hover:opacity-100 pointer-events-none">
                        {work.status}
                      </div>
                    </div>
                  </DraggableLibraryItem>
                );
              })}
            </div>
          )}
        </section>
      </DndContext>
    </div>
  );
}
