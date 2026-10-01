import { Request, Response } from "express";
import { sendMessageSchema } from "./contact.validation";
import * as contactService from "./contact.service";

/**
 * POST /api/v1/contact/send
 * Sends direct inquiry email to admin
 */
export async function handleSendContactMessage(req: Request, res: Response): Promise<void> {
  try {
    const validated = sendMessageSchema.parse(req.body);
    const userId = (req as any).user?.id || null;

    const result = await contactService.sendContactMessage(userId, validated);

    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (err: any) {
    if (err.name === "ZodError") {
      res.status(400).json({
        success: false,
        message: err.errors?.[0]?.message || "Validation error",
        errors: err.errors,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: err.message || "Failed to send message",
    });
  }
}
