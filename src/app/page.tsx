"use client";

import { useAppStore } from "@/lib/store";
import { Star, Flame, Clock } from "lucide-react";

export default function Home() {
  const { contentType } = useAppStore();

  return (
    <div className="flex flex-col gap-6 px-4 pt-6">
      <section>
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
          <Flame className="text-blue-500" /> 
          Top Empfehlungen
        </h2>
        <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 scrollbar-hide">
          {/* Skeleton/Placeholder for Recommendations */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="relative min-w-[240px] snap-center overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] shadow-lg">
              <div className="aspect-[3/4] w-full bg-gray-800 animate-pulse" />
              <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4">
                <h3 className="font-bold text-white truncate">Empfehlung {i}</h3>
                <div className="flex items-center gap-2 text-xs text-gray-300">
                  <Star size={12} className="text-yellow-500" />
                  <span>8.5</span>
                  <span className="text-blue-400 font-semibold uppercase">{contentType}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
          <Clock className="text-blue-500" /> 
          Aktuelle {contentType === "ANIME" ? "Episoden" : "Kapitel"}
        </h2>
        <div className="grid gap-4">
          {/* List items */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 rounded-xl border border-gray-800 bg-[#1a1d24] p-3 shadow-md">
              <div className="h-20 w-16 rounded bg-gray-800 animate-pulse flex-shrink-0" />
              <div className="flex flex-col justify-between h-full w-full">
                <div>
                  <h4 className="font-semibold text-sm line-clamp-2">Werk Titel {i}</h4>
                  <p className="text-xs text-gray-400 mt-1">{contentType === "ANIME" ? "Ep. 12" : "Ch. 145"}</p>
                </div>
                <div className="flex gap-2 mt-2">
                  <button className="rounded bg-blue-600/10 px-3 py-1 text-xs font-semibold text-blue-500 transition-colors hover:bg-blue-600/20">
                    Gesehen
                  </button>
                  <button className="rounded bg-gray-800 px-3 py-1 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-700">
                    Diskutieren
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
