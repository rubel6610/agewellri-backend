import { z } from "zod";

export const getNotificationsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(parseInt(val, 10), 100) : 20)),
  unreadOnly: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1"),
  readOnly: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1"),
  status: z.enum(["all", "unread", "read"]).optional(),
  type: z.string().optional(),
});

export const notificationIdParamSchema = z.object({
  id: z.string().min(1, "Notification ID is required"),
});
