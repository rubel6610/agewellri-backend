import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  handleGetNotifications,
  handleGetUnreadCount,
  handleMarkAsRead,
  handleMarkAllAsRead,
  handleDeleteNotification,
} from "./notification.controller";

const router = Router();

// All notification routes require authentication
router.use(authenticate);

router.get("/", handleGetNotifications);
router.get("/unread-count", handleGetUnreadCount);
router.patch("/read-all", handleMarkAllAsRead);
router.patch("/:id/read", handleMarkAsRead);
router.delete("/:id", handleDeleteNotification);

export default router;
