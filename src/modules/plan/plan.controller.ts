import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import * as planService from "./plan.service";
import {
  createPlanSchema,
  updatePlanSchema,
  changePlanStatusSchema,
  createServiceSchema,
  updateServiceSchema,
} from "./plan.validation";

/**
 * GET /api/v1/plans/active
 * Public/authenticated client endpoint returning all active plans with dynamic pricing and services.
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
 * Admin endpoint to list all plans with version counts and subscriber metrics.
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
 * Admin endpoint to view full plan version history and active subscribers.
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
        message: "Invalid plan creation parameters.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const createdPlan = await planService.createPlan(parseResult.data, req.user.id);
    res.status(201).json({
      success: true,
      message: "Service plan created successfully.",
      data: createdPlan,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/v1/plans/admin/:id
 * Admin endpoint to edit a service plan (automatically creates new PlanVersion if subscribers exist).
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
        message: "Invalid plan update parameters.",
        errors: parseResult.error.flatten().fieldErrors,
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
      message: "Service plan updated successfully.",
      data: updatedPlan,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/v1/plans/admin/:id/status
 * Admin endpoint to activate, deactivate, or archive a plan.
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
        message: "Invalid status parameter.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await planService.changePlanStatus(
      req.params.id as string,
      parseResult.data,
      req.user.id
    );

    res.status(200).json({
      success: true,
      message: `Plan status changed to ${parseResult.data.status}.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/v1/plans/admin/:id
 * Admin endpoint to permanently delete a service plan.
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
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to delete service plan.",
    });
  }
}

/**
 * Service Catalog Handlers
 */
export async function handleGetServiceStats(
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const stats = await planService.getServiceCatalogStats();
    res.status(200).json({
      success: true,
      message: "Service catalog statistics retrieved.",
      data: stats,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleGetAllServices(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;

    const services = await planService.getAllServices({
      includeInactive,
      category,
      search,
    });

    res.status(200).json({
      success: true,
      message: "Services catalog retrieved.",
      data: services,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleCreateService(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const parseResult = createServiceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: "Invalid service parameters.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const service = await planService.createService(parseResult.data, req.user.id);
    res.status(201).json({
      success: true,
      message: "Service created successfully.",
      data: service,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleUpdateService(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const parseResult = updateServiceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: "Invalid service update parameters.",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const service = await planService.updateService(
      req.params.id as string,
      parseResult.data,
      req.user.id
    );

    res.status(200).json({
      success: true,
      message: "Service updated successfully.",
      data: service,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleChangeServiceStatus(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const { isActive } = req.body;
    if (typeof isActive !== "boolean") {
      res.status(400).json({
        success: false,
        message: "Boolean 'isActive' field is required.",
      });
      return;
    }

    const service = await planService.changeServiceStatus(
      req.params.id as string,
      isActive,
      req.user.id
    );

    res.status(200).json({
      success: true,
      message: `Service successfully ${isActive ? "activated" : "deactivated"}.`,
      data: service,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleDeleteService(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin authorization required." });
      return;
    }

    const result = await planService.deleteService(
      req.params.id as string,
      req.user.id
    );

    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
