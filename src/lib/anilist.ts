const ANILIST_API_URL = "https://graphql.anilist.co";

const MEMORY_CACHE = new Map<string, { data: any; timestamp: number }>();
const BATCH_CACHE = new Map<number, { data: any; timestamp: number }>();
const IN_FLIGHT_REQUESTS = new Map<string, Promise<any>>();
const CACHE_DURATION = 1000 * 60 * 15; // 15 minutes

export async function fetchAniList(query: string, variables: any = {}, retries = 2): Promise<any> {
  const cacheKey = JSON.stringify({ query, variables });
  
  // 1. Return cached if valid
  const cached = MEMORY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  
  // 2. Return in-flight promise if currently fetching
  if (IN_FLIGHT_REQUESTS.has(cacheKey)) {
    return IN_FLIGHT_REQUESTS.get(cacheKey);
  }

  const requestPromise = (async () => {
    try {
      const fetchPromise = fetch(ANILIST_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });

      const response = await Promise.race([
        fetchPromise,
        new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("AniList API Timeout")), 15000))
      ]);

      if (!response.ok) {
        if (response.status === 429 && retries > 0) {
          const retryAfter = response.headers.get("Retry-After");
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : 2500;
          await new Promise(r => setTimeout(r, delay));
          // Bypass cache check for inner retry directly
          return fetchAniList(query, variables, retries - 1);
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`AniList API Fehler: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const json = await response.json();
      MEMORY_CACHE.set(cacheKey, { data: json.data, timestamp: Date.now() });
      return json.data;
    } catch (err: any) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 2000));
        return fetchAniList(query, variables, retries - 1);
      }
      throw err;
    } finally {
      IN_FLIGHT_REQUESTS.delete(cacheKey);
    }
  })();

  IN_FLIGHT_REQUESTS.set(cacheKey, requestPromise);
  return requestPromise;
}

export async function fetchAniListBatch(ids: number[]) {
  // Deduplicate IDs
  const validIds = [...new Set(ids.filter(id => !isNaN(id) && id > 0))];
  const results: any[] = [];
  const idsToFetch: number[] = [];

  // Check cache for individual IDs
  for (const id of validIds) {
    const cached = BATCH_CACHE.get(id);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      results.push(cached.data);
    } else {
      idsToFetch.push(id);
    }
  }

  // Fetch missing IDs in chunks
  for (let i = 0; i < idsToFetch.length; i += 50) {
    const chunk = idsToFetch.slice(i, i + 50);
    if (chunk.length === 0) continue;
    
    const data = await fetchAniList(GET_WORKS_BATCH, { ids: chunk });
    if (data?.Page?.media) {
      data.Page.media.forEach((m: any) => {
        BATCH_CACHE.set(m.id, { data: m, timestamp: Date.now() });
        results.push(m);
      });
    }
  }
  
  return results;
}

// -- Queries --

export const GET_TRENDING_WORKS = `
  query($type: MediaType, $season: MediaSeason, $seasonYear: Int, $page: Int = 1, $perPage: Int = 20) {
    Page(page: $page, perPage: $perPage) {
      media(type: $type, sort: TRENDING_DESC, season: $season, seasonYear: $seasonYear) {
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
  query($search: String, $type: MediaType, $page: Int = 1, $perPage: Int = 10) {
    Page(page: $page, perPage: $perPage) {
      media(search: $search, type: $type) {
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
        episodes
        chapters
        averageScore
      }
    }
  }
`;

export const GET_UPCOMING_WORKS = `
  query($type: MediaType, $season: MediaSeason, $seasonYear: Int, $page: Int = 1, $perPage: Int = 10) {
    Page(page: $page, perPage: $perPage) {
      media(type: $type, status: NOT_YET_RELEASED, sort: POPULARITY_DESC, season: $season, seasonYear: $seasonYear) {
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
        episodes
        chapters
        averageScore
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
        nextAiringEpisode {
          episode
          airingAt
          timeUntilAiring
        }
      }
    }
  }
`;

export const GET_RECOMMENDATIONS_BY_GENRE = `
  query($genre: String, $type: MediaType, $excludeIds: [Int]) {
    Page(page: 1, perPage: 10) {
      media(type: $type, genre: $genre, id_not_in: $excludeIds, sort: SCORE_DESC) {
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
        episodes
        chapters
        averageScore
        genres
      }
    }
  }
`;

export const GET_USER_AIRING_SCHEDULE = `
  query($ids: [Int]!) {
    Page(page: 1, perPage: 50) {
      media(id_in: $ids, status: RELEASING, type: ANIME) {
        id
        title {
          romaji
          english
        }
        coverImage {
          large
        }
        nextAiringEpisode {
          airingAt
          timeUntilAiring
          episode
        }
      }
    }
  }
`;
