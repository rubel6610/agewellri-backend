import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import * as specialistService from "./specialist.service";
import {
  createSpecialistSchema,
  updateSpecialistSchema,
  assignSpecialistSchema,
} from "./specialist.validation";
import sendResponse from "../../utils/sendResponse";

/**
 * GET /api/v1/specialists
 * List all specialists.
 */
export async function handleGetAllSpecialists(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const specialists = await specialistService.getAllSpecialists();
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Specialists retrieved successfully.",
      data: specialists,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/specialists/:id
 * Get specialist details.
 */
export async function handleGetSpecialistById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const specialist = await specialistService.getSpecialistById(req.params.id as string);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Specialist retrieved.",
      data: specialist,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/specialists
 * Admin creates a new specialist.
 */
export async function handleCreateSpecialist(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      sendResponse(res, {
        statusCode: 403,
        success: false,
        message: "Admin authorization required.",
      });
      return;
    }

    const parseResult = createSpecialistSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Invalid specialist data.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const created = await specialistService.createSpecialist(parseResult.data, req.user.id);
    sendResponse(res, {
      statusCode: 201,
      success: true,
      message: "Specialist created successfully.",
      data: created,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/v1/specialists/:id
 * Admin updates specialist.
 */
export async function handleUpdateSpecialist(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      sendResponse(res, {
        statusCode: 403,
        success: false,
        message: "Admin authorization required.",
      });
      return;
    }

    const parseResult = updateSpecialistSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Invalid specialist data.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const updated = await specialistService.updateSpecialist(
      req.params.id as string,
      parseResult.data,
      req.user.id
    );

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Specialist updated successfully.",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/v1/specialists/:id
 * Admin archives specialist.
 */
export async function handleDeleteSpecialist(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      sendResponse(res, {
        statusCode: 403,
        success: false,
        message: "Admin authorization required.",
      });
      return;
    }

    const archived = await specialistService.deleteSpecialist(
      req.params.id as string,
      req.user.id
    );

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Specialist archived successfully.",
      data: archived,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/specialists/assign
 * Assign specialist to appointment.
 */
export async function handleAssignSpecialist(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      sendResponse(res, {
        statusCode: 403,
        success: false,
        message: "Admin authorization required.",
      });
      return;
    }

    const parseResult = assignSpecialistSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendResponse(res, {
        statusCode: 400,
        success: false,
        message: "Invalid assignment data.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const assigned = await specialistService.assignSpecialistToAppointment(
      parseResult.data,
      req.user.id
    );

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Specialist assigned to appointment successfully.",
      data: assigned,
    });
  } catch (error) {
    next(error);
  }
}
