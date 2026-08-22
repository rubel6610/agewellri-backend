import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  handleGetAllSpecialists,
  handleGetSpecialistById,
  handleCreateSpecialist,
  handleUpdateSpecialist,
  handleDeleteSpecialist,
  handleAssignSpecialist,
} from "./specialist.controller";

const router = Router();

// Public / Authenticated read
router.get("/", authenticate, handleGetAllSpecialists);
router.get("/:id", authenticate, handleGetSpecialistById);

// Admin-only management
router.post("/", authenticate, handleCreateSpecialist);
router.put("/:id", authenticate, handleUpdateSpecialist);
router.delete("/:id", authenticate, handleDeleteSpecialist);
router.post("/assign", authenticate, handleAssignSpecialist);

export default router;
