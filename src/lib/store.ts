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
  offlineQueueCount: number;
  incrementOfflineQueue: () => void;
  clearOfflineQueue: () => void;
  searchHistory: string[];
  addSearchHistory: (term: string) => void;
  clearSearchHistory: () => void;
  workDetailsCache: Record<string, any>;
  setWorkDetailsCache: (cache: Record<string, any>) => void;
  rateLimited: boolean;
  setRateLimited: (limited: boolean) => void;
}

const idbStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const value = await get(name);
      return value !== undefined ? value : null;
    } catch (e) {
      console.warn('IDB fail', e);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await set(name, value);
    } catch (e) {
      console.warn('IDB fail', e);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await del(name);
    } catch (e) {
      console.warn('IDB fail', e);
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
      offlineQueueCount: 0,
      incrementOfflineQueue: () => set((state) => ({ offlineQueueCount: state.offlineQueueCount + 1 })),
      clearOfflineQueue: () => set({ offlineQueueCount: 0 }),
      searchHistory: [],
      addSearchHistory: (term) => set((state) => {
        const newHistory = [term, ...state.searchHistory.filter((t) => t !== term)].slice(0, 5);
        return { searchHistory: newHistory };
      }),
      clearSearchHistory: () => set({ searchHistory: [] }),
      workDetailsCache: {},
      setWorkDetailsCache: (cache) => set({ workDetailsCache: cache }),
      rateLimited: false,
      setRateLimited: (limited) => set({ rateLimited: limited }),
    }),
    {
      name: 'anitracker-store',
      storage: createJSONStorage(() => idbStorage),
    }
  )
);
