import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  handleScheduleClientAppointment,
  handleScheduleAdminAppointment,
  handleGetClientAppointments,
  handleGetAdminAppointments,
  handleGetAppointmentById,
  handleRescheduleAppointment,
  handleCancelAppointment,
  handleUpdateAppointmentStatus,
} from "./appointment.controller";

const router = Router();

// Protected Client Routes
router.get("/my", authenticate, handleGetClientAppointments);
router.post("/schedule", authenticate, handleScheduleClientAppointment);

// Protected Admin Routes
router.get("/admin", authenticate, handleGetAdminAppointments);
router.post("/admin/schedule", authenticate, handleScheduleAdminAppointment);
router.put("/:id/status", authenticate, handleUpdateAppointmentStatus);

// Shared Protected Routes (Client/Admin with ownership check)
router.get("/:id", authenticate, handleGetAppointmentById);
router.put("/:id/reschedule", authenticate, handleRescheduleAppointment);
router.put("/:id/cancel", authenticate, handleCancelAppointment);

export default router;
