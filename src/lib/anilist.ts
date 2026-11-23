import { AniListMedia } from "@/types/anilist";

const ANILIST_API_URL = "https://graphql.anilist.co";

const MEMORY_CACHE = new Map<string, { data: unknown; timestamp: number }>();
const BATCH_CACHE = new Map<number, { data: AniListMedia; timestamp: number }>();
const IN_FLIGHT_REQUESTS = new Map<string, Promise<unknown>>();
const CACHE_DURATION = 1000 * 60 * 15; // 15 minutes
const MAX_CACHE_ENTRIES = 300;
const MAX_BATCH_CACHE_ENTRIES = 800;

function trimMap<K, V>(map: Map<K, V>, maxEntries: number) {
  if (map.size <= maxEntries) return;
  const excess = map.size - maxEntries;
  let removed = 0;
  for (const key of map.keys()) {
    map.delete(key);
    removed++;
    if (removed >= excess) break;
  }
}

async function notifyRateLimit(delayMs: number) {
  try {
    const { useAppStore } = await import("@/lib/store");
    const store = useAppStore.getState();
    if (!store.rateLimited) {
      store.setRateLimited(true);
      setTimeout(() => {
        useAppStore.getState().setRateLimited(false);
        useAppStore.getState().triggerReload();
      }, delayMs);
    }
  } catch {
    // ignore store import issues in non-browser contexts
  }
}

export async function fetchAniList<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  retries = 1
): Promise<T> {
  const cacheKey = JSON.stringify({ query, variables });

  // 1. Return cached if valid
  const cached = MEMORY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data as T;
  }

  // 2. Return in-flight promise if currently fetching
  if (IN_FLIGHT_REQUESTS.has(cacheKey)) {
    return IN_FLIGHT_REQUESTS.get(cacheKey) as Promise<T>;
  }

  // Run retry loop INSIDE the single in-flight promise so retries never deadlock on IN_FLIGHT_REQUESTS
  const requestPromise = (async (): Promise<T> => {
    let attemptsLeft = retries;
    try {
      while (true) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(ANILIST_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ query, variables }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            if (response.status === 429) {
              const retryAfter = response.headers.get("Retry-After");
              const parsedRetry = retryAfter ? parseInt(retryAfter, 10) : NaN;
              const delay =
                !Number.isNaN(parsedRetry) && parsedRetry > 0
                  ? parsedRetry * 1000
                  : 60000;

              await notifyRateLimit(delay);

              if (delay > 5000 || attemptsLeft <= 0) {
                if (cached) return cached.data as T;
                throw new Error("RateLimit");
              }
              attemptsLeft--;
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }

            const errorData = await response.json().catch(() => ({}));
            throw new Error(
              `AniList API Fehler: ${response.status} - ${JSON.stringify(errorData)}`
            );
          }

          const json = await response.json();
          if (Array.isArray(json?.errors) && json.errors.length > 0 && !json?.data) {
            throw new Error(
              `AniList GraphQL Fehler: ${json.errors[0]?.message || "Unbekannter Fehler"}`
            );
          }

          if (json?.data !== undefined && json?.data !== null) {
            MEMORY_CACHE.set(cacheKey, { data: json.data, timestamp: Date.now() });
            trimMap(MEMORY_CACHE, MAX_CACHE_ENTRIES);
          }
          return json?.data as T;
        } catch (err: unknown) {
          clearTimeout(timeoutId);
          const errMessage = err instanceof Error ? err.message : String(err);
          if (errMessage === "RateLimit") {
            throw err;
          }
          if (attemptsLeft > 0) {
            attemptsLeft--;
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          if (cached) {
            return cached.data as T;
          }
          throw err;
        }
      }
    } finally {
      IN_FLIGHT_REQUESTS.delete(cacheKey);
    }
  })();

  IN_FLIGHT_REQUESTS.set(cacheKey, requestPromise);
  return requestPromise;
}

export async function fetchAniListBatch(ids: number[]): Promise<AniListMedia[]> {
  const validIds = [...new Set(ids.filter((id) => !Number.isNaN(id) && id > 0))];
  const results: AniListMedia[] = [];
  const idsToFetch: number[] = [];

  for (const id of validIds) {
    const cached = BATCH_CACHE.get(id);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      results.push(cached.data);
    } else {
      idsToFetch.push(id);
    }
  }

  for (let i = 0; i < idsToFetch.length; i += 50) {
    const chunk = idsToFetch.slice(i, i + 50);
    if (chunk.length === 0) continue;

    try {
      const data = await fetchAniList<{ Page?: { media?: AniListMedia[] } }>(
        GET_WORKS_BATCH,
        { ids: chunk }
      );
      if (data?.Page?.media) {
        const now = Date.now();
        data.Page.media.forEach((m) => {
          BATCH_CACHE.set(m.id, { data: m, timestamp: now });
          results.push(m);
        });
        trimMap(BATCH_CACHE, MAX_BATCH_CACHE_ENTRIES);
      }
    } catch (err) {
      console.warn("AniList batch fetch error", err);
    }
  }

  return results;
}

// -- Official AniList Genres (ordered by popularity) --
export const ANILIST_GENRES = [
  "Action",
  "Romance",
  "Fantasy",
  "Comedy",
  "Drama",
  "Adventure",
  "Slice of Life",
  "Sci-Fi",
  "Supernatural",
  "Mystery",
  "Psychological",
  "Thriller",
  "Sports",
  "Horror",
  "Mecha",
  "Music",
  "Ecchi",
  "Mahou Shoujo",
] as const;

// -- Queries --

export const GET_TRENDING_WORKS = `
  query($type: MediaType, $season: MediaSeason, $seasonYear: Int, $page: Int = 1, $perPage: Int = 20, $genre_in: [String], $excludeIds: [Int]) {
    Page(page: $page, perPage: $perPage) {
      media(type: $type, sort: TRENDING_DESC, season: $season, seasonYear: $seasonYear, genre_in: $genre_in, id_not_in: $excludeIds) {
        id
        title {
          romaji
          english
          native
        }
        coverImage {
          extraLarge
          large
        }
        type
        format
        episodes
        chapters
        averageScore
        genres
        status
        relations {
          edges {
            relationType
            node {
              id
            }
          }
        }
      }
    }
  }
`;

export const SEARCH_WORKS = `
  query($search: String, $type: MediaType, $page: Int = 1, $perPage: Int = 24, $genre_in: [String], $excludeIds: [Int]) {
    Page(page: $page, perPage: $perPage) {
      media(search: $search, type: $type, genre_in: $genre_in, id_not_in: $excludeIds) {
        id
        title {
          romaji
          english
        }
        coverImage {
          extraLarge
          large
        }
        format
        status
        episodes
        chapters
        averageScore
        genres
        relations {
          edges {
            relationType
            node {
              id
            }
          }
        }
      }
    }
  }
`;

export const GET_UPCOMING_WORKS = `
  query($type: MediaType, $season: MediaSeason, $seasonYear: Int, $page: Int = 1, $perPage: Int = 30, $genre_in: [String], $excludeIds: [Int]) {
    Page(page: $page, perPage: $perPage) {
      media(type: $type, status: NOT_YET_RELEASED, sort: POPULARITY_DESC, season: $season, seasonYear: $seasonYear, genre_in: $genre_in, id_not_in: $excludeIds) {
        id
        title {
          romaji
          english
        }
        coverImage {
          extraLarge
          large
        }
        format
        status
        episodes
        chapters
        averageScore
        genres
        relations {
          edges {
            relationType
            node {
              id
            }
          }
        }
      }
    }
  }
`;

export const GET_WORK_DETAILS = `
  query($id: Int!) {
    Media(id: $id) {
      id
      title {
        romaji
        english
        native
      }
      coverImage {
        extraLarge
        large
      }
      bannerImage
      description
      type
      format
      status
      episodes
      chapters
      averageScore
      genres
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      nextAiringEpisode {
        episode
        airingAt
        timeUntilAiring
      }
      tags {
        name
        rank
        isMediaSpoiler
      }
      relations {
        edges {
          relationType
          node {
            id
            title {
              romaji
              english
            }
            type
            episodes
            chapters
          }
        }
      }
    }
  }
`;

export const GET_WORKS_BATCH = `
  query($ids: [Int]!) {
    Page(page: 1, perPage: 50) {
      media(id_in: $ids) {
        id
        title {
          romaji
          english
        }
        coverImage {
          extraLarge
          large
        }
        type
        format
        averageScore
        status
        episodes
        chapters
        duration
        genres
        endDate {
          year
          month
          day
        }
        nextAiringEpisode {
          episode
          airingAt
          timeUntilAiring
        }
        relations {
          edges {
            relationType
            node {
              id
              type
              status
              title {
                romaji
                english
              }
              coverImage {
                medium
                large
              }
            }
          }
        }
      }
    }
  }
`;

export const GET_RECOMMENDATIONS_FOR_WORKS = `
  query($ids: [Int], $recPerPage: Int = 12) {
    Page(page: 1, perPage: 15) {
      media(id_in: $ids) {
        id
        type
        title {
          romaji
          english
        }
        genres
        recommendations(sort: RATING_DESC, page: 1, perPage: $recPerPage) {
          nodes {
            rating
            mediaRecommendation {
              id
              type
              title {
                romaji
                english
              }
              coverImage {
                extraLarge
                large
              }
              format
              status
              episodes
              chapters
              averageScore
              genres
              relations {
                edges {
                  relationType
                  node {
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function getWorkTitleAndType(
  workId: string
): Promise<{ title: string; type: "ANIME" | "MANGA"; coverImage?: string } | null> {
  try {
    const id = parseInt(workId, 10);
    if (Number.isNaN(id)) return null;
    const res = await fetchAniList<{ Media?: AniListMedia }>(
      `query($id: Int) { Media(id: $id) { title { romaji english } type coverImage { large medium } } }`,
      { id }
    );
    if (!res?.Media) return null;
    const title = res.Media.title?.english || res.Media.title?.romaji || "";
    const coverImage =
      res.Media.coverImage?.large || res.Media.coverImage?.medium || undefined;
    return {
      title,
      type: res.Media.type === "MANGA" ? "MANGA" : "ANIME",
      coverImage,
    };
  } catch {
    return null;
  }
}
