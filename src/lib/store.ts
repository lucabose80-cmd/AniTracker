import { create } from 'zustand';

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

export const useAppStore = create<AppState>((set) => ({
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
}));
