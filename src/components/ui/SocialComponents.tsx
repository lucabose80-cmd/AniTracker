"use client";

import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { deleteActivityComment, addActivityComment, getActivityComments } from "@/lib/db/feed";
import { ActivityComment } from "@/types/database";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import Link from "next/link";

export function CommentSection({ activityId, userProfiles, currentUserUid, commentCount: initialCount = 0 }: { activityId: string, userProfiles: Record<string, any>, currentUserUid?: string, commentCount?: number }) {
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [newText, setNewText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [seenCount, setSeenCount] = useState(0);
  const [commentCount, setCommentCount] = useState(initialCount);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`seen_comments_${activityId}`);
      if (saved) setSeenCount(parseInt(saved, 10));
    }
    
    getActivityComments(activityId).then(res => {
      setComments(res);
      setCommentCount(res.length);
    }).catch(console.error);
  }, [activityId]);

  useEffect(() => {
    if (isOpen) {
      if (typeof window !== "undefined") {
        localStorage.setItem(`seen_comments_${activityId}`, commentCount.toString());
      }
      setSeenCount(commentCount);
    }
  }, [isOpen, activityId, commentCount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim() || !currentUserUid) return;
    setIsSubmitting(true);
    try {
      const added = await addActivityComment(activityId, currentUserUid, newText.trim());
      if (added) {
        setComments(prev => [...prev, added]);
        setCommentCount(prev => prev + 1);
        setSeenCount(prev => prev + 1);
      }
      setNewText("");
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm("Kommentar wirklich löschen?")) return;
    try {
      await deleteActivityComment(commentId, activityId);
      setComments(prev => prev.filter(c => c.comment_id !== commentId));
      setCommentCount(prev => Math.max(0, prev - 1));
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="mt-3">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white transition"
      >
        <MessageSquare size={14} /> 
        {isOpen ? "Kommentare verbergen" : `${commentCount} Kommentare`}
        {!isOpen && commentCount > seenCount && (
          <span className="ml-1 bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded-full shadow-md animate-pulse">
            {commentCount - seenCount} neu
          </span>
        )}
      </button>

      {isOpen && (
        <div className="mt-3 flex flex-col gap-3 pt-3 border-t border-gray-800">
          {comments.map(c => {
            const author = userProfiles[c.user_id] || { username: "Unbekannt" };
            return (
              <div key={c.comment_id} className="flex gap-3 text-sm relative group border-t border-gray-800/50 pt-3">
                <div className="h-8 w-8 shrink-0 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center font-bold text-xs shadow-inner">
                  {author.avatar_url ? <img src={author.avatar_url} alt="" className="w-full h-full object-cover" /> : (author.username?.[0]?.toUpperCase() || "?")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-200">{author.username}</span>
                    <span className="text-[10px] text-gray-500">{formatDistanceToNow(new Date(c.timestamp), { addSuffix: true, locale: de })}</span>
                  </div>
                  <p className="text-gray-300 mt-0.5 break-words leading-relaxed">{c.text}</p>
                </div>
                {c.user_id === currentUserUid && (
                  <button 
                    onClick={() => handleDelete(c.comment_id)}
                    className="absolute top-3 right-0 text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                  >
                    X
                  </button>
                )}
              </div>
            );
          })}

          {comments.length === 0 && <p className="text-xs text-gray-500 italic">Noch keine Kommentare. Sei der erste!</p>}

          {currentUserUid ? (
            <form onSubmit={handleSubmit} className="flex gap-2 mt-1">
              <input 
                type="text" 
                value={newText}
                onChange={e => setNewText(e.target.value)}
                placeholder="Schreibe einen Kommentar..." 
                className="flex-1 bg-[#141a29] border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 text-white"
                disabled={isSubmitting}
              />
              <button 
                type="submit" 
                disabled={!newText.trim() || isSubmitting}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
              >
                Senden
              </button>
            </form>
          ) : (
            <p className="text-xs text-gray-500">Du musst angemeldet sein, um zu kommentieren.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function SpoilerProtectedThread({ activity, work, user, timeAgo, currentUserUid, isSpoiler, userProfiles }: any) {
  const [showAnyway, setShowAnyway] = useState(false);
  
  if (isSpoiler && !showAnyway) {
    return (
      <div className="rounded-xl border border-red-900/50 bg-[#1a1d24] p-6 text-center shadow-lg relative overflow-hidden flex flex-col items-center justify-center min-h-[160px]">
        <div className="absolute inset-0 bg-red-900/10" />
        <p className="text-red-400 font-bold mb-2 relative z-10 flex items-center gap-2">
          SPOILER WARNUNG
        </p>
        <p className="text-sm text-gray-400 mb-4 relative z-10">{work?.title?.english || work?.title?.romaji} - {work?.type === "MANGA" ? "Kapitel" : "Folge"} {activity.episode_num}</p>
        <button 
          onClick={() => setShowAnyway(true)} 
          className="bg-red-900/50 hover:bg-red-900 text-white text-xs font-bold px-4 py-2 rounded-lg transition relative z-10 shadow-lg"
        >
          Trotzdem anzeigen
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-blue-900/50 bg-[#141a29] p-4 shadow-lg relative overflow-hidden group">
      <div className="flex gap-4">
        {work && (
          <Link href={`/work/${work.id}?episode=${activity.episode_num || ''}`} className="shrink-0 relative">
            <img 
              src={work.coverImage?.large} 
              alt="Cover" 
              className="w-20 h-28 object-cover rounded-lg shadow-md border border-gray-800 group-hover:border-blue-500 transition"
            />
          </Link>
        )}
        <div className="flex flex-col justify-between flex-1 min-w-0 py-1">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[9px] bg-blue-600 text-white px-2 py-0.5 rounded-full font-bold shadow-md">
                OFFIZIELLER THREAD
              </span>
              <span className="text-xs text-gray-500">{timeAgo}</span>
            </div>
            <h3 className="font-bold text-gray-100 line-clamp-1">{work?.title?.english || work?.title?.romaji || "Unbekanntes Werk"}</h3>
            <p className="text-sm font-semibold text-blue-400 mt-0.5">Folge / Kapitel {activity.episode_num}</p>
          </div>

          <div className="flex gap-2 mt-3">
            <button 
              onClick={async () => {
                if (!currentUserUid) return;
                try {
                  const { saveUserWork } = await import("@/lib/db/works");
                  await saveUserWork(currentUserUid, work.id.toString(), { status: "CURRENT" });
                  alert("Zu 'Aktiv' hinzugefügt!");
                } catch(e) { console.error(e); }
              }}
              className="text-[10px] bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded font-bold transition"
            >
              + Aktiv
            </button>
            <button 
              onClick={async () => {
                if (!currentUserUid) return;
                try {
                  const { saveUserWork } = await import("@/lib/db/works");
                  await saveUserWork(currentUserUid, work.id.toString(), { status: "PLANNING" });
                  alert("Zur Wunschliste hinzugefügt!");
                } catch(e) { console.error(e); }
              }}
              className="text-[10px] bg-purple-600 hover:bg-purple-500 text-white px-2 py-1 rounded font-bold transition"
            >
              + Wunschliste
            </button>
          </div>
        </div>
      </div>
      <CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} commentCount={activity.comments_count || 0} />
    </div>
  );
}
