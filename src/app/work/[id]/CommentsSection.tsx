"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import { Comment } from "@/types/database";
import { getCommentsForWork, addComment, voteComment } from "@/lib/db/comments";
import { getUserProfile } from "@/lib/db/users";
import { MessageSquare, ThumbsUp, ThumbsDown, CornerDownRight, ShieldAlert } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

interface CommentsSectionProps {
  workId: string;
}

export function CommentsSection({ workId }: CommentsSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [newCommentText, setNewCommentText] = useState("");
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const initialEpisode = searchParams.get("episode") || "";

  const [selectedEpisodeFilter, setSelectedEpisodeFilter] = useState<string>(initialEpisode ? initialEpisode : "ALL");
  const [newCommentEpisode, setNewCommentEpisode] = useState<string>(initialEpisode);

  const currentUser = auth.currentUser;

  const loadComments = async () => {
    setIsLoading(true);
    try {
      const data = await getCommentsForWork(workId);
      setComments(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadComments();
  }, [workId]);

  const handleSubmit = async (e: React.FormEvent, parentId: string | null = null) => {
    e.preventDefault();
    if (!currentUser || !newCommentText.trim()) return;

    setIsSubmitting(true);
    try {
      const profile = await getUserProfile(currentUser.uid);
      const username = profile?.username || currentUser.displayName || "Anonym";
      const avatar = profile?.avatar_url || currentUser.photoURL || `https://api.dicebear.com/9.x/notionists/svg?seed=${username}`;

      let epNum: number | undefined = undefined;
      if (!parentId && newCommentEpisode.trim() !== "") {
        epNum = parseInt(newCommentEpisode, 10);
        if (isNaN(epNum)) epNum = undefined;
      }

      const newC = await addComment(workId, currentUser.uid, username, avatar, newCommentText, isSpoiler, parentId, epNum);
      if (newC) {
        setComments(prev => [newC, ...prev]);
        setNewCommentText("");
        setIsSpoiler(false);
        setReplyingTo(null);
        setNewCommentEpisode("");
      }
    } catch (e) {
      console.error(e);
      alert("Fehler beim Senden des Kommentars.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVote = async (commentId: string, type: "UP" | "DOWN") => {
    if (!currentUser) return alert("Bitte erst einloggen!");
    
    // Optimistic UI Update
    setComments(prev => prev.map(c => {
      if (c.comment_id === commentId) {
        let ups = c.upvotes.filter(id => id !== currentUser.uid);
        let downs = c.downvotes.filter(id => id !== currentUser.uid);
        if (type === "UP" && !c.upvotes.includes(currentUser.uid)) ups.push(currentUser.uid);
        if (type === "DOWN" && !c.downvotes.includes(currentUser.uid)) downs.push(currentUser.uid);
        return { ...c, upvotes: ups, downvotes: downs };
      }
      return c;
    }));

    await voteComment(commentId, currentUser.uid, type);
  };

  // Build Tree
  const rootComments = comments.filter(c => !c.parent_comment_id).filter(c => {
    if (selectedEpisodeFilter === "ALL") return true;
    if (selectedEpisodeFilter === "GENERAL") return c.episode_num === undefined;
    return c.episode_num?.toString() === selectedEpisodeFilter;
  });
  const replies = comments.filter(c => c.parent_comment_id);

  const renderComment = (comment: Comment, isReply = false) => {
    const childReplies = replies.filter(r => r.parent_comment_id === comment.comment_id);
    const score = comment.upvotes.length - comment.downvotes.length;
    const userUpvoted = currentUser && comment.upvotes.includes(currentUser.uid);
    const userDownvoted = currentUser && comment.downvotes.includes(currentUser.uid);

    return (
      <div key={comment.comment_id} className={`flex gap-3 ${isReply ? "mt-3" : "mt-6 pt-6 border-t border-gray-800"}`}>
        <img src={comment.author_avatar} alt="Avatar" className="w-10 h-10 rounded-full bg-gray-800 shrink-0 object-cover" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-sm text-gray-200">{comment.author_name}</span>
            <span className="text-xs text-gray-500">• {formatDistanceToNow(new Date(comment.timestamp), { addSuffix: true, locale: de })}</span>
            {comment.episode_num !== undefined && (
              <span className="text-[10px] bg-blue-900/40 text-blue-400 px-1.5 py-0.5 rounded font-bold border border-blue-800">Folge {comment.episode_num}</span>
            )}
            {comment.is_spoiler && <span className="text-[10px] bg-red-900/40 text-red-400 px-1.5 py-0.5 rounded font-bold border border-red-800">SPOILER</span>}
          </div>
          
          <div className={`text-sm text-gray-300 ${comment.is_spoiler ? "blur-sm hover:blur-none transition cursor-pointer" : ""}`}>
            {comment.text}
          </div>
          
          {/* Actions */}
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1 bg-gray-900 rounded-full border border-gray-800 overflow-hidden">
              <button onClick={() => handleVote(comment.comment_id, "UP")} className={`px-2 py-1 transition hover:bg-gray-800 ${userUpvoted ? "text-blue-500" : "text-gray-400"}`}>
                <ThumbsUp size={14} />
              </button>
              <span className="text-xs font-bold text-gray-300 min-w-[1ch] text-center">{score}</span>
              <button onClick={() => handleVote(comment.comment_id, "DOWN")} className={`px-2 py-1 transition hover:bg-gray-800 ${userDownvoted ? "text-red-500" : "text-gray-400"}`}>
                <ThumbsDown size={14} />
              </button>
            </div>
            
            {currentUser && (
              <button onClick={() => setReplyingTo(comment.comment_id)} className="text-xs font-semibold text-gray-500 hover:text-gray-300 flex items-center gap-1 transition">
                <MessageSquare size={14} /> Antworten
              </button>
            )}
          </div>

          {/* Reply Input Box */}
          {replyingTo === comment.comment_id && (
            <div className="mt-3 bg-gray-900 border border-gray-800 rounded-lg p-3">
              <textarea 
                value={newCommentText}
                onChange={e => setNewCommentText(e.target.value)}
                placeholder="Deine Antwort..." 
                className="w-full bg-transparent text-sm text-white focus:outline-none resize-none"
                rows={2}
              />
              <div className="flex justify-between items-center mt-2">
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={isSpoiler} onChange={e => setIsSpoiler(e.target.checked)} className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-600" />
                  <ShieldAlert size={14} /> Enthält Spoiler
                </label>
                <div className="flex gap-2">
                  <button onClick={() => { setReplyingTo(null); setNewCommentText(""); setIsSpoiler(false); }} className="px-3 py-1.5 text-xs font-bold text-gray-400 hover:text-white">Abbrechen</button>
                  <button onClick={(e) => handleSubmit(e, comment.comment_id)} disabled={isSubmitting || !newCommentText.trim()} className="bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition disabled:opacity-50">Senden</button>
                </div>
              </div>
            </div>
          )}

          {/* Render nested replies */}
          {childReplies.length > 0 && (
            <div className="mt-3 pl-4 border-l-2 border-gray-800">
              {childReplies.map(reply => renderComment(reply, true))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-12 rounded-2xl border border-gray-800 bg-[#1a1d24] p-5 shadow-lg">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <MessageSquare className="text-blue-500" />
          Diskussion ({comments.length})
        </h2>
        <select 
          value={selectedEpisodeFilter} 
          onChange={e => setSelectedEpisodeFilter(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg p-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
        >
          <option value="ALL">Alle Kommentare</option>
          <option value="GENERAL">Allgemein</option>
          {Array.from(new Set(comments.map(c => c.episode_num).filter(n => n !== undefined))).sort((a, b) => (a || 0) - (b || 0)).map(num => (
            <option key={`ep-${num}`} value={num?.toString()}>Zu Folge {num}</option>
          ))}
        </select>
      </div>

      {/* Main Input */}
      {currentUser ? (
        replyingTo === null && (
          <div className="flex gap-3 mb-6">
            <img src={currentUser.photoURL || `https://api.dicebear.com/9.x/notionists/svg?seed=${currentUser.uid}`} alt="My Avatar" className="w-10 h-10 rounded-full bg-gray-800 shrink-0 object-cover" />
            <div className="flex-1 bg-gray-900 border border-gray-800 rounded-lg p-3 focus-within:border-blue-500 transition-colors">
              <textarea 
                value={newCommentText}
                onChange={e => setNewCommentText(e.target.value)}
                placeholder="Was denkst du über dieses Werk?" 
                className="w-full bg-transparent text-sm text-white focus:outline-none resize-none"
                rows={3}
              />
              <div className="flex justify-between items-center mt-2 border-t border-gray-800 pt-2">
                <div className="flex gap-4 items-center">
                  <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                    <input type="checkbox" checked={isSpoiler} onChange={e => setIsSpoiler(e.target.checked)} className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-600" />
                    <ShieldAlert size={14} /> Enthält Spoiler
                  </label>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <label htmlFor="epInput">Zu Folge:</label>
                    <input 
                      id="epInput"
                      type="number" 
                      placeholder="Optional" 
                      value={newCommentEpisode} 
                      onChange={e => setNewCommentEpisode(e.target.value)}
                      className="w-16 bg-gray-900 border border-gray-700 rounded p-1 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <button onClick={(e) => handleSubmit(e)} disabled={isSubmitting || !newCommentText.trim()} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-bold text-white transition disabled:opacity-50">Posten</button>
              </div>
            </div>
          </div>
        )
      ) : (
        <div className="mb-6 p-4 rounded-lg bg-gray-900 border border-gray-800 text-center text-sm text-gray-400">
          Bitte logge dich ein, um mitzudiskutieren.
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-gray-500 py-8 animate-pulse">Lade Kommentare...</div>
      ) : rootComments.length === 0 ? (
        <div className="text-center text-gray-500 py-8">Sei der Erste, der einen Kommentar schreibt!</div>
      ) : (
        <div className="flex flex-col">
          {rootComments.map(c => renderComment(c, false))}
        </div>
      )}
    </div>
  );
}
