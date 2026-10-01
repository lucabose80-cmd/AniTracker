"use client";

import { useAppStore } from "@/lib/store";
import { WifiOff, Clock } from "lucide-react";
import { useEffect, useState } from "react";

export function OfflineBanner() {
  const isOnline = useAppStore(state => state.isOnline);

  const rateLimited = useAppStore(state => state.rateLimited);
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    if (!rateLimited) { setCountdown(60); return; }
    setCountdown(60);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [rateLimited]);

  return (
    <>
      {!isOnline && (
        <div className="fixed top-16 left-0 right-0 z-40 flex items-center justify-center gap-2 bg-orange-600/95 backdrop-blur-sm py-2 px-4 text-sm font-bold text-white shadow-lg animate-in slide-in-from-top-2 duration-300">
          <WifiOff size={16} />
          <span>
            Keine Internetverbindung. Einige Funktionen sind eingeschränkt.
          </span>
        </div>
      )}
      {rateLimited && isOnline && (
        <div className="fixed top-16 left-0 right-0 z-40 flex items-center justify-center gap-2 bg-yellow-600/95 backdrop-blur-sm py-2 px-4 text-sm font-bold text-white shadow-lg animate-in slide-in-from-top-2 duration-300">
          <Clock size={16} className="shrink-0" />
          <span>
            AniList-Limit erreicht – Bilder laden aus dem Cache. Automatisch wieder aktiv in ~{countdown}s.
          </span>
        </div>
      )}
    </>
  );
}
