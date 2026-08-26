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
  handleCreateInvoicePayment,
  handleCancelRenewal,
  handleReactivateRenewal,
  handleGetAdminOverview,
  handleGetAdminInvoices,
  handleGetAdminSubscriptions,
  handleGetAdminUpcomingRenewals,
  handleAdminTriggerReminders,
  handleAdminRetryCharge,
  handleWebhook,
} from "./payment.controller";

const router = Router();

// Public routes
router.get("/config", handleGetConfig);
router.post("/webhook", handleWebhook);

// Protected Client routes (Requires valid JWT)
router.post("/create-setup-intent", authenticate, handleCreateSetupIntent);
router.post("/create-payment-intent", authenticate, handleCreatePaymentIntent);
router.post("/save-payment-method", authenticate, handleSavePaymentMethod);
router.get("/payment-methods", authenticate, handleGetPaymentMethods);
router.get("/billing-info", authenticate, handleGetBillingOverview);
router.post("/process-agreement-payment", authenticate, handleProcessAgreementPayment);
router.post("/create-invoice-payment", authenticate, handleCreateInvoicePayment);
router.post("/subscription/cancel-renewal", authenticate, handleCancelRenewal);
router.post("/subscription/reactivate-renewal", authenticate, handleReactivateRenewal);

// Protected Admin routes (Requires valid JWT and ADMIN role)
router.get("/admin/overview", authenticate, handleGetAdminOverview);
router.get("/admin/invoices", authenticate, handleGetAdminInvoices);
router.get("/admin/subscriptions", authenticate, handleGetAdminSubscriptions);
router.get("/admin/renewals", authenticate, handleGetAdminUpcomingRenewals);
router.post("/admin/trigger-reminders", authenticate, handleAdminTriggerReminders);
router.post("/admin/retry-charge", authenticate, handleAdminRetryCharge);

export default router;

