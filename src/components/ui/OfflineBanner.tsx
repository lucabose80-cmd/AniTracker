"use client";

import { useAppStore } from "@/lib/store";
import { WifiOff, Clock } from "lucide-react";

export function OfflineBanner() {
  const isOnline = useAppStore((state) => state.isOnline);
  const rateLimited = useAppStore((state) => state.rateLimited);

  if (!isOnline) {
    return (
      <div className="fixed top-16 left-0 right-0 z-40 flex items-center justify-center gap-2 bg-orange-600/95 backdrop-blur-sm py-2 px-4 text-xs sm:text-sm font-bold text-white shadow-lg animate-fade-in">
        <WifiOff size={15} />
        <span>
          Keine Internetverbindung. Einige Funktionen sind eingeschränkt.
        </span>
      </div>
    );
  }

  if (rateLimited) {
    return (
      <div className="fixed top-16 left-0 right-0 z-40 flex items-center justify-center gap-2 bg-amber-600/95 backdrop-blur-sm py-2 px-4 text-xs sm:text-sm font-bold text-white shadow-lg animate-fade-in">
        <Clock size={15} />
        <span>
          AniList-Limit kurzzeitig erreicht – Daten werden automatisch neu geladen...
        </span>
      </div>
    );
  }

  return null;
}
