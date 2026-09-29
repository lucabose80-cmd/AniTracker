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
}

const idbStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const value = await get(name);
    return value !== undefined ? value : null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
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
    }),
    {
      name: 'anitracker-store',
      storage: createJSONStorage(() => idbStorage),
    }
  )
);
