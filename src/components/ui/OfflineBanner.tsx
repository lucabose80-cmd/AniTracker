"use client";

import { useAppStore } from "@/lib/store";
import { WifiOff } from "lucide-react";

export function OfflineBanner() {
  const isOnline = useAppStore(state => state.isOnline);
  const offlineQueueCount = useAppStore(state => state.offlineQueueCount);

  if (isOnline) return null;

  return (
    <div className="fixed top-16 left-0 right-0 z-40 flex items-center justify-center gap-2 bg-orange-600/95 backdrop-blur-sm py-2 px-4 text-sm font-bold text-white shadow-lg animate-in slide-in-from-top-2 duration-300">
      <WifiOff size={16} />
      <span>
        {offlineQueueCount > 0 
          ? `Offline - ${offlineQueueCount} Posts in der Warteschlange...` 
          : "Offline-Modus – Änderungen werden bei Verbindung synchronisiert"}
      </span>
    </div>
  );
}
