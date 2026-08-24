import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { cacheResponse, invalidateCacheTags } from "../../middlewares/cache.middleware";
import {
  handleGetActivePlans,
  handleGetAllAdminPlans,
  handleGetAdminPlanById,
  handleCreatePlan,
  handleUpdatePlan,
  handleChangePlanStatus,
  handleGetAllServices,
  handleCreateService,
  handleUpdateService,
} from "./plan.controller";

const router = Router();

// Public / Client routes (Cached 1 hour)
router.get("/active", cacheResponse({ ttlSeconds: 3600, tags: ["plans"] }), handleGetActivePlans);

// Admin Plan Management
router.get(
  "/admin/all",
  authenticate,
  cacheResponse({ ttlSeconds: 600, tags: ["plans", "admin_plans"], isPrivate: true }),
  handleGetAllAdminPlans
);

router.get(
  "/admin/:id",
  authenticate,
  cacheResponse({ ttlSeconds: 600, tags: ["plans"], isPrivate: true }),
  handleGetAdminPlanById
);

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

// Admin Service Catalog
router.get(
  "/services/all",
  authenticate,
  cacheResponse({ ttlSeconds: 1800, tags: ["services", "plans"], isPrivate: true }),
  handleGetAllServices
);

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

export default router;
