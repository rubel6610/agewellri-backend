import { z } from "zod";

export const createPlanSchema = z.object({
  name: z.string().min(2, "Plan name is required"),
  code: z.string().optional(),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  fullDescription: z.string().optional(),
  price: z.number().positive("Price must be greater than zero"),
  totalVisits: z.number().int().min(1, "Total visits must be at least 1").default(2),
  times: z.string().optional(),
  currency: z.string().default("USD").optional(),
  billingInterval: z.literal("MONTHLY").default("MONTHLY").optional(),
  displayOrder: z.number().int().default(0).optional(),
  supportsAutomaticBilling: z.boolean().default(true).optional(),
  supportsInvoiceBilling: z.boolean().default(true).optional(),
  autoRenewDefault: z.boolean().default(true).optional(),
  features: z.array(z.string()).default([]),
  isActive: z.boolean().default(true).optional(),
});

export const updatePlanSchema = z.object({
  name: z.string().min(2).optional(),
  code: z.string().optional(),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  fullDescription: z.string().optional(),
  price: z.number().positive().optional(),
  totalVisits: z.number().int().min(1).optional(),
  times: z.string().optional(),
  currency: z.string().optional(),
  billingInterval: z.literal("MONTHLY").optional(),
  displayOrder: z.number().int().optional(),
  supportsAutomaticBilling: z.boolean().optional(),
  supportsInvoiceBilling: z.boolean().optional(),
  autoRenewDefault: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export const changePlanStatusSchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED", "UNARCHIVED"]),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type ChangePlanStatusInput = z.infer<typeof changePlanStatusSchema>;
