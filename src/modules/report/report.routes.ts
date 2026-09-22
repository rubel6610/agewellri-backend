import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { handleReportFileUpload } from "../../middlewares/upload.middleware";
import {
  handleGetAssessmentTemplate,
  handleSubmitAssessment,
  handleUploadReport,
  handleDownloadReportFile,
  handleGetReportByAppointmentId,
  handleGetReportById,
  handleGetMyReports,
  handleGetAdminReports,
  handleDeleteReport,
} from "./report.controller";

const router = Router();

// Public / Authenticated Assessment Template
router.get("/template", handleGetAssessmentTemplate);
router.get("/assessment-template", handleGetAssessmentTemplate);

// Client Protected Routes
router.get("/my", authenticate, handleGetMyReports);
router.get("/appointment/:appointmentId", authenticate, handleGetReportByAppointmentId);

// Admin Protected Routes
router.post("/upload", authenticate, handleReportFileUpload, handleUploadReport);
router.post("/assessment", authenticate, handleSubmitAssessment);
router.post("/create", authenticate, handleSubmitAssessment);
router.get("/admin/all", authenticate, handleGetAdminReports);
router.delete("/admin/:id", authenticate, handleDeleteReport);

// Secure Download & Inline View Endpoints (Owner or Admin)
router.get("/:id/download", authenticate, handleDownloadReportFile);
router.get("/:id/file", authenticate, handleDownloadReportFile);
router.get("/:id/view", authenticate, handleDownloadReportFile);

// Single Report metadata by ID (Owner or Admin)
router.get("/:id", authenticate, handleGetReportById);
router.delete("/:id", authenticate, handleDeleteReport);

export default router;
