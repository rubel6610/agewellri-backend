import { Router, Request, Response, NextFunction } from "express";
import { handleSendContactMessage } from "./contact.controller";
import { verifyToken } from "../../utils/jwt";
import prisma from "../../lib/prisma";

const router = Router();

/**
 * Optional authentication helper: extracts user if token present, but doesn't block unauthenticated requests.
 */
async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
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

    if (token) {
      const decoded = verifyToken(token);
      if (decoded?.userId) {
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, email: true, role: true, status: true },
        });
        if (user) {
          (req as any).user = user;
        }
      }
    }
  } catch {}
  next();
}

/**
 * POST /api/v1/contact/send
 * Sends direct message to admin Gmail inbox
 */
router.post("/send", optionalAuth, handleSendContactMessage);

export default router;
