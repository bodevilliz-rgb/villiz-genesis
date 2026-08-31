import { createAdminClient } from "@/infrastructure/supabase/admin-client";
import type { CampaignPlatform } from "@/core/domain/entities/campaign";

export type CampaignScheduleSlotView = {
  id: string;
  campaignId: string;
  assetId: string | null;
  draftId: string | null;
  weekNumber: number;
  platform: CampaignPlatform;
  scheduledDate: string;
  scheduledTime: string;
  timezone: string;
  status: string;
};

type Row = { id:string; campaign_id:string; asset_id:string|null; draft_id:string|null; week_number:number; platform:CampaignPlatform; scheduled_date:string; scheduled_time:string; timezone:string; status:string };
type Reader = { from:(table:"campaign_schedule_slots")=>{ select:(columns:string)=>{ eq:(column:"campaign_id",value:string)=>{ order:(column:"week_number",opts:{ascending:boolean})=>PromiseLike<{data:Row[]|null;error:{message:string}|null}> } } } };

export async function getCampaignSchedule(campaignId: string): Promise<CampaignScheduleSlotView[]> {
  const db = createAdminClient() as unknown as Reader;
  const { data, error } = await db.from("campaign_schedule_slots").select("id,campaign_id,asset_id,draft_id,week_number,platform,scheduled_date,scheduled_time,timezone,status").eq("campaign_id", campaignId).order("week_number", { ascending: true });
  if (error) return [];
  return (data ?? []).map(row => ({ id:row.id, campaignId:row.campaign_id, assetId:row.asset_id, draftId:row.draft_id, weekNumber:row.week_number, platform:row.platform, scheduledDate:row.scheduled_date, scheduledTime:row.scheduled_time, timezone:row.timezone, status:row.status }));
}
