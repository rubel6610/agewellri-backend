import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import * as planService from "./plan.service";
import {
  createPlanSchema,
  updatePlanSchema,
  changePlanStatusSchema,
} from "./plan.validation";

/**
 * GET /api/v1/plans/active
 * Public/authenticated client endpoint returning all active plans.
 */
export async function handleGetActivePlans(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const plans = await planService.getActivePlans();
    res.status(200).json({
      success: true,
      message: "Active service plans retrieved successfully.",
      data: plans,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/plans/admin/all
 * Admin endpoint to list all plans with subscriber metrics.
 */
export async function handleGetAllAdminPlans(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const plans = await planService.getAllAdminPlans();
    res.status(200).json({
      success: true,
      message: "Admin plans retrieved successfully.",
      data: plans,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/plans/admin/:id
 * Admin endpoint to view full plan details and active subscribers.
 */
export async function handleGetAdminPlanById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const plan = await planService.getAdminPlanById(req.params.id as string);
    res.status(200).json({
      success: true,
      message: "Plan details retrieved.",
      data: plan,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/plans/admin
 * Admin endpoint to create a new service plan.
 */
export async function handleCreatePlan(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const parseResult = createPlanSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: "Validation failed.",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const newPlan = await planService.createPlan(parseResult.data, req.user.id);
    res.status(201).json({
      success: true,
      message: `Plan "${newPlan.name}" created successfully.`,
      data: newPlan,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/v1/plans/admin/:id
 * Admin endpoint to update an existing plan.
 */
export async function handleUpdatePlan(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const parseResult = updatePlanSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: "Validation failed.",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const updatedPlan = await planService.updatePlan(
      req.params.id as string,
      parseResult.data,
      req.user.id
    );

    res.status(200).json({
      success: true,
      message: `Plan "${updatedPlan.name}" updated successfully.`,
      data: updatedPlan,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/v1/plans/admin/:id/status
 * Admin endpoint to activate, deactivate or archive a plan.
 */
export async function handleChangePlanStatus(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const parseResult = changePlanStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: "Validation failed.",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const updated = await planService.changePlanStatus(
      req.params.id as string,
      parseResult.data,
      req.user.id
    );

    res.status(200).json({
      success: true,
      message: `Plan status updated to ${parseResult.data.status}.`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/v1/plans/admin/:id
 * Admin endpoint to delete a plan permanently.
 */
export async function handleDeletePlan(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const result = await planService.deletePlan(req.params.id as string, req.user.id);
    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
