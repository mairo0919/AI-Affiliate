import type {
  ResearchNotificationChannelType,
  ResearchNotificationEventType,
} from "@ai-affiliate/database";

export interface PreparedResearchNotification {
  id: string;
  eventType: ResearchNotificationEventType;
  channelType: ResearchNotificationChannelType;
  title: string;
  message: string;
  payload: Record<string, unknown>;
}

export interface NotificationSendResult {
  ok: boolean;
  skipped?: boolean;
  httpStatus?: number;
  errorType?: string;
  errorMessage?: string;
  retryable?: boolean;
}

export interface ResearchNotificationProvider {
  readonly channelType: ResearchNotificationChannelType;
  send(notification: PreparedResearchNotification): Promise<NotificationSendResult>;
}
