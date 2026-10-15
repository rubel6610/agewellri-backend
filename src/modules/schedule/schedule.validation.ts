import { z } from "zod";

export const OverrideType = {
  DATE: "DATE",
  WEEK: "WEEK",
} as const;
export type OverrideType = (typeof OverrideType)[keyof typeof OverrideType];

export const OverrideStatus = {
  CLOSED: "CLOSED",
  CUSTOM_HOURS: "CUSTOM_HOURS",
  OPEN: "OPEN",
} as const;
export type OverrideStatus = (typeof OverrideStatus)[keyof typeof OverrideStatus];

const timeStringRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const timeWindowSchema = z.object({
  start: z.string().regex(timeStringRegex, "Start time must be in HH:MM format (24h)"),
  end: z.string().regex(timeStringRegex, "End time must be in HH:MM format (24h)"),
}).refine(
  (data) => {
    const [sH, sM] = data.start.split(":").map(Number);
    const [eH, eM] = data.end.split(":").map(Number);
    return eH * 60 + eM > sH * 60 + sM;
  },
  { message: "End time must be after start time", path: ["end"] }
);

export const dayScheduleSchema = z.object({
  dayOfWeek: z.number().min(0).max(6),
  dayName: z.string(),
  isOpen: z.boolean(),
  timeWindows: z.array(timeWindowSchema).default([]),
});

export const updateWeeklyScheduleSchema = z.object({
  name: z.string().optional(),
  days: z.array(dayScheduleSchema).length(7, "Must provide schedule for all 7 days (Sunday to Saturday)"),
  slotDuration: z.number().min(15).max(480).default(60),
});

export const createScheduleOverrideSchema = z.object({
  title: z.string().optional().default(""),
  description: z.string().optional(),
  overrideType: z.enum(["DATE", "WEEK"]).default("DATE"),
  status: z.enum(["CLOSED", "CUSTOM_HOURS", "OPEN"]).default("CLOSED"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
  isRecurring: z.boolean().default(false),
  isActive: z.boolean().default(true),
  timeWindows: z.array(timeWindowSchema).optional().default([]),
});

export const updateScheduleOverrideSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  overrideType: z.enum(["DATE", "WEEK"]).optional(),
  status: z.enum(["CLOSED", "CUSTOM_HOURS", "OPEN"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isRecurring: z.boolean().optional(),
  isActive: z.boolean().optional(),
  timeWindows: z.array(timeWindowSchema).optional(),
});

export const queryOverridesSchema = z.object({
  search: z.string().optional(),
  overrideType: z.enum(["DATE", "WEEK", "ALL"]).optional(),
  status: z.enum(["CLOSED", "CUSTOM_HOURS", "OPEN", "ALL"]).optional(),
  isActive: z.string().optional(),
  year: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const queryAvailabilitySchema = z.object({
  date: z.string().min(1, "Date is required (YYYY-MM-DD)"),
  durationMinutes: z.coerce.number().optional().default(60),
  clientId: z.string().optional(),
  technicianId: z.string().optional(),
});

export const queryCalendarScheduleSchema = z.object({
  startDate: z.string().min(1, "Start date is required (YYYY-MM-DD)"),
  endDate: z.string().min(1, "End date is required (YYYY-MM-DD)"),
  durationMinutes: z.coerce.number().optional().default(60),
  technicianId: z.string().optional(),
});

export type TimeWindowInput = z.infer<typeof timeWindowSchema>;
export type DayScheduleInput = z.infer<typeof dayScheduleSchema>;
export type UpdateWeeklyScheduleInput = z.infer<typeof updateWeeklyScheduleSchema>;
export type CreateScheduleOverrideInput = z.infer<typeof createScheduleOverrideSchema>;
export type UpdateScheduleOverrideInput = z.infer<typeof updateScheduleOverrideSchema>;
export type QueryOverridesInput = z.infer<typeof queryOverridesSchema>;
export type QueryAvailabilityInput = z.infer<typeof queryAvailabilitySchema>;
export type QueryCalendarScheduleInput = z.infer<typeof queryCalendarScheduleSchema>;
