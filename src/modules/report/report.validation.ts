import { z } from "zod";

export const AssessmentResponseItemSchema = z.object({
  questionId: z.string().min(1, "Question ID is required"),
  category: z.string().min(1, "Category is required"),
  questionText: z.string().optional(),
  scoreValue: z
    .number()
    .min(0, "Score value cannot be negative")
    .max(2, "Score value cannot exceed 2 points per item"),
  notes: z.string().optional().nullable(),
  flaggedRisk: z.boolean().optional().default(false),
});

export const SubmitAssessmentInputSchema = z.object({
  appointmentId: z.string().min(1, "Appointment ID is required"),
  visitId: z.string().optional(),
  clientId: z.string().optional(),
  templateId: z.string().optional(),
  responses: z
    .array(AssessmentResponseItemSchema)
    .min(1, "At least one assessment response is required"),
  summary: z.string().min(5, "Assessment summary must be at least 5 characters"),
  findings: z.string().optional().nullable(),
  recommendations: z.string().min(5, "Safety recommendations must be at least 5 characters"),
  specialistNotes: z.string().optional().nullable(),
  status: z.enum(["PENDING", "GENERATED", "UPLOADED", "EMAILED"]).optional().default("GENERATED"),
});

export type SubmitAssessmentInput = z.infer<typeof SubmitAssessmentInputSchema>;
export type AssessmentResponseItem = z.infer<typeof AssessmentResponseItemSchema>;

export const UpdateReportStatusSchema = z.object({
  status: z.enum(["PENDING", "GENERATED", "UPLOADED", "EMAILED"]),
  fileUrl: z.string().optional(),
});

export type UpdateReportStatusInput = z.infer<typeof UpdateReportStatusSchema>;
