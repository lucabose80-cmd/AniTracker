import { create } from 'zustand';

export type ContentType = 'ANIME' | 'MANGA';

interface AppState {
  contentType: ContentType;
  setContentType: (type: ContentType) => void;
  toggleContentType: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  contentType: 'ANIME',
  setContentType: (type) => set({ contentType: type }),
  toggleContentType: () =>
    set((state) => ({
      contentType: state.contentType === 'ANIME' ? 'MANGA' : 'ANIME',
    })),
}));
