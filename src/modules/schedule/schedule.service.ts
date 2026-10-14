import prisma from "../../lib/prisma";
import { AppointmentStatus } from "@prisma/client";
import {
  UpdateWeeklyScheduleInput,
  CreateScheduleOverrideInput,
  UpdateScheduleOverrideInput,
  QueryOverridesInput,
  TimeWindowInput,
  OverrideStatus,
  OverrideType,
} from "./schedule.validation";
import { getUSHolidayForDate } from "../../utils/us-holidays.util";

const db = prisma as any;

function isValidObjectId(id?: string | null): boolean {
  if (!id || typeof id !== "string") return false;
  return /^[0-9a-fA-F]{24}$/.test(id.trim());
}

/**
 * Record an audit log for schedule operations.
 */
async function createScheduleAuditLog(params: {
  actorUserId?: string | null;
  action: string;
  entityType: string;
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
        entityType: params.entityType,
        entityId: params.entityId,
        previousValues: params.previousValues || null,
        newValues: params.newValues || null,
        metadata: params.metadata || null,
      },
    });
  } catch (err) {
    console.warn("⚠️ Failed to write schedule audit log:", err);
  }
}

/**
 * Default fallback working schedule for AgeWellRI (Mon, Tue, Thu, Fri, Sat 8am-6pm; Wed & Sun Closed)
 */
export const INITIAL_DEFAULT_DAYS = [
  {
    dayOfWeek: 0,
    dayName: "Sunday",
    isOpen: false,
    timeWindows: [],
  },
  {
    dayOfWeek: 1,
    dayName: "Monday",
    isOpen: true,
    timeWindows: [{ start: "08:00", end: "18:00" }],
  },
  {
    dayOfWeek: 2,
    dayName: "Tuesday",
    isOpen: true,
    timeWindows: [{ start: "08:00", end: "18:00" }],
  },
  {
    dayOfWeek: 3,
    dayName: "Wednesday",
    isOpen: false,
    timeWindows: [],
  },
  {
    dayOfWeek: 4,
    dayName: "Thursday",
    isOpen: true,
    timeWindows: [{ start: "08:00", end: "18:00" }],
  },
  {
    dayOfWeek: 5,
    dayName: "Friday",
    isOpen: true,
    timeWindows: [{ start: "08:00", end: "18:00" }],
  },
  {
    dayOfWeek: 6,
    dayName: "Saturday",
    isOpen: true,
    timeWindows: [{ start: "08:00", end: "18:00" }],
  },
];

/**
 * Format minutes (from midnight) into human-readable 12-hour AM/PM string (e.g. 540 -> "09:00 AM")
 */
export function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(displayHour).padStart(2, "0")}:${String(mins).padStart(2, "0")} ${ampm}`;
}

/**
 * Convert "HH:MM" (24h) string into minutes from midnight
 */
export function timeStringToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  // Check if standard 12h format e.g. "09:00 AM"
  const match12 = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (match12) {
    let hour = parseInt(match12[1], 10);
    const min = parseInt(match12[2], 10);
    const ampm = match12[3].toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    return hour * 60 + min;
  }
  // Check 24h format e.g. "09:00"
  const parts = timeStr.split(":");
  if (parts.length >= 2) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return h * 60 + m;
  }
  return 0;
}

/**
 * Normalize date string to UTC boundaries (00:00:00.000 to 23:59:59.999 UTC)
 */
export function normalizeDateRange(
  startDateStr: string | Date,
  endDateStr?: string | Date | null
) {
  let sY: number, sM: number, sD: number;
  if (typeof startDateStr === "string" && startDateStr.includes("-")) {
    const parts = startDateStr.split("T")[0].split("-");
    sY = parseInt(parts[0], 10);
    sM = parseInt(parts[1], 10) - 1;
    sD = parseInt(parts[2], 10);
  } else {
    const d = new Date(startDateStr);
    sY = d.getUTCFullYear();
    sM = d.getUTCMonth();
    sD = d.getUTCDate();
  }

  let eY = sY,
    eM = sM,
    eD = sD;
  if (endDateStr) {
    if (typeof endDateStr === "string" && endDateStr.includes("-")) {
      const parts = endDateStr.split("T")[0].split("-");
      eY = parseInt(parts[0], 10);
      eM = parseInt(parts[1], 10) - 1;
      eD = parseInt(parts[2], 10);
    } else {
      const d = new Date(endDateStr);
      eY = d.getUTCFullYear();
      eM = d.getUTCMonth();
      eD = d.getUTCDate();
    }
  }

  const sPadM = String(sM + 1).padStart(2, "0");
  const sPadD = String(sD).padStart(2, "0");
  const ePadM = String(eM + 1).padStart(2, "0");
  const ePadD = String(eD).padStart(2, "0");

  const startStr = `${sY}-${sPadM}-${sPadD}`;
  const endStr = `${eY}-${ePadM}-${ePadD}`;

  return {
    startDate: new Date(Date.UTC(sY, sM, sD, 0, 0, 0, 0)),
    endDate: new Date(Date.UTC(eY, eM, eD, 23, 59, 59, 999)),
    startDateStr: startStr,
    endDateStr: endStr,
    isSingleDay: startStr === endStr,
  };
}

/**
 * Format a YYYY-MM-DD date string to a human-friendly format (e.g. "Mon, Oct 12, 2026")
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
 * Get or seed the default weekly availability schedule.
 */
export async function getOrCreateDefaultWeeklySchedule() {
  let weekly = await db.weeklySchedule.findFirst({
    where: { isDefault: true },
  });

  if (!weekly) {
    weekly = await db.weeklySchedule.create({
      data: {
        name: "Standard Weekly Schedule",
        isDefault: true,
        slotDuration: 60,
        days: INITIAL_DEFAULT_DAYS,
      },
    });
  }

  return weekly;
}

/**
 * Update the default weekly availability schedule.
 */
export async function updateWeeklySchedule(
  actorUserId: string,
  input: UpdateWeeklyScheduleInput
) {
  let weekly = await getOrCreateDefaultWeeklySchedule();

  const previousValues = {
    days: weekly.days,
    slotDuration: weekly.slotDuration,
  };

  const updated = await db.weeklySchedule.update({
    where: { id: weekly.id },
    data: {
      name: input.name || weekly.name,
      days: input.days,
      slotDuration: input.slotDuration || weekly.slotDuration || 60,
    },
  });

  await createScheduleAuditLog({
    actorUserId,
    action: "WEEKLY_SCHEDULE_UPDATED",
    entityType: "WeeklySchedule",
    entityId: updated.id,
    previousValues,
    newValues: {
      days: updated.days,
      slotDuration: updated.slotDuration,
    },
  });

  return updated;
}

/**
 * Format ScheduleOverride item for responses
 */
function formatScheduleOverride(item: any) {
  let sYear: number, sMonth: number, sDay: number;
  let eYear: number, eMonth: number, eDay: number;

  if (item.startDate instanceof Date) {
    sYear = item.startDate.getUTCFullYear();
    sMonth = item.startDate.getUTCMonth();
    sDay = item.startDate.getUTCDate();
  } else {
    const parts = String(item.startDate).split("T")[0].split("-");
    sYear = parseInt(parts[0], 10);
    sMonth = parseInt(parts[1], 10) - 1;
    sDay = parseInt(parts[2], 10);
  }

  if (item.endDate instanceof Date) {
    eYear = item.endDate.getUTCFullYear();
    eMonth = item.endDate.getUTCMonth();
    eDay = item.endDate.getUTCDate();
  } else {
    const parts = String(item.endDate || item.startDate).split("T")[0].split("-");
    eYear = parseInt(parts[0], 10);
    eMonth = parseInt(parts[1], 10) - 1;
    eDay = parseInt(parts[2], 10);
  }

  const sPadM = String(sMonth + 1).padStart(2, "0");
  const sPadD = String(sDay).padStart(2, "0");
  const ePadM = String(eMonth + 1).padStart(2, "0");
  const ePadD = String(eDay).padStart(2, "0");

  const startDateStr = `${sYear}-${sPadM}-${sPadD}`;
  const endDateStr = `${eYear}-${ePadM}-${ePadD}`;
  const isSingleDay = startDateStr === endDateStr;

  const formattedStartDate = formatDateToDisplay(startDateStr);
  const formattedEndDate = formatDateToDisplay(endDateStr);

  return {
    id: String(item.id),
    title: item.title,
    description: item.description || "",
    overrideType: item.overrideType || "DATE",
    status: item.status || "CLOSED",
    startDate: startDateStr,
    endDate: endDateStr,
    formattedStartDate,
    formattedEndDate,
    formattedDateRange: isSingleDay
      ? formattedStartDate
      : `${formattedStartDate} – ${formattedEndDate}`,
    isSingleDay,
    isRecurring: Boolean(item.isRecurring),
    isActive: Boolean(item.isActive),
    timeWindows: item.timeWindows || [],
    offDayId: item.offDayId || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * Get all schedule overrides with filters and pagination.
 */
export async function getScheduleOverrides(query: QueryOverridesInput = {}) {
  const where: any = {};

  if (query.isActive !== undefined && query.isActive !== "ALL") {
    where.isActive = query.isActive === "true";
  }

  if (query.overrideType && query.overrideType !== "ALL") {
    where.overrideType = query.overrideType;
  }

  if (query.status && query.status !== "ALL") {
    where.status = query.status;
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
      const yearStart = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
      const yearEnd = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
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

  // Retrieve both ScheduleOverride and legacy OffDay records
  const [totalOverrides, overrides, legacyOffDays] = await Promise.all([
    db.scheduleOverride.count({ where }),
    db.scheduleOverride.findMany({
      where,
      orderBy: { startDate: "desc" },
      skip,
      take: limit,
    }),
    db.offDay.findMany({
      where: { isActive: true },
    }),
  ]);

  // Convert legacy OffDays that are not already linked in ScheduleOverride
  const linkedOffDayIds = new Set(
    overrides.map((o: any) => o.offDayId).filter(Boolean)
  );

  const unlinkedLegacy = legacyOffDays
    .filter((off: any) => !linkedOffDayIds.has(String(off.id)))
    .map((off: any) => ({
      id: `legacy-${off.id}`,
      title: off.title,
      description: off.description,
      overrideType: OverrideType.DATE,
      status: OverrideStatus.CLOSED,
      startDate: off.startDate,
      endDate: off.endDate,
      isRecurring: off.isRecurring,
      isActive: off.isActive,
      timeWindows: [],
      offDayId: String(off.id),
      createdAt: off.createdAt,
      updatedAt: off.updatedAt,
    }));

  const allItems = [...overrides, ...unlinkedLegacy].map(formatScheduleOverride);

  // Compute metrics
  const totalActive = allItems.filter((i) => i.isActive).length;
  const closedCount = allItems.filter((i) => i.status === "CLOSED" && i.isActive).length;
  const customCount = allItems.filter((i) => i.status === "CUSTOM_HOURS" && i.isActive).length;
  const weekOverrideCount = allItems.filter((i) => i.overrideType === "WEEK" && i.isActive).length;

  return {
    items: allItems,
    total: totalOverrides + unlinkedLegacy.length,
    page,
    limit,
    totalPages: Math.ceil((totalOverrides + unlinkedLegacy.length) / limit),
    metrics: {
      totalActive,
      closedCount,
      customCount,
      weekOverrideCount,
    },
  };
}

/**
 * Get a single schedule override by ID with conflicting appointments preview.
 */
export async function getScheduleOverrideById(id: string) {
  let override = null;

  if (id.startsWith("legacy-")) {
    const offDayId = id.replace("legacy-", "");
    const off = await db.offDay.findUnique({ where: { id: offDayId } });
    if (off) {
      override = {
        id,
        title: off.title,
        description: off.description,
        overrideType: OverrideType.DATE,
        status: OverrideStatus.CLOSED,
        startDate: off.startDate,
        endDate: off.endDate,
        isRecurring: off.isRecurring,
        isActive: off.isActive,
        timeWindows: [],
        offDayId: String(off.id),
        createdAt: off.createdAt,
        updatedAt: off.updatedAt,
      };
    }
  } else if (isValidObjectId(id)) {
    override = await db.scheduleOverride.findUnique({ where: { id } });
  }

  if (!override) {
    throw new Error("Schedule override record not found.");
  }

  const conflicts = await previewOverrideConflicts(
    override.startDate,
    override.endDate
  );

  return {
    ...formatScheduleOverride(override),
    conflicts: conflicts.conflicts,
    conflictCount: conflicts.conflictCount,
  };
}

/**
 * Create a new schedule override (Date or Week override).
 */
export async function createScheduleOverride(
  actorUserId: string,
  input: CreateScheduleOverrideInput
) {
  const { startDate, endDate } = normalizeDateRange(
    input.startDate,
    input.endDate
  );

  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("End date cannot be before start date.");
  }

  // Also create/sync to legacy OffDay if it's a closed date override for complete backward compatibility
  let linkedOffDayId: string | null = null;
  if (input.status === "CLOSED") {
    try {
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
      });
      linkedOffDayId = off.id;
    } catch (err) {
      console.warn("Could not sync legacy offDay:", err);
    }
  }

  // If creating a single-day override, deactivate any older active single-day overrides for the exact same date
  if ((input.overrideType === "DATE" || !input.overrideType) && !input.isRecurring && startDate.getTime() === endDate.getTime()) {
    try {
      await db.scheduleOverride.updateMany({
        where: {
          startDate,
          endDate,
          overrideType: "DATE",
          isRecurring: false,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });
    } catch (err) {
      console.warn("Could not deactivate previous override:", err);
    }
  }

  const override = await db.scheduleOverride.create({
    data: {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      overrideType: input.overrideType || "DATE",
      status: input.status || "CLOSED",
      startDate,
      endDate,
      isRecurring: Boolean(input.isRecurring),
      isActive: input.isActive !== undefined ? Boolean(input.isActive) : true,
      timeWindows: input.timeWindows || [],
      offDayId: linkedOffDayId,
      createdByUserId: isValidObjectId(actorUserId) ? actorUserId : null,
    },
  });

  await createScheduleAuditLog({
    actorUserId,
    action: "SCHEDULE_OVERRIDE_CREATED",
    entityType: "ScheduleOverride",
    entityId: override.id,
    newValues: {
      title: override.title,
      overrideType: override.overrideType,
      status: override.status,
      startDate: override.startDate,
      endDate: override.endDate,
      isRecurring: override.isRecurring,
    },
  });

  const conflicts = await previewOverrideConflicts(startDate, endDate);

  return {
    ...formatScheduleOverride(override),
    conflicts: conflicts.conflicts,
    conflictCount: conflicts.conflictCount,
  };
}

/**
 * Update an existing schedule override.
 */
export async function updateScheduleOverride(
  id: string,
  actorUserId: string,
  input: UpdateScheduleOverrideInput
) {
  let targetId = id;
  let isLegacy = false;

  if (id.startsWith("legacy-")) {
    targetId = id.replace("legacy-", "");
    isLegacy = true;
  }

  if (isLegacy) {
    // Update legacy offDay and create/upsert corresponding scheduleOverride
    const existingOff = await db.offDay.findUnique({ where: { id: targetId } });
    if (!existingOff) throw new Error("Off-day record not found.");

    let sDate = existingOff.startDate;
    let eDate = existingOff.endDate;
    if (input.startDate || input.endDate) {
      const range = normalizeDateRange(
        input.startDate || existingOff.startDate,
        input.endDate !== undefined ? input.endDate : existingOff.endDate
      );
      sDate = range.startDate;
      eDate = range.endDate;
    }

    await db.offDay.update({
      where: { id: targetId },
      data: {
        title: input.title !== undefined ? input.title.trim() : existingOff.title,
        description:
          input.description !== undefined
            ? input.description?.trim() || null
            : existingOff.description,
        startDate: sDate,
        endDate: eDate,
        isRecurring:
          input.isRecurring !== undefined
            ? Boolean(input.isRecurring)
            : existingOff.isRecurring,
        isActive:
          input.isActive !== undefined
            ? Boolean(input.isActive)
            : existingOff.isActive,
      },
    });

    const createdOverride = await db.scheduleOverride.create({
      data: {
        title: input.title !== undefined ? input.title.trim() : existingOff.title,
        description:
          input.description !== undefined
            ? input.description?.trim() || null
            : existingOff.description,
        overrideType: input.overrideType || OverrideType.DATE,
        status: input.status || OverrideStatus.CLOSED,
        startDate: sDate,
        endDate: eDate,
        isRecurring:
          input.isRecurring !== undefined
            ? Boolean(input.isRecurring)
            : existingOff.isRecurring,
        isActive:
          input.isActive !== undefined
            ? Boolean(input.isActive)
            : existingOff.isActive,
        timeWindows: input.timeWindows || [],
        offDayId: targetId,
        createdByUserId: isValidObjectId(actorUserId) ? actorUserId : null,
      },
    });

    return formatScheduleOverride(createdOverride);
  }

  if (!isValidObjectId(id)) {
    throw new Error("Invalid Schedule Override ID.");
  }

  const existing = await db.scheduleOverride.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("Schedule override record not found.");
  }

  let startDate = existing.startDate;
  let endDate = existing.endDate;

  if (input.startDate || input.endDate) {
    const range = normalizeDateRange(
      input.startDate || existing.startDate,
      input.endDate !== undefined ? input.endDate : existing.endDate
    );
    startDate = range.startDate;
    endDate = range.endDate;
  }

  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("End date cannot be before start date.");
  }

  const updated = await db.scheduleOverride.update({
    where: { id },
    data: {
      title: input.title !== undefined ? input.title.trim() : existing.title,
      description:
        input.description !== undefined
          ? input.description?.trim() || null
          : existing.description,
      overrideType: input.overrideType || existing.overrideType,
      status: input.status || existing.status,
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
      timeWindows:
        input.timeWindows !== undefined
          ? input.timeWindows
          : existing.timeWindows,
    },
  });

  // Sync back to linked legacy off-day if exists
  if (existing.offDayId) {
    try {
      if (updated.status === "CLOSED" && updated.isActive) {
        await db.offDay.update({
          where: { id: existing.offDayId },
          data: {
            title: updated.title,
            description: updated.description,
            startDate: updated.startDate,
            endDate: updated.endDate,
            isRecurring: updated.isRecurring,
            isActive: true,
          },
        });
      } else {
        // If changed to OPEN or CUSTOM_HOURS or deactivated, deactivate legacy offDay
        await db.offDay.update({
          where: { id: existing.offDayId },
          data: {
            isActive: false,
          },
        });
      }
    } catch {
      // Non-critical
    }
  }

  await createScheduleAuditLog({
    actorUserId,
    action: "SCHEDULE_OVERRIDE_UPDATED",
    entityType: "ScheduleOverride",
    entityId: id,
    previousValues: {
      title: existing.title,
      startDate: existing.startDate,
      endDate: existing.endDate,
      status: existing.status,
      isActive: existing.isActive,
    },
    newValues: {
      title: updated.title,
      startDate: updated.startDate,
      endDate: updated.endDate,
      status: updated.status,
      isActive: updated.isActive,
    },
  });

  const conflicts = await previewOverrideConflicts(startDate, endDate);

  return {
    ...formatScheduleOverride(updated),
    conflicts: conflicts.conflicts,
    conflictCount: conflicts.conflictCount,
  };
}

/**
 * Delete a schedule override.
 */
export async function deleteScheduleOverride(id: string, actorUserId: string) {
  let targetId = id;
  let isLegacyPrefix = false;

  if (id.startsWith("legacy-")) {
    targetId = id.replace("legacy-", "");
    isLegacyPrefix = true;
  }

  // 1. Try finding in ScheduleOverride first
  if (!isLegacyPrefix && isValidObjectId(targetId)) {
    const existingOverride = await db.scheduleOverride.findUnique({ where: { id: targetId } });
    if (existingOverride) {
      if (existingOverride.offDayId) {
        try {
          await db.offDay.delete({ where: { id: existingOverride.offDayId } });
        } catch {
          // Non-critical
        }
      }

      await db.scheduleOverride.delete({ where: { id: targetId } });

      await createScheduleAuditLog({
        actorUserId,
        action: "SCHEDULE_OVERRIDE_DELETED",
        entityType: "ScheduleOverride",
        entityId: targetId,
        previousValues: {
          title: existingOverride.title,
          startDate: existingOverride.startDate,
          endDate: existingOverride.endDate,
        },
      });

      return { success: true, message: `Schedule override "${existingOverride.title}" removed successfully.` };
    }
  }

  // 2. Try finding in OffDay (legacy or unlinked)
  if (isValidObjectId(targetId)) {
    const existingOff = await db.offDay.findUnique({ where: { id: targetId } });
    if (existingOff) {
      try {
        await db.scheduleOverride.deleteMany({ where: { offDayId: targetId } });
      } catch {
        // Non-critical
      }

      await db.offDay.delete({ where: { id: targetId } });

      await createScheduleAuditLog({
        actorUserId,
        action: "SCHEDULE_OVERRIDE_DELETED",
        entityType: "OffDay",
        entityId: targetId,
        previousValues: {
          title: existingOff.title,
          startDate: existingOff.startDate,
          endDate: existingOff.endDate,
        },
      });

      return { success: true, message: `Schedule override "${existingOff.title}" removed successfully.` };
    }
  }

  // 3. If already deleted or not found, return clean success
  return { success: true, message: "Schedule override removed successfully." };
}

/**
 * Preview any active appointments conflicting with a proposed date range
 */
export async function previewOverrideConflicts(
  startDateStr: string | Date,
  endDateStr?: string | Date | null
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

  const conflicts = appointments.map((appt: any) => {
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
      formattedDate: formatDateToDisplay(start.toISOString().split("T")[0]),
      timeSlot: `${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
      technicianName: appt.technician?.name || "Unassigned Specialist",
      status: appt.status,
    };
  });

  return {
    conflicts,
    conflictCount: conflicts.length,
  };
}

/**
 * Core Authoritative Availability Engine
 * Resolves Date Override > Week Override > Default Weekly Schedule minus Booked Slots
 */
export async function calculateDateAvailability(
  targetDateStr: string,
  options: {
    durationMinutes?: number;
    clientId?: string;
    technicianId?: string;
    excludeAppointmentId?: string;
  } = {}
) {
  const durationMinutes = options.durationMinutes || 60;
  const parts = targetDateStr.split("T")[0].split("-");
  const tY = parseInt(parts[0], 10);
  const tM = parseInt(parts[1], 10) - 1; // 0-11
  const tD = parseInt(parts[2], 10);

  const targetDateUTC = new Date(Date.UTC(tY, tM, tD, 12, 0, 0));
  const dayOfWeek = targetDateUTC.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = dayNames[dayOfWeek];

  const formattedDate = formatDateToDisplay(targetDateStr);
  const targetMidnight = Date.UTC(tY, tM, tD, 12, 0, 0);

  // 1. Check US Holiday
  const holiday = getUSHolidayForDate(targetDateStr);

  // 2. Fetch Default Weekly Schedule
  const weekly = await getOrCreateDefaultWeeklySchedule();
  const defaultDay = weekly.days.find((d: any) => d.dayOfWeek === dayOfWeek) || {
    dayOfWeek,
    dayName,
    isOpen: dayOfWeek !== 0 && dayOfWeek !== 3, // Default fallback (Sun & Wed closed)
    timeWindows: dayOfWeek !== 0 && dayOfWeek !== 3 ? [{ start: "08:00", end: "18:00" }] : [],
  };

  // 3. Fetch Overrides (ScheduleOverride + legacy OffDay)
  const [activeOverrides, activeLegacyOffDays] = await Promise.all([
    db.scheduleOverride.findMany({
      where: { isActive: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
    db.offDay.findMany({
      where: { isActive: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  // Combine legacy OffDays as CLOSED Date Overrides
  const unifiedOverrides: any[] = [...activeOverrides];
  for (const off of activeLegacyOffDays) {
    if (!activeOverrides.some((o: any) => o.offDayId === off.id)) {
      unifiedOverrides.push({
        id: `legacy-${off.id}`,
        title: off.title,
        description: off.description,
        overrideType: OverrideType.DATE,
        status: OverrideStatus.CLOSED,
        startDate: off.startDate,
        endDate: off.endDate,
        isRecurring: off.isRecurring,
        isActive: off.isActive,
        timeWindows: [],
      });
    }
  }

  // Find matching DATE override
  let dateOverride: any = null;
  let weekOverride: any = null;

  for (const item of unifiedOverrides) {
    let sY: number, sM: number, sD: number;
    let eY: number, eM: number, eD: number;

    if (item.startDate instanceof Date) {
      sY = item.startDate.getUTCFullYear();
      sM = item.startDate.getUTCMonth();
      sD = item.startDate.getUTCDate();
    } else {
      const p = String(item.startDate).split("T")[0].split("-");
      sY = parseInt(p[0], 10);
      sM = parseInt(p[1], 10) - 1;
      sD = parseInt(p[2], 10);
    }

    if (item.endDate instanceof Date) {
      eY = item.endDate.getUTCFullYear();
      eM = item.endDate.getUTCMonth();
      eD = item.endDate.getUTCDate();
    } else {
      const p = String(item.endDate || item.startDate).split("T")[0].split("-");
      eY = parseInt(p[0], 10);
      eM = parseInt(p[1], 10) - 1;
      eD = parseInt(p[2], 10);
    }

    let isMatch = false;
    if (item.isRecurring) {
      const targetMMDD = (tM + 1) * 100 + tD;
      const startMMDD = (sM + 1) * 100 + sD;
      const endMMDD = (eM + 1) * 100 + eD;
      if (startMMDD <= endMMDD) {
        isMatch = targetMMDD >= startMMDD && targetMMDD <= endMMDD;
      } else {
        isMatch = targetMMDD >= startMMDD || targetMMDD <= endMMDD;
      }
    } else {
      const sMidnight = Date.UTC(sY, sM, sD, 0, 0, 0, 0);
      const eMidnight = Date.UTC(eY, eM, eD, 23, 59, 59, 999);
      isMatch = targetMidnight >= sMidnight && targetMidnight <= eMidnight;
    }

    if (isMatch) {
      if (item.overrideType === OverrideType.WEEK) {
        if (!weekOverride) weekOverride = item;
      } else {
        if (!dateOverride) dateOverride = item;
      }
    }
  }

  // 4. Resolve Effective Availability Status & Time Windows based on Priority Hierarchy:
  // Priority: DATE OVERRIDE > WEEK OVERRIDE > DEFAULT WEEKLY
  let effectiveSource = "DEFAULT_WEEKLY";
  let effectiveStatus: "CLOSED" | "CUSTOM_HOURS" | "OPEN" = defaultDay.isOpen ? "OPEN" : "CLOSED";
  let effectiveTitle = "";
  let effectiveDescription = "";
  let effectiveWindows: TimeWindowInput[] = defaultDay.isOpen ? (defaultDay.timeWindows || [{ start: "08:00", end: "18:00" }]) : [];

  if (dateOverride) {
    effectiveSource = "DATE_OVERRIDE";
    effectiveStatus = dateOverride.status;
    effectiveTitle = dateOverride.title;
    effectiveDescription = dateOverride.description || "";
    if (dateOverride.status === "CUSTOM_HOURS") {
      effectiveWindows =
        dateOverride.timeWindows && dateOverride.timeWindows.length > 0
          ? dateOverride.timeWindows
          : [{ start: "08:00", end: "18:00" }];
    } else if (dateOverride.status === "OPEN") {
      effectiveWindows =
        dateOverride.timeWindows && dateOverride.timeWindows.length > 0
          ? dateOverride.timeWindows
          : defaultDay.timeWindows && defaultDay.timeWindows.length > 0
          ? defaultDay.timeWindows
          : [{ start: "08:00", end: "18:00" }];
    } else {
      effectiveWindows = [];
    }
  } else if (weekOverride) {
    effectiveSource = "WEEK_OVERRIDE";
    effectiveStatus = weekOverride.status;
    effectiveTitle = weekOverride.title;
    effectiveDescription = weekOverride.description || "";
    if (weekOverride.status === "CUSTOM_HOURS") {
      effectiveWindows =
        weekOverride.timeWindows && weekOverride.timeWindows.length > 0
          ? weekOverride.timeWindows
          : [{ start: "08:00", end: "18:00" }];
    } else if (weekOverride.status === "OPEN") {
      effectiveWindows =
        weekOverride.timeWindows && weekOverride.timeWindows.length > 0
          ? weekOverride.timeWindows
          : defaultDay.timeWindows && defaultDay.timeWindows.length > 0
          ? defaultDay.timeWindows
          : [{ start: "08:00", end: "18:00" }];
    } else {
      effectiveWindows = [];
    }
  }

  const isClosed = effectiveStatus === "CLOSED";
  const isOpen = !isClosed;

  // 5. Query Existing Active Appointments on this Date
  const startOfDay = new Date(Date.UTC(tY, tM, tD, 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(tY, tM, tD, 23, 59, 59, 999));

  const existingAppts = await db.appointment.findMany({
    where: {
      startAt: { gte: startOfDay, lte: endOfDay },
      status: {
        in: [
          AppointmentStatus.SCHEDULED,
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.RESCHEDULED,
        ],
      },
      isArchived: false,
      ...(options.excludeAppointmentId ? { id: { not: options.excludeAppointmentId } } : {}),
    },
    include: {
      client: { include: { user: true } },
      technician: true,
    },
    orderBy: { startAt: "asc" },
  });

  const bookedSlots = existingAppts.map((appt: any) => {
    const user = appt.client?.user || {};
    const clientName = `${user.firstName || appt.client?.primaryContactName || "Client"} ${user.lastName || ""}`.trim();
    const s = new Date(appt.startAt);
    const e = new Date(appt.endAt || new Date(s.getTime() + durationMinutes * 60000));
    const startMin = s.getHours() * 60 + s.getMinutes();
    const endMin = e.getHours() * 60 + e.getMinutes();

    return {
      id: appt.id,
      appointmentId: appt.id,
      clientId: appt.clientId,
      clientName,
      serviceName: appt.serviceName || "Home Safety Visit",
      startAt: appt.startAt,
      endAt: appt.endAt,
      startMinutes: startMin,
      endMinutes: endMin,
      timeSlot: `${minutesToTimeString(startMin)} – ${minutesToTimeString(endMin)}`,
      startTime: minutesToTimeString(startMin),
      endTime: minutesToTimeString(endMin),
      technicianName: appt.technician?.name || "Unassigned",
      status: appt.status,
    };
  });

  // 6. Generate Potential Slots from effective windows
  const availableSlots: Array<{
    slot: string;
    startTime: string;
    endTime: string;
    startMinutes: number;
    endMinutes: number;
    windowIndex: number;
  }> = [];

  const allPossibleSlots: Array<{
    slot: string;
    startTime: string;
    endTime: string;
    startMinutes: number;
    endMinutes: number;
    windowIndex: number;
  }> = [];

  // Check if date is in the past
  const now = new Date();
  const currentMidnightUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const targetMidnightUTC = Date.UTC(tY, tM, tD, 0, 0, 0, 0);
  const isPastDate = targetMidnightUTC < currentMidnightUTC;
  const isToday = targetMidnightUTC === currentMidnightUTC;
  const currentMinutesFromMidnight = now.getHours() * 60 + now.getMinutes();

  if (!isClosed && !isPastDate) {
    effectiveWindows.forEach((win, winIdx) => {
      const wStartMin = timeStringToMinutes(win.start);
      const wEndMin = timeStringToMinutes(win.end);

      // Generate slots step by duration (e.g. 60 mins) or standard 60 min intervals
      const step = Math.min(60, durationMinutes);

      for (let m = wStartMin; m + durationMinutes <= wEndMin; m += step) {
        const slotEnd = m + durationMinutes;
        const slotFormatted = `${minutesToTimeString(m)} – ${minutesToTimeString(slotEnd)}`;
        const slotObj = {
          slot: slotFormatted,
          startTime: minutesToTimeString(m),
          endTime: minutesToTimeString(slotEnd),
          startMinutes: m,
          endMinutes: slotEnd,
          windowIndex: winIdx,
        };

        allPossibleSlots.push(slotObj);

        // Check conflicts with existing bookings
        const hasConflict = bookedSlots.some((booked: any) => {
          return Math.max(m, booked.startMinutes) < Math.min(slotEnd, booked.endMinutes);
        });

        // Check if today and slot is in the past
        const isPastSlot = isToday && m <= currentMinutesFromMidnight + 15; // 15 min buffer

        if (!hasConflict && !isPastSlot) {
          availableSlots.push(slotObj);
        }
      }
    });
  }

  return {
    date: targetDateStr,
    formattedDate,
    dayOfWeek,
    dayName,
    isOpen,
    isClosed,
    source: effectiveSource,
    overrideTitle: effectiveTitle,
    overrideDescription: effectiveDescription,
    overrideStatus: effectiveStatus,
    timeWindows: effectiveWindows,
    holiday,
    isHoliday: Boolean(holiday),
    isPastDate,
    isToday,
    availableSlots,
    bookedSlots,
    allPossibleSlots,
    metrics: {
      totalPossibleSlots: allPossibleSlots.length,
      availableCount: availableSlots.length,
      bookedCount: bookedSlots.length,
    },
  };
}

/**
 * Batch calculate calendar availability for a date range (e.g. whole Month or Week view)
 */
export async function getCalendarRangeAvailability(
  startDateStr: string,
  endDateStr: string,
  options: {
    durationMinutes?: number;
    technicianId?: string;
  } = {}
) {
  const { startDate, endDate, startDateStr: sStr, endDateStr: eStr } = normalizeDateRange(
    startDateStr,
    endDateStr
  );

  const durationMinutes = options.durationMinutes || 60;

  // Fetch Default Weekly Schedule
  const weekly = await getOrCreateDefaultWeeklySchedule();

  // Fetch Overrides (ScheduleOverride + legacy OffDay)
  const [activeOverrides, activeLegacyOffDays] = await Promise.all([
    db.scheduleOverride.findMany({
      where: {
        isActive: true,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
    db.offDay.findMany({
      where: {
        isActive: true,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const unifiedOverrides = [...activeOverrides];
  for (const off of activeLegacyOffDays) {
    if (!activeOverrides.some((o: any) => o.offDayId === off.id)) {
      unifiedOverrides.push({
        id: `legacy-${off.id}`,
        title: off.title,
        description: off.description,
        overrideType: OverrideType.DATE,
        status: OverrideStatus.CLOSED,
        startDate: off.startDate,
        endDate: off.endDate,
        isRecurring: off.isRecurring,
        isActive: off.isActive,
        timeWindows: [],
      });
    }
  }

  // Fetch all appointments in range
  const appointments = await db.appointment.findMany({
    where: {
      startAt: { gte: startDate, lte: endDate },
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

  // Group appointments by date YYYY-MM-DD
  const apptsByDate: Record<string, any[]> = {};
  appointments.forEach((appt: any) => {
    const d = new Date(appt.startAt);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!apptsByDate[dateKey]) apptsByDate[dateKey] = [];
    apptsByDate[dateKey].push(appt);
  });

  // Iterate each day in range
  const days: any[] = [];
  const current = new Date(startDate.getTime());
  const now = new Date();
  const currentMidnightUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const currentMinutesFromMidnight = now.getHours() * 60 + now.getMinutes();

  while (current.getTime() <= endDate.getTime()) {
    const y = current.getUTCFullYear();
    const m = current.getUTCMonth();
    const d = current.getUTCDate();
    const dayOfWeek = current.getUTCDay();
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = dayNames[dayOfWeek];
    const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const formattedDate = formatDateToDisplay(dateStr);
    const targetMidnight = Date.UTC(y, m, d, 12, 0, 0);

    const holiday = getUSHolidayForDate(dateStr);

    const defaultDay = weekly.days.find((day: any) => day.dayOfWeek === dayOfWeek) || {
      dayOfWeek,
      dayName,
      isOpen: dayOfWeek !== 0 && dayOfWeek !== 3,
      timeWindows: dayOfWeek !== 0 && dayOfWeek !== 3 ? [{ start: "08:00", end: "18:00" }] : [],
    };

    // Find date / week override
    let dateOverride: any = null;
    let weekOverride: any = null;

    for (const item of unifiedOverrides) {
      let sY: number, sM: number, sD: number;
      let eY: number, eM: number, eD: number;

      if (item.startDate instanceof Date) {
        sY = item.startDate.getUTCFullYear();
        sM = item.startDate.getUTCMonth();
        sD = item.startDate.getUTCDate();
      } else {
        const p = String(item.startDate).split("T")[0].split("-");
        sY = parseInt(p[0], 10);
        sM = parseInt(p[1], 10) - 1;
        sD = parseInt(p[2], 10);
      }

      if (item.endDate instanceof Date) {
        eY = item.endDate.getUTCFullYear();
        eM = item.endDate.getUTCMonth();
        eD = item.endDate.getUTCDate();
      } else {
        const p = String(item.endDate || item.startDate).split("T")[0].split("-");
        eY = parseInt(p[0], 10);
        eM = parseInt(p[1], 10) - 1;
        eD = parseInt(p[2], 10);
      }

      let isMatch = false;
      if (item.isRecurring) {
        const targetMMDD = (m + 1) * 100 + d;
        const startMMDD = (sM + 1) * 100 + sD;
        const endMMDD = (eM + 1) * 100 + eD;
        if (startMMDD <= endMMDD) {
          isMatch = targetMMDD >= startMMDD && targetMMDD <= endMMDD;
        } else {
          isMatch = targetMMDD >= startMMDD || targetMMDD <= endMMDD;
        }
      } else {
        const sMidnight = Date.UTC(sY, sM, sD, 0, 0, 0, 0);
        const eMidnight = Date.UTC(eY, eM, eD, 23, 59, 59, 999);
        isMatch = targetMidnight >= sMidnight && targetMidnight <= eMidnight;
      }

      if (isMatch) {
        if (item.overrideType === OverrideType.WEEK) {
          if (!weekOverride) weekOverride = item;
        } else {
          if (!dateOverride) dateOverride = item;
        }
      }
    }

    let effectiveSource = "DEFAULT_WEEKLY";
    let effectiveStatus: "CLOSED" | "CUSTOM_HOURS" | "OPEN" = defaultDay.isOpen ? "OPEN" : "CLOSED";
    let effectiveTitle = "";
    let effectiveDescription = "";
    let effectiveWindows: TimeWindowInput[] = defaultDay.isOpen ? (defaultDay.timeWindows || [{ start: "08:00", end: "18:00" }]) : [];

    if (dateOverride) {
      effectiveSource = "DATE_OVERRIDE";
      effectiveStatus = dateOverride.status;
      effectiveTitle = dateOverride.title;
      effectiveDescription = dateOverride.description || "";
      if (dateOverride.status === "CUSTOM_HOURS") {
        effectiveWindows =
          dateOverride.timeWindows && dateOverride.timeWindows.length > 0
            ? dateOverride.timeWindows
            : [{ start: "08:00", end: "18:00" }];
      } else if (dateOverride.status === "OPEN") {
        effectiveWindows =
          dateOverride.timeWindows && dateOverride.timeWindows.length > 0
            ? dateOverride.timeWindows
            : defaultDay.timeWindows && defaultDay.timeWindows.length > 0
            ? defaultDay.timeWindows
            : [{ start: "08:00", end: "18:00" }];
      } else {
        effectiveWindows = [];
      }
    } else if (weekOverride) {
      effectiveSource = "WEEK_OVERRIDE";
      effectiveStatus = weekOverride.status;
      effectiveTitle = weekOverride.title;
      effectiveDescription = weekOverride.description || "";
      if (weekOverride.status === "CUSTOM_HOURS") {
        effectiveWindows =
          weekOverride.timeWindows && weekOverride.timeWindows.length > 0
            ? weekOverride.timeWindows
            : [{ start: "08:00", end: "18:00" }];
      } else if (weekOverride.status === "OPEN") {
        effectiveWindows =
          weekOverride.timeWindows && weekOverride.timeWindows.length > 0
            ? weekOverride.timeWindows
            : defaultDay.timeWindows && defaultDay.timeWindows.length > 0
            ? defaultDay.timeWindows
            : [{ start: "08:00", end: "18:00" }];
      } else {
        effectiveWindows = [];
      }
    }

    const isClosed = effectiveStatus === "CLOSED";
    const isOpen = !isClosed;

    const dayAppts = apptsByDate[dateStr] || [];
    const bookedSlots = dayAppts.map((appt: any) => {
      const user = appt.client?.user || {};
      const clientName = `${user.firstName || appt.client?.primaryContactName || "Client"} ${user.lastName || ""}`.trim();
      const s = new Date(appt.startAt);
      const e = new Date(appt.endAt || new Date(s.getTime() + durationMinutes * 60000));
      const startMin = s.getHours() * 60 + s.getMinutes();
      const endMin = e.getHours() * 60 + e.getMinutes();

      return {
        id: appt.id,
        appointmentId: appt.id,
        clientId: appt.clientId,
        clientName,
        serviceName: appt.serviceName || "Home Safety Visit",
        startAt: appt.startAt,
        endAt: appt.endAt,
        startMinutes: startMin,
        endMinutes: endMin,
        timeSlot: `${minutesToTimeString(startMin)} – ${minutesToTimeString(endMin)}`,
        startTime: minutesToTimeString(startMin),
        endTime: minutesToTimeString(endMin),
        technicianName: appt.technician?.name || "Unassigned",
        status: appt.status,
      };
    });

    const targetMidnightUTC = Date.UTC(y, m, d, 0, 0, 0, 0);
    const isPastDate = targetMidnightUTC < currentMidnightUTC;
    const isToday = targetMidnightUTC === currentMidnightUTC;

    const availableSlots: any[] = [];
    const allPossibleSlots: any[] = [];

    if (!isClosed && !isPastDate) {
      effectiveWindows.forEach((win, winIdx) => {
        const wStartMin = timeStringToMinutes(win.start);
        const wEndMin = timeStringToMinutes(win.end);
        const step = Math.min(60, durationMinutes);

        for (let min = wStartMin; min + durationMinutes <= wEndMin; min += step) {
          const slotEnd = min + durationMinutes;
          const slotFormatted = `${minutesToTimeString(min)} – ${minutesToTimeString(slotEnd)}`;
          const slotObj = {
            slot: slotFormatted,
            startTime: minutesToTimeString(min),
            endTime: minutesToTimeString(slotEnd),
            startMinutes: min,
            endMinutes: slotEnd,
            windowIndex: winIdx,
          };
          allPossibleSlots.push(slotObj);

          const hasConflict = bookedSlots.some((b) => {
            return Math.max(min, b.startMinutes) < Math.min(slotEnd, b.endMinutes);
          });
          const isPastSlot = isToday && min <= currentMinutesFromMidnight + 15;

          if (!hasConflict && !isPastSlot) {
            availableSlots.push(slotObj);
          }
        }
      });
    }

    days.push({
      date: dateStr,
      formattedDate,
      dayOfWeek,
      dayName,
      isOpen,
      isClosed,
      source: effectiveSource,
      overrideTitle: effectiveTitle,
      overrideDescription: effectiveDescription,
      overrideStatus: effectiveStatus,
      timeWindows: effectiveWindows,
      holiday,
      isHoliday: Boolean(holiday),
      isPastDate,
      isToday,
      availableSlots,
      bookedSlots,
      metrics: {
        totalPossibleSlots: allPossibleSlots.length,
        availableCount: availableSlots.length,
        bookedCount: bookedSlots.length,
      },
    });

    // Advance to next day UTC
    current.setUTCDate(current.getUTCDate() + 1);
  }

  // Summary overview metrics for calendar
  const totalDays = days.length;
  const openDaysCount = days.filter((d) => d.isOpen).length;
  const closedDaysCount = days.filter((d) => d.isClosed).length;
  const totalBookingsCount = days.reduce((sum, d) => sum + d.metrics.bookedCount, 0);
  const totalAvailableSlotsCount = days.reduce((sum, d) => sum + d.metrics.availableCount, 0);

  return {
    startDate: sStr,
    endDate: eStr,
    days,
    summary: {
      totalDays,
      openDaysCount,
      closedDaysCount,
      totalBookingsCount,
      totalAvailableSlotsCount,
    },
  };
}

/**
 * Authoritative Backend Booking Validator
 * Validates that requested appointment startAt and endAt strictly fall within the
 * operational schedule windows, date overrides, and holiday closures.
 */
export async function validateAppointmentTimeWithinSchedule(
  targetDateStr: string,
  startAt: Date,
  endAt: Date
) {
  const availability = await calculateDateAvailability(targetDateStr);

  if (availability.isClosed) {
    const reason = availability.overrideTitle
      ? ` (${availability.overrideTitle})`
      : "";
    throw new Error(
      `The selected date ${availability.formattedDate}${reason} is closed for scheduling. Please select an available operational date.`
    );
  }

  const reqStartMin = startAt.getHours() * 60 + startAt.getMinutes();
  const reqEndMin = endAt.getHours() * 60 + endAt.getMinutes();

  // Check if requested range falls inside any open window
  const fallsWithinWindow = availability.timeWindows.some((win) => {
    const wStart = timeStringToMinutes(win.start);
    const wEnd = timeStringToMinutes(win.end);
    return reqStartMin >= wStart && reqEndMin <= wEnd;
  });

  if (!fallsWithinWindow) {
    const windowsFormatted = availability.timeWindows
      .map((w) => `${minutesToTimeString(timeStringToMinutes(w.start))} – ${minutesToTimeString(timeStringToMinutes(w.end))}`)
      .join(", ");
    throw new Error(
      `Requested appointment time (${minutesToTimeString(reqStartMin)} – ${minutesToTimeString(reqEndMin)}) falls outside the open operational hours for ${availability.formattedDate}. Open hours: ${windowsFormatted}.`
    );
  }

  return true;
}
