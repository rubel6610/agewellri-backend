import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { invalidateCacheTags } from "../../middlewares/cache.middleware";
import {
  handleGetActivePlans,
  handleGetAllAdminPlans,
  handleGetAdminPlanById,
  handleCreatePlan,
  handleUpdatePlan,
  handleChangePlanStatus,
  handleDeletePlan,
  handleGetServiceStats,
  handleGetAllServices,
  handleCreateService,
  handleUpdateService,
  handleChangeServiceStatus,
  handleDeleteService,
} from "./plan.controller";

const router = Router();

// Public / Client routes (Real-time live plans)
router.get("/active", handleGetActivePlans);

// Admin Plan Management (Real-time live data, no browser caching)
router.get("/admin/all", authenticate, handleGetAllAdminPlans);

router.get("/admin/:id", authenticate, handleGetAdminPlanById);

router.post(
  "/admin",
  authenticate,
  invalidateCacheTags("plans", "admin_plans"),
  handleCreatePlan
);

router.put(
  "/admin/:id",
  authenticate,
  invalidateCacheTags("plans", "admin_plans"),
  handleUpdatePlan
);

router.patch(
  "/admin/:id/status",
  authenticate,
  invalidateCacheTags("plans", "admin_plans"),
  handleChangePlanStatus
);

router.delete(
  "/admin/:id",
  authenticate,
  invalidateCacheTags("plans", "admin_plans"),
  handleDeletePlan
);

// Admin Service Catalog (Real-time live data, no browser caching)
router.get("/services/stats", authenticate, handleGetServiceStats);

router.get("/services/all", authenticate, handleGetAllServices);

router.post(
  "/services",
  authenticate,
  invalidateCacheTags("services", "plans"),
  handleCreateService
);

router.put(
  "/services/:id",
  authenticate,
  invalidateCacheTags("services", "plans"),
  handleUpdateService
);

router.patch(
  "/services/:id/status",
  authenticate,
  invalidateCacheTags("services", "plans"),
  handleChangeServiceStatus
);

router.delete(
  "/services/:id",
  authenticate,
  invalidateCacheTags("services", "plans"),
  handleDeleteService
);

export default router;
