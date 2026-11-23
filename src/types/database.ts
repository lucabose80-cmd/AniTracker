export type WorkType = "ANIME" | "MANGA" | "MANHWA";
export type UserWorkStatus = "PLANNING" | "CURRENT" | "COMPLETED" | "DROPPED" | "PAUSED" | "NONE";
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
  dismissed_activity_ids?: string[];
  dismissed_activities_before?: string;
}

export interface UserWork {
  user_id: string;
  work_id: string;
  status: UserWorkStatus;
  current_episode: number;
  priority_tier: 1 | 2 | 3;
  sync_offset_days: number;
  synchro_offset_episodes?: number;
  manual_available_eps?: number | null;
  selected_platform: string;
  manual_max_episode?: number;
  auto_added?: boolean;
  top9_rank?: number;
  added_status?: string;
  updated_at?: number;

  adaptationScores: {
    story: number;
    pacing: number;
  };

  mal_rated?: boolean;
  dropped_reason?: string;

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
    rewatchPotential?: number;
    hasRomance?: boolean;
    isRomanceMainFocus?: boolean;
    emotionalImpact: EmotionalImpact;
    comments: string;
    overallScore: number;
    manualScore?: number;
  };
}

export interface ReviewListItem {
  work_id: string;
  work_title: string;
  work_cover?: string;
  media_type: "ANIME" | "MANGA";
  episode_num: number;
  episode_end?: number; // Optional end of range (e.g. Chapter 1-70)
  episodes?: number[];  // Optional list of individual episodes/chapters (e.g. [5, 6, 7])
  previous_episode?: number; // User's progress before this review was submitted (for rollback on delete/edit)
  applied_episode?: number;  // Progress value set by this review item
  text: string;
  rating?: number; // 1-10
}

export interface ActivityFeed {
  activity_id: string;
  user_id: string;
  action_type:
    | "MANUAL_POST"
    | "RATING"
    | "COMMENT"
    | "TOP9_UPDATE"
    | "RECOMMENDATION"
    | "EPISODE_THREAD"
    | "WEEKLY_RANKING"
    | "REVIEW_LIST";
  work_id?: string;
  episode_num?: number;
  text?: string;
  timestamp: string; // ISO string
  details?: string;
  comments_count?: number; // Optional cache for number of comments
  likes?: string[]; // Array of user IDs who liked this
  review_items?: ReviewListItem[];
  work_ids?: string[];
  reactions?: Record<string, string[]>; // emoji -> array of user UIDs
}

export interface EpisodeFeedback {
  feedback_id: string;
  user_id: string;
  work_id: string;
  episode_num: number;
  episode_end?: number;
  episodes?: number[];
  media_type: "ANIME" | "MANGA";
  text: string;
  rating?: number; // 1-10
  activity_id?: string;
  timestamp: string;
  reactions?: Record<string, string[]>;
}

export interface ActivityComment {
  comment_id: string;
  activity_id: string;
  user_id: string;
  text: string;
  timestamp: string;
  parent_comment_id?: string;
  likes?: string[];
}

export interface InAppNotification {
  notification_id: string;
  user_id: string;       // the user receiving it
  actor_id: string;      // the user who did the action
  actor_name: string;
  actor_avatar: string;
  type:
    | "REPLY_TO_COMMENT"
    | "COMMENT_ON_REVIEW"
    | "REVIEW_POST"
    | "REVIEW_UPDATE"
    | "RATING_UPDATE"
    | "COMMENT_ON_THREAD"
    | "NEW_EPISODE_THREAD"
    | "APP_UPDATE"
    | "SYSTEM"
    | "COMMENT_LIKE";
  activity_id?: string;
  work_id?: string;
  work_title?: string;
  media_type?: "ANIME" | "MANGA";
  episode_num?: number;
  comment_id?: string;
  text: string;
  timestamp: string;
  read: boolean;
  deleted?: boolean;
  deleted_at?: string;
}
