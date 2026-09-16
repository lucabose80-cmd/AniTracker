"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { fetchAniList, SEARCH_WORKS } from "@/lib/anilist";
import { useAppStore } from "@/lib/store";
import { Star, Search as SearchIcon } from "lucide-react";
import Link from "next/link";

function SearchContent() {
  const searchParams = useSearchParams();
  const query = searchParams?.get("q") || "";
  const { contentType } = useAppStore();
  const router = useRouter();

  const [input, setInput] = useState(query);
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }

    async function doSearch() {
      setIsLoading(true);
      try {
        const data = await fetchAniList(SEARCH_WORKS, { search: query, type: contentType });
        setResults(data.Page.media);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    doSearch();
  }, [query, contentType]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      router.push(`/search?q=${encodeURIComponent(input.trim())}`);
    }
  };

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24">
      <form onSubmit={handleSearch} className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Suche nach ${contentType}...`}
          className="w-full rounded-lg border border-gray-800 bg-[#1a1d24] p-3 pl-10 text-white focus:border-blue-500 focus:outline-none"
        />
        <button type="submit" className="hidden" />
      </form>

      {isLoading ? (
        <div className="text-center text-gray-500 animate-pulse mt-8">Suche läuft...</div>
      ) : results.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {results.map((work) => (
            <Link href={`/work/${work.id}`} key={work.id} className="relative overflow-hidden rounded-xl border border-gray-800 bg-[#1a1d24] shadow-lg transition-transform hover:scale-[1.02]">
              <img 
                src={work.coverImage.extraLarge || work.coverImage.large} 
                alt={work.title.english || work.title.romaji}
                className="aspect-[3/4] w-full object-cover"
                loading="lazy"
              />
              <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/95 via-black/70 to-transparent p-3">
                <h3 className="font-bold text-white text-sm line-clamp-1">{work.title.english || work.title.romaji}</h3>
                <div className="flex items-center gap-1 text-xs text-gray-300 mt-1">
                  <Star size={10} className="text-yellow-500" />
                  <span>{(work.averageScore / 10).toFixed(1)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : query ? (
        <div className="text-center text-gray-500 mt-8">Keine Ergebnisse für "{query}" gefunden.</div>
      ) : (
        <div className="text-center text-gray-500 mt-8">Gib einen Suchbegriff ein, um neue Werke zu finden.</div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">Lade Suche...</div>}>
      <SearchContent />
    </Suspense>
  );
}
