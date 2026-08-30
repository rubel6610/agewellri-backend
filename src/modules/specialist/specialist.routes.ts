import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { cacheResponse, invalidateCacheTags } from "../../middlewares/cache.middleware";
import {
  handleGetAllSpecialists,
  handleGetSpecialistById,
  handleCreateSpecialist,
  handleUpdateSpecialist,
  handleDeleteSpecialist,
  handleAssignSpecialist,
} from "./specialist.controller";

const router = Router();

// Public / Authenticated read (Real-time live data)
router.get("/", authenticate, handleGetAllSpecialists);

router.get("/:id", authenticate, handleGetSpecialistById);

// Admin-only management
router.post(
  "/",
  authenticate,
  invalidateCacheTags("specialists"),
  handleCreateSpecialist
);

router.put(
  "/:id",
  authenticate,
  invalidateCacheTags("specialists"),
  handleUpdateSpecialist
);

router.delete(
  "/:id",
  authenticate,
  invalidateCacheTags("specialists"),
  handleDeleteSpecialist
);

router.post(
  "/assign",
  authenticate,
  invalidateCacheTags("specialists", "clients"),
  handleAssignSpecialist
);

export default router;
