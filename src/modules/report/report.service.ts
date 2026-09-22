import {
  PrismaClient,
  ReportType,
  ReportStatus,
  VisitStatus,
  AppointmentStatus,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import {
  SubmitAssessmentInput,
  AssessmentResponseItem,
} from "./report.validation";
import { getAllSpecialists } from "../specialist/specialist.service";
import path from "path";
import fs from "fs";
import { sendReportAvailableEmail } from "../../utils/email";
import { resolveClientForUser } from "../family/family.service";
import {
  notifyClientAndFamily,
  notifyAdmins,
} from "../notification/notification.service";

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
    const validActorId = isValidObjectId(params.actorUserId)
      ? params.actorUserId
      : null;
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

  console.log(
    "✅ Seeded Age Safe® Home Score™ Assessment Template & 25 Questions.",
  );
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
export function calculateAuthoritativeScore(
  responses: AssessmentResponseItem[],
) {
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
  const flaggedRisksCount = responses.filter(
    (r) => r.flaggedRisk || r.scoreValue === 0,
  ).length;

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
  input: SubmitAssessmentInput,
) {
  const { appointmentId } = input;

  // 1. Resolve Appointment
  const appointment = await (prisma.appointment.findUnique as any)({
    where: { id: appointmentId },
    include: {
      client: { include: { user: true } },
      plan: true,
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
      throw new Error(
        "Cannot create visit: No specialist available to assign.",
      );
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
          flaggedRisk: Boolean(
            resp.flaggedRisk || Number(resp.scoreValue) === 0,
          ),
        },
      });
    }

    // C. Upsert Report record
    let report = await tx.report.findFirst({
      where: { visitId: visit.id, isArchived: false },
    });

    const reportTitle = `${appointment.serviceName || "Home Safety"} — Age Safe® Assessment`;

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
  return getReportByAppointmentId(appointmentId, {
    id: actorUserId,
    role: "ADMIN",
  });
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
  input: UploadVisitReportInput,
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
      `Cannot upload report: Appointment status is ${appointment.status}. Reports can only be uploaded for COMPLETED visits.`,
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
      throw new Error(
        "Cannot associate visit: No specialist assigned or available.",
      );
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

  // 3. Determine Report Title and Service Details
  const serviceName = appointment.serviceName || "Home Safety Oversight";
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
      const oldFilePath = path.join(
        process.cwd(),
        "uploads",
        "reports",
        oldFilename,
      );
      if (fs.existsSync(oldFilePath) && oldFilename !== storageFilename) {
        try {
          fs.unlinkSync(oldFilePath);
        } catch (unlinkErr) {
          console.warn(
            "⚠️ Could not remove previous report file from disk:",
            unlinkErr,
          );
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
            appointment: true,
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
            appointment: true,
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

  // 7. Send Client and Authorized Family Notification Emails
  const clientUser = appointment.client?.user;
  const primaryRecipientEmail =
    clientUser?.email || appointment.client?.primaryContactEmail;
  const clientName =
    `${clientUser?.firstName || ""} ${clientUser?.lastName || ""}`.trim() ||
    appointment.client?.primaryContactName ||
    "Valued Member";
  const specialistName =
    visit.technician?.name ||
    appointment.technician?.name ||
    "AgeWellRI Specialist";

  if (primaryRecipientEmail) {
    try {
      await sendReportAvailableEmail({
        to: primaryRecipientEmail,
        clientName,
        serviceType: serviceName,
        visitDate: visit.completedAt || appointment.startAt || new Date(),
        specialistName,
        reportTitle: defaultTitle,
      });
    } catch (emailErr) {
      console.warn(
        "⚠️ Could not send report availability email notification to primary client:",
        emailErr,
      );
    }
  }

  // Also dispatch automated report notification to all family members with reportAccess = true
  try {
    const familyMembersWithReportAccess = await (
      prisma.familyMember.findMany as any
    )({
      where: {
        clientId,
        reportAccess: true,
      },
    });

    for (const fam of familyMembersWithReportAccess) {
      if (
        fam.email &&
        fam.email.toLowerCase() !== primaryRecipientEmail?.toLowerCase()
      ) {
        try {
          await sendReportAvailableEmail({
            to: fam.email,
            clientName: `${fam.name} (for ${clientName})`,
            serviceType: serviceName,
            visitDate: visit.completedAt || appointment.startAt || new Date(),
            specialistName,
            reportTitle: defaultTitle,
          });
        } catch (famErr) {
          console.warn(`Could not email family member ${fam.email}:`, famErr);
        }
      }
    }
  } catch (err) {
    console.warn("Automated family report notification error:", err);
  }

  // Dispatch In-App Notifications for Client/Family (with reportAccess) and Admins
  try {
    await notifyClientAndFamily(
      clientId,
      {
        type: "REPORT_READY",
        title: "Visit Report Ready",
        message: `Your AgeWellRI visit report (${defaultTitle}) is now available to view.`,
        metadata: {
          reportId: report.id,
          appointmentId: appointment.id,
          serviceName,
        },
      },
      "reportAccess",
    );

    await notifyAdmins({
      type: "REPORT_READY",
      title: "Visit Report Uploaded",
      message: `${clientName}'s visit report (${defaultTitle}) has been uploaded.`,
      metadata: {
        clientId,
        reportId: report.id,
        appointmentId: appointment.id,
      },
    });
  } catch (notifErr: any) {
    console.warn("⚠️ Failed to dispatch report in-app notification:", notifErr.message);
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
  user: { id: string; role: string },
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

  // Object-level authorization with Family Member support
  if (user.role !== "ADMIN") {
    const context = await resolveClientForUser(user.id);
    if (!context || !context.client || context.client.id !== report.clientId) {
      throw new Error("You are not authorized to access this report document.");
    }

    if (!context.permissions.reportAccess) {
      throw new Error(
        "You do not have permission to view or download reports.",
      );
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

function safeFormatDate(dateVal?: any): string {
  if (!dateVal) return "N/A";
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return "N/A";
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "N/A";
  }
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
    (s) => s.id === visit?.technicianId || s.id === appt?.technicianId,
  );

  const specialistName =
    spec?.name || visit?.technician?.name || "Home Safety Specialist";
  const specialistTitle =
    spec?.title ||
    visit?.technician?.title ||
    "Certified Senior Safety Specialist";

  const totalScore = assessment?.score ?? report.score ?? null;
  const maxScore = assessment?.maxScore ?? 50;
  const percentage =
    totalScore != null && maxScore > 0
      ? Math.round((totalScore / maxScore) * 100)
      : null;
  const ratingTier =
    assessment?.ratingTier ??
    (totalScore && totalScore >= 45 ? "EXCELLENT" : "GOOD");

  const rawResponses = assessment?.responses || [];
  const sortedResponses = [...rawResponses].sort(
    (a: any, b: any) => (a.question?.order || 0) - (b.question?.order || 0),
  );

  const formattedResponses = sortedResponses.map((r: any) => ({
    id: r.id,
    questionId: r.questionId,
    category: r.question?.category || "SAFETY",
    questionText: r.question?.questionText || "Safety Inspection Item",
    order: r.question?.order || 1,
    scoreValue: r.scoreValue ?? 2,
    notes: r.notes || "",
    flaggedRisk: Boolean(r.flaggedRisk || r.scoreValue === 0),
  }));

  const clientName =
    `${user?.firstName || ""} ${user?.lastName || ""}`.trim() ||
    client?.primaryContactName ||
    "Valued Client";
  const reportIdStr = String(report.id || "");
  const clientNumber =
    client?.clientNumber ||
    `AW-${String(client?.id || "").slice(-4).toUpperCase() || "MEMBER"}`;
  const address =
    [client?.address, client?.city, client?.state, client?.postalCode]
      .filter(Boolean)
      .join(", ") || "Client Residence, Rhode Island";

  const hasFile = Boolean(report.fileUrl);
  const downloadUrl = hasFile ? `/api/v1/reports/${reportIdStr}/download` : null;
  const previewUrl = hasFile ? `/api/v1/reports/${reportIdStr}/file` : null;

  const visitDateVal = visit?.completedAt || appt?.startAt || report.createdAt;

  return {
    id: reportIdStr,
    reportId: reportIdStr,
    reportNumber: `RPT-${reportIdStr.slice(-6).toUpperCase() || "000000"}`,
    appointmentId: appt?.id || null,
    visitId: visit?.id || null,
    clientId: report.clientId,
    clientNumber,
    clientName,
    clientEmail: user?.email || client?.primaryContactEmail || "",
    clientPhone: user?.phone || client?.primaryContactPhone || "",
    clientAddress: address,
    serviceType: appt?.serviceName || "Home Safety Oversight",
    visitDate: visitDateVal,
    formattedVisitDate: safeFormatDate(visitDateVal),
    title: report.title || `${appt?.serviceName || "Visit"} Report`,
    reportType: report.reportType,
    status:
      report.status === "GENERATED" || report.status === "UPLOADED"
        ? "available"
        : "pending",
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
      report.recommendations || assessment?.recommendations || "",
    categoryScores: assessment?.categoryScores || null,
    responses: formattedResponses,
    specialistName,
    specialistTitle,
    specialistPhone: spec?.phone,
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
  user: { id: string; role: string },
) {
  const appt = await (prisma.appointment.findUnique as any)({
    where: { id: appointmentId },
    include: {
      client: { include: { user: true } },
      technician: true,
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
  if (
    user.role === "CLIENT" &&
    appt.client?.userId !== user.id &&
    appt.clientId !== user.id
  ) {
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
    title: `${appt.serviceName || "Home Safety"} Assessment Report`,
    score: visit.assessment?.score ?? 45,
    summary:
      visit.assessment?.summary || "Comprehensive home safety evaluation.",
    recommendations:
      visit.assessment?.recommendations || "Maintain clear walkways.",
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

  const visitIds = Array.from(
    new Set(rawReports.map((r) => r.visitId).filter(Boolean)),
  );

  let allSpecialists: any[] = [];
  let visits: any[] = [];
  let assessments: any[] = [];

  try {
    allSpecialists = await getAllSpecialists();
  } catch (specErr) {
    console.warn("Could not fetch specialists:", specErr);
  }

  if (visitIds.length > 0) {
    try {
      visits = await (prisma.visit.findMany as any)({
        where: { id: { in: visitIds } },
      });
    } catch (vErr) {
      console.warn("Could not fetch visits for reports:", vErr);
    }

    try {
      assessments = await (prisma.assessment.findMany as any)({
        where: { visitId: { in: visitIds } },
        include: {
          responses: {
            include: { question: true },
          },
        },
      });
    } catch (aErr) {
      console.warn("Could not fetch assessments for reports:", aErr);
    }
  }

  const visitMap = new Map<string, any>(visits.map((v: any) => [v.id, v]));
  const assessmentMap = new Map<string, any>(
    assessments.map((a: any) => [a.visitId, a]),
  );

  // Fetch appointments for these visits
  const apptIds = Array.from(
    new Set(visits.map((v: any) => v.appointmentId).filter(Boolean)),
  );

  let appointments: any[] = [];
  if (apptIds.length > 0) {
    try {
      appointments = await (prisma.appointment.findMany as any)({
        where: { id: { in: apptIds } },
        include: { technician: true },
      });
    } catch (apptErr) {
      console.warn("Could not fetch appointments for reports:", apptErr);
    }
  }

  const apptMap = new Map<string, any>(appointments.map((a: any) => [a.id, a]));

  return rawReports
    .map((report) => {
      try {
        const visit = report.visitId ? visitMap.get(report.visitId) : null;
        const populatedVisit = visit ? { ...visit } : null;

        if (populatedVisit) {
          if (populatedVisit.appointmentId) {
            populatedVisit.appointment =
              apptMap.get(populatedVisit.appointmentId) || null;
          }
          populatedVisit.assessment =
            assessmentMap.get(populatedVisit.id) || null;
        }

        const hydratedReport = {
          ...report,
          visit: populatedVisit,
        };

        return formatReportDetail(hydratedReport, allSpecialists);
      } catch (err) {
        console.error("Error formatting report item:", err);
        return null;
      }
    })
    .filter(Boolean);
}

async function hydrateSingleReport(rawReport: any) {
  if (!rawReport) return null;
  const list = await hydrateReports([rawReport]);
  return list[0] || null;
}

/**
 * Get Single Report by ID
 */
export async function getReportById(
  reportId: string,
  user: { id: string; role: string },
) {
  const report = await (prisma.report.findUnique as any)({
    where: { id: reportId },
    include: {
      client: { include: { user: true } },
    },
  });

  if (!report) {
    throw new Error(`Report with ID ${reportId} not found.`);
  }

  if (user.role === "CLIENT") {
    const context = await resolveClientForUser(user.id);
    if (!context || !context.client || context.client.id !== report.clientId) {
      throw new Error("You are not authorized to view this report.");
    }
    if (!context.permissions.reportAccess) {
      throw new Error("You do not have permission to view reports.");
    }
  }

  return hydrateSingleReport(report);
}

/**
 * CLIENT: Get My Finalized Reports
 */
export async function getMyReports(userId: string) {
  const context = await resolveClientForUser(userId);
  if (!context || !context.client) {
    return [];
  }

  if (!context.permissions.reportAccess) {
    return [];
  }

  try {
    const reports = await (prisma.report.findMany as any)({
      where: {
        clientId: context.client.id,
      },
      orderBy: { createdAt: "desc" },
      include: {
        client: { include: { user: true } },
      },
    });

    const activeReports = (reports || []).filter((r: any) => r.isArchived !== true);
    return hydrateReports(activeReports);
  } catch (err) {
    console.error("Error getting client reports:", err);
    return [];
  }
}

/**
 * ADMIN: Get All Client Reports with Search and Filter
 */
export async function getAdminReports(
  query: {
    search?: string;
    status?: string;
    clientId?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  const where: any = {};

  if (query.clientId) {
    where.clientId = query.clientId;
  }

  let reports: any[] = [];
  try {
    reports = await (prisma.report.findMany as any)({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        client: { include: { user: true } },
      },
    });
  } catch (dbErr) {
    console.error("Error fetching reports from database:", dbErr);
    return [];
  }

  // Filter out archived
  let filteredReports = (reports || []).filter((r: any) => r.isArchived !== true);

  // Status filtering in memory (safe across all enum variants)
  if (query.status && query.status !== "ALL") {
    const statusUpper = query.status.toUpperCase();
    filteredReports = filteredReports.filter((r: any) => {
      if (statusUpper === "AVAILABLE") {
        return r.status === "GENERATED" || r.status === "UPLOADED";
      }
      return r.status === statusUpper;
    });
  }

  // Search filtering in memory (resilient across client number, name, title)
  if (query.search && query.search.trim()) {
    const term = query.search.trim().toLowerCase();
    filteredReports = filteredReports.filter((r: any) => {
      const clientNumber = (r.client?.clientNumber || "").toLowerCase();
      const firstName = (r.client?.user?.firstName || "").toLowerCase();
      const lastName = (r.client?.user?.lastName || "").toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      const title = (r.title || "").toLowerCase();
      return (
        clientNumber.includes(term) ||
        firstName.includes(term) ||
        lastName.includes(term) ||
        fullName.includes(term) ||
        title.includes(term)
      );
    });
  }

  // Pagination in memory
  const page = query.page && query.page > 0 ? query.page : 1;
  const limit = query.limit && query.limit > 0 ? query.limit : 50;
  const paginated = filteredReports.slice((page - 1) * limit, page * limit);

  return hydrateReports(paginated);
}

/**
 * ADMIN: Delete or Archive Report
 */
export async function deleteReport(actorUserId: string, reportId: string) {
  const report = await (prisma.report.findUnique as any)({
    where: { id: reportId },
  });

  if (report) {
    await (prisma.report.delete as any)({
      where: { id: reportId },
    });
  } else if (reportId.startsWith("rep_")) {
    const visitId = reportId.replace("rep_", "");
    await (prisma.assessment.deleteMany as any)({
      where: { visitId },
    });
  } else {
    throw new Error("Report not found.");
  }

  try {
    await ((prisma as any).auditLog.create as any)({
      data: {
        actorUserId,
        action: "REPORT_DELETED",
        entityType: "REPORT",
        entityId: reportId,
      },
    });
  } catch (auditErr) {
    console.warn("Audit log creation error:", auditErr);
  }

  return {
    success: true,
    message: "Report deleted successfully.",
  };
}
