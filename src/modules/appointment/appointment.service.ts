import prisma from "../../lib/prisma";
import {
  AppointmentStatus,
  ServiceTypeCategory,
  VisitStatus,
  AgreementStatus,
  SubscriptionStatus,
} from "@prisma/client";
import {
  ScheduleAppointmentInput,
  AdminScheduleAppointmentInput,
  RescheduleAppointmentInput,
  UpdateAppointmentStatusInput,
  AdminAppointmentsQuery,
} from "./appointment.validation";
import {
  ensureVisitAllocationsForPeriod,
  formatPeriodEntitlements,
} from "../payment/visit-entitlement.service";
import { getAllSpecialists } from "../specialist/specialist.service";

export function isValidObjectId(id?: string | null): boolean {
  if (!id || typeof id !== "string") return false;
  return /^[0-9a-fA-F]{24}$/.test(id.trim());
}

/**
 * Sanitize any string createdAt/updatedAt in Technician collection to avoid BSON conversion errors.
 */
export async function sanitizeTechnicianCollection() {
  try {
    const result: any = await (prisma as any).$runCommandRaw({
      find: "Technician",
      filter: {},
    });
    const docs = result?.cursor?.firstBatch || [];
    for (const doc of docs) {
      const updates: any = {};
      if (typeof doc.createdAt === "string") {
        updates.createdAt = { $date: new Date(doc.createdAt).toISOString() };
      }
      if (typeof doc.updatedAt === "string") {
        updates.updatedAt = { $date: new Date(doc.updatedAt).toISOString() };
      }
      if (Object.keys(updates).length > 0) {
        await (prisma as any).$runCommandRaw({
          update: "Technician",
          updates: [
            {
              q: { _id: doc._id },
              u: { $set: updates },
            },
          ],
        });
      }
    }
  } catch (err) {
    // Non-critical background sanitizer
  }
}

// Run initial sanitization
sanitizeTechnicianCollection().catch(() => {});

/**
 * Record an audit log for appointment operations.
 */
async function createAppointmentAuditLog(params: {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValues?: any;
  newValues?: any;
  metadata?: any;
}) {
  try {
    await (prisma.auditLog.create as any)({
      data: {
        actorUserId: params.actorUserId || null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        previousValues: params.previousValues || null,
        newValues: params.newValues || null,
        metadata: params.metadata || null,
      },
    });
  } catch (err) {
    console.warn("⚠️ Failed to write appointment audit log:", err);
  }
}

/**
 * Helper to parse a date string and timeSlot (e.g. "10:00 AM – 12:00 PM") into startAt and endAt Dates.
 */
export function parseDateAndTimeSlot(dateStr: string, timeSlotStr: string): { startAt: Date; endAt: Date } {
  const baseDate = new Date(dateStr);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const day = baseDate.getDate();

  const timeMatches = timeSlotStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/g);

  if (timeMatches && timeMatches.length >= 2) {
    const parseTimePart = (timeStr: string): { hour: number; minute: number } => {
      const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/i);
      if (!match) return { hour: 10, minute: 0 };
      let hour = parseInt(match[1], 10);
      const minute = parseInt(match[2], 10);
      const ampm = match[3].toUpperCase();
      if (ampm === "PM" && hour < 12) hour += 12;
      if (ampm === "AM" && hour === 12) hour = 0;
      return { hour, minute };
    };

    const startTime = parseTimePart(timeMatches[0]);
    const endTime = parseTimePart(timeMatches[1]);

    const startAt = new Date(year, month, day, startTime.hour, startTime.minute, 0);
    const endAt = new Date(year, month, day, endTime.hour, endTime.minute, 0);

    return { startAt, endAt };
  }

  const startAt = new Date(year, month, day, 10, 0, 0);
  const endAt = new Date(year, month, day, 12, 0, 0);
  return { startAt, endAt };
}

/**
 * Resolves a ServiceType from ID, name, or category string
 */
async function resolveServiceType(serviceTypeId?: string, serviceName?: string) {
  if (serviceTypeId && isValidObjectId(serviceTypeId)) {
    const srv = await prisma.serviceType.findUnique({ where: { id: serviceTypeId } });
    if (srv) return srv;
  }

  if (serviceName) {
    const isCleaning =
      serviceName.toLowerCase().includes("cleaning") ||
      serviceName.toUpperCase() === "CLEANING";
    const isSafety =
      serviceName.toLowerCase().includes("safety") ||
      serviceName.toUpperCase() === "SAFETY_OVERSIGHT";

    const srv = await prisma.serviceType.findFirst({
      where: {
        OR: [
          { name: { contains: serviceName, mode: "insensitive" } },
          isCleaning ? { category: ServiceTypeCategory.CLEANING } : {},
          isSafety ? { category: ServiceTypeCategory.SAFETY_OVERSIGHT } : {},
        ],
        isActive: true,
      },
    });
    if (srv) return srv;
  }

  // Fallback to active safety oversight service
  return await prisma.serviceType.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Resolves or assigns a Specialist/Technician safely using getAllSpecialists()
 */
async function resolveTechnician(
  technicianId?: string,
  technicianName?: string,
  serviceCategory?: string
) {
  const allSpecialists = await getAllSpecialists();

  if (technicianId) {
    const found = allSpecialists.find((s: any) => s.id === technicianId);
    if (found) return found;
  }

  if (technicianName) {
    const found = allSpecialists.find((s: any) =>
      s.name.toLowerCase().includes(technicianName.toLowerCase())
    );
    if (found) return found;
  }

  // Auto-assign active specialist matching specialty
  const matched = allSpecialists.find((s: any) => {
    if (serviceCategory === "CLEANING") {
      return s.specialties?.some((sp: string) =>
        sp.toLowerCase().includes("cleaning") || sp.toLowerCase().includes("support")
      );
    }
    return s.specialties?.some((sp: string) =>
      sp.toLowerCase().includes("safety") || sp.toLowerCase().includes("fall")
    );
  });

  if (matched) return matched;

  return allSpecialists[0] || null;
}

/**
 * Formats appointment record for frontend consumption
 */
export function formatAppointmentRecord(appt: any, specialistsList: any[] = []) {
  const st = appt.serviceType || {};
  let tech = appt.technician;
  if (!tech && appt.technicianId && specialistsList.length > 0) {
    tech = specialistsList.find((s: any) => s.id === appt.technicianId);
  }
  tech = tech || {};
  const client = appt.client || {};
  const user = client.user || {};

  const start = appt.startAt ? new Date(appt.startAt) : new Date();
  const end = appt.endAt ? new Date(appt.endAt) : new Date(start.getTime() + 2 * 60 * 60 * 1000);

  const dateFormatted = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const timeSlotFormatted = `${start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })} – ${end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;

  const clientName = `${user.firstName || client.primaryContactName || "Valued"} ${user.lastName || "Member"}`.trim();

  // Report resolution from linked visit
  const visit = appt.visit;
  const activeReport = visit?.reports?.find((r: any) => !r.isArchived) || visit?.reports?.[0];
  const hasReport = Boolean(activeReport && (activeReport.fileUrl || activeReport.status === "UPLOADED" || activeReport.status === "GENERATED"));
  const reportStatus = hasReport ? "uploaded" : "not_uploaded";

  return {
    id: appt.id,
    appointmentId: appt.id,
    visitId: visit?.id || null,
    clientId: appt.clientId,
    clientNumber: client.clientNumber || "AW-CLIENT",
    clientName,
    clientEmail: user.email || client.primaryContactEmail || "",
    clientPhone: user.phone || client.primaryContactPhone || "",
    clientAddress: `${client.address || "100 Main St"}, ${client.city || "Providence"}, ${client.state || "RI"} ${client.postalCode || "02903"}`,
    serviceTypeId: appt.serviceTypeId,
    serviceType: st.name || (st.category === "CLEANING" ? "Cleaning Visit" : "Safety Oversight Visit"),
    serviceCategory: st.category || "OTHER",
    durationMinutes: st.durationMinutes || 60,
    subscriptionPeriodId: appt.subscriptionPeriodId,
    technicianId: appt.technicianId,
    technicianName: tech.name || "Assigned Caregiver",
    technicianTitle: tech.title || (st.category === "CLEANING" ? "Senior Home Support Caregiver" : "Certified Home Safety Specialist"),
    technicianPhone: tech.phone || null,
    technicianColor: tech.color || "#294B68",
    startAt: appt.startAt?.toISOString?.() || new Date(appt.startAt).toISOString(),
    endAt: appt.endAt?.toISOString?.() || new Date(appt.endAt).toISOString(),
    date: dateFormatted,
    timeSlot: timeSlotFormatted,
    status: appt.status?.toLowerCase() || "scheduled",
    reportStatus,
    hasReport,
    reportId: activeReport?.id || null,
    reportTitle: activeReport?.title || null,
    reportFileUrl: activeReport?.id ? `/api/v1/reports/${activeReport.id}/download` : null,
    reportUploadedAt: activeReport?.uploadedAt ? new Date(activeReport.uploadedAt).toISOString() : null,
    location: appt.location || client.address || "Client Residence",
    notes: appt.notes || "",
    bookedBy: appt.createdByUser ? `${appt.createdByUser.firstName} ${appt.createdByUser.lastName}`.trim() : "AgeWellRI Team",
    createdAt: appt.createdAt ? new Date(appt.createdAt).toISOString() : new Date().toISOString(),
  };
}

interface ContractualSchedulingParams {
  client: any;
  serviceTypeId?: string;
  serviceType?: string;
  date: string;
  timeSlot: string;
  startAt?: string | Date;
  endAt?: string | Date;
  technicianId?: string;
  technicianName?: string;
  location?: string;
  notes?: string;
  actorUserId: string;
  isAdmin: boolean;
}

/**
 * Validates the complete contractual chain:
 * Client -> Executed Agreement -> Plan / PlanVersion -> Subscription -> Billing Period -> Visit Entitlement
 * and atomically creates the appointment inside a database transaction.
 */
async function validateAndExecuteContractualScheduling(params: ContractualSchedulingParams) {
  const { client, actorUserId, isAdmin } = params;

  // 1. CONTRACTUAL INTEGRITY: Validate Executed Service Agreement
  const executedAgreement = await (prisma.serviceAgreement.findFirst as any)({
    where: {
      clientId: client.id,
      status: { in: [AgreementStatus.EXECUTED, AgreementStatus.SIGNED] },
      isArchived: false,
    },
    orderBy: { createdAt: "desc" },
    include: {
      planVersion: true,
      plan: true,
    },
  });

  if (!executedAgreement && !client.hasCompletedAgreement) {
    const anyAgreement = await (prisma.serviceAgreement.findFirst as any)({
      where: { clientId: client.id },
      orderBy: { createdAt: "desc" },
    });

    if (anyAgreement?.status === "DRAFT" || anyAgreement?.status === "SENT") {
      throw new Error(
        "Client agreement has not been signed and executed yet. A signed Client Service Agreement is required before scheduling visits."
      );
    }
    if (anyAgreement?.status === "CANCELLED" || anyAgreement?.status === "EXPIRED") {
      throw new Error(
        `Client agreement is ${anyAgreement.status.toLowerCase()}. A valid, active agreement is required to schedule visits.`
      );
    }
    throw new Error(
      "Client does not have an active executed Service Agreement. An executed agreement is required before scheduling visits."
    );
  }

  // 2. CONTRACTUAL INTEGRITY: Validate Active Subscription & Contracted PlanVersion
  const activeSubscription = await (prisma.subscription.findFirst as any)({
    where: {
      clientId: client.id,
      status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLATION_REQUESTED] },
      isArchived: false,
    },
    orderBy: { createdAt: "desc" },
    include: {
      plan: true,
      planVersion: {
        include: { planServices: true },
      },
      periods: {
        orderBy: { startDate: "desc" },
        take: 1,
        include: {
          allocations: {
            include: { serviceType: true },
          },
        },
      },
    },
  });

  if (!activeSubscription) {
    const anySub = await (prisma.subscription.findFirst as any)({
      where: { clientId: client.id },
      orderBy: { createdAt: "desc" },
    });

    if (anySub?.status === SubscriptionStatus.PENDING) {
      throw new Error(
        "Client payment is pending. Payment must be submitted and processed before visits can be scheduled."
      );
    }
    throw new Error(
      "No active subscription found for client. An active paid membership plan is required before scheduling visits."
    );
  }

  // 3. CONTRACTUAL INTEGRITY: Validate Active Billing Period
  const activePeriod = activeSubscription.periods?.[0];
  if (!activePeriod || activePeriod.status === "EXPIRED" || activePeriod.status === "CANCELLED") {
    throw new Error(
      "No active billing period found for the client's subscription. Payment and enrollment must be completed first."
    );
  }

  // 4. Resolve Selected Service Type
  const serviceType = await resolveServiceType(params.serviceTypeId, params.serviceType);
  if (!serviceType) {
    throw new Error("Invalid or inactive service type selected.");
  }

  // 5. Ensure Period Allocations from the Contracted PlanVersion / Agreement
  if (!activePeriod.allocations || activePeriod.allocations.length === 0) {
    await ensureVisitAllocationsForPeriod(
      activePeriod.id,
      activeSubscription.planVersionId || executedAgreement?.planVersionId,
      activeSubscription.planId || executedAgreement?.planId,
      client.hasCleaningAddon || executedAgreement?.hasCleaningAddon
    );

    const refreshed = await (prisma.subscriptionPeriod.findUnique as any)({
      where: { id: activePeriod.id },
      include: { allocations: { include: { serviceType: true } } },
    });
    if (refreshed) {
      activePeriod.allocations = refreshed.allocations;
    }
  }

  // 6. CONTRACTUAL INTEGRITY: Validate Visit Entitlement Inclusions & Quotas
  const matchingAlloc = (activePeriod.allocations || []).find(
    (a: any) =>
      a.serviceTypeId === serviceType.id ||
      a.serviceType?.category === serviceType.category
  );

  if (!matchingAlloc) {
    const contractedPlanName =
      activeSubscription.planVersion?.name ||
      activeSubscription.plan?.name ||
      "contracted plan";
    throw new Error(
      `The selected service "${serviceType.name}" is not included in the client's ${contractedPlanName}.`
    );
  }

  const existingAppts = await (prisma.appointment.findMany as any)({
    where: {
      clientId: client.id,
      subscriptionPeriodId: activePeriod.id,
      serviceTypeId: matchingAlloc.serviceTypeId || serviceType.id,
      status: { not: AppointmentStatus.CANCELLED },
    },
  });

  const scheduledCount = existingAppts.filter((a: any) =>
    [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.RESCHEDULED].includes(a.status)
  ).length;
  const completedCount =
    matchingAlloc.usedCount > 0
      ? matchingAlloc.usedCount
      : existingAppts.filter((a: any) => a.status === AppointmentStatus.COMPLETED).length;
  const allocatedCount = matchingAlloc.allocatedCount || 0;
  const remainingCount = Math.max(0, allocatedCount - (scheduledCount + completedCount));

  if (remainingCount <= 0) {
    throw new Error(
      `You have 0 remaining visits available for ${serviceType.name} in the current quarterly cycle (${allocatedCount} allocated, all scheduled/used).`
    );
  }

  // 7. Calculate startAt and endAt
  const { startAt, endAt } = params.startAt && params.endAt
    ? { startAt: new Date(params.startAt), endAt: new Date(params.endAt) }
    : parseDateAndTimeSlot(params.date, params.timeSlot);

  // 8. Check client overlapping active appointments
  const clientConflict = await (prisma.appointment.findFirst as any)({
    where: {
      clientId: client.id,
      status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.RESCHEDULED] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
  });

  if (clientConflict) {
    throw new Error("The client already has an active appointment scheduled during this time window.");
  }

  // 9. Resolve Specialist / Technician
  const technician = await resolveTechnician(
    params.technicianId,
    params.technicianName,
    serviceType.category
  );

  const clientAddress = `${client.address || "100 Main St"}, ${client.city || "Providence"}, ${client.state || "RI"} ${client.postalCode || "02903"}`;

  // 10. TRANSACTION ATOMIC CREATION (Concurrency / Double-Booking Protection)
  const appointment = await prisma.$transaction(async (tx: any) => {
    // Re-verify quota atomically within the transaction
    const currentActiveCount = await tx.appointment.count({
      where: {
        clientId: client.id,
        subscriptionPeriodId: activePeriod.id,
        serviceTypeId: matchingAlloc.serviceTypeId || serviceType.id,
        status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.RESCHEDULED, AppointmentStatus.COMPLETED] },
      },
    });

    if (currentActiveCount >= allocatedCount) {
      throw new Error(
        `All visit entitlements for ${serviceType.name} have already been booked for this cycle.`
      );
    }

    const createdAppt = await tx.appointment.create({
      data: {
        clientId: client.id,
        serviceTypeId: serviceType.id,
        subscriptionPeriodId: activePeriod.id,
        technicianId: technician?.id || null,
        startAt,
        endAt,
        status: AppointmentStatus.SCHEDULED,
        location: params.location || clientAddress,
        notes: params.notes || null,
        createdByUserId: actorUserId,
      },
      include: {
        serviceType: true,
        client: { include: { user: true } },
        createdByUser: true,
      },
    });

    if (technician?.id) {
      try {
        await tx.visit.create({
          data: {
            appointmentId: createdAppt.id,
            technicianId: technician.id,
            status: VisitStatus.SCHEDULED,
            notes: params.notes || null,
          },
        });
      } catch (visitErr) {
        console.warn("⚠️ Linked Visit creation warning:", visitErr);
      }
    }

    return createdAppt;
  });

  // 11. Audit Log
  await createAppointmentAuditLog({
    actorUserId,
    action: isAdmin ? "ADMIN_DISPATCHED_VISIT" : "CLIENT_SCHEDULED_VISIT",
    entityType: "Appointment",
    entityId: appointment.id,
    metadata: {
      clientId: client.id,
      agreementId: executedAgreement?.id || null,
      subscriptionId: activeSubscription.id,
      subscriptionPeriodId: activePeriod.id,
      serviceType: serviceType.name,
      technicianName: technician?.name,
      startAt,
      endAt,
    },
  });

  return formatAppointmentRecord(appointment, technician ? [technician] : []);
}

/**
 * CLIENT: Schedule an Appointment from Client Portal
 */
export async function scheduleClientAppointment(
  userId: string,
  input: ScheduleAppointmentInput
) {
  // 1. Find client record safely
  const client = await (prisma.client.findFirst as any)({
    where: {
      OR: [{ userId }, { id: userId }],
    },
    include: {
      user: true,
    },
  });

  if (!client) {
    throw new Error("Client account not found. Please complete registration.");
  }

  return validateAndExecuteContractualScheduling({
    client,
    serviceTypeId: input.serviceTypeId,
    serviceType: input.serviceType,
    date: input.date,
    timeSlot: input.timeSlot,
    startAt: input.startAt,
    endAt: input.endAt,
    technicianId: input.technicianId,
    technicianName: input.technicianName,
    location: input.location,
    notes: input.notes,
    actorUserId: userId,
    isAdmin: false,
  });
}

/**
 * ADMIN: Schedule an Appointment for Any Client
 */
export async function scheduleAdminAppointment(
  actorUserId: string,
  input: AdminScheduleAppointmentInput
) {
  // 1. Locate client safely by ID, clientNumber, or email
  const trimmedId = (input.clientId || "").trim();
  const orConditions: any[] = [
    { clientNumber: trimmedId },
    { clientNumber: { equals: trimmedId, mode: "insensitive" } },
    { clientNumber: { contains: trimmedId, mode: "insensitive" } },
    { user: { email: { equals: trimmedId, mode: "insensitive" } } },
    { primaryContactEmail: { equals: trimmedId, mode: "insensitive" } },
  ];

  const digits = trimmedId.replace(/\D/g, "");
  if (digits.length >= 3) {
    orConditions.push({ clientNumber: `AW-${digits}` });
    orConditions.push({ clientNumber: { contains: digits, mode: "insensitive" } });
  }

  if (isValidObjectId(trimmedId)) {
    orConditions.push({ id: trimmedId });
    orConditions.push({ userId: trimmedId });
  }

  const client = await (prisma.client.findFirst as any)({
    where: {
      OR: orConditions,
    },
    include: {
      user: true,
    },
  });

  if (!client) {
    throw new Error(`Client with identifier "${input.clientId}" not found.`);
  }

  return validateAndExecuteContractualScheduling({
    client,
    serviceTypeId: input.serviceTypeId,
    serviceType: input.serviceType,
    date: input.date,
    timeSlot: input.timeSlot,
    startAt: input.startAt,
    endAt: input.endAt,
    technicianId: input.technicianId,
    technicianName: input.technicianName,
    location: input.location,
    notes: input.notes,
    actorUserId,
    isAdmin: true,
  });
}

/**
 * CLIENT: Get My Appointments
 */
export async function getClientAppointments(userId: string) {
  const client = await (prisma.client.findFirst as any)({
    where: {
      OR: [{ userId }, { id: userId }],
    },
  });

  if (!client) {
    return [];
  }

  const [allSpecialists, appts] = await Promise.all([
    getAllSpecialists(),
    (prisma.appointment.findMany as any)({
      where: {
        clientId: client.id,
        isArchived: false,
      },
      orderBy: { startAt: "desc" },
      include: {
        serviceType: true,
        client: { include: { user: true } },
        createdByUser: true,
        visit: {
          include: {
            technician: true,
            reports: {
              where: { isArchived: false },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    }),
  ]);

  return appts.map((a: any) => formatAppointmentRecord(a, allSpecialists));
}

/**
 * ADMIN: Get All Appointments with Filters
 */
export async function getAdminAppointments(query: AdminAppointmentsQuery = {}) {
  const where: any = { isArchived: false };

  if (query.status) {
    where.status = query.status.toUpperCase();
  }

  if (query.clientId) {
    const trimmed = query.clientId.trim();
    const orClient: any[] = [
      { client: { clientNumber: trimmed } },
      { client: { clientNumber: { contains: trimmed, mode: "insensitive" } } },
    ];
    if (isValidObjectId(trimmed)) {
      orClient.push({ clientId: trimmed });
    }
    where.OR = orClient;
  }

  if (query.technicianId && isValidObjectId(query.technicianId)) {
    where.technicianId = query.technicianId;
  }

  if (query.startDate || query.endDate) {
    where.startAt = {};
    if (query.startDate) where.startAt.gte = new Date(query.startDate);
    if (query.endDate) where.startAt.lte = new Date(query.endDate);
  }

  if (query.search) {
    where.OR = [
      { client: { user: { firstName: { contains: query.search, mode: "insensitive" } } } },
      { client: { user: { lastName: { contains: query.search, mode: "insensitive" } } } },
      { client: { clientNumber: { contains: query.search, mode: "insensitive" } } },
    ];
  }

  const [allSpecialists, appts] = await Promise.all([
    getAllSpecialists(),
    (prisma.appointment.findMany as any)({
      where,
      orderBy: { startAt: "desc" },
      take: query.limit || 50,
      skip: query.page && query.limit ? (query.page - 1) * query.limit : 0,
      include: {
        serviceType: true,
        client: { include: { user: true } },
        createdByUser: true,
        visit: {
          include: {
            technician: true,
            reports: {
              where: { isArchived: false },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    }),
  ]);

  return appts.map((a: any) => formatAppointmentRecord(a, allSpecialists));
}

/**
 * GET Single Appointment by ID
 */
export async function getAppointmentById(
  id: string,
  user: { id: string; role: string }
) {
  if (!isValidObjectId(id)) {
    throw new Error(`Appointment with ID ${id} not found.`);
  }

  const appt = await (prisma.appointment.findUnique as any)({
    where: { id },
    include: {
      serviceType: true,
      client: { include: { user: true } },
      createdByUser: true,
      visit: {
        include: {
          technician: true,
          reports: {
            where: { isArchived: false },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  if (!appt) {
    throw new Error(`Appointment with ID ${id} not found.`);
  }

  if (user.role !== "ADMIN" && appt.client?.userId !== user.id && appt.clientId !== user.id) {
    throw new Error("Access denied to appointment record.");
  }

  const allSpecialists = await getAllSpecialists();
  return formatAppointmentRecord(appt, allSpecialists);
}

/**
 * Reschedule an Appointment
 */
export async function rescheduleAppointment(
  appointmentId: string,
  actorUserId: string,
  isClient: boolean,
  input: RescheduleAppointmentInput
) {
  if (!isValidObjectId(appointmentId)) {
    throw new Error(`Appointment with ID ${appointmentId} not found.`);
  }

  const appt = await (prisma.appointment.findUnique as any)({
    where: { id: appointmentId },
    include: { client: true },
  });

  if (!appt) {
    throw new Error(`Appointment with ID ${appointmentId} not found.`);
  }

  if (isClient && appt.client?.userId !== actorUserId && appt.clientId !== actorUserId) {
    throw new Error("You are not authorized to reschedule this appointment.");
  }

  const { startAt, endAt } = input.startAt && input.endAt
    ? { startAt: new Date(input.startAt), endAt: new Date(input.endAt) }
    : parseDateAndTimeSlot(input.date, input.timeSlot);

  const technicianId = input.technicianId || appt.technicianId;

  const updated = await (prisma.appointment.update as any)({
    where: { id: appointmentId },
    data: {
      startAt,
      endAt,
      technicianId,
      status: AppointmentStatus.RESCHEDULED,
      notes: input.reason ? `${appt.notes || ""}\nRescheduled: ${input.reason}`.trim() : appt.notes,
    },
    include: {
      serviceType: true,
      client: { include: { user: true } },
      createdByUser: true,
    },
  });

  await createAppointmentAuditLog({
    actorUserId,
    action: "APPOINTMENT_RESCHEDULED",
    entityType: "Appointment",
    entityId: appointmentId,
    previousValues: { startAt: appt.startAt, endAt: appt.endAt },
    newValues: { startAt, endAt },
    metadata: { reason: input.reason },
  });

  const allSpecialists = await getAllSpecialists();
  return formatAppointmentRecord(updated, allSpecialists);
}

/**
 * Cancel an Appointment (Releases Entitlement)
 */
export async function cancelAppointment(
  appointmentId: string,
  actorUserId: string,
  isClient: boolean,
  reason?: string
) {
  if (!isValidObjectId(appointmentId)) {
    throw new Error(`Appointment with ID ${appointmentId} not found.`);
  }

  const appt = await (prisma.appointment.findUnique as any)({
    where: { id: appointmentId },
    include: { client: true },
  });

  if (!appt) {
    throw new Error(`Appointment with ID ${appointmentId} not found.`);
  }

  if (isClient && appt.client?.userId !== actorUserId && appt.clientId !== actorUserId) {
    throw new Error("You are not authorized to cancel this appointment.");
  }

  const updated = await (prisma.appointment.update as any)({
    where: { id: appointmentId },
    data: {
      status: AppointmentStatus.CANCELLED,
      notes: reason ? `${appt.notes || ""}\nCancelled: ${reason}`.trim() : appt.notes,
    },
    include: {
      serviceType: true,
      client: { include: { user: true } },
      createdByUser: true,
    },
  });

  // Update associated visit status
  try {
    await (prisma.visit.updateMany as any)({
      where: { appointmentId },
      data: { status: VisitStatus.CANCELLED },
    });
  } catch {}

  await createAppointmentAuditLog({
    actorUserId,
    action: "APPOINTMENT_CANCELLED",
    entityType: "Appointment",
    entityId: appointmentId,
    metadata: { reason },
  });

  const allSpecialists = await getAllSpecialists();
  return formatAppointmentRecord(updated, allSpecialists);
}

/**
 * Update Appointment Status (Admin: Completed, No-Show, Confirmed, etc.)
 */
export async function updateAppointmentStatus(
  appointmentId: string,
  actorUserId: string,
  input: UpdateAppointmentStatusInput
) {
  if (!isValidObjectId(appointmentId)) {
    throw new Error(`Appointment with ID ${appointmentId} not found.`);
  }

  const appt = await (prisma.appointment.findUnique as any)({
    where: { id: appointmentId },
    include: {
      serviceType: true,
      client: true,
    },
  });

  if (!appt) {
    throw new Error(`Appointment with ID ${appointmentId} not found.`);
  }

  const updated = await (prisma.appointment.update as any)({
    where: { id: appointmentId },
    data: {
      status: input.status,
      notes: input.notes ? `${appt.notes || ""}\n${input.notes}`.trim() : appt.notes,
    },
    include: {
      serviceType: true,
      client: { include: { user: true } },
      createdByUser: true,
      visit: {
        include: {
          technician: true,
          reports: {
            where: { isArchived: false },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  // If marked COMPLETED, update visit allocation usedCount if subscriptionPeriod exists
  if (input.status === "COMPLETED" && appt.subscriptionPeriodId && appt.serviceTypeId) {
    try {
      await (prisma.visitAllocation.updateMany as any)({
        where: {
          subscriptionPeriodId: appt.subscriptionPeriodId,
          serviceTypeId: appt.serviceTypeId,
        },
        data: {
          usedCount: { increment: 1 },
        },
      });
    } catch {}
  }

  await createAppointmentAuditLog({
    actorUserId,
    action: "APPOINTMENT_STATUS_UPDATED",
    entityType: "Appointment",
    entityId: appointmentId,
    previousValues: { status: appt.status },
    newValues: { status: input.status },
    metadata: { notes: input.notes },
  });

  const allSpecialists = await getAllSpecialists();
  return formatAppointmentRecord(updated, allSpecialists);
}
