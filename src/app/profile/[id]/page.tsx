"use client";

import { useEffect, useMemo, useState, use } from "react";
import { getUserProfile } from "@/lib/db/users";
import { getAllUserWorks } from "@/lib/db/works";
import { fetchAniListBatch } from "@/lib/anilist";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import { User as UserIcon, ChevronDown, ChevronUp } from "lucide-react";
import { ProfileStats } from "@/components/ui/ProfileStats";
import { useAppStore } from "@/lib/store";

function FavoriteItem({ id, index, workDetails }: { id: string, index: number, workDetails?: any }) {
  return (
    <div className={`w-full aspect-[3/4] relative rounded-lg bg-[#1a1d24] border border-gray-700 hover:border-blue-500 transition flex items-center justify-center font-bold text-gray-500 overflow-hidden shadow-sm group`}>
      <span className="absolute top-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 font-bold text-white shadow-md z-10 border border-blue-400 text-[10px]">
        {index + 1}
      </span>
      {workDetails ? (
        <Link href={`/work/${id}`} className="absolute inset-0 block h-full w-full group">
          <img src={workDetails.coverImage?.extraLarge || workDetails.coverImage?.large} alt="Cover" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          <div className="absolute bottom-0 w-full bg-black/80 backdrop-blur-md text-[10px] text-center text-blue-400 py-1 font-bold">
            ★ {workDetails.userScore?.toFixed(1) || "?"}
          </div>
        </Link>
      ) : (
        <span className="text-xs text-center p-2 text-white line-clamp-3"></span>
      )}
    </div>
  );
}

export default function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const userId = resolvedParams.id;
  const { contentType } = useAppStore();
  
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [favItems, setFavItems] = useState<any[]>([]);
  const [aniListDetails, setAniListDetails] = useState<Record<string, any>>({});
  const [allWorks, setAllWorks] = useState<any[]>([]);
  const [myWorks, setMyWorks] = useState<any[]>([]);
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [showTasteDetails, setShowTasteDetails] = useState(false);
  const [onlyMalOpen, setOnlyMalOpen] = useState(false);

  const ratedWorks = useMemo(() => {
    return allWorks
      .filter(
        (w) =>
          aniListDetails[w.work_id]?.type === contentType &&
          (w.evaluation?.overallScore || 0) > 0 &&
          (!onlyMalOpen || !w.mal_rated)
      )
      .sort((a, b) => (b.evaluation?.overallScore || 0) - (a.evaluation?.overallScore || 0));
  }, [allWorks, aniListDetails, contentType, onlyMalOpen]);

  // Taste compatibility calculation with the logged-in user
  const tasteMatch = useMemo(() => {
    if (isOwnProfile || myWorks.length === 0 || allWorks.length === 0) return null;

    const myRatedMap = new Map<string, number>();
    myWorks.forEach((w) => {
      const score = Number(w.evaluation?.overallScore) || 0;
      if (score > 0) myRatedMap.set(w.work_id, score);
    });
    if (myRatedMap.size === 0) return null;

    type SharedRating = {
      workId: string;
      title: string;
      myScore: number;
      friendScore: number;
      diff: number;
      type?: string;
    };

    const allShared: SharedRating[] = [];
    allWorks.forEach((w) => {
      const friendScore = Number(w.evaluation?.overallScore) || 0;
      if (friendScore <= 0) return;
      const myScore = myRatedMap.get(w.work_id);
      if (myScore === undefined) return;
      const details = aniListDetails[w.work_id];
      allShared.push({
        workId: w.work_id,
        title: details?.title?.english || details?.title?.romaji || `Werk #${w.work_id}`,
        myScore,
        friendScore,
        diff: Math.abs(myScore - friendScore),
        type: details?.type,
      });
    });

    if (allShared.length === 0) return null;

    const typedShared = allShared.filter((s) => s.type === contentType);
    const activeShared = typedShared.length > 0 ? typedShared : allShared;
    const isScopedToType = typedShared.length > 0;

    const avgDiff =
      activeShared.reduce((acc, item) => acc + item.diff, 0) / activeShared.length;
    const matchPercent = Math.round(
      Math.max(0, Math.min(100, (1 - avgDiff / 6) * 100))
    );

    const agreements = [...activeShared]
      .filter((s) => s.diff <= 1.2)
      .sort((a, b) => a.diff - b.diff || (b.myScore + b.friendScore) - (a.myScore + a.friendScore))
      .slice(0, 3);

    const controversies = [...activeShared]
      .filter((s) => s.diff >= 1.5)
      .sort((a, b) => b.diff - a.diff)
      .slice(0, 3);

    return {
      matchPercent,
      sharedCount: activeShared.length,
      isScopedToType,
      agreements,
      controversies,
    };
  }, [isOwnProfile, myWorks, allWorks, aniListDetails, contentType]);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setMyWorks([]);
        setIsOwnProfile(false);
        return;
      }
      if (currentUser.uid === userId) {
        setIsOwnProfile(true);
        setMyWorks([]);
        return;
      }
      setIsOwnProfile(false);
      try {
        const works = await getAllUserWorks(currentUser.uid);
        setMyWorks(works);
      } catch (err) {
        console.warn("Could not load viewer works for taste match:", err);
      }
    });
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const p = await getUserProfile(userId);
        if (p) {
          setProfile(p);
          const works = await getAllUserWorks(userId);
          setAllWorks(works);
          
          const topAnime = works
            .filter((w: any) => (w.evaluation?.overallScore || 0) > 0)
            .sort((a: any, b: any) => (b.evaluation?.overallScore || 0) - (a.evaluation?.overallScore || 0))
            .slice(0, 9);
            
          setFavItems(topAnime);
          
          const idsToFetch = works.map(w => parseInt(w.work_id, 10));
          if (idsToFetch.length > 0) {
            const mediaList = await fetchAniListBatch(idsToFetch);
            const map: Record<string, any> = {};
            mediaList.forEach((m: any) => { map[m.id.toString()] = m; });
            setAniListDetails(map);
          }
        }
      } catch(e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [userId]);

  if (isLoading) {
    return <div className="p-10 text-center text-gray-400">Lade Profil...</div>;
  }

  if (!profile) {
    return <div className="p-10 text-center text-red-400">Profil nicht gefunden.</div>;
  }

  const friendShortName = profile.username || "Freund";

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24 max-w-lg mx-auto">
      <div className="flex flex-col bg-[#1a1d24] rounded-xl border border-gray-800 shadow-lg overflow-hidden">
        <div className="flex items-center gap-4 p-4">
          <button onClick={() => window.history.back()} className="text-gray-400 hover:text-white p-2 shrink-0">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <div className="h-20 w-20 rounded-full bg-gray-700 flex items-center justify-center overflow-hidden border-2 border-blue-500 shrink-0">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              <UserIcon size={32} className="text-gray-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold text-white truncate">{friendShortName}</h2>
            {tasteMatch && (
              <button
                type="button"
                onClick={() => setShowTasteDetails((v) => !v)}
                className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/25 text-blue-300 transition-colors"
                title="Übereinstimmungen & Kontroversen anzeigen"
              >
                <span className="tabular-nums">{tasteMatch.matchPercent} % Match</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-400">{tasteMatch.sharedCount} gemeinsam</span>
                {showTasteDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Taste Comparison Details */}
        {tasteMatch && showTasteDetails && (
          <div className="border-t border-gray-800/90 bg-[#141720]/70 px-4 py-3 flex flex-col gap-3">
            {tasteMatch.agreements.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/90">
                  Größte Übereinstimmungen
                </span>
                <div className="flex flex-col gap-1">
                  {tasteMatch.agreements.map((item) => (
                    <Link
                      key={`agree-${item.workId}`}
                      href={`/work/${item.workId}`}
                      className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                    >
                      <span className="text-gray-200 truncate">{item.title}</span>
                      <span className="text-[11px] text-emerald-300 font-semibold shrink-0 tabular-nums">
                        Du {item.myScore.toFixed(1)} · {friendShortName} {item.friendScore.toFixed(1)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {tasteMatch.controversies.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400/90">
                  Größte Kontroversen
                </span>
                <div className="flex flex-col gap-1">
                  {tasteMatch.controversies.map((item) => (
                    <Link
                      key={`contra-${item.workId}`}
                      href={`/work/${item.workId}`}
                      className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                    >
                      <span className="text-gray-200 truncate">{item.title}</span>
                      <span className="text-[11px] text-rose-300 font-semibold shrink-0 tabular-nums">
                        Du {item.myScore.toFixed(1)} vs. {friendShortName} {item.friendScore.toFixed(1)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {tasteMatch.agreements.length === 0 && tasteMatch.controversies.length === 0 && (
              <p className="text-xs text-gray-500">
                Eure Bewertungen liegen bei den gemeinsamen Werken alle im Mittelfeld beieinander.
              </p>
            )}
          </div>
        )}
      </div>
      
      <ProfileStats allWorks={allWorks} aniListDetails={aniListDetails} />

      <div className="bg-[#1a1d24] border border-gray-800 rounded-xl p-4 shadow-lg">
        <h3 className="font-bold text-lg mb-4 text-blue-400">All-Time Top 9</h3>
        <div className="grid grid-cols-3 gap-2">
          {favItems.map((item, i) => (
            <FavoriteItem 
              key={i} 
              id={item?.work_id} 
              index={i} 
              workDetails={item ? { ...aniListDetails[item.work_id], userScore: item.evaluation?.overallScore } : null} 
            />
          ))}
        </div>
      </div>

      <section className="bg-[#1a1d24] border border-gray-800 rounded-xl p-4 shadow-lg">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-base font-bold text-white">
            Alle Bewertungen ({contentType}) ({ratedWorks.length})
          </h3>
          <button
            type="button"
            onClick={() => setOnlyMalOpen((prev) => !prev)}
            className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap ${
              onlyMalOpen
                ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                : "bg-[#141a29] border-gray-700 text-gray-400 hover:text-white"
            }`}
          >
            Nur AniList/MAL offen
          </button>
        </div>

        {ratedWorks.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-6">
            {onlyMalOpen
              ? "Alle bewerteten Werke sind bereits auf AniList/MAL markiert."
              : "Keine bewerteten Werke für diese Kategorie vorhanden."}
          </p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
            {ratedWorks.map((w) => {
              const details = aniListDetails[w.work_id];
              const title =
                details?.title?.english ||
                details?.title?.romaji ||
                `Werk #${w.work_id}`;
              const cover = details?.coverImage?.large || details?.coverImage?.extraLarge;
              const score = w.evaluation?.overallScore || 0;
              const rewatch = w.evaluation?.rewatchPotential || 0;

              return (
                <div
                  key={w.work_id}
                  className="flex items-center gap-3 rounded-xl border border-gray-800 bg-[#141a29] p-2.5 hover:border-gray-700 transition-colors"
                >
                  <Link
                    href={`/work/${w.work_id}`}
                    className="w-10 h-14 rounded-md overflow-hidden bg-gray-800 shrink-0 block"
                  >
                    {cover ? (
                      <img
                        src={cover}
                        alt={title}
                        className="w-full h-full object-cover"
                      />
                    ) : null}
                  </Link>

                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/work/${w.work_id}`}
                      className="text-sm font-semibold text-white hover:text-blue-400 transition-colors line-clamp-1 block"
                    >
                      {title}
                    </Link>
                    <div className="flex items-center flex-wrap gap-1.5 mt-1">
                      {rewatch > 0 && (
                        <span className="inline-flex items-center rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
                          Rewatch: {rewatch}/10
                        </span>
                      )}
                      {!w.mal_rated && (
                        <span className="inline-flex items-center rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          AniList offen
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="text-sm font-bold text-blue-400 shrink-0 tabular-nums">
                    ★ {score.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
