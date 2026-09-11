import prisma from "../../lib/prisma";
import {
  CreateNotificationInput,
  GetNotificationsQuery,
  NotificationPriority,
  NotificationResponseItem,
} from "./notification.types";

/**
 * Determine logical frontend link based on notification type and metadata
 */
export function resolveNotificationLink(
  type: string,
  metadata?: Record<string, any> | null,
  role: "CLIENT" | "ADMIN" = "CLIENT",
): string {
  const isAdm = role === "ADMIN";

  switch (type) {
    case "PAYMENT_SUCCESS":
    case "PAYMENT_FAILED":
    case "INVOICE_ISSUED":
      return isAdm ? "/admin/billing" : "/dashboard/billing";

    case "RENEWAL_REMINDER":
    case "SUBSCRIPTION_RENEWED":
    case "SUBSCRIPTION_CANCELLED":
    case "SUBSCRIPTION_REACTIVATED":
      return isAdm ? "/admin/subscriptions" : "/dashboard/billing";

    case "AGREEMENT_SENT":
    case "AGREEMENT_SIGNED":
    case "AGREEMENT_EXECUTED":
      return isAdm ? "/admin/agreements" : "/dashboard/agreements";

    case "APPOINTMENT_CREATED":
    case "APPOINTMENT_RESCHEDULED":
    case "APPOINTMENT_CANCELLED":
    case "SPECIALIST_ASSIGNED":
    case "VISIT_COMPLETED":
      if (isAdm) {
        return metadata?.appointmentId
          ? `/admin/appointments/${metadata.appointmentId}`
          : "/admin/appointments";
      }
      return metadata?.appointmentId
        ? `/dashboard/appointments/${metadata.appointmentId}`
        : "/dashboard/appointments";

    case "REPORT_READY":
      if (isAdm) {
        return metadata?.reportId
          ? `/admin/reports/${metadata.reportId}`
          : "/admin/reports";
      }
      return metadata?.reportId
        ? `/dashboard/reports/${metadata.reportId}`
        : "/dashboard/reports";

    case "FAMILY_MEMBER_ADDED":
      return isAdm ? "/admin/clients" : "/dashboard/family-members";

    case "ACCOUNT_CREATED":
    case "ONBOARDING_COMPLETED":
      return isAdm
        ? metadata?.clientId
          ? `/admin/clients/${metadata.clientId}`
          : "/admin/clients"
        : "/dashboard";

    default:
      return isAdm ? "/admin/notifications" : "/dashboard";
  }
}

/**
 * Determine priority tag for notification visual treatment
 */
export function resolveNotificationPriority(
  type: string,
): NotificationPriority {
  switch (type) {
    case "PAYMENT_FAILED":
      return "CRITICAL";
    case "AGREEMENT_SENT":
    case "AGREEMENT_EXECUTED":
    case "SUBSCRIPTION_CANCELLED":
    case "SUBSCRIPTION_REACTIVATED":
    case "REPORT_READY":
    case "APPOINTMENT_CANCELLED":
      return "HIGH";
    case "PAYMENT_SUCCESS":
    case "INVOICE_ISSUED":
    case "APPOINTMENT_CREATED":
    case "APPOINTMENT_RESCHEDULED":
    case "SPECIALIST_ASSIGNED":
    case "VISIT_COMPLETED":
    case "RENEWAL_REMINDER":
    case "SUBSCRIPTION_RENEWED":
    case "FAMILY_MEMBER_ADDED":
      return "NORMAL";
    default:
      return "LOW";
  }
}

/**
 * Standardized single notification creation with duplicate protection
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<{ success: boolean; notificationId?: string }> {
  try {
    const { userId, type, title, message, metadata, idempotencyKey } = input;
    if (!userId) return { success: false };

    // Duplicate protection check
    const dedupKey = idempotencyKey || metadata?.idempotencyKey;
    if (dedupKey) {
      const existing = await (prisma.notification.findFirst as any)({
        where: {
          userId,
          type: type as any,
          metadata: {
            path: ["idempotencyKey"],
            equals: dedupKey,
          },
        },
      });

      if (existing) {
        return { success: true, notificationId: existing.id };
      }
    }

    const mergedMetadata = {
      ...(metadata || {}),
      ...(dedupKey ? { idempotencyKey: dedupKey } : {}),
    };

    const record = await (prisma.notification.create as any)({
      data: {
        userId,
        type: type as any,
        title,
        message,
        metadata: mergedMetadata,
      },
    });

    return { success: true, notificationId: record.id };
  } catch (error: any) {
    console.warn(
      "⚠️ [NOTIFICATION SERVICE] Failed to create in-app notification:",
      error.message,
    );
    return { success: false };
  }
}

/**
 * Batch notification creation
 */
export async function createNotifications(
  inputs: CreateNotificationInput[],
): Promise<{ success: boolean; count: number }> {
  let count = 0;
  for (const input of inputs) {
    const res = await createNotification(input);
    if (res.success) count++;
  }
  return { success: true, count };
}

/**
 * Helper to dispatch operational alerts to all active administrators
 */
export async function notifyAdmins(
  data: Omit<CreateNotificationInput, "userId">,
): Promise<{ success: boolean; notifiedCount: number }> {
  try {
    const adminUsers = await prisma.user.findMany({
      where: {
        role: "ADMIN",
        status: "ACTIVE",
      },
      select: { id: true },
    });

    if (!adminUsers || adminUsers.length === 0) {
      return { success: true, notifiedCount: 0 };
    }

    const promises = adminUsers.map((admin) =>
      createNotification({
        userId: admin.id,
        ...data,
      }),
    );

    const results = await Promise.all(promises);
    const successCount = results.filter((r) => r.success).length;
    return { success: true, notifiedCount: successCount };
  } catch (error: any) {
    console.warn(
      "⚠️ [NOTIFICATION SERVICE] Failed to notify admins:",
      error.message,
    );
    return { success: false, notifiedCount: 0 };
  }
}

/**
 * Helper to dispatch notifications to client and authorized family members
 */
export async function notifyClientAndFamily(
  clientId: string,
  data: Omit<CreateNotificationInput, "userId">,
  permissionType?: "billingAccess" | "reportAccess" | "portalAccess",
): Promise<{ success: boolean; recipientCount: number }> {
  try {
    const client = await (prisma.client.findUnique as any)({
      where: { id: clientId },
      include: {
        user: { select: { id: true } },
        familyMembers: {
          where: { invitationStatus: "ACCEPTED" },
          include: { user: { select: { id: true } } },
        },
      },
    });

    if (!client) return { success: false, recipientCount: 0 };

    const recipientUserIds = new Set<string>();

    // 1. Primary Client User
    if (client.user?.id) {
      recipientUserIds.add(client.user.id);
    }

    // 2. Authorized Family Members with required permission
    if (client.familyMembers && client.familyMembers.length > 0) {
      for (const fm of client.familyMembers) {
        if (!fm.user?.id) continue;

        let hasAccess = true;
        if (permissionType === "billingAccess") {
          hasAccess = Boolean(fm.billingAccess);
        } else if (permissionType === "reportAccess") {
          hasAccess = Boolean(fm.reportAccess);
        } else if (permissionType === "portalAccess") {
          hasAccess = Boolean(fm.portalAccess);
        }

        if (hasAccess) {
          recipientUserIds.add(fm.user.id);
        }
      }
    }

    let sentCount = 0;
    for (const uId of Array.from(recipientUserIds)) {
      const res = await createNotification({
        userId: uId,
        ...data,
      });
      if (res.success) sentCount++;
    }

    return { success: true, recipientCount: sentCount };
  } catch (error: any) {
    console.warn(
      "⚠️ [NOTIFICATION SERVICE] Failed to notify client and family:",
      error.message,
    );
    return { success: false, recipientCount: 0 };
  }
}

/**
 * Get paginated notifications for the authenticated user
 */
export async function getUserNotifications(
  userId: string,
  userRole: "CLIENT" | "ADMIN",
  query: GetNotificationsQuery,
) {
  const page = query.page && query.page > 0 ? query.page : 1;
  const limit = query.limit && query.limit > 0 ? query.limit : 20;
  const skip = (page - 1) * limit;

  const where: any = { userId };

  if (query.unreadOnly) {
    where.readAt = null;
  }

  if (query.type) {
    where.type = query.type;
  }

  const [notifications, total, unreadCount] = await Promise.all([
    (prisma.notification.findMany as any)({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  const formattedItems: NotificationResponseItem[] = notifications.map(
    (n: any) => ({
      id: n.id,
      userId: n.userId,
      type: n.type,
      title: n.title,
      message: n.message,
      metadata: n.metadata || null,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      isRead: Boolean(n.readAt),
      createdAt: n.createdAt.toISOString(),
      link: resolveNotificationLink(n.type, n.metadata, userRole),
      priority: resolveNotificationPriority(n.type),
    }),
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    notifications: formattedItems,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages,
    },
    unreadCount,
  };
}

/**
 * Get unread notification count for authenticated user
 */
export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: {
      userId,
      readAt: null,
    },
  });
}

/**
 * Mark a single notification as read (with user ownership enforcement)
 */
export async function markAsRead(
  userId: string,
  notificationId: string,
): Promise<{ success: boolean }> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification || notification.userId !== userId) {
    throw new Error("Notification not found or access denied.");
  }

  if (!notification.readAt) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  return { success: true };
}

/**
 * Mark all notifications as read for the authenticated user
 */
export async function markAllAsRead(
  userId: string,
): Promise<{ success: boolean; updatedCount: number }> {
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });

  return { success: true, updatedCount: result.count };
}

/**
 * Delete a single notification (with user ownership enforcement)
 */
export async function deleteNotification(
  userId: string,
  notificationId: string,
): Promise<{ success: boolean }> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification || notification.userId !== userId) {
    throw new Error("Notification not found or access denied.");
  }

  await prisma.notification.delete({
    where: { id: notificationId },
  });

  return { success: true };
}
