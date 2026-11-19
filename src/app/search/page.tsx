"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  fetchAniList,
  SEARCH_WORKS,
  GET_UPCOMING_WORKS,
  GET_TRENDING_WORKS,
} from "@/lib/anilist";
import { useAppStore } from "@/lib/store";
import {
  Star,
  Search as SearchIcon,
  PlayCircle,
  CheckCircle,
  Bookmark,
  Sparkles,
  Flame,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  saveUserWork,
  getAllUserWorks,
  getAllCommunityWorks,
} from "@/lib/db/works";
import { addToHistory, getAllUserProfiles } from "@/lib/db/users";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

function getCurrentAniListSeason(): {
  season: "WINTER" | "SPRING" | "SUMMER" | "FALL";
  seasonYear: number;
  label: string;
} {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();
  if (month >= 1 && month <= 3) {
    return { season: "WINTER", seasonYear: year, label: `Winter ${year}` };
  }
  if (month >= 4 && month <= 6) {
    return { season: "SPRING", seasonYear: year, label: `Frühling ${year}` };
  }
  if (month >= 7 && month <= 9) {
    return { season: "SUMMER", seasonYear: year, label: `Sommer ${year}` };
  }
  return { season: "FALL", seasonYear: year, label: `Herbst ${year}` };
}

type OtherUserTrack = {
  userId: string;
  username: string;
  avatarUrl?: string;
  status: string;
};

function SearchContent() {
  const searchParams = useSearchParams();
  const query = searchParams?.get("q") || "";
  const { contentType, searchHistory, addSearchHistory } = useAppStore();
  const router = useRouter();

  const [input, setInput] = useState(query);
  const [discoverTab, setDiscoverTab] = useState<"SEASON" | "UPCOMING">("SEASON");
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [currentUserUid, setCurrentUserUid] = useState<string | null>(null);
  // Work IDs that the current user already has (CURRENT, PLANNING, COMPLETED, etc.)
  const [hiddenMyWorkIds, setHiddenMyWorkIds] = useState<Set<number>>(new Set());
  // All works in the user's library (for sequel/spin-off relation detection)
  const [allMyLibraryIds, setAllMyLibraryIds] = useState<Set<number>>(new Set());
  // Other users' active / wishlist tracking per workId
  const [communityTracksByWork, setCommunityTracksByWork] = useState<
    Record<number, OtherUserTrack[]>
  >({});

  const seasonInfo = useMemo(() => getCurrentAniListSeason(), []);

  useEffect(() => {
    setInput(query);
  }, [query]);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUserUid(user?.uid || null);
      if (!user) {
        setHiddenMyWorkIds(new Set());
        setAllMyLibraryIds(new Set());
        setCommunityTracksByWork({});
        return;
      }

      try {
        const [myWorks, allCommWorks, allProfiles] = await Promise.all([
          getAllUserWorks(user.uid),
          getAllCommunityWorks(),
          getAllUserProfiles(),
        ]);

        const hiddenIds = new Set<number>();
        const allMyIds = new Set<number>();
        myWorks.forEach((w) => {
          const parsed = parseInt(w.work_id, 10);
          if (!Number.isNaN(parsed)) {
            allMyIds.add(parsed);
            // Hide works the user is actively watching/reading, has on their wishlist, or already completed
            if (
              w.status === "CURRENT" ||
              w.status === "PLANNING" ||
              w.status === "COMPLETED" ||
              w.status === "PAUSED"
            ) {
              hiddenIds.add(parsed);
            }
          }
        });
        setHiddenMyWorkIds(hiddenIds);
        setAllMyLibraryIds(allMyIds);

        const profileMap: Record<string, { username: string; avatar_url?: string }> = {};
        allProfiles.forEach((p) => {
          if (p.uid) {
            profileMap[p.uid] = {
              username: p.username || "User",
              avatar_url: p.avatar_url,
            };
          }
        });

        const commMap: Record<number, OtherUserTrack[]> = {};
        allCommWorks.forEach((w) => {
          if (!w.user_id || w.user_id === user.uid) return;
          if (w.status !== "CURRENT" && w.status !== "PLANNING") return;
          const wid = parseInt(w.work_id, 10);
          if (Number.isNaN(wid)) return;

          if (!commMap[wid]) commMap[wid] = [];
          // Avoid duplicate entries for the same user on the same work
          if (!commMap[wid].some((entry) => entry.userId === w.user_id)) {
            commMap[wid].push({
              userId: w.user_id,
              username: profileMap[w.user_id]?.username || "Freund",
              avatarUrl: profileMap[w.user_id]?.avatar_url,
              status: w.status,
            });
          }
        });

        setCommunityTracksByWork(commMap);
      } catch (err) {
        console.error("Failed to load library/community works for search:", err);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    async function doSearch() {
      setIsLoading(true);
      try {
        if (!query) {
          if (discoverTab === "SEASON") {
            // For Anime: current season & year; for Manga: trending/releasing works
            const vars =
              contentType === "ANIME"
                ? {
                    type: contentType,
                    season: seasonInfo.season,
                    seasonYear: seasonInfo.seasonYear,
                    perPage: 36,
                  }
                : {
                    type: contentType,
                    perPage: 36,
                  };
            const data = await fetchAniList(GET_TRENDING_WORKS, vars);
            setResults(data?.Page?.media || []);
          } else {
            const data = await fetchAniList(GET_UPCOMING_WORKS, {
              type: contentType,
              perPage: 36,
            });
            setResults(data?.Page?.media || []);
          }
        } else {
          const data = await fetchAniList(SEARCH_WORKS, {
            search: query,
            type: contentType,
            perPage: 24,
          });
          setResults(data?.Page?.media || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    doSearch();
  }, [query, contentType, discoverTab, seasonInfo]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      addSearchHistory(input.trim());
      router.push(`/search?q=${encodeURIComponent(input.trim())}`);
    } else {
      router.push("/search");
    }
  };

  const handleQuickAdd = async (
    e: React.MouseEvent,
    work: any,
    status: "CURRENT" | "COMPLETED" | "PLANNING"
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const user = auth?.currentUser;
    if (!user) {
      alert("Bitte erst einloggen!");
      return;
    }

    const workId = work.id.toString();

    try {
      await saveUserWork(user.uid, workId, {
        status,
        added_status: work?.status,
        current_episode: 0,
        evaluation: {
          plotAndStory: 0,
          castAndCharacters: 0,
          sideCharacters: 0,
          ending: 0,
          artstyleAndAnimation: 0,
          introOutro: 0,
          voiceActing: 0,
          romanceAndChemistry: 0,
          bingeFactor: 0,
          emotionalImpact: "None",
          comments: "",
          overallScore: 0,
        },
      });
      await addToHistory(user.uid, workId);

      // Immediately hide this work from the discovery grid since the user now tracks it
      setHiddenMyWorkIds((prev) => {
        const next = new Set(prev);
        next.add(work.id);
        return next;
      });
      setAllMyLibraryIds((prev) => {
        const next = new Set(prev);
        next.add(work.id);
        return next;
      });
    } catch (err: any) {
      console.error(err);
      alert("Fehler beim Hinzufügen.");
    }
  };

  const visibleResults = useMemo(() => {
    return results.filter((w) => !hiddenMyWorkIds.has(w.id));
  }, [results, hiddenMyWorkIds]);

  return (
    <div className="flex flex-col gap-5 px-4 pt-6 pb-24 max-w-4xl mx-auto">
      <form onSubmit={handleSearch} className="relative">
        <SearchIcon
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500"
          size={18}
        />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Neue ${contentType === "ANIME" ? "Anime" : "Manga"} entdecken oder suchen...`}
          className="w-full rounded-xl border border-gray-800 bg-[#1a1d24] p-3 pl-10 pr-10 text-sm text-white focus:border-blue-500 focus:outline-none shadow-sm"
        />
        { (input || query) && (
          <button
            type="button"
            onClick={() => {
              setInput("");
              router.push("/search");
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
            title="Suche zurücksetzen"
          >
            <X size={16} />
          </button>
        )}
        <button type="submit" className="hidden" />
      </form>

      {!query && searchHistory.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {searchHistory.map((term) => (
            <button
              key={term}
              onClick={() => router.push(`/search?q=${encodeURIComponent(term)}`)}
              className="px-3 py-1 text-xs bg-[#1a1d24] border border-gray-800 text-gray-300 rounded-full hover:bg-gray-800 transition"
            >
              {term}
            </button>
          ))}
        </div>
      )}

      {/* Switcher: Diese Season vs. Bald verfügbar */}
      {!query && (
        <div className="flex items-center justify-between gap-2 bg-[#141720] p-1.5 rounded-xl border border-gray-800">
          <button
            type="button"
            onClick={() => setDiscoverTab("SEASON")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-extrabold transition-all ${
              discoverTab === "SEASON"
                ? "bg-blue-600 text-white shadow-md shadow-blue-600/25"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Flame size={15} className={discoverTab === "SEASON" ? "text-amber-300" : "text-gray-400"} />
            <span>
              {contentType === "ANIME"
                ? `Diese Season (${seasonInfo.label})`
                : "Aktuell im Trend"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDiscoverTab("UPCOMING")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-extrabold transition-all ${
              discoverTab === "UPCOMING"
                ? "bg-purple-600 text-white shadow-md shadow-purple-600/25"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Sparkles size={15} className={discoverTab === "UPCOMING" ? "text-yellow-300" : "text-gray-400"} />
            <span>Bald verfügbar</span>
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-gray-500 animate-pulse mt-8">Lade Werke...</div>
      ) : visibleResults.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              {query ? (
                <>Suchergebnisse für „{query}“</>
              ) : discoverTab === "SEASON" ? (
                <>
                  <Flame size={18} className="text-orange-400" />
                  {contentType === "ANIME"
                    ? `Diese Season (${seasonInfo.label})`
                    : "Aktuell beliebte Manga"}
                </>
              ) : (
                <>
                  <Sparkles size={18} className="text-yellow-400" />
                  Bald verfügbar
                </>
              )}
            </h2>
            <span className="text-[11px] text-gray-500">
              Nur neue Werke für dich
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {visibleResults.map((work) => {
              const hasRelatedInLibrary = work.relations?.edges?.some((edge: any) =>
                allMyLibraryIds.has(edge.node.id)
              );
              const otherTracks = communityTracksByWork[work.id] || [];
              const activeFriends = otherTracks.filter((t) => t.status === "CURRENT");
              const wishlistFriends = otherTracks.filter((t) => t.status === "PLANNING");
              const hasFriendTracking = otherTracks.length > 0;

              return (
                <Link
                  href={`/work/${work.id}`}
                  key={work.id}
                  className={`group relative overflow-hidden rounded-xl border ${
                    hasFriendTracking
                      ? "border-cyan-500/70 shadow-[0_0_16px_rgba(6,182,212,0.22)]"
                      : hasRelatedInLibrary
                      ? "border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.25)]"
                      : "border-gray-800"
                  } bg-[#1a1d24] shadow-lg transition-transform hover:scale-[1.02]`}
                >
                  <img
                    src={work.coverImage.extraLarge || work.coverImage.large}
                    alt={work.title.english || work.title.romaji}
                    className="aspect-[3/4] w-full object-cover"
                    loading="lazy"
                  />

                  {/* Top-left badges: Friends tracking & Sequel/Spin-Off */}
                  <div className="absolute top-2 left-2 right-11 flex flex-col items-start gap-1 pointer-events-none z-10">
                    {activeFriends.length > 0 && (
                      <div className="inline-flex items-center gap-1 rounded-md bg-emerald-600/95 backdrop-blur-md px-2 py-0.5 text-[10px] font-extrabold text-white shadow-md border border-emerald-400/40 max-w-full">
                        <PlayCircle size={11} className="shrink-0" />
                        <span className="truncate">
                          {activeFriends.map((f) => f.username).join(", ")}: Aktiv
                        </span>
                      </div>
                    )}
                    {wishlistFriends.length > 0 && (
                      <div className="inline-flex items-center gap-1 rounded-md bg-purple-600/95 backdrop-blur-md px-2 py-0.5 text-[10px] font-extrabold text-white shadow-md border border-purple-400/40 max-w-full">
                        <Bookmark size={11} className="shrink-0" />
                        <span className="truncate">
                          {wishlistFriends.map((f) => f.username).join(", ")}: Wunschliste
                        </span>
                      </div>
                    )}
                    {hasRelatedInLibrary && (
                      <div className="inline-flex items-center gap-1 rounded-md bg-amber-500/95 backdrop-blur-md px-2 py-0.5 text-[10px] font-extrabold text-black shadow-md">
                        <span>Fortsetzung / Spin-Off</span>
                      </div>
                    )}
                  </div>

                  {/* Quick Add action buttons (always accessible on mobile & hover on desktop) */}
                  <div className="absolute top-2 right-2 flex flex-col gap-1.5 z-10">
                    <button
                      onClick={(e) => handleQuickAdd(e, work, "CURRENT")}
                      className="bg-blue-600/90 hover:bg-blue-500 text-white p-1.5 rounded-full shadow-lg backdrop-blur border border-white/15"
                      title="Als Aktiv hinzufügen"
                    >
                      <PlayCircle size={15} />
                    </button>
                    <button
                      onClick={(e) => handleQuickAdd(e, work, "PLANNING")}
                      className="bg-purple-600/90 hover:bg-purple-500 text-white p-1.5 rounded-full shadow-lg backdrop-blur border border-white/15"
                      title="Auf die Wunschliste"
                    >
                      <Bookmark size={15} />
                    </button>
                    <button
                      onClick={(e) => handleQuickAdd(e, work, "COMPLETED")}
                      className="bg-emerald-600/90 hover:bg-emerald-500 text-white p-1.5 rounded-full shadow-lg backdrop-blur border border-white/15"
                      title="Als Fertig markieren"
                    >
                      <CheckCircle size={15} />
                    </button>
                  </div>

                  <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/95 via-black/75 to-transparent p-3 pt-6">
                    <h3 className="font-bold text-white text-xs sm:text-sm line-clamp-2 leading-snug">
                      {work.title.english || work.title.romaji}
                    </h3>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-gray-300 mt-1">
                      <div className="flex items-center gap-1">
                        <Star size={11} className="text-yellow-400 fill-yellow-400" />
                        <span className="font-semibold">
                          {work.averageScore ? (work.averageScore / 10).toFixed(1) : "–"}
                        </span>
                      </div>
                      {hasFriendTracking && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-300">
                          <Users size={11} />
                          {otherTracks.length}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : query ? (
        <div className="text-center text-gray-500 mt-8">
          Keine neuen Ergebnisse für „{query}“ gefunden (bereits in deiner Bibliothek befindliche Werke sind ausgeblendet).
        </div>
      ) : (
        <div className="text-center text-gray-500 mt-8">
          Keine neuen Werke in dieser Ansicht gefunden.
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-gray-500 animate-pulse">Lade...</div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
