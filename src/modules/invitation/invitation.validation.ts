import { z } from "zod";
import { SignerRole } from "@prisma/client";

export const createInvitationSchema = z.object({
  email: z.string().email("Please provide a valid recipient email"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  state: z.string().optional().default("RI"),
  planName: z.string().optional().default("Guardian Plus"),
  clientId: z.string().optional().nullable(),
  expiresInDays: z.number().min(1).max(90).optional().default(7),
  skipEmail: z.boolean().optional(),
});

export const verifyInvitationTokenSchema = z.object({
  token: z.string().min(1, "Invitation token is required"),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, "Invitation token is required"),
  email: z.string().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().min(1, "Phone number is required"),
  state: z.string().optional().default("RI"),
  address: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
});

export const saveOnboardingProgressSchema = z.object({
  step: z.number().min(1).max(10),
  onboardingData: z.record(z.any()),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type VerifyInvitationTokenInput = z.infer<typeof verifyInvitationTokenSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type SaveOnboardingProgressInput = z.infer<typeof saveOnboardingProgressSchema>;
