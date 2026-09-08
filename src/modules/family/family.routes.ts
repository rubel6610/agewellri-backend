import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  handleGetFamilyMembers,
  handleGetFamilyMemberById,
  handleCreateFamilyMember,
  handleUpdateFamilyMember,
  handleDeleteFamilyMember,
  handleInviteFamilyMember,
  handleResendFamilyInvite,
  handleRevokeFamilyAccess,
  handleVerifyFamilyInvite,
  handleAcceptFamilyInvite,
  handleSendReportToFamily,
} from "./family.controller";

const router = Router();

// Public invitation verification & acceptance
router.get("/invitation/verify", handleVerifyFamilyInvite);
router.post("/invitation/accept", handleAcceptFamilyInvite);

// Protected Client Family Member Management (Requires valid JWT)
router.get("/", authenticate, handleGetFamilyMembers);
router.post("/", authenticate, handleCreateFamilyMember);
router.get("/:id", authenticate, handleGetFamilyMemberById);
router.patch("/:id", authenticate, handleUpdateFamilyMember);
router.delete("/:id", authenticate, handleDeleteFamilyMember);
router.post("/:id/invite", authenticate, handleInviteFamilyMember);
router.post("/:id/resend-invite", authenticate, handleResendFamilyInvite);
router.post("/:id/revoke-access", authenticate, handleRevokeFamilyAccess);

// Send Report to Family
router.post("/reports/:reportId/send", authenticate, handleSendReportToFamily);

export default router;
