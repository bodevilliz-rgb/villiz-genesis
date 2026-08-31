import { createAdminClient } from "@/infrastructure/supabase/admin-client";

export type CampaignAwoJobView = {
  id: string;
  campaignId: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  totalPosts: number;
  completedPosts: number;
  failedPosts: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type Row = {
  id: string;
  campaign_id: string;
  status: CampaignAwoJobView["status"];
  total_posts: number;
  completed_posts: number;
  failed_posts: number;
  last_error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type QueryResult = { data: Row | null; error: { message: string } | null };
type Reader = {
  from: (table: "awo_campaign_jobs") => {
    select: (columns: string) => {
      eq: (column: "campaign_id", value: string) => {
        order: (column: "created_at", options: { ascending: boolean }) => {
          limit: (count: number) => { maybeSingle: () => PromiseLike<QueryResult> };
        };
      };
    };
  };
};

export async function getLatestCampaignAwoJob(campaignId: string): Promise<CampaignAwoJobView | null> {
  const db = createAdminClient() as unknown as Reader;
  const { data, error } = await db
    .from("awo_campaign_jobs")
    .select("id,campaign_id,status,total_posts,completed_posts,failed_posts,last_error,created_at,started_at,finished_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    campaignId: data.campaign_id,
    status: data.status,
    totalPosts: data.total_posts,
    completedPosts: data.completed_posts,
    failedPosts: data.failed_posts,
    lastError: data.last_error,
    createdAt: data.created_at,
    startedAt: data.started_at,
    finishedAt: data.finished_at,
  };
}
