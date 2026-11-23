"use client";

import { useState } from "react";

function InlineSpoiler({
  content,
  forceReveal,
}: {
  content: string;
  forceReveal?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const isRevealed = Boolean(forceReveal || revealed);

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        if (!forceReveal) setRevealed((v) => !v);
      }}
      className={`transition-colors duration-200 px-1 rounded ${
        isRevealed
          ? "bg-white/10 text-white"
          : "bg-black text-black select-none cursor-pointer hover:bg-black/80"
      }`}
      title={isRevealed ? "" : "Klicken zum Aufdecken"}
    >
      {content}
    </span>
  );
}

export function SpoilerText({
  text,
  forceReveal,
}: {
  text?: string;
  forceReveal?: boolean;
}) {
  if (!text) return null;
  // Use [\s\S]*? so multiline spoilers (||line1\nline2||) also match cleanly
  const parts = text.split(/(\|\|[\s\S]*?\|\|)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("||") && part.endsWith("||") && part.length > 4) {
          const content = part.slice(2, -2);
          return (
            <InlineSpoiler key={i} content={content} forceReveal={forceReveal} />
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
