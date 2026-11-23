import { redirect } from "next/navigation";

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ activity_id?: string; comment_id?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.activity_id) query.set("activity_id", params.activity_id);
  if (params.comment_id) query.set("comment_id", params.comment_id);

  const qs = query.toString();
  redirect(qs ? `/?${qs}` : "/");
}
