import { Request, Response } from "express";
import {
  createOffDay,
  updateOffDay,
  deleteOffDay,
  getActiveOffDays,
  getAdminOffDays,
  getOffDayById,
  getConflictingAppointmentsForRange,
} from "./off-day.service";
import {
  createOffDaySchema,
  updateOffDaySchema,
  queryOffDaysSchema,
  previewConflictsSchema,
} from "./off-day.validation";

/**
 * CLIENT / PUBLIC: Get Active Off-Days for scheduling calendars
 */
export async function handleGetActiveOffDays(req: Request, res: Response) {
  try {
    const year = req.query.year ? parseInt(String(req.query.year), 10) : undefined;
    const month = req.query.month ? parseInt(String(req.query.month), 10) : undefined;

    const data = await getActiveOffDays({ year, month });
    res.status(200).json({
      success: true,
      data,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message || "Failed to retrieve off-days.",
    });
  }
}

/**
 * ADMIN: Get All Off-Days with filters & metrics
 */
export async function handleGetAdminOffDays(req: Request, res: Response) {
  try {
    const query = queryOffDaysSchema.parse(req.query);
    const result = await getAdminOffDays(query);

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
      message: err.message || "Failed to retrieve off-days.",
    });
  }
}

/**
 * ADMIN: Get Single Off-Day by ID
 */
export async function handleGetOffDayById(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const data = await getOffDayById(id);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err: any) {
    res.status(404).json({
      success: false,
      message: err.message || "Off-day not found.",
    });
  }
}

/**
 * ADMIN: Preview Conflicts for a proposed date range
 */
export async function handlePreviewConflicts(req: Request, res: Response) {
  try {
    const input = previewConflictsSchema.parse(req.body);
    const conflicts = await getConflictingAppointmentsForRange(
      input.startDate,
      input.endDate,
    );

    res.status(200).json({
      success: true,
      data: {
        conflicts,
        conflictCount: conflicts.length,
      },
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to check appointment conflicts.",
    });
  }
}

/**
 * ADMIN: Create new Off-Day
 */
export async function handleCreateOffDay(req: Request, res: Response) {
  try {
    const actorUserId = (req as any).user?.id;
    const validated = createOffDaySchema.parse(req.body);

    const data = await createOffDay(actorUserId, validated);

    res.status(201).json({
      success: true,
      message: `Off-day "${data.title}" created successfully.${
        data.conflictCount > 0
          ? ` Note: ${data.conflictCount} scheduled visit(s) fall on this off-day.`
          : ""
      }`,
      data,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to create off-day.",
    });
  }
}

/**
 * ADMIN: Update Off-Day
 */
export async function handleUpdateOffDay(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const actorUserId = (req as any).user?.id;
    const validated = updateOffDaySchema.parse(req.body);

    const data = await updateOffDay(id, actorUserId, validated);

    res.status(200).json({
      success: true,
      message: `Off-day "${data.title}" updated successfully.`,
      data,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to update off-day.",
    });
  }
}

/**
 * ADMIN: Delete Off-Day
 */
export async function handleDeleteOffDay(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const actorUserId = (req as any).user?.id;

    const result = await deleteOffDay(id, actorUserId);

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to delete off-day.",
    });
  }
}
