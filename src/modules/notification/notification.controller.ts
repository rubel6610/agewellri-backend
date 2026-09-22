import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import * as notificationService from "./notification.service";
import {
  getNotificationsQuerySchema,
  notificationIdParamSchema,
} from "./notification.validation";

/**
 * GET /api/v1/notifications
 * Returns paginated notifications for the authenticated user.
 */
export async function handleGetNotifications(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ success: false, message: "Authentication required." });
      return;
    }

    const parseResult = getNotificationsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: "Invalid query parameters.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await notificationService.getUserNotifications(
      req.user.id,
      req.user.role as any,
      parseResult.data,
    );

    res.status(200).json({
      success: true,
      message: "Notifications retrieved successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/notifications/unread-count
 * Returns total unread notification count for the authenticated user.
 */
export async function handleGetUnreadCount(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ success: false, message: "Authentication required." });
      return;
    }

    const unreadCount = await notificationService.getUnreadCount(req.user.id);

    res.status(200).json({
      success: true,
      message: "Unread count retrieved successfully.",
      data: { unreadCount },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/v1/notifications/:id/read
 * Marks a specific notification as read.
 */
export async function handleMarkAsRead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ success: false, message: "Authentication required." });
      return;
    }

    const parseResult = notificationIdParamSchema.safeParse(req.params);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: "Invalid notification ID.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await notificationService.markAsRead(
      req.user.id,
      parseResult.data.id,
    );

    res.status(200).json({
      success: true,
      message: "Notification marked as read.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/v1/notifications/read-all
 * Marks all notifications as read for the authenticated user.
 */
export async function handleMarkAllAsRead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ success: false, message: "Authentication required." });
      return;
    }

    const result = await notificationService.markAllAsRead(req.user.id);

    res.status(200).json({
      success: true,
      message: "All notifications marked as read.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/v1/notifications/:id
 * Deletes a specific notification belonging to the authenticated user.
 */
export async function handleDeleteNotification(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ success: false, message: "Authentication required." });
      return;
    }

    const parseResult = notificationIdParamSchema.safeParse(req.params);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: "Invalid notification ID.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await notificationService.deleteNotification(
      req.user.id,
      parseResult.data.id,
    );

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
