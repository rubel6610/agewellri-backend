import { z } from "zod";

export const submitAgreementSchema = z.object({
  clientFullName: z.string().min(1, "Primary client full name is required"),
  address: z.string().min(1, "Street address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required").default("RI"),
  postalCode: z.string().min(1, "Postal code is required"),
  phone: z.string().min(1, "Phone number is required"),
  dob: z.string().optional().nullable(),
  email: z.string().email("Valid email required").optional(),

  // Signer party & legal authority
  signingTrack: z.enum(["TRACK_A", "TRACK_B"]).optional().nullable(),
  representativeCapacity: z.enum(["ATTORNEY_IN_FACT", "GUARDIAN", "CONSERVATOR"]).optional().nullable(),
  authorityDocumentUrl: z.string().optional().nullable(),
  signerRole: z.enum([
    "RESIDENT",
    "FAMILY_MEMBER",
    "CAREGIVER",
    "POWER_OF_ATTORNEY",
    "AUTHORIZED_REPRESENTATIVE",
  ]).default("RESIDENT"),
  signerName: z.string().optional().nullable(),
  signerEmail: z.string().email().optional().nullable(),
  signerPhone: z.string().optional().nullable(),
  legalAuthority: z.string().optional().nullable(),
  legalAuthorityOther: z.string().optional().nullable(),
  primaryBillingContact: z.string().optional().nullable(),
  primaryContactName: z.string().optional().nullable(),
  primaryContactPhone: z.string().optional().nullable(),
  primaryContactEmail: z.string().email().optional().nullable(),
  primaryContactRelation: z.string().optional().nullable(),

  // Authorized Recipients (Step 4)
  authorizedRecipients: z.array(
    z.object({
      name: z.string(),
      relationship: z.string(),
      email: z.string(),
    })
  ).optional().nullable(),

  // Emergency contact (optional/fallback)
  emergencyContactName: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  emergencyContactEmail: z.string().email().optional().nullable(),
  emergencyContactRelation: z.string().optional().nullable(),

  // Home access instructions
  homeAccessType: z.enum(["LOCKBOX", "RESIDENT_ANSWERS", "DIGITAL_CODE", "OTHER"]).default("RESIDENT_ANSWERS"),
  homeAccessInstructions: z.string().optional().nullable(),
  homeAccessCode: z.string().optional().nullable(),
  homeAccessAuthorized: z.boolean().optional().nullable(),

  // Required Authorizations (Step 7)
  authorizations: z.object({
    emergencyRightOfEntry: z.boolean().optional(),
    residentAutonomyAcknowledgment: z.boolean().optional(),
    automaticBillingAuthorization: z.boolean().optional(),
  }).optional().nullable(),

  // Dynamic Plan & Billing
  planId: z.string().optional().nullable(),
  planVersionId: z.string().optional().nullable(),
  selectedPlan: z.string().default("GUARDIAN_PLUS"),
  hasCleaningAddon: z.boolean().default(false),
  billingMethod: z.enum(["AUTOMATIC", "INVOICE"]).default("AUTOMATIC"),
  paymentMethodId: z.string().optional().nullable(),
  setupIntentId: z.string().optional().nullable(),

  // Dynamic Signature block
  clientPrintedName: z.string().min(1, "Printed signer name is required"),
  authorizedRepName: z.string().optional().nullable(),
  relationshipToClient: z.string().optional().nullable(),
  agreementDate: z.string().min(1, "Agreement date is required"),
  clientSignature: z.string().min(1, "Signature is required"),
  agreedToTerms: z.literal(true, {
    errorMap: () => ({ message: "You must accept and agree to the terms of the Client Service Agreement" }),
  }),
});

export const calculateDeadlineSchema = z.object({
  state: z.string().optional().default("RI"),
  date: z.string().optional(),
});

export const createAgreementTemplateSchema = z.object({
  state: z.string().min(2).max(2).toUpperCase(),
  versionNumber: z.string().min(1).default("v1.0"),
  title: z.string().min(1),
  statutoryReference: z.string().optional(),
  content: z.string().optional(),
  isDefault: z.boolean().optional().default(true),
});

export type SubmitAgreementInput = z.infer<typeof submitAgreementSchema>;
export type CalculateDeadlineInput = z.infer<typeof calculateDeadlineSchema>;
export type CreateAgreementTemplateInput = z.infer<typeof createAgreementTemplateSchema>;
