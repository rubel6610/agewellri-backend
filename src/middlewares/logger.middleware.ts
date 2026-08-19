import { Request, Response, NextFunction } from "express";

// ANSI Color Codes for terminal
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

/**
 * Format timestamp in [YYYY-MM-DD HH:mm:ss] format
 */
function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${colors.gray}[${date} ${time}]${colors.reset}`;
}

/**
 * Color-code HTTP method
 */
function formatMethod(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return `${colors.cyan}${colors.bold}GET   ${colors.reset}`;
    case "POST":
      return `${colors.green}${colors.bold}POST  ${colors.reset}`;
    case "PUT":
      return `${colors.yellow}${colors.bold}PUT   ${colors.reset}`;
    case "PATCH":
      return `${colors.magenta}${colors.bold}PATCH ${colors.reset}`;
    case "DELETE":
      return `${colors.red}${colors.bold}DELETE${colors.reset}`;
    default:
      return `${colors.bold}${method.padEnd(6)}${colors.reset}`;
  }
}

/**
 * Color-code HTTP status code
 */
function formatStatus(status: number): string {
  if (status >= 500) {
    return `${colors.red}${colors.bold}${status}${colors.reset}`;
  }
  if (status >= 400) {
    return `${colors.yellow}${colors.bold}${status}${colors.reset}`;
  }
  if (status >= 300) {
    return `${colors.cyan}${colors.bold}${status}${colors.reset}`;
  }
  return `${colors.green}${colors.bold}${status}${colors.reset}`;
}

/**
 * Sanitize request body to prevent leaking sensitive credentials in console
 */
function sanitizeBody(body: any): any {
  if (!body || typeof body !== "object") return body;
  const sanitized = { ...body };
  const sensitiveKeys = [
    "password",
    "oldPassword",
    "newPassword",
    "confirmPassword",
    "token",
    "clientSignature",
  ];
  for (const key of sensitiveKeys) {
    if (key in sanitized) {
      sanitized[key] = "[PROTECTED]";
    }
  }
  return sanitized;
}

/**
 * Express Request Logger Middleware
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const timestamp = getTimestamp();
  const method = formatMethod(req.method);
  const url = req.originalUrl || req.url;

  // Log incoming request
  let bodyInfo = "";
  if (["POST", "PUT", "PATCH"].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
    const sanitized = sanitizeBody(req.body);
    const bodyStr = JSON.stringify(sanitized);
    bodyInfo = ` ${colors.dim}body:${colors.reset} ${colors.gray}${bodyStr.length > 120 ? bodyStr.slice(0, 120) + "..." : bodyStr}${colors.reset}`;
  }

  console.log(`${timestamp} 🚀 ${method} ${colors.bold}${url}${colors.reset}${bodyInfo}`);

  // Hook into response finish
  res.on("finish", () => {
    const duration = Date.now() - start;
    const endTimestamp = getTimestamp();
    const status = formatStatus(res.statusCode);
    const timeFormatted = `${duration}ms`.padStart(5);

    console.log(
      `${endTimestamp} ✨ ${method} ${colors.bold}${url}${colors.reset} ${status} ${colors.dim}(${timeFormatted})${colors.reset}`
    );
  });

  next();
}

/**
 * Global Error Logging Middleware
 */
export function errorLogger(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const timestamp = getTimestamp();
  console.error(
    `${timestamp} ${colors.red}${colors.bold}[ERROR] ${req.method} ${req.originalUrl || req.url}:${colors.reset}`,
    err.message || err
  );
  if (err.stack) {
    console.error(`${colors.gray}${err.stack}${colors.reset}`);
  }
  next(err);
}
