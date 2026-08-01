export interface NotificationRecord {
  id: string;
  organisationId: string;
  profileId: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationRepository {
  createNotification(input: {
    organisationId: string;
    profileId: string;
    type: string;
    message: string;
  }): Promise<NotificationRecord>;

  listNotifications(organisationId: string, profileId: string): Promise<NotificationRecord[]>;
  markAsRead(organisationId: string, notificationId: string, profileId: string): Promise<void>;
}
