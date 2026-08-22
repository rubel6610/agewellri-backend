import { z } from "zod";

export const createSpecialistSchema = z.object({
  name: z.string().min(2, "Specialist name is required"),
  email: z.string().email("Valid email is required").optional().nullable(),
  phone: z.string().optional().nullable(),
  title: z.string().default("Home Safety Specialist").optional(),
  specialties: z.array(z.string()).default([]),
  color: z.string().default("#294B68").optional(),
  notes: z.string().optional().nullable(),
  displayOrder: z.number().int().default(0).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "PENDING"]).default("ACTIVE"),
});

export const updateSpecialistSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  title: z.string().optional(),
  specialties: z.array(z.string()).optional(),
  color: z.string().optional(),
  notes: z.string().optional().nullable(),
  displayOrder: z.number().int().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "PENDING"]).optional(),
  isArchived: z.boolean().optional(),
});

export const assignSpecialistSchema = z.object({
  appointmentId: z.string().min(1, "Appointment ID is required"),
  specialistId: z.string().min(1, "Specialist ID is required"),
});

export type CreateSpecialistInput = z.infer<typeof createSpecialistSchema>;
export type UpdateSpecialistInput = z.infer<typeof updateSpecialistSchema>;
export type AssignSpecialistInput = z.infer<typeof assignSpecialistSchema>;
