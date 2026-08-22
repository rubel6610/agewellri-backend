import { z } from "zod";
import { UserRole } from "@prisma/client";

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().optional(),
  role: z.nativeEnum(UserRole).optional().default(UserRole.CLIENT),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const requestSmsOtpSchema = z.object({
  phone: z.string().min(10, "Please provide a valid 10-digit phone number"),
});

export const verifySmsOtpSchema = z.object({
  phone: z.string().min(10, "Valid phone number is required"),
  otp: z.string().length(6, "Verification code must be 6 digits"),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1, "First name cannot be empty").optional(),
  lastName: z.string().min(1, "Last name cannot be empty").optional(),
  phone: z.string().optional().nullable(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  emergencyContactName: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  emergencyContactRelation: z.string().optional().nullable(),
  homeAccessType: z.enum(["LOCKBOX", "RESIDENT_ANSWERS", "DIGITAL_CODE", "OTHER"]).optional(),
  homeAccessInstructions: z.string().optional().nullable(),
});

export const submitAgreementSchema = z.object({
  clientFullName: z.string().min(1, "Client full name is required"),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required").default("RI"),
  postalCode: z.string().min(1, "Postal code is required"),
  phone: z.string().min(1, "Phone number is required"),
  dob: z.string().min(1, "Date of birth is required"),
  email: z.string().email("Valid email required").optional(),
  // Signer party & legal authority
  signerRole: z.enum([
    "RESIDENT",
    "FAMILY_MEMBER",
    "CAREGIVER",
    "POWER_OF_ATTORNEY",
    "AUTHORIZED_REPRESENTATIVE",
  ]).default("RESIDENT"),
  signerName: z.string().optional().nullable(),
  legalAuthority: z.string().optional().nullable(),
  primaryBillingContact: z.string().optional().nullable(),
  primaryContactName: z.string().optional().nullable(),
  primaryContactPhone: z.string().optional().nullable(),
  primaryContactEmail: z.string().optional().nullable(),
  primaryContactRelation: z.string().optional().nullable(),
  // Emergency contact (mandatory secondary family contact)
  emergencyContactName: z.string().min(1, "Emergency contact name is required"),
  emergencyContactPhone: z.string().min(1, "Emergency contact phone is required"),
  emergencyContactRelation: z.string().optional().nullable(),
  // Home access instructions
  homeAccessType: z.enum(["LOCKBOX", "RESIDENT_ANSWERS", "DIGITAL_CODE", "OTHER"]).default("RESIDENT_ANSWERS"),
  homeAccessInstructions: z.string().optional().nullable(),
  homeAccessCode: z.string().optional().nullable(),
  // Dynamic Plan & Billing
  planId: z.string().optional().nullable(),
  planVersionId: z.string().optional().nullable(),
  selectedPlan: z.string().default("GUARDIAN_PLUS"),
  hasCleaningAddon: z.boolean().default(false),
  billingMethod: z.enum(["AUTOMATIC", "INVOICE"]).default("AUTOMATIC"),
  paymentMethodId: z.string().optional().nullable(),
  setupIntentId: z.string().optional().nullable(),
  // Signature block
  clientPrintedName: z.string().min(1, "Printed name is required"),
  authorizedRepName: z.string().optional().nullable(),
  relationshipToClient: z.string().optional().nullable(),
  agreementDate: z.string().min(1, "Date is required"),
  clientSignature: z.string().min(1, "Signature is required"),
  agreedToTerms: z.literal(true, {
    errorMap: () => ({ message: "You must agree to the terms of the Client Service Agreement" }),
  }),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Please provide a valid email address"),
});

export const verifyOtpSchema = z.object({
  email: z.string().email("Please provide a valid email address"),
  otp: z.string().length(6, "Verification code must be 6 digits"),
});

export const resetPasswordSchema = z.object({
  email: z.string().email("Please provide a valid email address"),
  otp: z.string().length(6, "Verification code must be 6 digits"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RequestSmsOtpInput = z.infer<typeof requestSmsOtpSchema>;
export type VerifySmsOtpInput = z.infer<typeof verifySmsOtpSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type SubmitAgreementInput = z.infer<typeof submitAgreementSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
