import { Request, Response } from "express";
import {
  getAssessmentTemplate,
  submitAssessment,
  uploadVisitReport,
  getReportFileForDownload,
  getReportByAppointmentId,
  getReportById,
  getMyReports,
  getAdminReports,
} from "./report.service";
import { SubmitAssessmentInputSchema } from "./report.validation";

/**
 * ADMIN: Upload & Publish Technician Visit PDF Report
 */
export async function handleUploadReport(req: Request, res: Response) {
  try {
    const actorUserId = (req as any).user?.id;
    const actorRole = (req as any).user?.role;

    if (actorRole !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only administrators can upload visit reports.",
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No PDF file attached. Please select a valid PDF visit report.",
      });
    }

    const appointmentId = req.body.appointmentId;
    if (!appointmentId) {
      return res.status(400).json({
        success: false,
        message: "appointmentId is required to attach the report.",
      });
    }

    const report = await uploadVisitReport(actorUserId, {
      appointmentId,
      file,
      title: req.body.title,
      summary: req.body.summary,
      notes: req.body.notes,
    });

    res.status(201).json({
      success: true,
      message: "Visit report PDF uploaded and published to client portal successfully.",
      data: report,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to upload visit report.",
    });
  }
}

/**
 * Authenticated: Download or Stream Report PDF File
 */
export async function handleDownloadReportFile(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const user = (req as any).user;
    const isInline = req.query.inline === "true" || req.path.endsWith("/file") || req.path.endsWith("/view");

    const fileInfo = await getReportFileForDownload(id, user);

    res.setHeader("Content-Type", fileInfo.mimeType);
    res.setHeader(
      "Content-Disposition",
      `${isInline ? "inline" : "attachment"}; filename="${encodeURIComponent(fileInfo.fileName)}"`
    );

    res.sendFile(fileInfo.filePath);
  } catch (err: any) {
    res.status(err.message?.includes("authorized") ? 403 : 404).json({
      success: false,
      message: err.message || "Failed to download report document.",
    });
  }
}

/**
 * Public/Authenticated: Get active 50-point Assessment Template
 */
export async function handleGetAssessmentTemplate(req: Request, res: Response) {
  try {
    const template = await getAssessmentTemplate();
    res.status(200).json({
      success: true,
      data: template,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message || "Failed to retrieve assessment template.",
    });
  }
}

/**
 * ADMIN: Submit and Complete Home Safety Assessment & Report
 */
export async function handleSubmitAssessment(req: Request, res: Response) {
  try {
    const actorUserId = (req as any).user?.id;
    const actorRole = (req as any).user?.role;

    if (actorRole !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only administrators and certified specialists can complete assessments.",
      });
    }

    const validatedInput = SubmitAssessmentInputSchema.parse(req.body);
    const report = await submitAssessment(actorUserId, validatedInput);

    res.status(201).json({
      success: true,
      message: "Age Safe® Home Score™ assessment completed and report generated successfully.",
      data: report,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message: err.message || "Failed to submit assessment.",
    });
  }
}

/**
 * Authenticated: Get Report by Appointment ID
 */
export async function handleGetReportByAppointmentId(req: Request, res: Response) {
  try {
    const appointmentId = String(req.params.appointmentId);
    const user = (req as any).user;

    const report = await getReportByAppointmentId(appointmentId, user);
    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (err: any) {
    res.status(404).json({
      success: false,
      message: err.message || "Report not found for this appointment.",
    });
  }
}

/**
 * Authenticated: Get Single Report by ID
 */
export async function handleGetReportById(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const user = (req as any).user;

    const report = await getReportById(id, user);
    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (err: any) {
    res.status(404).json({
      success: false,
      message: err.message || "Report not found.",
    });
  }
}

/**
 * CLIENT: Get My Finalized Reports
 */
export async function handleGetMyReports(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    const reports = await getMyReports(userId);

    res.status(200).json({
      success: true,
      data: reports,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message || "Failed to retrieve your safety reports.",
    });
  }
}

/**
 * ADMIN: Get All Client Reports with Filters
 */
export async function handleGetAdminReports(req: Request, res: Response) {
  try {
    const actorRole = (req as any).user?.role;
    if (actorRole !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Admin privileges required.",
      });
    }

    const { search, status, clientId, page, limit } = req.query;

    const reports = await getAdminReports({
      search: search ? String(search) : undefined,
      status: status ? String(status) : undefined,
      clientId: clientId ? String(clientId) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    res.status(200).json({
      success: true,
      data: reports,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message || "Failed to retrieve reports.",
    });
  }
}

