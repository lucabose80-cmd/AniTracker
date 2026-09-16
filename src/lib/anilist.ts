const ANILIST_API_URL = "https://graphql.anilist.co";

export async function fetchAniList(query: string, variables: any = {}) {
  const fetchPromise = fetch(ANILIST_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const response = await Promise.race([
    fetchPromise,
    new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("AniList API Timeout")), 8000))
  ]);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`AniList API Fehler: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  const json = await response.json();
  return json.data;
}

// -- Queries --

export const GET_TRENDING_WORKS = `
  query($type: MediaType, $page: Int = 1, $perPage: Int = 10) {
    Page(page: $page, perPage: $perPage) {
      media(type: $type, sort: TRENDING_DESC) {
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
          }
        }
      }
    }
  }
`;
