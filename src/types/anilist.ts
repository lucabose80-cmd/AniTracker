export interface AniListTitle {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
}

export interface AniListCoverImage {
  extraLarge?: string | null;
  large?: string | null;
  medium?: string | null;
}

export interface AniListDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

export interface AniListNextAiringEpisode {
  episode: number;
  airingAt: number;
  timeUntilAiring?: number;
}

export interface AniListRelationNode {
  id: number;
  type?: "ANIME" | "MANGA";
  status?: string;
  episodes?: number | null;
  chapters?: number | null;
  title?: AniListTitle;
  coverImage?: AniListCoverImage;
}

export interface AniListRelationEdge {
  relationType?: string;
  node?: AniListRelationNode;
}

export interface AniListTag {
  name: string;
  rank?: number;
  isMediaSpoiler?: boolean;
}

export interface AniListRecommendationNode {
  rating?: number | null;
  mediaRecommendation?: AniListMedia | null;
}

export interface AniListMedia {
  id: number;
  title?: AniListTitle;
  coverImage?: AniListCoverImage;
  bannerImage?: string | null;
  description?: string | null;
  type?: "ANIME" | "MANGA";
  format?: string | null;
  status?: "FINISHED" | "RELEASING" | "NOT_YET_RELEASED" | "CANCELLED" | "HIATUS" | string;
  episodes?: number | null;
  chapters?: number | null;
  duration?: number | null;
  averageScore?: number | null;
  genres?: string[];
  startDate?: AniListDate | null;
  endDate?: AniListDate | null;
  nextAiringEpisode?: AniListNextAiringEpisode | null;
  tags?: AniListTag[];
  relations?: {
    edges?: AniListRelationEdge[];
  } | null;
  recommendations?: {
    nodes?: AniListRecommendationNode[];
  } | null;
}

export function getAniListTitle(media?: Pick<AniListMedia, "title"> | null, fallback = "Unbekannt"): string {
  return (
    media?.title?.english ||
    media?.title?.romaji ||
    media?.title?.native ||
    fallback
  );
}
