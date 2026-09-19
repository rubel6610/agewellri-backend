import { Response } from "express";
import { formatToHumanReadable } from "../middlewares/error.middleware";

export interface ApiResponse<T> {
  statusCode: number;
  success: boolean;
  message?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPage?: number;
    [key: string]: unknown;
  };
  data?: T | null;
  errors?: unknown;
}

/**
 * Reusable utility to send standardized HTTP JSON responses across controllers.
 * Automatically sanitizes any technical/database errors into clean human-readable text.
 */
export function sendResponse<T>(res: Response, data: ApiResponse<T>): void {
  const cleanMessage =
    data.message !== undefined
      ? data.success === false
        ? formatToHumanReadable(data.message)
        : data.message
      : undefined;

  const responsePayload: ApiResponse<T> = {
    statusCode: data.statusCode,
    success: data.success,
    message: cleanMessage,
    meta: data.meta,
    data: data.data !== undefined ? data.data : null,
    errors: data.errors,
  };

  // Remove undefined fields for clean JSON output
  if (responsePayload.meta === undefined) delete responsePayload.meta;
  if (responsePayload.errors === undefined) delete responsePayload.errors;
  if (responsePayload.message === undefined) delete responsePayload.message;

  res.status(data.statusCode).json(responsePayload);
}

export default sendResponse;
