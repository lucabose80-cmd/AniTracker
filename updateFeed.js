const fs = require('fs');
const file = 'src/app/feed/FeedClient.tsx';
let content = fs.readFileSync(file, 'utf8');

const editStateStr = `
  const [editStates, setEditStates] = useState<Record<string, { isEditing: boolean, text: string, isSpoiler: boolean }>>({});

  const startEditingPost = (activity: ActivityFeed) => {
    const text = activity.text || activity.details || "";
    const isSpoiler = text.startsWith("||") && text.endsWith("||");
    setEditStates(prev => ({
      ...prev,
      [activity.activity_id]: {
        isEditing: true,
        text: isSpoiler ? text.slice(2, -2) : text,
        isSpoiler
      }
    }));
  };

  const submitEditPost = async (activityId: string) => {
    const state = editStates[activityId];
    if (!state) return;
    const final = state.isSpoiler ? \`||\${state.text.trim()}||\` : state.text.trim();
    
    try {
      const { editActivity } = await import("@/lib/db/feed");
      await editActivity(activityId, final);
      setFeed(prev => prev.map(a => a.activity_id === activityId ? { ...a, text: final, details: a.action_type === "MANUAL_POST" ? final : a.details } : a));
      setEditStates(prev => ({ ...prev, [activityId]: { ...prev[activityId], isEditing: false } }));
    } catch(e) {
      console.error(e);
      alert("Fehler beim Speichern");
    }
  };
`;
content = content.replace('const [showNotifications, setShowNotifications] = useState(false);', 'const [showNotifications, setShowNotifications] = useState(false);\n' + editStateStr);

// Fix SpoilerProtectedThread currentUserWorks
content = content.replace('userWorkIds={userWorkIdSet}', 'currentUserWorks={currentUserWorks}');

// Fix generic activities forceReveal
const genericTextSearch = '<SpoilerText text={activity.text || activity.details} /></p>';
content = content.replace(genericTextSearch, '<SpoilerText text={activity.text || activity.details} forceReveal={work && activity.episode_num != null && currentUserWorks[work.id.toString()] >= activity.episode_num} /></p>');

const genericCommentSearch = '<CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} commentCount={activity.comments_count || 0} />';
content = content.replace(genericCommentSearch, '<CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} commentCount={activity.comments_count || 0} forceReveal={work && activity.episode_num != null && currentUserWorks[work.id.toString()] >= activity.episode_num} />');
content = content.replace(genericCommentSearch, '<CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} commentCount={activity.comments_count || 0} forceReveal={work && activity.episode_num != null && currentUserWorks[work.id.toString()] >= activity.episode_num} />'); // Replaces both instances (Weekly Ranking and Generic)

// Replace the generic activity render with the edit logic
const postBodyRegex = /<p className="text-sm text-gray-300 mt-2 break-words whitespace-pre-wrap leading-relaxed"><SpoilerText text=\{activity\.text \|\| activity\.details\} forceReveal=\{.*?\} \/><\/p>/;
const editablePostBody = `
                        {editStates[activity.activity_id]?.isEditing ? (
                          <div className="mt-2">
                            <textarea 
                              value={editStates[activity.activity_id].text} 
                              onChange={e => setEditStates(prev => ({ ...prev, [activity.activity_id]: { ...prev[activity.activity_id], text: e.target.value } }))}
                              className="w-full bg-[#1a1d24] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:border-blue-500 outline-none min-h-[80px]"
                            />
                            <div className="flex gap-2 mt-2 items-center justify-between">
                              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                                <input type="checkbox" checked={editStates[activity.activity_id].isSpoiler} onChange={e => setEditStates(prev => ({ ...prev, [activity.activity_id]: { ...prev[activity.activity_id], isSpoiler: e.target.checked } }))} className="rounded border-gray-600 bg-gray-800 text-blue-500 w-4 h-4" />
                                Spoiler
                              </label>
                              <div className="flex gap-2">
                                <button onClick={() => setEditStates(prev => ({ ...prev, [activity.activity_id]: { ...prev[activity.activity_id], isEditing: false } }))} className="text-xs bg-gray-700 text-gray-300 px-3 py-1.5 rounded font-bold hover:bg-gray-600 transition">Abbrechen</button>
                                <button onClick={() => submitEditPost(activity.activity_id)} disabled={!editStates[activity.activity_id].text.trim()} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded font-bold hover:bg-blue-500 transition disabled:opacity-50">Speichern</button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-300 mt-2 break-words whitespace-pre-wrap leading-relaxed"><SpoilerText text={activity.text || activity.details} forceReveal={work && activity.episode_num != null && currentUserWorks[work.id.toString()] >= activity.episode_num} /></p>
                        )}
`;
content = content.replace(postBodyRegex, editablePostBody.trim());

// Replace generic delete button with edit/delete buttons
const delButtonRegex = /\{activity\.user_id === currentUserUid && \(\s*<button\s*onClick=\{\(\) => handleDeletePost\(activity\.activity_id\)\}\s*className="absolute top-3 right-3 text-gray-600 hover:text-red-500 transition z-10"\s*>\s*X\s*<\/button>\s*\)\}/;
const newButtons = `{activity.user_id === currentUserUid && (<div className="absolute top-3 right-3 flex gap-2 z-10"><button onClick={() => startEditingPost(activity)} className="text-[10px] text-blue-500 hover:text-blue-400 transition font-bold bg-blue-900/20 px-2 py-1 rounded">Bearbeiten</button><button onClick={() => handleDeletePost(activity.activity_id)} className="text-[10px] text-red-500 hover:text-red-400 transition font-bold bg-red-900/20 px-2 py-1 rounded">Löschen</button></div>)}`;
content = content.replace(delButtonRegex, newButtons);

fs.writeFileSync(file, content);