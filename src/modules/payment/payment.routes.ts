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
  handleAdminCancelSubscription,
  handleAdminReactivateSubscription,
  handleAdminUpdateSubscriptionStatus,
  handleWebhook,
  handleGetClientVisitEntitlements,
  handleGetAdminClientVisitEntitlements,
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
router.get("/visit-entitlements", authenticate, handleGetClientVisitEntitlements);
router.post("/process-agreement-payment", authenticate, handleProcessAgreementPayment);
router.post("/create-invoice-payment", authenticate, handleCreateInvoicePayment);
router.post("/subscription/cancel-renewal", authenticate, handleCancelRenewal);
router.post("/subscription/reactivate-renewal", authenticate, handleReactivateRenewal);

// Protected Admin routes (Requires valid JWT and ADMIN role)
router.get("/admin/overview", authenticate, handleGetAdminOverview);
router.get("/admin/invoices", authenticate, handleGetAdminInvoices);
router.get("/admin/subscriptions", authenticate, handleGetAdminSubscriptions);
router.post("/admin/subscription/:id/cancel", authenticate, handleAdminCancelSubscription);
router.post("/admin/subscription/:id/reactivate", authenticate, handleAdminReactivateSubscription);
router.post("/admin/subscription/:id/status", authenticate, handleAdminUpdateSubscriptionStatus);
router.get("/admin/renewals", authenticate, handleGetAdminUpcomingRenewals);
router.get("/admin/client/:id/visit-entitlements", authenticate, handleGetAdminClientVisitEntitlements);
router.post("/admin/trigger-reminders", authenticate, handleAdminTriggerReminders);
router.post("/admin/retry-charge", authenticate, handleAdminRetryCharge);

export default router;

