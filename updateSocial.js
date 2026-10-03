const fs = require('fs');
const file = 'src/components/ui/SocialComponents.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace('deleteActivityComment, addActivityComment, getActivityComments', 'deleteActivityComment, addActivityComment, getActivityComments, editActivityComment');

content = content.replace('export function SpoilerText({ text }: { text?: string }) {', 'export function SpoilerText({ text, forceReveal }: { text?: string, forceReveal?: boolean }) {');
content = content.replace(/return <InlineSpoiler key=\{i\} content=\{content\} \/>;/g, 'return <InlineSpoiler key={i} content={content} forceReveal={forceReveal} />;');
content = content.replace('function InlineSpoiler({ content }: { content: string }) {', 'function InlineSpoiler({ content, forceReveal }: { content: string, forceReveal?: boolean }) {');
content = content.replace('const [revealed, setRevealed] = useState(false);', 'const [revealed, setRevealed] = useState(false);\n  const isRevealed = forceReveal || revealed;');
content = content.replace(/className=\{\`cursor-pointer transition-colors duration-200 px-1 rounded \$\{revealed \? 'bg-gray-800 text-white' : 'bg-black text-black select-none'\}\`\}/, 'className={`transition-colors duration-200 px-1 rounded ${isRevealed ? "bg-gray-800 text-white" : "bg-black text-black select-none cursor-pointer"}`}');
content = content.replace(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); setRevealed\(!revealed\); \}\}/, 'onClick={(e) => { e.stopPropagation(); if (!forceReveal) setRevealed(!revealed); }}');
content = content.replace(/title=\{revealed \? "" : "Klicken zum Aufdecken"\}/, 'title={isRevealed ? "" : "Klicken zum Aufdecken"}');

content = content.replace(/export function SpoilerProtectedThread\(\{(.*?)\} : any\)/, 'export function SpoilerProtectedThread({$1} : any)'); 
content = content.replace('userWorkIds}: any)', 'currentUserWorks}: any)');
content = content.replace('const isInLibrary = userWorkIds?.has(work?.id?.toString()) || false;', 'const isInLibrary = currentUserWorks ? (work?.id?.toString() in currentUserWorks) : false;\n              const hasSeen = isInLibrary && currentUserWorks[work!.id.toString()] >= activity.episode_num;');
content = content.replace('<SpoilerText text={activity.text} />', '<SpoilerText text={activity.text} forceReveal={currentUserWorks && work?.id ? currentUserWorks[work.id.toString()] >= activity.episode_num : false} />');
content = content.replace('<CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} commentCount={activity.comments_count || 0} />', '<CommentSection activityId={activity.activity_id} userProfiles={userProfiles} currentUserUid={currentUserUid} commentCount={activity.comments_count || 0} forceReveal={hasSeen} />');

content = content.replace('export function CommentSection({ activityId, userProfiles, currentUserUid, commentCount: initialCount = 0 }: { activityId: string, userProfiles: Record<string, any>, currentUserUid?: string, commentCount?: number }) {', 'export function CommentSection({ activityId, userProfiles, currentUserUid, commentCount: initialCount = 0, forceReveal }: { activityId: string, userProfiles: Record<string, any>, currentUserUid?: string, commentCount?: number, forceReveal?: boolean }) {');

const handleEditCode = "    const handleEdit = async (commentId: string, newText: string) => {\n      try {\n        await editActivityComment(commentId, newText);\n        setComments(prev => prev.map(c => c.comment_id === commentId ? { ...c, text: newText } : c));\n      } catch (e) {\n        console.error(e);\n      }\n    };\n";
content = content.replace('const handleDelete = async (commentId: string) => {', handleEditCode + '    const handleDelete = async (commentId: string) => {');

content = content.replace('const CommentNode = ({ node, level = 0 }: { node: any, level?: number }) => {', 'const CommentNode = ({ node, level = 0 }: { node: any, level?: number }) => {\n      const [isEditing, setIsEditing] = useState(false);\n      const [editText, setEditText] = useState(node.text.startsWith("||") && node.text.endsWith("||") ? node.text.slice(2, -2) : node.text);\n      const [editIsSpoiler, setEditIsSpoiler] = useState(node.text.startsWith("||") && node.text.endsWith("||"));\n\n      const submitEdit = async (e: React.FormEvent) => {\n        e.preventDefault();\n        const final = editIsSpoiler ? `||${editText.trim()}||` : editText.trim();\n        await handleEdit(node.comment_id, final);\n        setIsEditing(false);\n      };');

content = content.replace('const [replyText, setReplyText] = useState("");', 'const [replyText, setReplyText] = useState(""); const [replyIsSpoiler, setReplyIsSpoiler] = useState(false);');
content = content.replace('const prevText = replyText.trim();', 'const prevText = replyIsSpoiler ? `||${replyText.trim()}||` : replyText.trim();');
content = content.replace('<form onSubmit={handleReply} className="flex gap-2 mt-2 max-w-sm">', '<form onSubmit={handleReply} className="flex gap-2 mt-2 max-w-sm items-center">');
content = content.replace('<button disabled={isReplying || !replyText.trim()} type="submit"', '<label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer"><input type="checkbox" checked={replyIsSpoiler} onChange={e => setReplyIsSpoiler(e.target.checked)} className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 w-3 h-3" /> Spoiler</label><button disabled={isReplying || !replyText.trim()} type="submit"');

const editFormStr = "              {isEditing ? (\n                <form onSubmit={submitEdit} className=\"flex gap-2 mt-2 items-center flex-wrap\">\n                  <input type=\"text\" value={editText} onChange={e => setEditText(e.target.value)} className=\"flex-1 bg-[#1a1d24] border border-gray-700 rounded px-2 py-1 text-[10px] text-white focus:border-blue-500 outline-none\" />\n                  <label className=\"flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer\"><input type=\"checkbox\" checked={editIsSpoiler} onChange={e => setEditIsSpoiler(e.target.checked)} className=\"rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 w-3 h-3\" /> Spoiler</label>\n                  <button type=\"submit\" disabled={!editText.trim()} className=\"text-[10px] bg-blue-600 text-white px-2 py-1 rounded font-bold\">Speichern</button>\n                  <button type=\"button\" onClick={() => setIsEditing(false)} className=\"text-[10px] bg-gray-700 text-gray-300 px-2 py-1 rounded font-bold\">Abbrechen</button>\n                </form>\n              ) : (\n                <>\n                  <p className=\"text-gray-300 mt-0.5 break-words leading-relaxed\"><SpoilerText text={node.text} forceReveal={forceReveal} /></p>\n                  \n                  <div className=\"flex items-center gap-3 mt-1\">\n                    {currentUserUid && (\n                      <button onClick={(e) => { e.stopPropagation(); setReplyOpen(!replyOpen); }} className=\"text-[10px] text-gray-500 hover:text-gray-300 transition font-bold\">\n                        Antworten\n                      </button>\n                    )}\n                    {node.user_id === currentUserUid && (\n                      <>\n                        <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} className=\"text-[10px] text-blue-500/50 hover:text-blue-500 transition font-bold\">\n                          Bearbeiten\n                        </button>\n                        <button onClick={(e) => { e.stopPropagation(); handleDelete(node.comment_id); }} className=\"text-[10px] text-red-500/50 hover:text-red-500 transition font-bold\">\n                          Löschen\n                        </button>\n                      </>\n                    )}\n                  </div>\n                </>\n              )}";

const oldCommentBody = `              <p className="text-gray-300 mt-0.5 break-words leading-relaxed"><SpoilerText text={node.text} /></p>
              
              <div className="flex items-center gap-3 mt-1">
                {currentUserUid && (
                  <button onClick={(e) => { e.stopPropagation(); setReplyOpen(!replyOpen); }} className="text-[10px] text-gray-500 hover:text-gray-300 transition font-bold">
                    Antworten
                  </button>
                )}
                {node.user_id === currentUserUid && (
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(node.comment_id); }} className="text-[10px] text-red-500/50 hover:text-red-500 transition font-bold">
                    Löschen
                  </button>
                )}
              </div>`;

content = content.replace(oldCommentBody, editFormStr);
fs.writeFileSync(file, content);