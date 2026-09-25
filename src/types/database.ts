export type WorkType = "ANIME" | "MANGA" | "MANHWA";
export type UserWorkStatus = "PLANNING" | "CURRENT" | "COMPLETED" | "DROPPED" | "NONE";
export type EmotionalImpact = "Leicht" | "Mitgenommen" | "Tränen nah" | "Tränen ausgelöst" | "Geweint" | "None";
export type WatchMode = "SUB" | "DUB" | "BEIDES" | "N/A";

export interface UserProfile {
  uid: string;
  username: string;
  avatar_url: string;
  following_array: string[]; // array of uids
  top_9_list?: string[]; // Legacy
  top_9_anime: string[];
  top_9_manga: string[];
  read_watch_history: string[]; // array of work_ids
  notification_settings?: {
    releases: boolean;
    likes: boolean;
    replies: boolean;
    social: boolean;
  };
  fcm_tokens?: string[];
  weekly_ranking_anime?: {
    current: string[];
    previous: string[];
    last_updated: string;
    last_active?: number;
  };
  weekly_ranking_manga?: {
    current: string[];
    previous: string[];
    last_updated: string;
    last_active?: number;
  };
  last_maintenance_timestamp?: number;
}

export interface Work {
  work_id: string; // From AniList/Jikan
  title: string;
  type: WorkType;
  total_episodes: number;
  platforms_array: string[];
  official_tags: string[];
  official_genres: string[];
  related_works: string[]; // array of work_ids
}

export interface UserWork {
  user_id: string;
  work_id: string;
  status: UserWorkStatus;
  current_episode: number;
  priority_tier: 1 | 2 | 3;
  sync_offset_days: number;
  synchro_offset_episodes?: number;
  selected_platform: string;
  manual_max_episode?: number;
  auto_added?: boolean;
  
  adaptationScores: {
    story: number;
    pacing: number;
  };
  
  mal_rated?: boolean;

  classification: {
    watchMode: WatchMode;
    romanceLevel: number;
    confessionTiming: string;
    intimacyLevel: number;
    relationshipDynamics: string;
    wholesomeLewdScale: number;
    comedySeriousScale: number;
    actionDialogScale: number;
    pacingScale: number;
  };
  
  evaluation: {
    plotAndStory: number;
    castAndCharacters: number;
    sideCharacters: number;
    ending: number;
    artstyleAndAnimation: number;
    introOutro: number;
    voiceActing: number;
    romanceAndChemistry: number;
    comedy?: number;
    bingeFactor: number;
    emotionalImpact: EmotionalImpact;
    comments: string;
    overallScore: number;
  };
}

export interface Comment {
  comment_id: string;
  work_id: string;
  episode_num?: number;
  author_uid: string;
  author_name: string;
  author_avatar?: string;
  text: string;
  timestamp: string;
  is_spoiler: boolean;
  parent_comment_id: string | null;
  upvotes: string[];
  downvotes: string[];
}

export interface ActivityFeed {
  activity_id: string;
  user_id: string;
  action_type: "MANUAL_POST" | "RATING" | "COMMENT" | "TOP9_UPDATE" | "RECOMMENDATION" | "EPISODE_THREAD" | "WEEKLY_RANKING";
  work_id?: string;
  episode_num?: number;
  text?: string;
  timestamp: string; // ISO string
  details?: string;
  comments_count?: number; // Optional cache for number of comments
}

export interface ActivityComment {
  comment_id: string;
  activity_id: string;
  user_id: string;
  text: string;
  timestamp: string;
  parent_comment_id?: string;
}
