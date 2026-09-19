import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/app-error";

interface FormattedError {
  statusCode: number;
  message: string;
  errors?: unknown;
}

/**
 * Format any raw internal error string into clean, human-readable, polite text.
 */
export function formatToHumanReadable(raw: string): string {
  if (!raw || typeof raw !== "string") {
    return "An unexpected error occurred. Please try again.";
  }

  const trimmed = raw.trim();

  // Detect Prisma validation / invocation / unknown field errors
  if (
    trimmed.includes("invocation:") ||
    trimmed.includes("Invalid `prisma.") ||
    trimmed.includes("Unknown field") ||
    trimmed.includes("Unknown argument")
  ) {
    const unknownFieldMatch = trimmed.match(/Unknown field `?([a-zA-Z0-9_]+)`?/i);
    if (unknownFieldMatch) {
      return `Invalid request parameter or unrecognized field: "${unknownFieldMatch[1]}". Please verify your request data.`;
    }
    const unknownArgMatch = trimmed.match(/Unknown argument `?([a-zA-Z0-9_]+)`?/i);
    if (unknownArgMatch) {
      return `Unrecognized parameter: "${unknownArgMatch[1]}". Please check your request parameters.`;
    }
    const argumentMatch = trimmed.match(/Argument `?([a-zA-Z0-9_]+)`? is missing/i);
    if (argumentMatch) {
      return `Required field "${argumentMatch[1]}" is missing. Please provide all required information.`;
    }
    return "The submitted request contains invalid or unrecognized parameters. Please review your input and try again.";
  }

  // Detect MongoDB ObjectId conversion errors
  if (
    trimmed.includes("Argument `id` is missing") ||
    trimmed.includes("Malformed ObjectId") ||
    trimmed.includes("must be a single String of 12 bytes or a string of 24 hex characters")
  ) {
    return "Invalid resource identifier format. Please provide a valid ID.";
  }

  // Detect stack traces or node_modules paths
  if (trimmed.includes("node_modules") || trimmed.includes("    at ") || trimmed.includes("Error:\n")) {
    return "An unexpected server error occurred while processing your request. Please try again later.";
  }

  // Clean out any remaining raw backticks or technical prefixes
  return trimmed.replace(/^Error:\s*/i, "").trim();
}

/**
 * Format Prisma known request errors into clean human-readable messages.
 */
function handlePrismaKnownError(err: Prisma.PrismaClientKnownRequestError): FormattedError {
  switch (err.code) {
    case "P2002": {
      // Unique constraint violation
      let targetField = "value";
      if (err.meta?.target) {
        if (Array.isArray(err.meta.target)) {
          targetField = err.meta.target.join(", ");
        } else if (typeof err.meta.target === "string") {
          targetField = err.meta.target;
        }
      } else if (err.meta?.driverException) {
        const driverMsg = String(err.meta.driverException);
        const match = driverMsg.match(/index:\s*([a-zA-Z0-9_]+)/i);
        if (match) targetField = match[1];
      }

      // Clean up common target names (e.g. User_email_key -> email)
      targetField = targetField
        .replace(/^[A-Za-z]+_([A-Za-z0-9]+)_key$/i, "$1")
        .replace(/_key$/i, "")
        .replace(/([A-Z])/g, " $1")
        .toLowerCase()
        .trim();

      return {
        statusCode: 409,
        message: `A record with this ${targetField} already exists. Please use a different value.`,
        errors: { [targetField]: "Value already taken" },
      };
    }

    case "P2025": {
      // Record not found
      return {
        statusCode: 404,
        message: (err.meta?.cause as string) || "The requested record was not found or has been removed.",
      };
    }

    case "P2003": {
      // Foreign key constraint failed
      const field = (err.meta?.field_name as string) || "associated record";
      return {
        statusCode: 400,
        message: `Referenced ${field} does not exist or cannot be linked.`,
      };
    }

    case "P2014": {
      // Relation violation
      return {
        statusCode: 400,
        message: "This action cannot be completed because related records depend on it.",
      };
    }

    case "P2000": {
      // Value too long
      return {
        statusCode: 400,
        message: "The provided value is too long for one or more fields.",
      };
    }

    default:
      return {
        statusCode: 400,
        message: "A database operation error occurred. Please verify your submitted data.",
      };
  }
}

/**
 * Format Prisma validation errors into concise, human-readable messages.
 */
function handlePrismaValidationError(err: Prisma.PrismaClientValidationError): FormattedError {
  const rawMsg = err.message || "";
  const humanMsg = formatToHumanReadable(rawMsg);

  return {
    statusCode: 400,
    message: humanMsg || "The request contains invalid or incomplete parameters. Please review your input.",
  };
}

/**
 * Format Zod validation errors into user-friendly message and field errors object.
 */
function handleZodError(err: ZodError): FormattedError {
  const fieldErrors = err.flatten().fieldErrors;
  const issues = err.issues.map((i) => {
    const path = i.path.join(".") || "input";
    return `${path}: ${i.message}`;
  });

  const message = issues.length > 0 ? issues.join(" | ") : "Validation failed for submitted data.";

  return {
    statusCode: 400,
    message,
    errors: fieldErrors,
  };
}

/**
 * Global Express Error Handler Middleware.
 * Catches all thrown/passed errors, transforms technical errors into clean, human-readable messages,
 * and responds with standard JSON format.
 */
export function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  let statusCode = 500;
  let message = "An unexpected internal server error occurred. Please try again later.";
  let errors: unknown = undefined;

  // 1. AppError (Explicit Custom Application Errors)
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    errors = err.errors;
  }
  // 2. Zod Validation Errors
  else if (err instanceof ZodError || err?.name === "ZodError") {
    const formatted = handleZodError(err);
    statusCode = formatted.statusCode;
    message = formatted.message;
    errors = formatted.errors;
  }
  // 3. Prisma Known Request Errors
  else if (err instanceof Prisma.PrismaClientKnownRequestError || (err?.code && String(err.code).startsWith("P"))) {
    const formatted = handlePrismaKnownError(err);
    statusCode = formatted.statusCode;
    message = formatted.message;
    errors = formatted.errors;
  }
  // 4. Prisma Validation Errors
  else if (err instanceof Prisma.PrismaClientValidationError || err?.name === "PrismaClientValidationError") {
    const formatted = handlePrismaValidationError(err);
    statusCode = formatted.statusCode;
    message = formatted.message;
  }
  // 5. Prisma Initialization / Connection Errors
  else if (err instanceof Prisma.PrismaClientInitializationError) {
    statusCode = 503;
    message = "Database service is temporarily unavailable. Please try again shortly.";
  }
  // 6. JWT Authentication Errors
  else if (err?.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Your login session has expired. Please log in again.";
  } else if (err?.name === "JsonWebTokenError" || err?.name === "NotBeforeError") {
    statusCode = 401;
    message = "Invalid or malformed authentication token. Please log in again.";
  }
  // 7. Multer File Upload Errors
  else if (err?.name === "MulterError") {
    statusCode = 400;
    if (err.code === "LIMIT_FILE_SIZE") {
      message = "The uploaded file is too large. Maximum allowed size is 10MB.";
    } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
      message = `Unexpected file upload field "${err.field || "file"}".`;
    } else if (err.code === "LIMIT_FILE_COUNT") {
      message = "Too many files uploaded at once.";
    } else {
      message = `File upload error: ${err.message || "Failed to process uploaded file."}`;
    }
  }
  // 8. Syntax Errors (Malformed JSON Body)
  else if (err instanceof SyntaxError && "body" in err) {
    statusCode = 400;
    message = "Malformed JSON syntax in request body. Please verify your payload format.";
  }
  // 9. Stripe Payment Errors
  else if (err?.type && String(err.type).startsWith("Stripe")) {
    statusCode = err.statusCode || 400;
    message = err.raw?.message || err.message || "A payment processing error occurred.";
  }
  // 10. Standard HTTP Error with Status Code
  else if (err?.statusCode || err?.status) {
    statusCode = Number(err.statusCode || err.status);
    message = formatToHumanReadable(err.message || message);
    errors = err.errors;
  }
  // 11. Generic Error with descriptive message
  else if (err?.message && typeof err.message === "string") {
    message = formatToHumanReadable(err.message);
  }

  // Ensure statusCode is a valid integer between 400 and 599
  if (isNaN(statusCode) || statusCode < 400 || statusCode > 599) {
    statusCode = 500;
  }

  const responsePayload: Record<string, any> = {
    success: false,
    statusCode,
    message: formatToHumanReadable(message),
  };

  if (errors !== undefined) {
    responsePayload.errors = errors;
  }

  // Include stack trace only in development environment
  if (process.env.NODE_ENV === "development" && err?.stack) {
    responsePayload.stack = err.stack;
  }

  res.status(statusCode).json(responsePayload);
}

/**
 * 404 Not Found Middleware for unhandled API routes.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}
