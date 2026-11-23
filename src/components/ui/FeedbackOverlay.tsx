"use client";

import { useEffect } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useUiFeedbackStore } from "@/lib/ui-feedback";

export function FeedbackOverlay() {
  const toasts = useUiFeedbackStore((s) => s.toasts);
  const dismissToast = useUiFeedbackStore((s) => s.dismissToast);
  const confirmRequest = useUiFeedbackStore((s) => s.confirmRequest);
  const resolveConfirm = useUiFeedbackStore((s) => s.resolveConfirm);

  useEffect(() => {
    if (!confirmRequest) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolveConfirm(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmRequest, resolveConfirm]);

  return (
    <>
      {/* Toast Stack */}
      {toasts.length > 0 && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[120] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none">
          {toasts.map((t) => {
            const styles =
              t.variant === "success"
                ? "border-accent-border bg-surface/95 text-accent-light"
                : t.variant === "error"
                ? "border-rose-500/45 bg-surface/95 text-rose-200"
                : "border-gray-700 bg-surface/95 text-gray-100";

            return (
              <div
                key={t.id}
                role="status"
                className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold shadow-2xl backdrop-blur-md animate-fade-in ${styles}`}
              >
                {t.variant === "success" ? (
                  <CheckCircle2 size={15} className="shrink-0 mt-0.5 text-accent-text" />
                ) : t.variant === "error" ? (
                  <AlertCircle size={15} className="shrink-0 mt-0.5 text-rose-400" />
                ) : (
                  <Info size={15} className="shrink-0 mt-0.5 text-gray-400" />
                )}
                <span className="flex-1 leading-snug">{t.message}</span>
                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  className="text-gray-400 hover:text-white p-0.5 shrink-0"
                  aria-label="Hinweis schließen"
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmRequest && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          onClick={() => resolveConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-gray-800 bg-surface shadow-2xl overflow-hidden flex flex-col animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3.5 border-b border-gray-800/80">
              <h3 className="text-sm font-bold text-white">
                {confirmRequest.title}
              </h3>
            </div>
            <p className="px-4 py-4 text-xs text-gray-300 leading-relaxed">
              {confirmRequest.message}
            </p>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-800/80 bg-surface-inset">
              <button
                type="button"
                onClick={() => resolveConfirm(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 transition"
              >
                {confirmRequest.cancelLabel || "Abbrechen"}
              </button>
              <button
                type="button"
                onClick={() => resolveConfirm(true)}
                className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition shadow-md ${
                  confirmRequest.destructive
                    ? "bg-rose-600 hover:bg-rose-500"
                    : "bg-accent hover:bg-accent-hover"
                }`}
              >
                {confirmRequest.confirmLabel || "Bestätigen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
