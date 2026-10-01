import { z } from "zod";

export const sendMessageSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(200, "Subject is too long"),
  message: z.string().min(1, "Message is required").max(5000, "Message is too long"),
  senderName: z.string().optional(),
  senderEmail: z.string().email("Invalid email address").optional(),
  senderPhone: z.string().optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
