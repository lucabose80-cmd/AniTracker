import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { get, set, del } from 'idb-keyval';

export type ContentType = 'ANIME' | 'MANGA';

interface AppState {
  contentType: ContentType;
  setContentType: (type: ContentType) => void;
  toggleContentType: () => void;
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;

  searchHistory: string[];
  addSearchHistory: (term: string) => void;
  clearSearchHistory: () => void;

  rateLimited: boolean;
  setRateLimited: (limited: boolean) => void;
  reloadTrigger: number;
  triggerReload: () => void;

  homeTab: "UPNEXT" | "COMMUNITY" | "TRENDING" | "UPCOMING" | "RECOMMENDATIONS";
  setHomeTab: (tab: "UPNEXT" | "COMMUNITY" | "TRENDING" | "UPCOMING" | "RECOMMENDATIONS") => void;
  trendingGenre: string;
  setTrendingGenre: (genre: string) => void;
}

const idbStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const value = await get(name);
      return value !== undefined ? value : null;
    } catch (e) {
      if (typeof window !== 'undefined') console.warn('IDB fail', e);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await set(name, value);
    } catch (e) {
      if (typeof window !== 'undefined') console.warn('IDB fail', e);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await del(name);
    } catch (e) {
      if (typeof window !== 'undefined') console.warn('IDB fail', e);
    }
  },
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      contentType: 'ANIME',
      setContentType: (type) => set({ contentType: type }),
      toggleContentType: () =>
        set((state) => ({
          contentType: state.contentType === 'ANIME' ? 'MANGA' : 'ANIME',
        })),
      isOnline: true,
      setIsOnline: (online) => set({ isOnline: online }),

      searchHistory: [],
      addSearchHistory: (term) => set((state) => {
        const newHistory = [term, ...state.searchHistory.filter((t) => t !== term)].slice(0, 5);
        return { searchHistory: newHistory };
      }),
      clearSearchHistory: () => set({ searchHistory: [] }),

      rateLimited: false,
      setRateLimited: (limited) => set({ rateLimited: limited }),
      reloadTrigger: 0,
      triggerReload: () => set((state) => ({ reloadTrigger: state.reloadTrigger + 1 })),

      homeTab: "UPNEXT",
      setHomeTab: (tab) => set({ homeTab: tab }),
      trendingGenre: "All",
      setTrendingGenre: (genre) => set({ trendingGenre: genre }),
    }),
    {
      name: 'anitracker-store',
      storage: createJSONStorage(() => idbStorage),
    }
  )
);
