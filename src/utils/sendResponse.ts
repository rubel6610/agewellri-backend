import { Response } from "express";

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
 */
export function sendResponse<T>(res: Response, data: ApiResponse<T>): void {
  const responsePayload: ApiResponse<T> = {
    statusCode: data.statusCode,
    success: data.success,
    message: data.message,
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
