import { z } from "zod";

export const createFamilyMemberSchema = z.object({
  name: z.string().min(1, "Full name is required").trim(),
  relationship: z.string().min(1, "Relationship is required").trim(),
  email: z.string().email("Valid email address is required").trim().toLowerCase(),
  phone: z.string().optional().nullable(),
  password: z.string().min(6, "Password must be at least 6 characters").optional().nullable(),
  reportAccess: z.boolean().default(true),
  portalAccess: z.boolean().default(false),
  billingAccess: z.boolean().default(false),
  isEmergencyContact: z.boolean().optional(),
  sendInviteNow: z.boolean().default(false),
  sendCredentialsNow: z.boolean().default(true),
});

export type CreateFamilyMemberInput = z.infer<typeof createFamilyMemberSchema>;

export const updateFamilyMemberSchema = z.object({
  name: z.string().min(1, "Full name is required").trim().optional(),
  relationship: z.string().min(1, "Relationship is required").trim().optional(),
  email: z.string().email("Valid email address is required").trim().toLowerCase().optional(),
  phone: z.string().optional().nullable(),
  password: z.string().min(6, "Password must be at least 6 characters").optional().nullable(),
  reportAccess: z.boolean().optional(),
  portalAccess: z.boolean().optional(),
  billingAccess: z.boolean().optional(),
  isEmergencyContact: z.boolean().optional(),
  sendCredentialsNow: z.boolean().optional(),
});

export type UpdateFamilyMemberInput = z.infer<typeof updateFamilyMemberSchema>;

export const sendCredentialsSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters").optional().nullable(),
});

export type SendCredentialsInput = z.infer<typeof sendCredentialsSchema>;

export const acceptFamilyInviteSchema = z.object({
  token: z.string().min(1, "Invitation token is required"),
  email: z.string().email("Valid email address is required").trim().toLowerCase().optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().min(1, "First name is required").trim(),
  lastName: z.string().min(1, "Last name is required").trim(),
  phone: z.string().optional().nullable(),
});

export type AcceptFamilyInviteInput = z.infer<typeof acceptFamilyInviteSchema>;

export const sendReportToFamilySchema = z.object({
  familyMemberIds: z.array(z.string().min(1)).min(1, "At least one family recipient must be selected"),
  customNote: z.string().optional().nullable(),
});

export type SendReportToFamilyInput = z.infer<typeof sendReportToFamilySchema>;
