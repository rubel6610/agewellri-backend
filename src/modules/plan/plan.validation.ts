import { z } from "zod";

export const planServiceItemSchema = z.object({
  serviceTypeId: z.string().min(1, "Valid serviceTypeId is required"),
  allocatedVisits: z
    .number()
    .int()
    .min(0, "Allocated visits must be 0 or more"),
  unit: z.string().default("visits").optional(),
  durationMinutes: z.number().int().positive().optional(),
});

export const createPlanSchema = z.object({
  name: z.string().min(2, "Plan name is required"),
  code: z
    .string()
    .min(2, "Plan code is required")
    .regex(
      /^[A-Z0-9_-]+$/i,
      "Code must contain only letters, numbers, hyphens or underscores",
    ),
  shortDescription: z.string().optional(),
  fullDescription: z.string().optional(),
  price: z.number().positive("Price must be greater than zero"),
  currency: z.string().default("USD").optional(),
  billingInterval: z
    .enum(["MONTHLY", "ONE_TIME"])
    .default("MONTHLY"),
  displayOrder: z.number().int().default(0).optional(),
  supportsAutomaticBilling: z.boolean().default(true).optional(),
  supportsInvoiceBilling: z.boolean().default(true).optional(),
  autoRenewDefault: z.boolean().default(true).optional(),
  features: z.array(z.string()).default([]),
  services: z.array(planServiceItemSchema).default([]),
  isActive: z.boolean().default(true).optional(),
  effectiveDate: z.string().datetime().optional(),
});

export const updatePlanSchema = z.object({
  name: z.string().min(2).optional(),
  shortDescription: z.string().optional(),
  fullDescription: z.string().optional(),
  price: z.number().positive().optional(),
  currency: z.string().optional(),
  billingInterval: z
    .enum(["MONTHLY", "ONE_TIME"])
    .optional(),
  displayOrder: z.number().int().optional(),
  supportsAutomaticBilling: z.boolean().optional(),
  supportsInvoiceBilling: z.boolean().optional(),
  autoRenewDefault: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  services: z.array(planServiceItemSchema).optional(),
  isActive: z.boolean().optional(),
  effectiveDate: z.string().datetime().optional(),
  forceNewVersion: z.boolean().optional(),
});

export const changePlanStatusSchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED", "UNARCHIVED"]),
});

export const createServiceSchema = z.object({
  name: z.string().min(2, "Service name is required"),
  code: z.string().optional(),
  category: z
    .enum(["CLEANING", "SAFETY_OVERSIGHT", "ASSESSMENT", "WELLNESS", "OTHER"])
    .default("SAFETY_OVERSIGHT"),
  description: z.string().optional(),
  durationMinutes: z.number().int().positive().default(60),
  defaultPrice: z.number().positive().optional(),
  displayOrder: z.number().int().default(0).optional(),
  isActive: z.boolean().default(true).optional(),
});

export const updateServiceSchema = z.object({
  name: z.string().min(2).optional(),
  code: z.string().optional(),
  category: z
    .enum(["CLEANING", "SAFETY_OVERSIGHT", "ASSESSMENT", "WELLNESS", "OTHER"])
    .optional(),
  description: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
  defaultPrice: z.number().positive().optional(),
  displayOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const changeServiceStatusSchema = z.object({
  isActive: z.boolean(),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type ChangePlanStatusInput = z.infer<typeof changePlanStatusSchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type ChangeServiceStatusInput = z.infer<
  typeof changeServiceStatusSchema
>;
