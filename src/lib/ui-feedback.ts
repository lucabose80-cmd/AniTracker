import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  resolve: (confirmed: boolean) => void;
}

interface UiFeedbackState {
  toasts: ToastItem[];
  confirmRequest: ConfirmRequest | null;
  pushToast: (message: string, variant?: ToastVariant, durationMs?: number) => void;
  dismissToast: (id: string) => void;
  openConfirm: (options: Omit<ConfirmRequest, "resolve">) => Promise<boolean>;
  resolveConfirm: (confirmed: boolean) => void;
}

export const useUiFeedbackStore = create<UiFeedbackState>((set) => ({
  toasts: [],
  confirmRequest: null,
  pushToast: (message, variant = "info", durationMs = 3400) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({
      toasts: [...state.toasts.slice(-3), { id, message, variant }],
    }));
    if (typeof window !== "undefined" && durationMs > 0) {
      window.setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, durationMs);
    }
  },
  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
  openConfirm: (options) =>
    new Promise<boolean>((resolve) => {
      set({
        confirmRequest: {
          ...options,
          resolve,
        },
      });
    }),
  resolveConfirm: (confirmed) =>
    set((state) => {
      state.confirmRequest?.resolve(confirmed);
      return { confirmRequest: null };
    }),
}));

export const toast = {
  success: (message: string) =>
    useUiFeedbackStore.getState().pushToast(message, "success"),
  error: (message: string) =>
    useUiFeedbackStore.getState().pushToast(message, "error", 4500),
  info: (message: string) =>
    useUiFeedbackStore.getState().pushToast(message, "info"),
};

export function confirmAction(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return useUiFeedbackStore.getState().openConfirm(options);
}
