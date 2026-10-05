import { z } from "zod";

export const createOffDaySchema = z.object({
  title: z.string().min(2, "Title / reason must be at least 2 characters").trim(),
  description: z.string().optional().nullable(),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional().nullable(),
  isRecurring: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export type CreateOffDayInput = z.infer<typeof createOffDaySchema>;

export const updateOffDaySchema = z.object({
  title: z.string().min(2, "Title / reason must be at least 2 characters").trim().optional(),
  description: z.string().optional().nullable(),
  startDate: z.string().optional(),
  endDate: z.string().optional().nullable(),
  isRecurring: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateOffDayInput = z.infer<typeof updateOffDaySchema>;

export const queryOffDaysSchema = z.object({
  year: z.string().optional(),
  month: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isActive: z.string().optional(),
  search: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export type QueryOffDaysInput = z.infer<typeof queryOffDaysSchema>;

export const previewConflictsSchema = z.object({
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional().nullable(),
});

export type PreviewConflictsInput = z.infer<typeof previewConflictsSchema>;
