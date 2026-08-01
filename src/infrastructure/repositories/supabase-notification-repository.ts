import "server-only";
import type { NotificationRepository, NotificationRecord } from "@/core/application/ports/notification-port";
import type { GenesisClient } from "../supabase/server-client";
import { translateError } from "./errors";

type NotificationRow = {
  id: string;
  organisation_id: string;
  profile_id: string;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

function toNotificationRecord(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    profileId: row.profile_id,
    type: row.type,
    message: row.message,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

export class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private readonly client: GenesisClient) {}

  async createNotification(input: {
    organisationId: string;
    profileId: string;
    type: string;
    message: string;
  }): Promise<NotificationRecord> {
    const result = await this.client
      .from("notifications")
      .insert({
        organisation_id: input.organisationId,
        profile_id: input.profileId,
        type: input.type,
        message: input.message,
        is_read: false,
      })
      .select()
      .single();

    if (result.error) translateError(result.error, "Notification creation");
    return toNotificationRecord(result.data as unknown as NotificationRow);
  }

  async listNotifications(organisationId: string, profileId: string): Promise<NotificationRecord[]> {
    const result = await this.client
      .from("notifications")
      .select()
      .eq("organisation_id", organisationId)
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });

    if (result.error) translateError(result.error, "Notification listing");
    return (result.data ?? []).map((row) => toNotificationRecord(row as unknown as NotificationRow));
  }

  async markAsRead(organisationId: string, notificationId: string, profileId: string): Promise<void> {
    const result = await this.client
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId)
      .eq("organisation_id", organisationId)
      .eq("profile_id", profileId);

    if (result.error) translateError(result.error, "Mark notification as read");
  }
}
