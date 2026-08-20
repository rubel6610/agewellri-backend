import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  handleGetConfig,
  handleCreateSetupIntent,
  handleCreatePaymentIntent,
  handleSavePaymentMethod,
  handleGetPaymentMethods,
  handleGetBillingOverview,
  handleProcessAgreementPayment,
  handleWebhook,
} from "./payment.controller";

const router = Router();

// Public routes
router.get("/config", handleGetConfig);
router.post("/webhook", handleWebhook);

// Protected routes (Requires valid JWT)
router.post("/create-setup-intent", authenticate, handleCreateSetupIntent);
router.post("/create-payment-intent", authenticate, handleCreatePaymentIntent);
router.post("/save-payment-method", authenticate, handleSavePaymentMethod);
router.get("/payment-methods", authenticate, handleGetPaymentMethods);
router.get("/billing-info", authenticate, handleGetBillingOverview);
router.post("/process-agreement-payment", authenticate, handleProcessAgreementPayment);

export default router;
