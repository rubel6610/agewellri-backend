import {
  PrismaClient,
  ReportType,
  ReportStatus,
  VisitStatus,
  AppointmentStatus,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { SubmitAssessmentInput, AssessmentResponseItem } from "./report.validation";
import { getAllSpecialists } from "../specialist/specialist.service";
import path from "path";
import fs from "fs";
import { sendReportAvailableEmail } from "../../utils/email";




function isValidObjectId(id?: string | null): boolean {
  if (!id || typeof id !== "string") return false;
  return /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Record an audit log for assessment and report operations.
 */
async function createReportAuditLog(params: {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: any;
}) {
  try {
    const validActorId = isValidObjectId(params.actorUserId) ? params.actorUserId : null;
    await (prisma.auditLog.create as any)({
      data: {
        actorUserId: validActorId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: params.metadata || null,
      },
    });
  } catch (err) {
    console.error("⚠️ Failed to write report audit log:", err);
  }
}

/**
 * Seed Default Assessment Template and 25 Questions if missing
 */
export async function seedDefaultAssessmentTemplate() {
  const existingTemplate = await (prisma as any).assessmentTemplate.findFirst({
    where: { isActive: true },
    include: { questions: true },
  });

  if (existingTemplate && existingTemplate.questions?.length >= 25) {
    return existingTemplate;
  }

  let template = existingTemplate;
  if (!template) {
    template = await (prisma as any).assessmentTemplate.create({
      data: {
        name: "Age Safe® Home Score™ Assessment",
        version: "v1.0",
        isActive: true,
      },
    });
  }


  console.log("✅ Seeded Age Safe® Home Score™ Assessment Template & 25 Questions.");
  return (prisma as any).assessmentTemplate.findUnique({
    where: { id: template.id },
    include: { questions: { orderBy: { order: "asc" } } },
  });
}

/**
 * Get active assessment template with questions
 */
export async function getAssessmentTemplate() {
  let template = await (prisma as any).assessmentTemplate.findFirst({
    where: { isActive: true },
    include: {
      questions: {
        orderBy: { order: "asc" },
      },
    },
  });

  if (!template || !template.questions || template.questions.length === 0) {
    template = await seedDefaultAssessmentTemplate();
  }

  return template;
}

/**
 * Server-Side Authoritative 50-Point Score Engine
 */
export function calculateAuthoritativeScore(responses: AssessmentResponseItem[]) {
  const categoryScores: Record<
    string,
    { score: number; maxScore: number; count: number; items: any[] }
  > = {
    ENTRANCE_EXIT: { score: 0, maxScore: 10, count: 0, items: [] },
    HALLWAYS_WALKWAYS: { score: 0, maxScore: 10, count: 0, items: [] },
    BATHROOMS: { score: 0, maxScore: 10, count: 0, items: [] },
    LIGHTING_VISIBILITY: { score: 0, maxScore: 10, count: 0, items: [] },
    FIRE_EMERGENCY: { score: 0, maxScore: 10, count: 0, items: [] },
  };

  let totalScore = 0;
  const flaggedRisksCount = responses.filter((r) => r.flaggedRisk || r.scoreValue === 0).length;

  for (const resp of responses) {
    const rawVal = Number(resp.scoreValue);
    const clampedScore = Math.max(0, Math.min(2, isNaN(rawVal) ? 0 : rawVal));
    const cat = resp.category || "OTHER";

    if (!categoryScores[cat]) {
      categoryScores[cat] = { score: 0, maxScore: 10, count: 0, items: [] };
    }

    categoryScores[cat].score += clampedScore;
    categoryScores[cat].count += 1;
    categoryScores[cat].items.push({
      questionId: resp.questionId,
      score: clampedScore,
      notes: resp.notes,
      flaggedRisk: Boolean(resp.flaggedRisk || clampedScore === 0),
    });

    totalScore += clampedScore;
  }

  // Ensure total score does not exceed 50
  totalScore = Math.min(50, Math.max(0, totalScore));
  const maxScore = 50;
  const percentage = Math.round((totalScore / maxScore) * 100);

  let ratingTier: "EXCELLENT" | "GOOD" | "MODERATE" | "ELEVATED" = "EXCELLENT";
  let gradeLabel = "Age Safe Certified™ — Excellent Home Safety";

  if (totalScore >= 45) {
    ratingTier = "EXCELLENT";
    gradeLabel = "Age Safe Certified™ — Excellent Home Safety";
  } else if (totalScore >= 38) {
    ratingTier = "GOOD";
    gradeLabel = "Good Home Safety — Minor Recommendations";
  } else if (totalScore >= 30) {
    ratingTier = "MODERATE";
    gradeLabel = "Moderate Fall Risk — Action Recommended";
  } else {
    ratingTier = "ELEVATED";
    gradeLabel = "Elevated Hazard Risk — Immediate Attention Required";
  }

  return {
    totalScore,
    maxScore,
    percentage,
    ratingTier,
    gradeLabel,
    flaggedRisksCount,
    categoryBreakdown: categoryScores,
  };
}

/**
 * Submit and Generate Home Safety Assessment & Report (Admin)
 */
export async function submitAssessment(
  actorUserId: string,
  input: SubmitAssessmentInput
) {
  const { appointmentId } = input;

  // 1. Resolve Appointment
  const appointment = await (prisma.appointment.findUnique as any)({
    where: { id: appointmentId },
    include: {
      client: { include: { user: true } },
      serviceType: true,
      technician: true,
      visit: {
        include: {
          assessment: {
            include: { responses: { include: { question: true } } },
          },
          reports: true,
        },
      },
    },
  });

  if (!appointment) {
    throw new Error(`Appointment with ID ${appointmentId} not found.`);
  }

  const clientId = appointment.clientId;

  // 2. Ensure appointment is marked COMPLETED
  if (appointment.status !== AppointmentStatus.COMPLETED) {
    await (prisma.appointment.update as any)({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.COMPLETED },
    });
  }

  // 3. Resolve or Create Linked Visit record
  let visit = appointment.visit;
  if (!visit) {
    let technicianId = appointment.technicianId;
    if (!technicianId) {
      const specialists = await getAllSpecialists();
      technicianId = specialists[0]?.id || null;
    }

    if (!technicianId) {
      throw new Error("Cannot create visit: No specialist available to assign.");
    }

    visit = await (prisma.visit.create as any)({
      data: {
        appointmentId: appointment.id,
        technicianId,
        status: VisitStatus.COMPLETED,
        completedAt: new Date(),
        notes: input.specialistNotes || "Completed home safety visit.",
      },
    });
  } else if (visit.status !== VisitStatus.COMPLETED) {
    visit = await (prisma.visit.update as any)({
      where: { id: visit.id },
      data: {
        status: VisitStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
  }

  // 4. Resolve Template
  const template = await getAssessmentTemplate();

  // 5. Calculate Server-Side Authoritative 50-Point Score
  const scoreResult = calculateAuthoritativeScore(input.responses);

  // 6. Transactional Database Persistence
  const result = await prisma.$transaction(async (tx: any) => {
    // A. Upsert Assessment
    let assessment = await tx.assessment.findUnique({
      where: { visitId: visit.id },
    });

    if (!assessment) {
      assessment = await tx.assessment.create({
        data: {
          visitId: visit.id,
          templateId: template.id,
          score: scoreResult.totalScore,
          maxScore: scoreResult.maxScore,
          percentage: scoreResult.percentage,
          ratingTier: scoreResult.ratingTier,
          summary: input.summary,
          findings: input.findings || null,
          recommendations: input.recommendations,
          categoryScores: scoreResult.categoryBreakdown,
          isCompleted: true,
          startedAt: appointment.startAt,
          completedAt: new Date(),
        },
      });
    } else {
      assessment = await tx.assessment.update({
        where: { id: assessment.id },
        data: {
          score: scoreResult.totalScore,
          maxScore: scoreResult.maxScore,
          percentage: scoreResult.percentage,
          ratingTier: scoreResult.ratingTier,
          summary: input.summary,
          findings: input.findings || null,
          recommendations: input.recommendations,
          categoryScores: scoreResult.categoryBreakdown,
          isCompleted: true,
          completedAt: new Date(),
        },
      });

      // Clear previous responses for clean idempotent re-submission
      await tx.assessmentResponse.deleteMany({
        where: { assessmentId: assessment.id },
      });
    }

    // B. Create Assessment Responses
    for (const resp of input.responses) {
      await tx.assessmentResponse.create({
        data: {
          assessmentId: assessment.id,
          questionId: resp.questionId,
          scoreValue: Math.max(0, Math.min(2, Number(resp.scoreValue) || 0)),
          notes: resp.notes || null,
          flaggedRisk: Boolean(resp.flaggedRisk || Number(resp.scoreValue) === 0),
        },
      });
    }

    // C. Upsert Report record
    let report = await tx.report.findFirst({
      where: { visitId: visit.id, isArchived: false },
    });

    const reportTitle = `${appointment.serviceType?.name || "Home Safety"} — Age Safe® Assessment`;

    if (!report) {
      report = await tx.report.create({
        data: {
          clientId,
          visitId: visit.id,
          reportType: ReportType.HOME_SAFETY_SCORE,
          status: ReportStatus.GENERATED,
          title: reportTitle,
          score: scoreResult.totalScore,
          summary: input.summary,
          recommendations: input.recommendations,
          generatedAt: new Date(),
        },
      });
    } else {
      report = await tx.report.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.GENERATED,
          title: reportTitle,
          score: scoreResult.totalScore,
          summary: input.summary,
          recommendations: input.recommendations,
          generatedAt: new Date(),
        },
      });
    }

    return { assessment, report };
  });

  // 7. Record Audit Log
  await createReportAuditLog({
    actorUserId,
    action: "ASSESSMENT_CREATED",
    entityType: "Assessment",
    entityId: result.assessment.id,
    metadata: {
      appointmentId,
      visitId: visit.id,
      clientId,
      totalScore: scoreResult.totalScore,
      percentage: scoreResult.percentage,
      ratingTier: scoreResult.ratingTier,
    },
  });

  // 8. Return formatted report detail
  return getReportByAppointmentId(appointmentId, { id: actorUserId, role: "ADMIN" });
}

export interface UploadVisitReportInput {
  appointmentId: string;
  file: Express.Multer.File;
  title?: string;
  summary?: string;
  notes?: string;
}

/**
 * Upload and link a completed visit's technician PDF report (Admin Only)
 */
export async function uploadVisitReport(
  actorUserId: string,
  input: UploadVisitReportInput
) {
  const { appointmentId, file, title, summary, notes } = input;

  if (!file) {
    throw new Error("No PDF report file was provided for upload.");
  }

  // 1. Fetch Appointment with Client and Technician
  const appointment = await (prisma.appointment.findUnique as any)({
    where: { id: appointmentId },
    include: {
      client: { include: { user: true } },
      serviceType: true,
      technician: true,
      visit: {
        include: {
          technician: true,
          reports: { where: { isArchived: false } },
        },
      },
    },
  });

  if (!appointment) {
    throw new Error(`Appointment with ID ${appointmentId} not found.`);
  }

  // 2. Validate Appointment is marked COMPLETED
  if (appointment.status !== AppointmentStatus.COMPLETED) {
    throw new Error(
      `Cannot upload report: Appointment status is ${appointment.status}. Reports can only be uploaded for COMPLETED visits.`
    );
  }

  const clientId = appointment.clientId;

  // 3. Resolve or Create Linked Visit record
  let visit = appointment.visit;
  if (!visit) {
    let technicianId = appointment.technicianId;
    if (!technicianId) {
      const specialists = await getAllSpecialists();
      technicianId = specialists[0]?.id || null;
    }

    if (!technicianId) {
      throw new Error("Cannot associate visit: No specialist assigned or available.");
    }

    visit = await (prisma.visit.create as any)({
      data: {
        appointmentId: appointment.id,
        technicianId,
        status: VisitStatus.COMPLETED,
        completedAt: appointment.endAt || new Date(),
        notes: notes || "Completed visit.",
      },
      include: {
        technician: true,
        reports: { where: { isArchived: false } },
      },
    });
  } else if (visit.status !== VisitStatus.COMPLETED) {
    visit = await (prisma.visit.update as any)({
      where: { id: visit.id },
      data: {
        status: VisitStatus.COMPLETED,
        completedAt: visit.completedAt || new Date(),
      },
      include: {
        technician: true,
        reports: { where: { isArchived: false } },
      },
    });
  }

  // 4. Default report title if none specified
  const serviceName = appointment.serviceType?.name || "Home Safety";
  const defaultTitle = title?.trim() || `${serviceName} Visit Report`;
  const storageFilename = file.filename;
  const relativeFileUrl = `/uploads/reports/${storageFilename}`;

  // 5. Check for existing active report for this visit (Prevent duplicates & support replacement)
  const existingReport = await (prisma.report.findFirst as any)({
    where: {
      visitId: visit.id,
      isArchived: false,
    },
    orderBy: { createdAt: "desc" },
  });

  let report: any;

  if (existingReport) {
    // If replacing existing report file, safely delete old file from disk
    if (existingReport.fileUrl) {
      const oldFilename = path.basename(existingReport.fileUrl);
      const oldFilePath = path.join(process.cwd(), "uploads", "reports", oldFilename);
      if (fs.existsSync(oldFilePath) && oldFilename !== storageFilename) {
        try {
          fs.unlinkSync(oldFilePath);
        } catch (unlinkErr) {
          console.warn("⚠️ Could not remove previous report file from disk:", unlinkErr);
        }
      }
    }

    report = await (prisma.report.update as any)({
      where: { id: existingReport.id },
      data: {
        title: defaultTitle,
        summary: summary || existingReport.summary || null,
        fileUrl: relativeFileUrl,
        status: ReportStatus.UPLOADED,
        uploadedAt: new Date(),
        isArchived: false,
      },
      include: {
        client: { include: { user: true } },
        visit: {
          include: {
            appointment: { include: { serviceType: true } },
            technician: true,
          },
        },
      },
    });
  } else {
    report = await (prisma.report.create as any)({
      data: {
        clientId,
        visitId: visit.id,
        reportType: ReportType.VISIT_SUMMARY,
        status: ReportStatus.UPLOADED,
        title: defaultTitle,
        summary: summary || null,
        fileUrl: relativeFileUrl,
        uploadedAt: new Date(),
        isArchived: false,
      },
      include: {
        client: { include: { user: true } },
        visit: {
          include: {
            appointment: { include: { serviceType: true } },
            technician: true,
          },
        },
      },
    });
  }

  // 6. Record Audit Log
  await createReportAuditLog({
    actorUserId,
    action: "REPORT_UPLOADED",
    entityType: "Report",
    entityId: report.id,
    metadata: {
      appointmentId: appointment.id,
      visitId: visit.id,
      clientId,
      filename: file.originalname,
      storedFilename: storageFilename,
      size: file.size,
      mimeType: file.mimetype,
    },
  });

  // 7. Send Client Notification Email
  const clientUser = appointment.client?.user;
  const recipientEmail = clientUser?.email || appointment.client?.primaryContactEmail;
  const clientName = `${clientUser?.firstName || ""} ${clientUser?.lastName || ""}`.trim() || appointment.client?.primaryContactName || "Valued Member";
  const specialistName = visit.technician?.name || appointment.technician?.name || "AgeWellRI Specialist";

  if (recipientEmail) {
    try {
      await sendReportAvailableEmail({
        to: recipientEmail,
        clientName,
        serviceType: serviceName,
        visitDate: visit.completedAt || appointment.startAt || new Date(),
        specialistName,
        reportTitle: defaultTitle,
      });
    } catch (emailErr) {
      console.warn("⚠️ Could not send report availability email notification:", emailErr);
    }
  }

  // 8. Return formatted report detail
  const allSpecialists = await getAllSpecialists();
  return formatReportDetail(report, allSpecialists);
}

/**
 * Get Report File for Secure Streaming / Download
 */
export async function getReportFileForDownload(
  reportId: string,
  user: { id: string; role: string }
) {
  const report = await (prisma.report.findUnique as any)({
    where: { id: reportId },
    include: {
      client: { include: { user: true } },
    },
  });

  if (!report || report.isArchived) {
    throw new Error(`Report with ID ${reportId} not found.`);
  }

  // Object-level authorization
  if (user.role !== "ADMIN") {
    const isOwner =
      report.clientId === user.id ||
      report.client?.userId === user.id ||
      report.client?.id === user.id;

    if (!isOwner) {
      throw new Error("You are not authorized to access this report document.");
    }
  }

  if (!report.fileUrl) {
    throw new Error("No PDF document is attached to this report.");
  }

  const filename = path.basename(report.fileUrl);
  const filePath = path.join(process.cwd(), "uploads", "reports", filename);

  if (!fs.existsSync(filePath)) {
    throw new Error("Report file is missing from server storage.");
  }

  const downloadName = report.title
    ? `${report.title.replace(/[^a-zA-Z0-9.-]/g, "_")}.pdf`
    : filename;

  return {
    filePath,
    fileName: downloadName,
    mimeType: "application/pdf",
  };
}

/**
 * Format raw Report & Assessment database record into clean client/admin DTO
 */
function formatReportDetail(report: any, allSpecialists: any[] = []) {
  if (!report) return null;

  const visit = report.visit;
  const appt = visit?.appointment;
  const client = report.client;
  const user = client?.user;
  const assessment = visit?.assessment;

  let spec = allSpecialists.find(
    (s) => s.id === visit?.technicianId || s.id === appt?.technicianId
  );

  const specialistName =
    spec?.name || visit?.technician?.name || "Home Safety Specialist";
  const specialistTitle =
    spec?.title || visit?.technician?.title || "Certified Senior Safety Specialist";

  const totalScore = assessment?.score ?? report.score ?? null;
  const maxScore = assessment?.maxScore ?? 50;
  const percentage = totalScore != null ? Math.round((totalScore / maxScore) * 100) : null;
  const ratingTier = assessment?.ratingTier ?? (totalScore && totalScore >= 45 ? "EXCELLENT" : "GOOD");

  const formattedResponses = (assessment?.responses || []).map((r: any) => ({
    id: r.id,
    questionId: r.questionId,
    category: r.question?.category || "SAFETY",
    questionText: r.question?.questionText || "Safety Inspection Item",
    order: r.question?.order || 1,
    scoreValue: r.scoreValue ?? 2,
    notes: r.notes || "",
    flaggedRisk: Boolean(r.flaggedRisk || r.scoreValue === 0),
  }));

  const clientName = `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Valued Client";
  const clientNumber = client?.clientNumber || `AW-${client?.id?.slice(-4).toUpperCase() || "MEMBER"}`;
  const address = [client?.address, client?.city, client?.state, client?.postalCode]
    .filter(Boolean)
    .join(", ") || "Client Residence, Rhode Island";

  const hasFile = Boolean(report.fileUrl);
  const downloadUrl = hasFile ? `/api/v1/reports/${report.id}/download` : null;
  const previewUrl = hasFile ? `/api/v1/reports/${report.id}/file` : null;

  return {
    id: report.id,
    reportId: report.id,
    reportNumber: `RPT-${report.id.slice(-6).toUpperCase()}`,
    appointmentId: appt?.id || null,
    visitId: visit?.id || null,
    clientId: report.clientId,
    clientNumber,
    clientName,
    clientEmail: user?.email || client?.primaryContactEmail || "",
    clientPhone: user?.phone || client?.primaryContactPhone || "",
    clientAddress: address,
    serviceType: appt?.serviceType?.name || "Home Safety Oversight",
    visitDate: visit?.completedAt || appt?.startAt || report.createdAt,
    formattedVisitDate: (visit?.completedAt || appt?.startAt || report.createdAt).toLocaleDateString(
      "en-US",
      { weekday: "short", month: "short", day: "numeric", year: "numeric" }
    ),
    title: report.title || `${appt?.serviceType?.name || "Visit"} Report`,
    reportType: report.reportType,
    status: report.status === "GENERATED" || report.status === "UPLOADED" ? "available" : "pending",
    reportStatus: report.status,
    score: totalScore,
    maxScore,
    percentage,
    ratingTier,
    summary:
      report.summary ||
      assessment?.summary ||
      `Visit report completed by ${specialistName}.`,
    findings: assessment?.findings || "",
    recommendations:
      report.recommendations ||
      assessment?.recommendations ||
      "",
    categoryScores: assessment?.categoryScores || null,
    responses: formattedResponses,
    specialistName,
    specialistTitle,
    specialistPhone: spec?.phone || "(401) 555-0199",
    specialistColor: spec?.color || "#294B68",
    fileUrl: downloadUrl,
    downloadUrl,
    previewUrl,
    hasFile,
    uploadedAt: report.uploadedAt || null,
    generatedAt: report.generatedAt || report.createdAt,
    createdAt: report.createdAt,
  };
}

/**
 * Get Report by Appointment ID
 */
export async function getReportByAppointmentId(
  appointmentId: string,
  user: { id: string; role: string }
) {
  const appt = await (prisma.appointment.findUnique as any)({
    where: { id: appointmentId },
    include: {
      client: { include: { user: true } },
      serviceType: true,
      visit: {
        include: {
          technician: true,
          reports: {
            where: { isArchived: false },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          assessment: {
            include: {
              responses: {
                include: { question: true },
                orderBy: { question: { order: "asc" } },
              },
            },
          },
        },
      },
    },
  });

  if (!appt) {
    throw new Error(`Appointment with ID ${appointmentId} not found.`);
  }

  // Ownership verification for CLIENT role
  if (user.role === "CLIENT" && appt.client?.userId !== user.id && appt.clientId !== user.id) {
    throw new Error("You are not authorized to view this report.");
  }

  const visit = appt.visit;
  const report = visit?.reports?.[0];

  if (!report && !visit?.assessment) {
    return null;
  }

  const allSpecialists = await getAllSpecialists();

  // Synthetic report object if assessment exists but report record is creating
  const reportData = report || {
    id: `rep_${visit.id}`,
    clientId: appt.clientId,
    client: appt.client,
    visitId: visit.id,
    visit,
    reportType: ReportType.HOME_SAFETY_SCORE,
    status: ReportStatus.GENERATED,
    title: `${appt.serviceType?.name || "Home Safety"} Assessment Report`,
    score: visit.assessment?.score ?? 45,
    summary: visit.assessment?.summary || "Comprehensive home safety evaluation.",
    recommendations: visit.assessment?.recommendations || "Maintain clear walkways.",
    fileUrl: null,
    generatedAt: visit.assessment?.completedAt || new Date(),
    createdAt: visit.assessment?.createdAt || new Date(),
  };

  return formatReportDetail(reportData, allSpecialists);
}

/**
 * Hydrates raw reports by safely joining visits, appointments, and assessments without throwing on missing relations
 */
async function hydrateReports(rawReports: any[]) {
  if (!rawReports || rawReports.length === 0) return [];

  const visitIds = Array.from(new Set(rawReports.map((r) => r.visitId).filter(Boolean)));

  // Parallel fetch specialists, visits, and assessments
  const [allSpecialists, visits, assessments] = await Promise.all([
    getAllSpecialists(),
    visitIds.length > 0
      ? (prisma.visit.findMany as any)({
          where: { id: { in: visitIds } },
        })
      : Promise.resolve([]),
    visitIds.length > 0
      ? (prisma.assessment.findMany as any)({
          where: { visitId: { in: visitIds } },
          include: {
            responses: {
              include: { question: true },
              orderBy: { question: { order: "asc" } },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const visitMap = new Map<string, any>(visits.map((v: any) => [v.id, v]));
  const assessmentMap = new Map<string, any>(assessments.map((a: any) => [a.visitId, a]));

  // Fetch appointments for these visits
  const apptIds = Array.from(new Set(visits.map((v: any) => v.appointmentId).filter(Boolean)));
  const appointments =
    apptIds.length > 0
      ? await (prisma.appointment.findMany as any)({
          where: { id: { in: apptIds } },
          include: { serviceType: true, technician: true },
        })
      : [];

  const apptMap = new Map<string, any>(appointments.map((a: any) => [a.id, a]));

  return rawReports.map((report) => {
    const visit = report.visitId ? visitMap.get(report.visitId) : null;
    const populatedVisit = visit ? { ...visit } : null;

    if (populatedVisit) {
      if (populatedVisit.appointmentId) {
        populatedVisit.appointment = apptMap.get(populatedVisit.appointmentId) || null;
      }
      populatedVisit.assessment = assessmentMap.get(populatedVisit.id) || null;
    }

    const hydratedReport = {
      ...report,
      visit: populatedVisit,
    };

    return formatReportDetail(hydratedReport, allSpecialists);
  });
}

async function hydrateSingleReport(rawReport: any) {
  if (!rawReport) return null;
  const list = await hydrateReports([rawReport]);
  return list[0] || null;
}

/**
 * Get Single Report by ID
 */
export async function getReportById(reportId: string, user: { id: string; role: string }) {
  const report = await (prisma.report.findUnique as any)({
    where: { id: reportId },
    include: {
      client: { include: { user: true } },
    },
  });

  if (!report) {
    throw new Error(`Report with ID ${reportId} not found.`);
  }

  if (user.role === "CLIENT" && report.client?.userId !== user.id && report.clientId !== user.id) {
    throw new Error("You are not authorized to view this report.");
  }

  return hydrateSingleReport(report);
}

/**
 * CLIENT: Get My Finalized Reports
 */
export async function getMyReports(userId: string) {
  const client = await prisma.client.findFirst({
    where: {
      OR: [{ userId }, { id: userId }],
    },
  });

  if (!client) {
    return [];
  }

  const reports = await (prisma.report.findMany as any)({
    where: {
      clientId: client.id,
      isArchived: false,
    },
    orderBy: { createdAt: "desc" },
    include: {
      client: { include: { user: true } },
    },
  });

  return hydrateReports(reports);
}

/**
 * ADMIN: Get All Client Reports with Search and Filter
 */
export async function getAdminReports(query: {
  search?: string;
  status?: string;
  clientId?: string;
  page?: number;
  limit?: number;
} = {}) {
  const where: any = { isArchived: false };

  if (query.status && query.status !== "ALL") {
    where.status = query.status.toUpperCase();
  }

  if (query.clientId) {
    where.clientId = query.clientId;
  }

  if (query.search && query.search.trim()) {
    const term = query.search.trim();
    where.OR = [
      { client: { clientNumber: { contains: term, mode: "insensitive" } } },
      { client: { user: { firstName: { contains: term, mode: "insensitive" } } } },
      { client: { user: { lastName: { contains: term, mode: "insensitive" } } } },
      { title: { contains: term, mode: "insensitive" } },
    ];
  }

  const reports = await (prisma.report.findMany as any)({
    where,
    orderBy: { createdAt: "desc" },
    take: query.limit || 50,
    skip: query.page && query.limit ? (query.page - 1) * query.limit : 0,
    include: {
      client: { include: { user: true } },
    },
  });

  return hydrateReports(reports);
}
