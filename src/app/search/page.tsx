"use client";

import { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  fetchAniList,
  fetchAniListBatch,
  SEARCH_WORKS,
  GET_UPCOMING_WORKS,
  GET_TRENDING_WORKS,
  GET_RECOMMENDATIONS_FOR_WORKS,
  ANILIST_GENRES,
} from "@/lib/anilist";
import { useAppStore } from "@/lib/store";
import { AniListMedia, getAniListTitle } from "@/types/anilist";
import { toast } from "@/lib/ui-feedback";
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
  SlidersHorizontal,
  Wand2,
  ChevronDown,
  Check,
  Trash2,
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
  const month = now.getMonth() + 1;
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

type RatedSeedWork = {
  workId: number;
  score: number;
  title?: string;
  cover?: string;
  type?: "ANIME" | "MANGA";
  genres?: string[];
};

interface RecommendationNode {
  rating?: number | null;
  mediaRecommendation?: AniListMedia | null;
}

interface SeedMediaWithRecs extends AniListMedia {
  recommendations?: {
    nodes?: RecommendationNode[];
  };
}

function SearchContent() {
  const searchParams = useSearchParams();
  const query = searchParams?.get("q") || "";
  const { contentType, searchHistory, addSearchHistory, clearSearchHistory } =
    useAppStore();
  const router = useRouter();

  const [input, setInput] = useState(query);
  const [discoverTab, setDiscoverTab] = useState<
    "SEASON" | "UPCOMING" | "FOR_YOU"
  >("SEASON");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [showGenreFilter, setShowGenreFilter] = useState(false);
  const genreMenuRef = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<AniListMedia[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [currentUserUid, setCurrentUserUid] = useState<string | null>(null);
  const [isLibraryLoaded, setIsLibraryLoaded] = useState(!auth);
  const [hiddenMyWorkIds, setHiddenMyWorkIds] = useState<Set<number>>(
    new Set()
  );
  const [queryExcludeIds, setQueryExcludeIds] = useState<number[]>([]);
  const [allMyLibraryIds, setAllMyLibraryIds] = useState<Set<number>>(
    new Set()
  );
  const [myRatedWorksRaw, setMyRatedWorksRaw] = useState<
    Array<{ workId: number; score: number }>
  >([]);
  const [ratedMediaMap, setRatedMediaMap] = useState<
    Record<number, AniListMedia>
  >({});
  const ratedMediaMapRef = useRef<Record<number, AniListMedia>>({});
  const [selectedSeedWorkId, setSelectedSeedWorkId] = useState<string>("ALL");
  const [showSeedPicker, setShowSeedPicker] = useState(false);
  const [seedPickerQuery, setSeedPickerQuery] = useState("");
  const seedPickerRef = useRef<HTMLDivElement>(null);
  const [recReasonByWorkId, setRecReasonByWorkId] = useState<
    Record<number, string>
  >({});
  const [communityTracksByWork, setCommunityTracksByWork] = useState<
    Record<number, OtherUserTrack[]>
  >({});

  const seasonInfo = useMemo(() => getCurrentAniListSeason(), []);

  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setInput(query);
  }

  const [prevContentType, setPrevContentType] = useState(contentType);
  if (contentType !== prevContentType) {
    setPrevContentType(contentType);
    setSelectedSeedWorkId("ALL");
    setShowSeedPicker(false);
    setSeedPickerQuery("");
  }

  useEffect(() => {
    if (!showGenreFilter) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        genreMenuRef.current &&
        !genreMenuRef.current.contains(e.target as Node)
      ) {
        setShowGenreFilter(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showGenreFilter]);

  useEffect(() => {
    if (!showSeedPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        seedPickerRef.current &&
        !seedPickerRef.current.contains(e.target as Node)
      ) {
        setShowSeedPicker(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSeedPicker(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showSeedPicker]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUserUid(user?.uid || null);
      if (!user) {
        setHiddenMyWorkIds(new Set());
        setQueryExcludeIds([]);
        setAllMyLibraryIds(new Set());
        setMyRatedWorksRaw([]);
        ratedMediaMapRef.current = {};
        setRatedMediaMap({});
        setCommunityTracksByWork({});
        setIsLibraryLoaded(true);
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
        const ratedRaw: Array<{ workId: number; score: number }> = [];
        myWorks.forEach((w) => {
          const parsed = parseInt(w.work_id, 10);
          if (!Number.isNaN(parsed)) {
            allMyIds.add(parsed);
            const score =
              Number(w.evaluation?.overallScore) ||
              Number(w.evaluation?.manualScore) ||
              0;
            if (score > 0) {
              ratedRaw.push({ workId: parsed, score });
            }
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
        ratedRaw.sort((a, b) => b.score - a.score);
        setMyRatedWorksRaw(ratedRaw);
        setHiddenMyWorkIds(hiddenIds);
        setQueryExcludeIds(Array.from(hiddenIds));
        setAllMyLibraryIds(allMyIds);

        const profileMap: Record<
          string,
          { username: string; avatar_url?: string }
        > = {};
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
      } finally {
        setIsLibraryLoaded(true);
      }
    });

    return () => unsub();
  }, []);

  const ratedSeedWorksForType = useMemo<RatedSeedWork[]>(() => {
    return myRatedWorksRaw
      .map((r) => {
        const m = ratedMediaMap[r.workId];
        return {
          workId: r.workId,
          score: r.score,
          title: m ? getAniListTitle(m, "") || undefined : undefined,
          cover: m?.coverImage?.large || m?.coverImage?.extraLarge || undefined,
          type: m?.type,
          genres: Array.isArray(m?.genres) ? m.genres : undefined,
        };
      })
      .filter((r) => !r.type || r.type === contentType);
  }, [myRatedWorksRaw, ratedMediaMap, contentType]);

  const activeSeedWork = useMemo(() => {
    if (selectedSeedWorkId === "ALL") return null;
    return (
      ratedSeedWorksForType.find(
        (w) => String(w.workId) === selectedSeedWorkId
      ) || null
    );
  }, [ratedSeedWorksForType, selectedSeedWorkId]);

  const filteredSeedWorks = useMemo(() => {
    const q = seedPickerQuery.trim().toLowerCase();
    const withTitle = ratedSeedWorksForType.filter((w) => w.title);
    if (!q) return withTitle.slice(0, 50);
    return withTitle.filter((w) => w.title?.toLowerCase().includes(q));
  }, [ratedSeedWorksForType, seedPickerQuery]);

  useEffect(() => {
    if (!isLibraryLoaded) return;

    let cancelled = false;

    async function doSearch() {
      setIsLoading(true);
      try {
        const excludeParam =
          queryExcludeIds.length > 0 ? queryExcludeIds : undefined;
        const genreParam =
          selectedGenres.length > 0 ? selectedGenres : undefined;

        if (!query) {
          if (discoverTab === "FOR_YOU") {
            if (myRatedWorksRaw.length === 0) {
              if (!cancelled) {
                setResults([]);
                setRecReasonByWorkId({});
              }
              return;
            }

            // Load metadata for up to 150 top-rated works so Manga seeds aren't truncated
            let currentRatedMap = ratedMediaMapRef.current;
            const topIdsForMeta = myRatedWorksRaw
              .slice(0, 150)
              .map((r) => r.workId);
            const missingMetaIds = topIdsForMeta.filter(
              (id) => !currentRatedMap[id]
            );
            if (missingMetaIds.length > 0) {
              const fetched = await fetchAniListBatch(missingMetaIds);
              if (cancelled) return;
              const nextMap: Record<number, AniListMedia> = {
                ...currentRatedMap,
              };
              fetched.forEach((m) => {
                if (m?.id) nextMap[m.id] = m;
              });
              currentRatedMap = nextMap;
              ratedMediaMapRef.current = nextMap;
              setRatedMediaMap(nextMap);
            }

            const typedRated = myRatedWorksRaw.filter(
              (r) => currentRatedMap[r.workId]?.type === contentType
            );
            if (typedRated.length === 0) {
              if (!cancelled) {
                setResults([]);
                setRecReasonByWorkId({});
              }
              return;
            }

            const isSingleSeed = selectedSeedWorkId !== "ALL";
            const singleSeedNum = isSingleSeed
              ? parseInt(selectedSeedWorkId, 10)
              : NaN;
            const highRated = typedRated.filter((r) => r.score >= 7);
            const seedPool =
              isSingleSeed && !Number.isNaN(singleSeedNum)
                ? typedRated.filter((r) => r.workId === singleSeedNum)
                : (highRated.length > 0 ? highRated : typedRated).slice(0, 10);

            if (seedPool.length === 0) {
              if (!cancelled) {
                setResults([]);
                setRecReasonByWorkId({});
              }
              return;
            }

            const seedScoreMap = new Map<number, number>();
            seedPool.forEach((s) => seedScoreMap.set(s.workId, s.score));

            const data = await fetchAniList<{
              Page?: { media?: SeedMediaWithRecs[] };
            }>(GET_RECOMMENDATIONS_FOR_WORKS, {
              ids: seedPool.map((s) => s.workId),
              recPerPage: isSingleSeed ? 25 : 12,
            });
            if (cancelled) return;

            const excludeSet = new Set<number>(queryExcludeIds);
            const candidateMap = new Map<
              number,
              {
                media: AniListMedia;
                weight: number;
                bestSeedWeight: number;
                reasonTitle: string;
              }
            >();

            const seedMedias = data?.Page?.media || [];
            seedMedias.forEach((seedMedia) => {
              const seedTitle = getAniListTitle(seedMedia, "");
              const userScore = seedScoreMap.get(seedMedia.id) || 7;
              const nodes = seedMedia?.recommendations?.nodes || [];
              nodes.forEach((node) => {
                const rec = node?.mediaRecommendation;
                if (!rec || !rec.id) return;
                if (rec.type !== contentType) return;
                if (excludeSet.has(rec.id)) return;
                if (
                  selectedGenres.length > 0 &&
                  (!Array.isArray(rec.genres) ||
                    !selectedGenres.every((g) => rec.genres?.includes(g)))
                ) {
                  return;
                }
                const recRating = Math.max(0, Number(node?.rating) || 0);
                const weight = userScore * (1 + Math.log1p(recRating));
                const existing = candidateMap.get(rec.id);
                if (existing) {
                  existing.weight += weight;
                  if (weight > existing.bestSeedWeight && seedTitle) {
                    existing.bestSeedWeight = weight;
                    existing.reasonTitle = seedTitle;
                  }
                } else {
                  candidateMap.set(rec.id, {
                    media: rec,
                    weight,
                    bestSeedWeight: weight,
                    reasonTitle: seedTitle,
                  });
                }
              });
            });

            let ranked = Array.from(candidateMap.values())
              .sort((a, b) => b.weight - a.weight)
              .slice(0, 36);

            if (ranked.length < 6) {
              const primarySeed =
                seedMedias[0] || currentRatedMap[seedPool[0].workId];
              const seedGenres = Array.isArray(primarySeed?.genres)
                ? primarySeed.genres.slice(0, 2)
                : [];
              const fallbackGenres =
                selectedGenres.length > 0
                  ? selectedGenres
                  : seedGenres.length > 0
                  ? seedGenres
                  : undefined;
              if (fallbackGenres) {
                const fallbackData = await fetchAniList<{
                  Page?: { media?: AniListMedia[] };
                }>(GET_TRENDING_WORKS, {
                  type: contentType,
                  perPage: 24,
                  genre_in: fallbackGenres,
                  excludeIds: excludeParam,
                });
                if (cancelled) return;
                const fallbackMedia = fallbackData?.Page?.media || [];
                const existingIds = new Set(ranked.map((r) => r.media.id));
                const seedLabel = getAniListTitle(primarySeed, "");
                fallbackMedia.forEach((m) => {
                  if (!m?.id || existingIds.has(m.id) || excludeSet.has(m.id)) {
                    return;
                  }
                  existingIds.add(m.id);
                  ranked.push({
                    media: m,
                    weight: 0,
                    bestSeedWeight: 0,
                    reasonTitle: seedLabel,
                  });
                });
                ranked = ranked.slice(0, 36);
              }
            }

            const reasons: Record<number, string> = {};
            ranked.forEach((r) => {
              if (r.reasonTitle) reasons[r.media.id] = r.reasonTitle;
            });
            if (!cancelled) {
              setRecReasonByWorkId(reasons);
              setResults(ranked.map((r) => r.media));
            }
          } else if (discoverTab === "SEASON") {
            if (!cancelled) setRecReasonByWorkId({});
            const vars =
              contentType === "ANIME"
                ? {
                    type: contentType,
                    season: seasonInfo.season,
                    seasonYear: seasonInfo.seasonYear,
                    perPage: 36,
                    genre_in: genreParam,
                    excludeIds: excludeParam,
                  }
                : {
                    type: contentType,
                    perPage: 36,
                    genre_in: genreParam,
                    excludeIds: excludeParam,
                  };
            const data = await fetchAniList<{
              Page?: { media?: AniListMedia[] };
            }>(GET_TRENDING_WORKS, vars);
            if (!cancelled) setResults(data?.Page?.media || []);
          } else {
            if (!cancelled) setRecReasonByWorkId({});
            const data = await fetchAniList<{
              Page?: { media?: AniListMedia[] };
            }>(GET_UPCOMING_WORKS, {
              type: contentType,
              perPage: 36,
              genre_in: genreParam,
              excludeIds: excludeParam,
            });
            if (!cancelled) setResults(data?.Page?.media || []);
          }
        } else {
          if (!cancelled) setRecReasonByWorkId({});
          const data = await fetchAniList<{
            Page?: { media?: AniListMedia[] };
          }>(SEARCH_WORKS, {
            search: query,
            type: contentType,
            perPage: 24,
            genre_in: genreParam,
            excludeIds: excludeParam,
          });
          if (!cancelled) setResults(data?.Page?.media || []);
        }
      } catch (err) {
        if (!cancelled) console.error(err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    doSearch();
    return () => {
      cancelled = true;
    };
  }, [
    query,
    contentType,
    discoverTab,
    seasonInfo,
    isLibraryLoaded,
    queryExcludeIds,
    selectedGenres,
    myRatedWorksRaw,
    selectedSeedWorkId,
  ]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQueryExcludeIds(Array.from(hiddenMyWorkIds));
    if (input.trim()) {
      addSearchHistory(input.trim());
      router.push(`/search?q=${encodeURIComponent(input.trim())}`);
    } else {
      router.push("/search");
    }
  };

  const handleQuickAdd = async (
    e: React.MouseEvent,
    work: AniListMedia,
    status: "CURRENT" | "COMPLETED" | "PLANNING"
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const user = auth?.currentUser;
    if (!user) {
      toast.info("Bitte erst einloggen!");
      return;
    }

    const workId = work.id.toString();
    const totalCount = work.type === "MANGA" ? work.chapters : work.episodes;
    const initialEpisode =
      status === "COMPLETED" && typeof totalCount === "number" && totalCount > 0
        ? totalCount
        : 0;

    try {
      // Do NOT pass a zeroed evaluation object (preserves existing scores if re-adding a DROPPED work)
      await saveUserWork(user.uid, workId, {
        status,
        added_status: work.status,
        current_episode: initialEpisode,
      });
      await addToHistory(user.uid, workId);

      // Compute nextHidden outside setState updater to avoid side-effects inside updaters
      const nextHidden = new Set(hiddenMyWorkIds);
      nextHidden.add(work.id);
      setHiddenMyWorkIds(nextHidden);

      const remainingCount = results.filter(
        (r) => !nextHidden.has(r.id)
      ).length;
      if (remainingCount < 12) {
        setQueryExcludeIds(Array.from(nextHidden));
      }

      setAllMyLibraryIds((prev) => {
        const next = new Set(prev);
        next.add(work.id);
        return next;
      });

      const statusLabel =
        status === "CURRENT"
          ? "Aktiv"
          : status === "PLANNING"
          ? "Wunschliste"
          : "Fertig";
      toast.success(
        `${getAniListTitle(work)} zu „${statusLabel}“ hinzugefügt.`
      );
    } catch (err) {
      console.error(err);
      toast.error("Fehler beim Hinzufügen.");
    }
  };

  const visibleResults = useMemo(() => {
    return results.filter((w) => !hiddenMyWorkIds.has(w.id));
  }, [results, hiddenMyWorkIds]);

  return (
    <div className="flex flex-col gap-5 px-4 pt-6 pb-4 max-w-4xl mx-auto">
      <div className="flex flex-col gap-2" ref={genreMenuRef}>
        <div className="relative flex items-center gap-2">
          <form onSubmit={handleSearch} className="relative flex-1 min-w-0">
            <SearchIcon
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500"
              size={18}
            />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Neue ${
                contentType === "ANIME" ? "Anime" : "Manga"
              } entdecken oder suchen...`}
              className="w-full rounded-xl border border-gray-800 bg-surface-elevated p-3 pl-10 pr-10 text-sm text-white focus:border-accent-border-strong focus:outline-none shadow-sm"
            />
            {(input || query) && (
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

          {/* Subtle Genre Filter Trigger */}
          <button
            type="button"
            onClick={() => setShowGenreFilter((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-3 rounded-xl border text-xs font-semibold shrink-0 transition-colors ${
              showGenreFilter || selectedGenres.length > 0
                ? "bg-accent-soft border-accent-border-strong text-accent-light"
                : "bg-surface-elevated border-gray-800 text-gray-400 hover:text-white"
            }`}
            title="Nach Genre filtern"
            aria-expanded={showGenreFilter}
          >
            <SlidersHorizontal size={15} />
            <span className="hidden sm:inline">Genre</span>
            {selectedGenres.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] font-bold">
                {selectedGenres.length}
              </span>
            )}
          </button>

          {/* Subtle Collapsible Genre Popover */}
          {showGenreFilter && (
            <div className="absolute right-0 top-full mt-2 z-30 w-72 sm:w-80 rounded-2xl border border-gray-700/90 bg-surface p-3 shadow-2xl flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                  <SlidersHorizontal size={12} />
                  Genre filtern
                </span>
                <div className="flex items-center gap-2">
                  {selectedGenres.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedGenres([])}
                      className="text-[11px] font-semibold text-gray-400 hover:text-white transition-colors"
                    >
                      Zurücksetzen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowGenreFilter(false)}
                    className="text-gray-400 hover:text-white"
                    aria-label="Schließen"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto pr-0.5">
                {ANILIST_GENRES.map((genre) => {
                  const active = selectedGenres.includes(genre);
                  return (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => toggleGenre(genre)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                        active
                          ? "bg-accent-soft-hover border-accent-border-strong text-accent-soft-text"
                          : "bg-surface-elevated border-gray-800 text-gray-400 hover:text-white hover:border-gray-700"
                      }`}
                    >
                      {genre}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Slim active genre chips */}
        {selectedGenres.length > 0 && (
          <div className="flex items-center flex-wrap gap-1.5">
            {selectedGenres.map((genre) => (
              <button
                key={genre}
                type="button"
                onClick={() => toggleGenre(genre)}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-accent-soft border border-accent-border text-accent-light hover:bg-accent-soft-hover transition-colors"
                title={`${genre}-Filter entfernen`}
              >
                <span>{genre}</span>
                <X size={11} />
              </button>
            ))}
            {selectedGenres.length > 1 && (
              <button
                type="button"
                onClick={() => setSelectedGenres([])}
                className="text-[11px] text-gray-500 hover:text-gray-300 px-1 transition-colors"
              >
                Alle löschen
              </button>
            )}
          </div>
        )}
      </div>

      {!query && searchHistory.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5">
          {searchHistory.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() =>
                router.push(`/search?q=${encodeURIComponent(term)}`)
              }
              className="px-3 py-1 text-xs bg-surface-elevated border border-gray-800 text-gray-300 rounded-full hover:bg-gray-800 transition"
            >
              {term}
            </button>
          ))}
          <button
            type="button"
            onClick={() => clearSearchHistory()}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-gray-500 hover:text-rose-400 transition"
            title="Suchverlauf löschen"
          >
            <Trash2 size={11} />
            Verlauf löschen
          </button>
        </div>
      )}

      {/* Switcher: Diese Season vs. Bald verfügbar vs. Für dich */}
      {!query && (
        <div className="flex items-center justify-between gap-1.5 bg-surface p-1.5 rounded-xl border border-gray-800">
          <button
            type="button"
            onClick={() => setDiscoverTab("SEASON")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-extrabold transition-all whitespace-nowrap ${
              discoverTab === "SEASON"
                ? "bg-accent text-white shadow-md"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Flame
              size={14}
              className={
                discoverTab === "SEASON" ? "text-amber-300" : "text-gray-400"
              }
            />
            <span>{contentType === "ANIME" ? "Season" : "Im Trend"}</span>
          </button>
          <button
            type="button"
            onClick={() => setDiscoverTab("UPCOMING")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-extrabold transition-all whitespace-nowrap ${
              discoverTab === "UPCOMING"
                ? "bg-purple-600 text-white shadow-md shadow-purple-600/25"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Sparkles
              size={14}
              className={
                discoverTab === "UPCOMING" ? "text-yellow-300" : "text-gray-400"
              }
            />
            <span>Bald</span>
          </button>
          <button
            type="button"
            onClick={() => setDiscoverTab("FOR_YOU")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-extrabold transition-all whitespace-nowrap ${
              discoverTab === "FOR_YOU"
                ? "bg-accent text-white shadow-md"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Wand2
              size={14}
              className={
                discoverTab === "FOR_YOU"
                  ? "text-accent-soft-text"
                  : "text-gray-400"
              }
            />
            <span>Für dich</span>
          </button>
        </div>
      )}

      {/* Subtle custom seed-work selector ONLY in "Für dich" tab */}
      {!query &&
        discoverTab === "FOR_YOU" &&
        ratedSeedWorksForType.length > 0 && (
          <div
            className="relative flex items-center gap-2 -mt-2"
            ref={seedPickerRef}
          >
            <span className="text-[11px] font-medium text-gray-500 shrink-0">
              Ähnlich zu:
            </span>

            <div className="flex items-center gap-1.5 min-w-0 flex-1 sm:flex-initial">
              <button
                type="button"
                onClick={() => {
                  setShowSeedPicker((v) => !v);
                  setSeedPickerQuery("");
                }}
                aria-expanded={showSeedPicker}
                aria-label="Basis-Werk für Empfehlungen wählen"
                className={`flex items-center gap-2 max-w-full sm:max-w-xs rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  showSeedPicker || activeSeedWork
                    ? "bg-accent-soft border-accent-border text-accent-soft-text"
                    : "bg-surface-elevated border-gray-800 text-gray-200 hover:border-gray-700"
                }`}
              >
                {activeSeedWork ? (
                  <>
                    {activeSeedWork.cover && (
                      <img
                        src={activeSeedWork.cover}
                        alt=""
                        className="w-4 h-5 rounded object-cover shrink-0"
                      />
                    )}
                    <span className="truncate">{activeSeedWork.title}</span>
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-300 shrink-0 tabular-nums">
                      <Star
                        size={10}
                        className="fill-amber-400 text-amber-400"
                      />
                      {activeSeedWork.score.toFixed(1)}
                    </span>
                  </>
                ) : (
                  <>
                    <Sparkles size={12} className="text-accent-text shrink-0" />
                    <span className="truncate">Alle meine Favoriten</span>
                  </>
                )}
                <ChevronDown
                  size={13}
                  className={`text-gray-400 shrink-0 transition-transform ${
                    showSeedPicker ? "rotate-180" : ""
                  }`}
                />
              </button>

              {activeSeedWork && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSeedWorkId("ALL");
                    setShowSeedPicker(false);
                  }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors shrink-0"
                  title="Zurück zu allen Favoriten"
                  aria-label="Zurück zu allen Favoriten"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {showSeedPicker && (
              <div className="absolute left-0 right-0 sm:right-auto sm:w-96 top-full mt-2 z-30 rounded-2xl border border-gray-700/90 bg-surface p-2.5 shadow-2xl flex flex-col gap-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                    Basis für Empfehlungen
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSeedPicker(false)}
                    className="text-gray-400 hover:text-white p-0.5"
                    aria-label="Schließen"
                  >
                    <X size={14} />
                  </button>
                </div>

                {ratedSeedWorksForType.filter((w) => w.title).length > 5 && (
                  <div className="relative">
                    <SearchIcon
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                    />
                    <input
                      type="text"
                      value={seedPickerQuery}
                      onChange={(e) => setSeedPickerQuery(e.target.value)}
                      placeholder="Bewertetes Werk suchen..."
                      className="w-full rounded-xl border border-gray-800 bg-surface-inset pl-8 pr-7 py-1.5 text-xs text-white placeholder:text-gray-500 focus:border-accent-border-strong focus:outline-none"
                    />
                    {seedPickerQuery && (
                      <button
                        type="button"
                        onClick={() => setSeedPickerQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                        aria-label="Filter leeren"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                )}

                <div className="max-h-64 overflow-y-auto flex flex-col gap-1 pr-0.5">
                  {!seedPickerQuery.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSeedWorkId("ALL");
                        setShowSeedPicker(false);
                      }}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors ${
                        selectedSeedWorkId === "ALL"
                          ? "bg-accent-soft border border-accent-border"
                          : "hover:bg-white/[0.04] border border-transparent"
                      }`}
                    >
                      <div className="w-7 h-10 rounded-md bg-accent-soft border border-accent-border flex items-center justify-center shrink-0">
                        <Sparkles size={14} className="text-accent-text" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white">
                          Alle meine Favoriten
                        </p>
                        <p className="text-[10px] text-gray-400 truncate">
                          Mix aus deinen bestbewerteten Werken
                        </p>
                      </div>
                      {selectedSeedWorkId === "ALL" && (
                        <Check size={14} className="text-accent-text shrink-0" />
                      )}
                    </button>
                  )}

                  {filteredSeedWorks.length > 0 ? (
                    filteredSeedWorks.map((w) => {
                      const isSelected =
                        selectedSeedWorkId === String(w.workId);
                      return (
                        <button
                          key={w.workId}
                          type="button"
                          onClick={() => {
                            setSelectedSeedWorkId(String(w.workId));
                            setShowSeedPicker(false);
                          }}
                          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-left transition-colors ${
                            isSelected
                              ? "bg-accent-soft border border-accent-border"
                              : "hover:bg-white/[0.04] border border-transparent"
                          }`}
                        >
                          {w.cover ? (
                            <img
                              src={w.cover}
                              alt=""
                              className="w-7 h-10 rounded-md object-cover bg-gray-800 shrink-0"
                            />
                          ) : (
                            <div className="w-7 h-10 rounded-md bg-gray-800 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white truncate">
                              {w.title}
                            </p>
                            {w.genres && w.genres.length > 0 && (
                              <p className="text-[10px] text-gray-500 truncate">
                                {w.genres.slice(0, 2).join(" · ")}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-300 tabular-nums">
                              <Star
                                size={10}
                                className="fill-amber-400 text-amber-400"
                              />
                              {w.score.toFixed(1)}
                            </span>
                            {isSelected && (
                              <Check size={14} className="text-accent-text" />
                            )}
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-center text-xs text-gray-500 py-4">
                      Kein passendes bewertetes Werk gefunden.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

      {isLoading ? (
        <div className="text-center text-gray-500 animate-pulse mt-8">
          Lade Werke...
        </div>
      ) : visibleResults.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              {query ? (
                <>Suchergebnisse für „{query}“</>
              ) : discoverTab === "FOR_YOU" ? (
                <>
                  <Wand2 size={17} className="text-accent-text" />
                  Empfehlungen für dich
                </>
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
              const hasRelatedInLibrary = work.relations?.edges?.some((edge) =>
                edge.node?.id ? allMyLibraryIds.has(edge.node.id) : false
              );
              const otherTracks = communityTracksByWork[work.id] || [];
              const activeFriends = otherTracks.filter(
                (t) => t.status === "CURRENT"
              );
              const wishlistFriends = otherTracks.filter(
                (t) => t.status === "PLANNING"
              );
              const hasFriendTracking = otherTracks.length > 0;
              const recReason =
                discoverTab === "FOR_YOU"
                  ? recReasonByWorkId[work.id]
                  : undefined;
              const cover =
                work.coverImage?.extraLarge || work.coverImage?.large || "";

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
                  } bg-surface-elevated shadow-lg transition-transform hover:scale-[1.02]`}
                >
                  {cover ? (
                    <img
                      src={cover}
                      alt={getAniListTitle(work)}
                      className="aspect-[3/4] w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="aspect-[3/4] w-full bg-gray-800" />
                  )}

                  {/* Top-left badges */}
                  <div className="absolute top-2 left-2 right-11 flex flex-col items-start gap-1 pointer-events-none z-10">
                    {activeFriends.length > 0 && (
                      <div className="inline-flex items-center gap-1 rounded-md bg-emerald-600/95 backdrop-blur-md px-2 py-0.5 text-[10px] font-extrabold text-white shadow-md border border-emerald-400/40 max-w-full">
                        <PlayCircle size={11} className="shrink-0" />
                        <span className="truncate">
                          {activeFriends.map((f) => f.username).join(", ")}:
                          Aktiv
                        </span>
                      </div>
                    )}
                    {wishlistFriends.length > 0 && (
                      <div className="inline-flex items-center gap-1 rounded-md bg-purple-600/95 backdrop-blur-md px-2 py-0.5 text-[10px] font-extrabold text-white shadow-md border border-purple-400/40 max-w-full">
                        <Bookmark size={11} className="shrink-0" />
                        <span className="truncate">
                          {wishlistFriends.map((f) => f.username).join(", ")}:
                          Wunschliste
                        </span>
                      </div>
                    )}
                    {hasRelatedInLibrary && (
                      <div className="inline-flex items-center gap-1 rounded-md bg-amber-500/95 backdrop-blur-md px-2 py-0.5 text-[10px] font-extrabold text-black shadow-md">
                        <span>Fortsetzung / Spin-Off</span>
                      </div>
                    )}
                  </div>

                  {/* Quick Add action buttons */}
                  <div className="absolute top-2 right-2 flex flex-col gap-1.5 z-10">
                    <button
                      type="button"
                      onClick={(e) => handleQuickAdd(e, work, "CURRENT")}
                      className="bg-accent/90 hover:bg-accent-hover text-white p-1.5 rounded-full shadow-lg backdrop-blur border border-white/15"
                      title="Als Aktiv hinzufügen"
                    >
                      <PlayCircle size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleQuickAdd(e, work, "PLANNING")}
                      className="bg-purple-600/90 hover:bg-purple-500 text-white p-1.5 rounded-full shadow-lg backdrop-blur border border-white/15"
                      title="Auf die Wunschliste"
                    >
                      <Bookmark size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleQuickAdd(e, work, "COMPLETED")}
                      className="bg-emerald-600/90 hover:bg-emerald-500 text-white p-1.5 rounded-full shadow-lg backdrop-blur border border-white/15"
                      title="Als Fertig markieren"
                    >
                      <CheckCircle size={15} />
                    </button>
                  </div>

                  <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/95 via-black/75 to-transparent p-3 pt-6">
                    <h3 className="font-bold text-white text-xs sm:text-sm line-clamp-2 leading-snug">
                      {getAniListTitle(work)}
                    </h3>
                    {recReason && (
                      <p className="text-[10px] text-accent-light/85 truncate mt-0.5">
                        Ähnlich zu {recReason}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-2 text-[11px] text-gray-300 mt-1">
                      <div className="flex items-center gap-1">
                        <Star
                          size={11}
                          className="text-yellow-400 fill-yellow-400"
                        />
                        <span className="font-semibold">
                          {work.averageScore
                            ? (work.averageScore / 10).toFixed(1)
                            : "–"}
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
        <div className="text-center text-gray-500 mt-8 flex flex-col items-center gap-2.5">
          <p>
            Keine neuen Ergebnisse für „{query}“
            {selectedGenres.length > 0
              ? ` (${selectedGenres.join(", ")})`
              : ""}{" "}
            gefunden (bereits in deiner Bibliothek befindliche Werke sind
            ausgeblendet).
          </p>
          {selectedGenres.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedGenres([])}
              className="text-xs font-semibold text-accent-text hover:text-accent-light underline"
            >
              Genre-Filter zurücksetzen
            </button>
          )}
        </div>
      ) : discoverTab === "FOR_YOU" && !currentUserUid ? (
        <div className="text-center text-gray-500 mt-8">
          Logge dich ein, um Empfehlungen anhand deiner bewerteten Werke zu
          erhalten.
        </div>
      ) : discoverTab === "FOR_YOU" && ratedSeedWorksForType.length === 0 ? (
        <div className="text-center text-gray-500 mt-8">
          Bewerte zuerst ein paar {contentType === "ANIME" ? "Anime" : "Manga"}{" "}
          in deiner Bibliothek, damit wir passende Empfehlungen für dich finden
          können.
        </div>
      ) : (
        <div className="text-center text-gray-500 mt-8 flex flex-col items-center gap-2.5">
          <p>
            Keine neuen Werke
            {selectedGenres.length > 0
              ? ` für ${selectedGenres.join(", ")}`
              : ""}{" "}
            in dieser Ansicht gefunden.
          </p>
          {selectedGenres.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedGenres([])}
              className="text-xs font-semibold text-accent-text hover:text-accent-light underline"
            >
              Genre-Filter zurücksetzen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-gray-500 animate-pulse">
          Lade...
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
