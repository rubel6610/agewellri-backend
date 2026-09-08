import { z } from "zod";
import { AppointmentStatus } from "@prisma/client";

export const ScheduleAppointmentSchema = z.object({
  serviceTypeId: z.string().optional(),
  serviceType: z.string().optional(),
  technicianId: z.string().optional(),
  technicianName: z.string().optional(),
  date: z.string().min(1, "Appointment date is required"),
  timeSlot: z.string().min(1, "Time slot is required"),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  notes: z.string().optional(),
  location: z.string().optional(),
});

export type ScheduleAppointmentInput = z.infer<typeof ScheduleAppointmentSchema>;

export const AdminScheduleAppointmentSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  serviceTypeId: z.string().optional(),
  serviceType: z.string().optional(),
  technicianId: z.string().optional(),
  technicianName: z.string().optional(),
  date: z.string().min(1, "Appointment date is required"),
  timeSlot: z.string().min(1, "Time slot is required"),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  notes: z.string().optional(),
  location: z.string().optional(),
});

export type AdminScheduleAppointmentInput = z.infer<typeof AdminScheduleAppointmentSchema>;

export const RescheduleAppointmentSchema = z.object({
  date: z.string().min(1, "Appointment date is required"),
  timeSlot: z.string().min(1, "Time slot is required"),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  technicianId: z.string().optional(),
  technicianName: z.string().optional(),
  reason: z.string().optional(),
});

export type RescheduleAppointmentInput = z.infer<typeof RescheduleAppointmentSchema>;

export const UpdateAppointmentStatusSchema = z.object({
  status: z.nativeEnum(AppointmentStatus),
  notes: z.string().optional(),
});

export type UpdateAppointmentStatusInput = z.infer<typeof UpdateAppointmentStatusSchema>;

export interface AdminAppointmentsQuery {
  status?: string;
  clientId?: string;
  technicianId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}
