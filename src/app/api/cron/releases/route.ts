import { NextResponse } from "next/server";
import { adminDb, adminMessaging } from "@/lib/firebase-admin";

const GET_RECENT_RELEASES = `
  query($greater: Int, $lesser: Int) {
    Page(page: 1, perPage: 50) {
      airingSchedules(airingAt_greater: $greater, airingAt_lesser: $lesser, sort: TIME_DESC) {
        mediaId
        episode
        media {
          title {
            romaji
          }
        }
      }
    }
  }
`;

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check last hour
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;

    const fetchPromise = fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: GET_RECENT_RELEASES,
        variables: { greater: oneHourAgo, lesser: now },
      }),
    });

    const response = await fetchPromise;
    const json = await response.json();
    const schedules = json.data?.Page?.airingSchedules || [];

    if (schedules.length === 0) {
      return NextResponse.json({ message: "No new releases in the last hour" });
    }

    const releasedMediaIds = schedules.map((s: any) => s.mediaId.toString());

    // Get all users who have notifications enabled for releases
    const usersSnap = await adminDb.collection("users").get();
    
    let notificationsSent = 0;
    
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const settings = userData.notification_settings || { releases: true };
      const tokens = userData.fcm_tokens || [];

      if (settings.releases && tokens.length > 0) {
        // Find if this user tracks any of the newly released media
        const userWorksRef = adminDb.collection("user_works");
        const querySnap = await userWorksRef.where("user_id", "==", userDoc.id).get();
        
        const userLibraryIds = querySnap.docs.map(d => d.data().work_id);
        
        for (const schedule of schedules) {
          if (userLibraryIds.includes(schedule.mediaId.toString())) {
            // User tracks this anime, and a new episode just dropped!
            const payload = {
              notification: {
                title: "Neue Folge verfügbar!",
                body: `Episode ${schedule.episode} von ${schedule.media.title.romaji} ist jetzt online.`,
              },
              data: {
                link: `/work/${schedule.mediaId}`,
                type: "releases",
              },
              tokens,
            };

            await adminMessaging.sendMulticast(payload);
            notificationsSent++;
          }
        }
      }
    }

    return NextResponse.json({ success: true, releasedMediaIds, notificationsSent });
  } catch (error: any) {
    console.error("Cron Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
