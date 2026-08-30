import { z } from "zod";

export const createSetupIntentSchema = z.object({
  plan: z.enum(["ESSENTIAL_GUARD", "GUARDIAN_PLUS", "STANDALONE_CLEANING"]).optional(),
  hasCleaningAddon: z.boolean().optional(),
});

export const createPaymentIntentSchema = z.object({
  amount: z.number().positive("Amount must be greater than zero"),
  currency: z.string().default("usd").optional(),
  description: z.string().optional(),
  selectedPlan: z.enum(["ESSENTIAL_GUARD", "GUARDIAN_PLUS", "STANDALONE_CLEANING"]).optional(),
  hasCleaningAddon: z.boolean().optional(),
});

export const savePaymentMethodSchema = z.object({
  paymentMethodId: z
    .string()
    .min(5, "Valid Stripe paymentMethodId is required")
    .startsWith("pm_", "Payment method ID must start with pm_"),
  setAsDefault: z.boolean().optional().default(true),
});

export const processAgreementPaymentSchema = z.object({
  agreementId: z.string().optional(),
  paymentMethodId: z.string().optional(),
  setupIntentId: z.string().optional(),
  billingMethod: z.enum(["AUTOMATIC", "INVOICE"]).default("AUTOMATIC"),
  selectedPlan: z.enum(["ESSENTIAL_GUARD", "GUARDIAN_PLUS", "STANDALONE_CLEANING"]).default("ESSENTIAL_GUARD"),
  hasCleaningAddon: z.boolean().default(false),
});

export const createInvoicePaymentSchema = z.object({
  selectedPlan: z.enum(["ESSENTIAL_GUARD", "GUARDIAN_PLUS", "STANDALONE_CLEANING"]).default("ESSENTIAL_GUARD"),
  hasCleaningAddon: z.boolean().default(false),
});

export const cancelRenewalSchema = z.object({
  reason: z.string().optional(),
});

export const adminBillingFilterSchema = z.object({
  status: z.string().optional(),
  billingMethod: z.string().optional(),
  plan: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().positive().default(1).optional(),
  limit: z.coerce.number().positive().default(20).optional(),
});

export const adminRetryChargeSchema = z.object({
  invoiceId: z.string().optional(),
  paymentId: z.string().optional(),
});

export const adminCancelSubscriptionSchema = z.object({
  immediate: z.boolean().default(false).optional(),
  reason: z.string().optional(),
});

export const adminUpdateSubscriptionStatusSchema = z.object({
  status: z.enum(["ACTIVE", "PENDING", "PAUSED", "CANCELLED", "PAYMENT_FAILED", "CANCELLATION_REQUESTED"]),
  reason: z.string().optional(),
});

export type CreateSetupIntentInput = z.infer<typeof createSetupIntentSchema>;
export type CreatePaymentIntentInput = z.infer<typeof createPaymentIntentSchema>;
export type SavePaymentMethodInput = z.infer<typeof savePaymentMethodSchema>;
export type ProcessAgreementPaymentInput = z.infer<typeof processAgreementPaymentSchema>;
export type CreateInvoicePaymentInput = z.infer<typeof createInvoicePaymentSchema>;
export type CancelRenewalInput = z.infer<typeof cancelRenewalSchema>;
export type AdminBillingFilterInput = z.infer<typeof adminBillingFilterSchema>;
export type AdminRetryChargeInput = z.infer<typeof adminRetryChargeSchema>;
export type AdminCancelSubscriptionInput = z.infer<typeof adminCancelSubscriptionSchema>;
export type AdminUpdateSubscriptionStatusInput = z.infer<typeof adminUpdateSubscriptionStatusSchema>;
