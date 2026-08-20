import { z } from "zod";

export const createSetupIntentSchema = z.object({
  plan: z.enum(["ESSENTIAL_GUARD", "GUARDIAN_PLUS"]).optional(),
  hasCleaningAddon: z.boolean().optional(),
});

export const createPaymentIntentSchema = z.object({
  amount: z.number().positive("Amount must be greater than zero"),
  currency: z.string().default("usd").optional(),
  description: z.string().optional(),
  selectedPlan: z.enum(["ESSENTIAL_GUARD", "GUARDIAN_PLUS"]).optional(),
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
  selectedPlan: z.enum(["ESSENTIAL_GUARD", "GUARDIAN_PLUS"]).default("ESSENTIAL_GUARD"),
  hasCleaningAddon: z.boolean().default(false),
});

export type CreateSetupIntentInput = z.infer<typeof createSetupIntentSchema>;
export type CreatePaymentIntentInput = z.infer<typeof createPaymentIntentSchema>;
export type SavePaymentMethodInput = z.infer<typeof savePaymentMethodSchema>;
export type ProcessAgreementPaymentInput = z.infer<typeof processAgreementPaymentSchema>;
