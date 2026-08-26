import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import * as appointmentService from "./appointment.service";
import {
  ScheduleAppointmentSchema,
  AdminScheduleAppointmentSchema,
  RescheduleAppointmentSchema,
  UpdateAppointmentStatusSchema,
} from "./appointment.validation";

/**
 * POST /api/v1/appointments/schedule
 * Client schedules an appointment
 */
export async function handleScheduleClientAppointment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const validated = ScheduleAppointmentSchema.parse(req.body);
    const appointment = await appointmentService.scheduleClientAppointment(req.user.id, validated);

    res.status(201).json({
      success: true,
      message: "Appointment scheduled successfully.",
      data: appointment,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      res.status(400).json({
        success: false,
        message: "Invalid appointment data.",
        errors: error.flatten().fieldErrors,
      });
      return;
    }
    if (error instanceof Error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
      return;
    }
    next(error);
  }
}

/**
 * POST /api/v1/appointments/admin/schedule
 * Admin schedules an appointment for any client
 */
export async function handleScheduleAdminAppointment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const validated = AdminScheduleAppointmentSchema.parse(req.body);
    const appointment = await appointmentService.scheduleAdminAppointment(req.user.id, validated);

    res.status(201).json({
      success: true,
      message: "Visit scheduled and dispatched successfully.",
      data: appointment,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      res.status(400).json({
        success: false,
        message: "Invalid dispatch data.",
        errors: error.flatten().fieldErrors,
      });
      return;
    }
    if (error instanceof Error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
      return;
    }
    next(error);
  }
}

/**
 * GET /api/v1/appointments/my
 * Client retrieves their own appointments
 */
export async function handleGetClientAppointments(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const appointments = await appointmentService.getClientAppointments(req.user.id);

    res.status(200).json({
      success: true,
      message: "Appointments retrieved successfully.",
      data: appointments,
    });
  } catch (error: any) {
    if (error instanceof Error) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
}

/**
 * GET /api/v1/appointments/admin
 * Admin retrieves all appointments with optional filters
 */
export async function handleGetAdminAppointments(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const query = {
      status: req.query.status as string,
      clientId: req.query.clientId as string,
      technicianId: req.query.technicianId as string,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      search: req.query.search as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };

    const appointments = await appointmentService.getAdminAppointments(query);

    res.status(200).json({
      success: true,
      message: "Appointments retrieved successfully.",
      data: appointments,
    });
  } catch (error: any) {
    if (error instanceof Error) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
}

/**
 * GET /api/v1/appointments/:id
 * Retrieve a single appointment
 */
export async function handleGetAppointmentById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const appointmentId = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id as string);
    const appointment = await appointmentService.getAppointmentById(appointmentId, req.user);

    res.status(200).json({
      success: true,
      message: "Appointment retrieved successfully.",
      data: appointment,
    });
  } catch (error: any) {
    if (error instanceof Error) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
}

/**
 * PUT /api/v1/appointments/:id/reschedule
 * Reschedule an appointment
 */
export async function handleRescheduleAppointment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const appointmentId = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id as string);
    const validated = RescheduleAppointmentSchema.parse(req.body);
    const isClient = req.user.role === "CLIENT";

    const appointment = await appointmentService.rescheduleAppointment(
      appointmentId,
      req.user.id,
      isClient,
      validated
    );

    res.status(200).json({
      success: true,
      message: "Appointment rescheduled successfully.",
      data: appointment,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      res.status(400).json({
        success: false,
        message: "Invalid reschedule parameters.",
        errors: error.flatten().fieldErrors,
      });
      return;
    }
    if (error instanceof Error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
      return;
    }
    next(error);
  }
}

/**
 * PUT /api/v1/appointments/:id/cancel
 * Cancel an appointment
 */
export async function handleCancelAppointment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const appointmentId = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id as string);
    const isClient = req.user.role === "CLIENT";
    const reason = req.body?.reason || req.body?.notes;

    const appointment = await appointmentService.cancelAppointment(
      appointmentId,
      req.user.id,
      isClient,
      reason
    );

    res.status(200).json({
      success: true,
      message: "Appointment cancelled successfully.",
      data: appointment,
    });
  } catch (error: any) {
    if (error instanceof Error) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
}

/**
 * PUT /api/v1/appointments/:id/status
 * Admin updates appointment status (e.g. COMPLETED, NO_SHOW)
 */
export async function handleUpdateAppointmentStatus(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const appointmentId = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id as string);
    const validated = UpdateAppointmentStatusSchema.parse(req.body);

    const appointment = await appointmentService.updateAppointmentStatus(
      appointmentId,
      req.user.id,
      validated
    );

    res.status(200).json({
      success: true,
      message: `Appointment status updated to ${validated.status}.`,
      data: appointment,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      res.status(400).json({
        success: false,
        message: "Invalid status update data.",
        errors: error.flatten().fieldErrors,
      });
      return;
    }
    if (error instanceof Error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
      return;
    }
    next(error);
  }
}
