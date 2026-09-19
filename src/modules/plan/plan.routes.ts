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

export default router;
