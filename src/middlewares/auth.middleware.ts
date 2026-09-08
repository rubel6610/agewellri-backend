import { Request, Response, NextFunction } from "express";
import { UserRole, UserStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { verifyToken, JwtPayload } from "../utils/jwt";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    status: UserStatus;
  };
}

/**
 * Middleware to authenticate requests using JWT Bearer token.
 */
export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let token: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.query && typeof req.query.token === "string" && req.query.token) {
      token = req.query.token;
    } else if ((req as any).cookies) {
      token = (req as any).cookies.agewell_auth_token || (req as any).cookies.token;
    }

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Authentication required. Please provide a valid Bearer token or token parameter.",
      });
      return;
    }

    let decoded: JwtPayload;

    try {
      decoded = verifyToken(token);
    } catch {
      res.status(401).json({
        success: false,
        message: "Invalid or expired token.",
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: "User account no longer exists.",
      });
      return;
    }

    if (user.status !== UserStatus.ACTIVE) {
      res.status(403).json({
        success: false,
        message: `Account is ${user.status.toLowerCase()}. Access denied.`,
      });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware for Role-Based Access Control (RBAC).
 */
export function authorize(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: "Forbidden. You do not have permission to perform this action.",
      });
      return;
    }

    next();
  };
}
