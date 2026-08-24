import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { cacheResponse, invalidateCacheTags } from "../../middlewares/cache.middleware";
import {
  handleSendInvitation,
  handleVerifyInvitation,
  handleAcceptInvitation,
  handleGetAdminInvitations,
  handleRevokeInvitation,
  handleResendInvitation,
  handleGetOnboardingState,
  handleSaveOnboardingProgress,
} from "./invitation.controller";

const router = Router();

// Public invitation routes
router.get(
  "/verify/:token",
  cacheResponse({ ttlSeconds: 600, tags: ["invitations"] }),
  handleVerifyInvitation
);

router.post(
  "/accept",
  invalidateCacheTags("invitations", "clients", "onboarding"),
  handleAcceptInvitation
);

// Authenticated Onboarding routes (Client)
router.get(
  "/onboarding/state",
  authenticate,
  cacheResponse({ ttlSeconds: 300, tags: ["onboarding", "clients"], isPrivate: true }),
  handleGetOnboardingState
);

router.post(
  "/onboarding/save-progress",
  authenticate,
  invalidateCacheTags("onboarding"),
  handleSaveOnboardingProgress
);

// Admin invitation routes
router.post(
  "/send",
  authenticate,
  invalidateCacheTags("invitations", "clients"),
  handleSendInvitation
);

router.get(
  "/admin/all",
  authenticate,
  cacheResponse({ ttlSeconds: 300, tags: ["invitations"], isPrivate: true }),
  handleGetAdminInvitations
);

router.post(
  "/admin/:id/revoke",
  authenticate,
  invalidateCacheTags("invitations", "clients"),
  handleRevokeInvitation
);

router.post(
  "/admin/:id/resend",
  authenticate,
  invalidateCacheTags("invitations", "clients"),
  handleResendInvitation
);

export default router;
