import prisma from "../../lib/prisma";
import { AppointmentStatus } from "@prisma/client";
import {
  CreateOffDayInput,
  UpdateOffDayInput,
  QueryOffDaysInput,
} from "./off-day.validation";

const db = prisma as any;

function isValidObjectId(id?: string | null): boolean {
  if (!id || typeof id !== "string") return false;
  return /^[0-9a-fA-F]{24}$/.test(id.trim());
}

/**
 * Record an audit log for off-day operations.
 */
async function createOffDayAuditLog(params: {
  actorUserId?: string | null;
  action: string;
  entityId: string;
  previousValues?: any;
  newValues?: any;
  metadata?: any;
}) {
  try {
    const validActorId = isValidObjectId(params.actorUserId)
      ? params.actorUserId
      : null;
    await db.auditLog.create({
      data: {
        actorUserId: validActorId,
        action: params.action,
        entityType: "OffDay",
        entityId: params.entityId,
        previousValues: params.previousValues || null,
        newValues: params.newValues || null,
        metadata: params.metadata || null,
      },
    });
  } catch (err) {
    console.warn("⚠️ Failed to write off-day audit log:", err);
  }
}

/**
 * Helper to format YYYY-MM-DD string into short display string (e.g. "Mon, Oct 5, 2026")
 * Using UTC to prevent any local server timezone shifts.
 */
export function formatDateToDisplay(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("T")[0].split("-");
  if (parts.length < 3) return dateStr;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);

  const utcDate = new Date(Date.UTC(y, m, d, 12, 0, 0));
  return utcDate.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Normalize start and end dates to UTC day boundaries (00:00:00 to 23:59:59.999 UTC)
 */
export function normalizeDateRange(
  startDateStr: string | Date,
  endDateStr?: string | Date | null,
): {
  startDate: Date;
  endDate: Date;
  startDateStr: string;
  endDateStr: string;
  isSingleDay: boolean;
} {
  let sYear: number, sMonth: number, sDay: number;
  if (typeof startDateStr === "string" && startDateStr.includes("-")) {
    const parts = startDateStr.split("T")[0].split("-");
    sYear = parseInt(parts[0], 10);
    sMonth = parseInt(parts[1], 10) - 1;
    sDay = parseInt(parts[2], 10);
  } else {
    const d = new Date(startDateStr);
    sYear = d.getUTCFullYear();
    sMonth = d.getUTCMonth();
    sDay = d.getUTCDate();
  }

  let eYear = sYear;
  let eMonth = sMonth;
  let eDay = sDay;

  if (endDateStr) {
    if (typeof endDateStr === "string" && endDateStr.includes("-")) {
      const parts = endDateStr.split("T")[0].split("-");
      eYear = parseInt(parts[0], 10);
      eMonth = parseInt(parts[1], 10) - 1;
      eDay = parseInt(parts[2], 10);
    } else {
      const d = new Date(endDateStr);
      eYear = d.getUTCFullYear();
      eMonth = d.getUTCMonth();
      eDay = d.getUTCDate();
    }
  }

  const sPadMonth = String(sMonth + 1).padStart(2, "0");
  const sPadDay = String(sDay).padStart(2, "0");
  const ePadMonth = String(eMonth + 1).padStart(2, "0");
  const ePadDay = String(eDay).padStart(2, "0");

  const normStartDateStr = `${sYear}-${sPadMonth}-${sPadDay}`;
  const normEndDateStr = `${eYear}-${ePadMonth}-${ePadDay}`;
  const isSingleDay = normStartDateStr === normEndDateStr;

  const startDate = new Date(Date.UTC(sYear, sMonth, sDay, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(eYear, eMonth, eDay, 23, 59, 59, 999));

  return {
    startDate,
    endDate,
    startDateStr: normStartDateStr,
    endDateStr: normEndDateStr,
    isSingleDay,
  };
}

/**
 * Checks whether a given target date falls within any active off-day (including annual recurring ones)
 */
export async function isDateAnOffDay(
  targetDate: Date | string,
): Promise<any | null> {
  let targetYear: number, targetMonth: number, targetDay: number;
  if (typeof targetDate === "string" && targetDate.includes("-")) {
    const parts = targetDate.split("T")[0].split("-");
    targetYear = parseInt(parts[0], 10);
    targetMonth = parseInt(parts[1], 10) - 1;
    targetDay = parseInt(parts[2], 10);
  } else {
    const d = new Date(targetDate);
    targetYear = d.getFullYear();
    targetMonth = d.getMonth();
    targetDay = d.getDate();
  }

  const targetMidnight = Date.UTC(targetYear, targetMonth, targetDay, 12, 0, 0);

  const activeOffDays = await db.offDay.findMany({
    where: { isActive: true },
  });

  for (const off of activeOffDays) {
    let sY: number, sM: number, sD: number;
    let eY: number, eM: number, eD: number;

    if (off.startDate instanceof Date) {
      sY = off.startDate.getUTCFullYear();
      sM = off.startDate.getUTCMonth();
      sD = off.startDate.getUTCDate();
    } else {
      const parts = String(off.startDate).split("T")[0].split("-");
      sY = parseInt(parts[0], 10);
      sM = parseInt(parts[1], 10) - 1;
      sD = parseInt(parts[2], 10);
    }

    if (off.endDate instanceof Date) {
      eY = off.endDate.getUTCFullYear();
      eM = off.endDate.getUTCMonth();
      eD = off.endDate.getUTCDate();
    } else {
      const parts = String(off.endDate || off.startDate).split("T")[0].split("-");
      eY = parseInt(parts[0], 10);
      eM = parseInt(parts[1], 10) - 1;
      eD = parseInt(parts[2], 10);
    }

    if (off.isRecurring) {
      const targetMMDD = (targetMonth + 1) * 100 + targetDay;
      const startMMDD = (sM + 1) * 100 + sD;
      const endMMDD = (eM + 1) * 100 + eD;

      if (startMMDD <= endMMDD) {
        if (targetMMDD >= startMMDD && targetMMDD <= endMMDD) return off;
      } else {
        if (targetMMDD >= startMMDD || targetMMDD <= endMMDD) return off;
      }
    } else {
      const sMidnight = Date.UTC(sY, sM, sD, 0, 0, 0, 0);
      const eMidnight = Date.UTC(eY, eM, eD, 23, 59, 59, 999);
      if (targetMidnight >= sMidnight && targetMidnight <= eMidnight) {
        return off;
      }
    }
  }

  return null;
}

/**
 * Finds any active scheduled appointments falling within a date range (for conflict detection)
 */
export async function getConflictingAppointmentsForRange(
  startDateStr: string | Date,
  endDateStr?: string | Date | null,
) {
  const { startDate, endDate } = normalizeDateRange(startDateStr, endDateStr);

  const appointments = await db.appointment.findMany({
    where: {
      startAt: {
        gte: startDate,
        lte: endDate,
      },
      status: {
        in: [
          AppointmentStatus.SCHEDULED,
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.RESCHEDULED,
        ],
      },
      isArchived: false,
    },
    include: {
      client: { include: { user: true } },
      technician: true,
    },
    orderBy: { startAt: "asc" },
  });

  return appointments.map((appt: any) => {
    const user = appt.client?.user || {};
    const clientName = `${user.firstName || appt.client?.primaryContactName || "Client"} ${user.lastName || ""}`.trim();
    const start = new Date(appt.startAt);

    return {
      id: appt.id,
      clientId: appt.clientId,
      clientNumber: appt.client?.clientNumber || "AW-CLIENT",
      clientName,
      clientEmail: user.email || appt.client?.primaryContactEmail || "",
      clientPhone: user.phone || appt.client?.primaryContactPhone || "",
      serviceName: appt.serviceName || "Home Safety Visit",
      startAt: appt.startAt,
      date: start.toISOString().split("T")[0],
      formattedDate: start.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      timeSlot: `${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
      technicianName: appt.technician?.name || "Unassigned Specialist",
      status: appt.status,
    };
  });
}

/**
 * Format OffDay response
 */
export function formatOffDay(off: any) {
  let sYear: number, sMonth: number, sDay: number;
  let eYear: number, eMonth: number, eDay: number;

  if (off.startDate instanceof Date) {
    sYear = off.startDate.getUTCFullYear();
    sMonth = off.startDate.getUTCMonth();
    sDay = off.startDate.getUTCDate();
  } else if (typeof off.startDate === "string") {
    const parts = off.startDate.split("T")[0].split("-");
    sYear = parseInt(parts[0], 10);
    sMonth = parseInt(parts[1], 10) - 1;
    sDay = parseInt(parts[2], 10);
  } else {
    const d = new Date(off.startDate);
    sYear = d.getUTCFullYear();
    sMonth = d.getUTCMonth();
    sDay = d.getUTCDate();
  }

  if (off.endDate instanceof Date) {
    eYear = off.endDate.getUTCFullYear();
    eMonth = off.endDate.getUTCMonth();
    eDay = off.endDate.getUTCDate();
  } else if (typeof off.endDate === "string") {
    const parts = off.endDate.split("T")[0].split("-");
    eYear = parseInt(parts[0], 10);
    eMonth = parseInt(parts[1], 10) - 1;
    eDay = parseInt(parts[2], 10);
  } else {
    const d = new Date(off.endDate || off.startDate);
    eYear = d.getUTCFullYear();
    eMonth = d.getUTCMonth();
    eDay = d.getUTCDate();
  }

  const startDateStr = `${sYear}-${String(sMonth + 1).padStart(2, "0")}-${String(sDay).padStart(2, "0")}`;
  const endDateStr = `${eYear}-${String(eMonth + 1).padStart(2, "0")}-${String(eDay).padStart(2, "0")}`;
  const isSingleDay = startDateStr === endDateStr;

  const formattedStartDate = formatDateToDisplay(startDateStr);
  const formattedEndDate = formatDateToDisplay(endDateStr);

  const startMidnight = Date.UTC(sYear, sMonth, sDay, 0, 0, 0, 0);
  const endMidnight = Date.UTC(eYear, eMonth, eDay, 0, 0, 0, 0);
  const durationDays = isSingleDay
    ? 1
    : Math.max(1, Math.round((endMidnight - startMidnight) / (1000 * 60 * 60 * 24)) + 1);

  const now = new Date();
  const todayMidnight = Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  );

  const isPast = endMidnight < todayMidnight;
  const isOngoing = startMidnight <= todayMidnight && endMidnight >= todayMidnight;
  const isUpcoming = startMidnight > todayMidnight;

  return {
    id: String(off.id),
    title: off.title,
    description: off.description || "",
    startDate: startDateStr,
    endDate: endDateStr,
    formattedStartDate,
    formattedEndDate,
    formattedDateRange: isSingleDay
      ? formattedStartDate
      : `${formattedStartDate} – ${formattedEndDate}`,
    isSingleDay,
    durationDays,
    isRecurring: Boolean(off.isRecurring),
    isActive: Boolean(off.isActive),
    status: !off.isActive
      ? "INACTIVE"
      : isOngoing
      ? "TODAY"
      : isUpcoming
      ? "UPCOMING"
      : "PAST",
    createdByUserId: off.createdByUserId || null,
    createdByName: off.createdByUser
      ? `${off.createdByUser.firstName} ${off.createdByUser.lastName}`.trim()
      : null,
    createdAt: off.createdAt,
    updatedAt: off.updatedAt,
  };
}

/**
 * CLIENT & CALENDARS: Get active off-days for date picker and calendar display
 */
export async function getActiveOffDays(filter: { year?: number; month?: number } = {}) {
  const where: any = { isActive: true };

  const offDays = await db.offDay.findMany({
    where,
    orderBy: { startDate: "asc" },
  });

  return offDays.map(formatOffDay);
}

/**
 * ADMIN: Get all off-days with search, pagination, and conflict counts
 */
export async function getAdminOffDays(query: QueryOffDaysInput = {}) {
  const where: any = {};

  if (query.isActive !== undefined && query.isActive !== "ALL") {
    where.isActive = query.isActive === "true";
  }

  if (query.search && query.search.trim()) {
    const term = query.search.trim();
    where.OR = [
      { title: { contains: term, mode: "insensitive" } },
      { description: { contains: term, mode: "insensitive" } },
    ];
  }

  if (query.year) {
    const y = parseInt(query.year, 10);
    if (!isNaN(y)) {
      const yearStart = new Date(y, 0, 1);
      const yearEnd = new Date(y, 11, 31, 23, 59, 59, 999);
      where.OR = [
        ...(where.OR || []),
        {
          startDate: { lte: yearEnd },
          endDate: { gte: yearStart },
        },
        { isRecurring: true },
      ];
    }
  }

  const page = query.page ? Math.max(1, parseInt(query.page, 10)) : 1;
  const limit = query.limit ? Math.max(1, parseInt(query.limit, 10)) : 100;
  const skip = (page - 1) * limit;

  const [total, offDays] = await Promise.all([
    db.offDay.count({ where }),
    db.offDay.findMany({
      where,
      include: { createdByUser: true },
      orderBy: { startDate: "desc" },
      skip,
      take: limit,
    }),
  ]);

  const formatted = offDays.map(formatOffDay);

  // Compute metrics for admin overview
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;

  const allActive = await db.offDay.findMany({ where: { isActive: true } });
  const activeFormatted = allActive.map(formatOffDay);

  const totalActive = activeFormatted.length;
  const upcomingCount = activeFormatted.filter(
    (o: any) => o.status === "UPCOMING" || o.status === "TODAY",
  ).length;
  const thisMonthCount = activeFormatted.filter((o: any) => {
    const [sY, sM] = o.startDate.split("-").map(Number);
    const [eY, eM] = o.endDate.split("-").map(Number);
    if (o.isRecurring) {
      return sM === nowMonth || eM === nowMonth;
    }
    return (
      (sY < nowYear || (sY === nowYear && sM <= nowMonth)) &&
      (eY > nowYear || (eY === nowYear && eM >= nowMonth))
    );
  }).length;
  const recurringCount = activeFormatted.filter(
    (o: any) => o.isRecurring,
  ).length;

  return {
    items: formatted,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    metrics: {
      totalActive,
      upcomingCount,
      thisMonthCount,
      recurringCount,
    },
  };
}

/**
 * ADMIN: Get Single Off-Day with any conflicting appointments
 */
export async function getOffDayById(id: string) {
  if (!isValidObjectId(id)) {
    throw new Error("Invalid Off-Day ID.");
  }

  const off = await db.offDay.findUnique({
    where: { id },
    include: { createdByUser: true },
  });

  if (!off) {
    throw new Error("Off-day record not found.");
  }

  const conflicts = await getConflictingAppointmentsForRange(
    off.startDate,
    off.endDate,
  );

  return {
    ...formatOffDay(off),
    conflicts,
    conflictCount: conflicts.length,
  };
}

/**
 * ADMIN: Create new Off-Day / Holiday
 */
export async function createOffDay(
  actorUserId: string,
  input: CreateOffDayInput,
) {
  const { startDate, endDate } = normalizeDateRange(
    input.startDate,
    input.endDate,
  );

  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("End date cannot be before start date.");
  }

  const off = await db.offDay.create({
    data: {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      startDate,
      endDate,
      isRecurring: Boolean(input.isRecurring),
      isActive: input.isActive !== undefined ? Boolean(input.isActive) : true,
      createdByUserId: isValidObjectId(actorUserId) ? actorUserId : null,
    },
    include: { createdByUser: true },
  });

  await createOffDayAuditLog({
    actorUserId,
    action: "OFF_DAY_CREATED",
    entityId: off.id,
    newValues: {
      title: off.title,
      startDate: off.startDate,
      endDate: off.endDate,
      isRecurring: off.isRecurring,
    },
  });

  // Check if any existing appointments are affected by this newly blocked off-day
  const conflicts = await getConflictingAppointmentsForRange(startDate, endDate);

  return {
    ...formatOffDay(off),
    conflicts,
    conflictCount: conflicts.length,
  };
}

/**
 * ADMIN: Update Off-Day
 */
export async function updateOffDay(
  id: string,
  actorUserId: string,
  input: UpdateOffDayInput,
) {
  if (!isValidObjectId(id)) {
    throw new Error("Invalid Off-Day ID.");
  }

  const existing = await db.offDay.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new Error("Off-day record not found.");
  }

  let startDate = existing.startDate;
  let endDate = existing.endDate;

  if (input.startDate || input.endDate) {
    const range = normalizeDateRange(
      input.startDate || existing.startDate,
      input.endDate !== undefined ? input.endDate : existing.endDate,
    );
    startDate = range.startDate;
    endDate = range.endDate;
  }

  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("End date cannot be before start date.");
  }

  const updated = await db.offDay.update({
    where: { id },
    data: {
      title: input.title !== undefined ? input.title.trim() : existing.title,
      description:
        input.description !== undefined
          ? input.description?.trim() || null
          : existing.description,
      startDate,
      endDate,
      isRecurring:
        input.isRecurring !== undefined
          ? Boolean(input.isRecurring)
          : existing.isRecurring,
      isActive:
        input.isActive !== undefined
          ? Boolean(input.isActive)
          : existing.isActive,
    },
    include: { createdByUser: true },
  });

  await createOffDayAuditLog({
    actorUserId,
    action: "OFF_DAY_UPDATED",
    entityId: id,
    previousValues: {
      title: existing.title,
      startDate: existing.startDate,
      endDate: existing.endDate,
      isActive: existing.isActive,
    },
    newValues: {
      title: updated.title,
      startDate: updated.startDate,
      endDate: updated.endDate,
      isActive: updated.isActive,
    },
  });

  const conflicts = await getConflictingAppointmentsForRange(startDate, endDate);

  return {
    ...formatOffDay(updated),
    conflicts,
    conflictCount: conflicts.length,
  };
}

/**
 * ADMIN: Delete Off-Day
 */
export async function deleteOffDay(id: string, actorUserId: string) {
  if (!isValidObjectId(id)) {
    throw new Error("Invalid Off-Day ID.");
  }

  const existing = await db.offDay.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new Error("Off-day record not found.");
  }

  await db.offDay.delete({
    where: { id },
  });

  await createOffDayAuditLog({
    actorUserId,
    action: "OFF_DAY_DELETED",
    entityId: id,
    previousValues: {
      title: existing.title,
      startDate: existing.startDate,
      endDate: existing.endDate,
    },
  });

  return { success: true, message: `Off-day "${existing.title}" deleted successfully.` };
}
