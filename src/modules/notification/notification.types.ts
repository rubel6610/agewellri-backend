export type NotificationTypeValue =
  | "ACCOUNT_CREATED"
  | "AGREEMENT_SENT"
  | "AGREEMENT_SIGNED"
  | "AGREEMENT_EXECUTED"
  | "ONBOARDING_COMPLETED"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "INVOICE_ISSUED"
  | "APPOINTMENT_CREATED"
  | "APPOINTMENT_RESCHEDULED"
  | "APPOINTMENT_CANCELLED"
  | "SPECIALIST_ASSIGNED"
  | "VISIT_COMPLETED"
  | "REPORT_READY"
  | "RENEWAL_REMINDER"
  | "SUBSCRIPTION_RENEWED"
  | "SUBSCRIPTION_CANCELLED"
  | "SUBSCRIPTION_REACTIVATED"
  | "FAMILY_MEMBER_ADDED";

export type NotificationPriority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationTypeValue | string;
  title: string;
  message: string;
  metadata?: Record<string, any> | null;
  idempotencyKey?: string;
}

export interface GetNotificationsQuery {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
  readOnly?: boolean;
  status?: "all" | "unread" | "read";
  type?: string;
}

export interface NotificationResponseItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, any> | null;
  readAt: string | null;
  isRead: boolean;
  createdAt: string;
  link?: string;
  priority?: NotificationPriority;
}
