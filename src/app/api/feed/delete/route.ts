import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { adminDb } = await import("@/lib/firebase-admin");
    const { activityId, userId } = await req.json();

    if (!activityId || !userId) {
      return NextResponse.json({ error: "Fehlende Parameter" }, { status: 400 });
    }

    // 1. Find the activity document
    let actDocRef = adminDb.collection("activity_feed").doc(activityId);
    let actSnap = await actDocRef.get();

    if (!actSnap.exists) {
      const qSnap = await adminDb
        .collection("activity_feed")
        .where("activity_id", "==", activityId)
        .limit(1)
        .get();

      if (qSnap.empty) {
        return NextResponse.json({ error: "Aktivität nicht gefunden" }, { status: 404 });
      }
      actDocRef = qSnap.docs[0].ref;
      actSnap = qSnap.docs[0];
    }

    const actData = actSnap.data()!;

    // 2. Ownership check
    if (actData.user_id !== userId) {
      return NextResponse.json(
        { error: "Nur der Ersteller kann diesen Beitrag löschen." },
        { status: 403 }
      );
    }

    // 3. Comments check
    const commentsSnap = await adminDb
      .collection("activity_comments")
      .where("activity_id", "==", activityId)
      .limit(1)
      .get();

    if (!commentsSnap.empty || (actData.comments_count && actData.comments_count > 0)) {
      return NextResponse.json(
        { error: "Dieser Beitrag kann nicht mehr gelöscht werden, da bereits Kommentare existieren." },
        { status: 400 }
      );
    }

    // 4. Delete the activity from Firestore
    await actDocRef.delete();

    // 5. Delete related notifications across all users
    try {
      const notifsSnap = await adminDb
        .collection("notifications")
        .where("activity_id", "==", activityId)
        .get();

      if (!notifsSnap.empty) {
        const batch = adminDb.batch();
        notifsSnap.docs.forEach((d: any) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (nErr) {
      console.warn("Failed to delete related notifications:", nErr);
    }

    // 6. Revert check-in if this was an EPISODE_THREAD
    if (actData.action_type === "EPISODE_THREAD" && actData.work_id && actData.episode_num != null) {
      try {
        const userWorkRef = adminDb
          .collection("user_works")
          .doc(`${userId}_${actData.work_id}`);
        const userWorkSnap = await userWorkRef.get();

        if (userWorkSnap.exists) {
          const uData = userWorkSnap.data()!;
          if (uData.current_episode === actData.episode_num) {
            const revertedEp = Math.max(0, actData.episode_num - 1);
            await userWorkRef.update({ current_episode: revertedEp });
          }
        }
      } catch (wErr) {
        console.warn("Failed to revert user_work current_episode:", wErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("API delete activity error:", err);
    return NextResponse.json(
      { error: err?.message || "Fehler beim Löschen des Beitrags" },
      { status: 500 }
    );
  }
}
