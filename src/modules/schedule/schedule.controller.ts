import { Request, Response } from "express";
import {
  getOrCreateDefaultWeeklySchedule,
  updateWeeklySchedule,
  getScheduleOverrides,
  getScheduleOverrideById,
  createScheduleOverride,
  updateScheduleOverride,
  deleteScheduleOverride,
  calculateDateAvailability,
  getCalendarRangeAvailability,
  previewOverrideConflicts,
} from "./schedule.service";
import {
  updateWeeklyScheduleSchema,
  createScheduleOverrideSchema,
  updateScheduleOverrideSchema,
  queryOverridesSchema,
  queryAvailabilitySchema,
  queryCalendarScheduleSchema,
} from "./schedule.validation";

/**
 * GET /api/v1/schedule/weekly
 * Get default weekly schedule
 */
export async function handleGetWeeklySchedule(_req: Request, res: Response) {
  try {
    const weekly = await getOrCreateDefaultWeeklySchedule();
    res.status(200).json({
      success: true,
      data: weekly,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message || "Failed to retrieve weekly schedule.",
    });
  }
}

/**
 * PUT /api/v1/schedule/weekly
 * Update default weekly schedule (Admin)
 */
export async function handleUpdateWeeklySchedule(req: Request, res: Response) {
  try {
    const actorUserId = (req as any).user?.id;
    const validated = updateWeeklyScheduleSchema.parse(req.body);
    const updated = await updateWeeklySchedule(actorUserId, validated);

    res.status(200).json({
      success: true,
      message: "Weekly schedule updated successfully.",
      data: updated,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to update weekly schedule.",
    });
  }
}

/**
 * GET /api/v1/schedule/calendar
 * Get month / range schedule availability overview for Admin & Calendar views
 */
export async function handleGetCalendarSchedule(req: Request, res: Response) {
  try {
    const validated = queryCalendarScheduleSchema.parse(req.query);
    const result = await getCalendarRangeAvailability(
      validated.startDate,
      validated.endDate,
      {
        durationMinutes: validated.durationMinutes,
        technicianId: validated.technicianId,
      }
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to retrieve calendar schedule.",
    });
  }
}

/**
 * GET /api/v1/schedule/availability
 * Single date authoritative availability (Available slots, booked slots, holidays, closures)
 */
export async function handleGetDateAvailability(req: Request, res: Response) {
  try {
    const validated = queryAvailabilitySchema.parse(req.query);
    const result = await calculateDateAvailability(validated.date, {
      durationMinutes: validated.durationMinutes,
      clientId: validated.clientId,
      technicianId: validated.technicianId,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to retrieve date availability.",
    });
  }
}

/**
 * GET /api/v1/schedule/overrides
 * List schedule overrides (Admin)
 */
export async function handleGetScheduleOverrides(req: Request, res: Response) {
  try {
    const query = queryOverridesSchema.parse(req.query);
    const result = await getScheduleOverrides(query);

    res.status(200).json({
      success: true,
      data: result.items,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        metrics: result.metrics,
      },
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to retrieve schedule overrides.",
    });
  }
}

/**
 * GET /api/v1/schedule/overrides/:id
 * Get single schedule override (Admin)
 */
export async function handleGetScheduleOverrideById(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const data = await getScheduleOverrideById(id);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err: any) {
    res.status(404).json({
      success: false,
      message: err.message || "Schedule override not found.",
    });
  }
}

/**
 * POST /api/v1/schedule/overrides
 * Create new schedule override (Date or Week)
 */
export async function handleCreateScheduleOverride(req: Request, res: Response) {
  try {
    const actorUserId = (req as any).user?.id;
    const validated = createScheduleOverrideSchema.parse(req.body);
    const data = await createScheduleOverride(actorUserId, validated);

    res.status(201).json({
      success: true,
      message: `Schedule override "${data.title}" created successfully.${
        data.conflictCount > 0
          ? ` Note: ${data.conflictCount} scheduled visit(s) fall on this overridden period.`
          : ""
      }`,
      data,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to create schedule override.",
    });
  }
}

/**
 * PATCH /api/v1/schedule/overrides/:id
 * Update schedule override
 */
export async function handleUpdateScheduleOverride(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const actorUserId = (req as any).user?.id;
    const validated = updateScheduleOverrideSchema.parse(req.body);
    const data = await updateScheduleOverride(id, actorUserId, validated);

    res.status(200).json({
      success: true,
      message: `Schedule override "${data.title}" updated successfully.`,
      data,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to update schedule override.",
    });
  }
}

/**
 * DELETE /api/v1/schedule/overrides/:id
 * Delete schedule override
 */
export async function handleDeleteScheduleOverride(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const actorUserId = (req as any).user?.id;
    const result = await deleteScheduleOverride(id, actorUserId);

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to remove schedule override.",
    });
  }
}

/**
 * POST /api/v1/schedule/preview-conflicts
 * Preview appointment conflicts for a proposed date range
 */
export async function handlePreviewConflicts(req: Request, res: Response) {
  try {
    const { startDate, endDate } = req.body;
    if (!startDate) {
      res.status(400).json({ success: false, message: "startDate is required." });
      return;
    }
    const data = await previewOverrideConflicts(startDate, endDate);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to check appointment conflicts.",
    });
  }
}
