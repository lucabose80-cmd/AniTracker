import { db } from "@/lib/firebase";
import { collection, doc, setDoc, getDocs, query, where, updateDoc, getDoc } from "firebase/firestore";
import { Comment } from "@/types/database";

export async function addComment(
  work_id: string,
  author_uid: string,
  author_name: string,
  author_avatar: string,
  text: string,
  is_spoiler: boolean,
  parent_comment_id: string | null = null
): Promise<Comment | null> {
  if (!db) return null;

  const commentsRef = collection(db, "comments");
  const newDocRef = doc(commentsRef);
  const comment_id = newDocRef.id;
  const timestamp = new Date().toISOString();

  const newComment: Comment = {
    comment_id,
    work_id,
    author_uid,
    author_name,
    author_avatar,
    text,
    timestamp,
    is_spoiler,
    parent_comment_id,
    upvotes: [],
    downvotes: []
  };

  await setDoc(newDocRef, newComment);

  // Send Notification if this is a reply
  if (parent_comment_id && author_uid) {
    const parentDoc = await getDoc(doc(db, "comments", parent_comment_id));
    if (parentDoc.exists()) {
      const parentData = parentDoc.data() as Comment;
      if (parentData.author_uid !== author_uid) {
        fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetUserId: parentData.author_uid,
            title: "Neue Antwort",
            body: `${author_name} hat auf deinen Kommentar geantwortet.`,
            type: "replies",
            link: `/work/${work_id}`
          })
        }).catch(console.error);
      }
    }
  }

  return newComment;
}

export async function getCommentsForWork(work_id: string): Promise<Comment[]> {
  if (!db) return [];
  
  const commentsRef = collection(db, "comments");
  const q = query(
    commentsRef, 
    where("work_id", "==", work_id)
  );
  
  const snapshot = await getDocs(q);
  const comments: Comment[] = [];
  snapshot.forEach((doc) => {
    comments.push(doc.data() as Comment);
  });
  
  // Sort descending by timestamp
  return comments.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function voteComment(comment_id: string, uid: string, voteType: "UP" | "DOWN" | "NONE") {
  if (!db) return;
  const docRef = doc(db, "comments", comment_id);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return;
  
  const comment = docSnap.data() as Comment;
  
  // Remove existing votes from this user
  let upvotes = comment.upvotes.filter(id => id !== uid);
  let downvotes = comment.downvotes.filter(id => id !== uid);
  
  if (voteType === "UP") {
    upvotes.push(uid);
  } else if (voteType === "DOWN") {
    downvotes.push(uid);
  }
  
  await updateDoc(docRef, {
    upvotes,
    downvotes
  });

  // Send Notification for UPVOTE
  if (voteType === "UP" && uid !== comment.author_uid) {
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: comment.author_uid,
        title: "Neuer Like",
        body: `Jemand hat deinen Kommentar gelikt!`,
        type: "likes",
        link: `/work/${comment.work_id}`
      })
    }).catch(console.error);
  }
}
