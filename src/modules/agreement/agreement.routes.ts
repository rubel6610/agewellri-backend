import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { cacheResponse, invalidateCacheTags } from "../../middlewares/cache.middleware";
import {
  handleGetAgreementTemplates,
  handleGetAgreementTemplateByState,
  handleCalculateCancellationDeadline,
  handleSubmitServiceAgreement,
  handleGetMyAgreement,
  handleGetAdminAgreements,
  handleSendAgreementReminder,
  handleUploadAuthorityDocument,
  handleDeleteAgreement,
  handleDownloadAuthorityDocument,
} from "./agreement.controller";
import { handleAuthorityDocFileUpload } from "../../middlewares/upload.middleware";

const router = Router();

// Public routes (Cached for speed and high concurrency)
router.get(
  "/templates",
  cacheResponse({ ttlSeconds: 3600, tags: ["agreement_templates"] }),
  handleGetAgreementTemplates
);

router.get(
  "/template/:state",
  cacheResponse({ ttlSeconds: 3600, tags: ["agreement_templates"] }),
  handleGetAgreementTemplateByState
);

router.get(
  "/calculate-deadline",
  cacheResponse({ ttlSeconds: 1800, tags: ["deadlines"] }),
  handleCalculateCancellationDeadline
);

// Protected client routes
router.post(
  "/upload-authority-document",
  authenticate,
  handleAuthorityDocFileUpload,
  handleUploadAuthorityDocument
);

router.post(
  "/sign",
  authenticate,
  invalidateCacheTags("agreements", "clients", "onboarding"),
  handleSubmitServiceAgreement
);

router.post(
  "/submit",
  authenticate,
  invalidateCacheTags("agreements", "clients", "onboarding"),
  handleSubmitServiceAgreement
);

router.get(
  "/my-agreement",
  authenticate,
  cacheResponse({ ttlSeconds: 600, tags: ["agreements"], isPrivate: true }),
  handleGetMyAgreement
);

// Authority document download & view routes
router.get(
  "/my-agreement/authority-document/download",
  authenticate,
  handleDownloadAuthorityDocument
);
router.get(
  "/my-agreement/authority-document/file",
  authenticate,
  handleDownloadAuthorityDocument
);
router.get(
  "/my-agreement/authority-document/view",
  authenticate,
  handleDownloadAuthorityDocument
);

router.get(
  "/authority-document/download",
  authenticate,
  handleDownloadAuthorityDocument
);
router.get(
  "/authority-document/file",
  authenticate,
  handleDownloadAuthorityDocument
);
router.get(
  "/authority-document/view",
  authenticate,
  handleDownloadAuthorityDocument
);

router.get(
  "/:id/authority-document/download",
  authenticate,
  handleDownloadAuthorityDocument
);
router.get(
  "/:id/authority-document/file",
  authenticate,
  handleDownloadAuthorityDocument
);
router.get(
  "/:id/authority-document/view",
  authenticate,
  handleDownloadAuthorityDocument
);

// Admin routes
router.get(
  "/admin/all",
  authenticate,
  handleGetAdminAgreements
);

router.post(
  "/admin/:id/reminder",
  authenticate,
  invalidateCacheTags("agreements"),
  handleSendAgreementReminder
);

router.delete(
  "/admin/:id",
  authenticate,
  invalidateCacheTags("agreements", "clients"),
  handleDeleteAgreement
);

export default router;

