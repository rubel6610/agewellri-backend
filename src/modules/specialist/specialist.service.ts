import prisma from "../../lib/prisma";
import {
  CreateSpecialistInput,
  UpdateSpecialistInput,
  AssignSpecialistInput,
} from "./specialist.validation";
import { notifyClientAndFamily } from "../notification/notification.service";
import { sendSpecialistAssignedEmail } from "../../utils/email";

/**
 * Record an audit log for specialist management operations.
 */
async function createSpecialistAuditLog(params: {
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
    console.warn("⚠️ Failed to write specialist audit log:", err);
  }
}

export function invalidateSpecialistsCache() {
  // no-op retained for backwards compatibility
}

/**
 * Repair any corrupted string dates in Technician collection by converting them to BSON Date objects.
 */
export async function repairTechnicianDates() {
  try {
    await (prisma as any).$runCommandRaw({
      update: "Technician",
      updates: [
        {
          q: {
            $or: [
              { updatedAt: { $type: "string" } },
              { createdAt: { $type: "string" } },
            ],
          },
          u: [
            {
              $set: {
                updatedAt: {
                  $cond: {
                    if: { $eq: [{ $type: "$updatedAt" }, "string"] },
                    then: {
                      $dateFromString: {
                        dateString: "$updatedAt",
                        onError: new Date(),
                        onNull: new Date(),
                      },
                    },
                    else: "$updatedAt",
                  },
                },
                createdAt: {
                  $cond: {
                    if: { $eq: [{ $type: "$createdAt" }, "string"] },
                    then: {
                      $dateFromString: {
                        dateString: "$createdAt",
                        onError: new Date(),
                        onNull: new Date(),
                      },
                    },
                    else: "$createdAt",
                  },
                },
              },
            },
          ],
          multi: true,
        },
      ],
    });
  } catch (err) {
    try {
      const result: any = await (prisma as any).$runCommandRaw({
        find: "Technician",
        filter: {
          $or: [
            { updatedAt: { $type: "string" } },
            { createdAt: { $type: "string" } },
          ],
        },
      });
      const docs = result?.cursor?.firstBatch || [];
      for (const doc of docs) {
        const docId = doc._id?.$oid || doc._id;
        const setFields: any = {};
        if (typeof doc.updatedAt === "string") {
          const parsed = new Date(doc.updatedAt);
          setFields.updatedAt = { $date: isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString() };
        }
        if (typeof doc.createdAt === "string") {
          const parsed = new Date(doc.createdAt);
          setFields.createdAt = { $date: isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString() };
        }
        if (Object.keys(setFields).length > 0) {
          await (prisma as any).$runCommandRaw({
            update: "Technician",
            updates: [
              {
                q: { $or: [{ _id: { $oid: docId } }, { _id: docId }] },
                u: { $set: setFields },
              },
            ],
          });
        }
      }
    } catch {}
  }
}

// Trigger initial repair in background
repairTechnicianDates().catch(() => {});

/**
 * List all specialists directly from database (100% real-time).
 */
export async function getAllSpecialists(_forceRefresh = true) {
  try {
    const result: any = await (prisma as any).$runCommandRaw({
      find: "Technician",
      filter: { isArchived: { $ne: true } },
    });

    const docs = result?.cursor?.firstBatch || [];

    const parseDateStr = (val: any): string | null => {
      if (!val) return null;
      if (typeof val === "string") return val;
      if (val?.$date) return typeof val.$date === "string" ? val.$date : new Date(val.$date).toISOString();
      if (val instanceof Date) return val.toISOString();
      return String(val);
    };

    const mapped = docs
      .map((doc: any) => {
        const id = doc._id?.$oid || String(doc._id);
        const specialties = Array.isArray(doc.specialties) ? doc.specialties : [];
        const specLower = specialties.map((s: any) => String(s || "").toLowerCase());
        const titleLower = String(doc.title || "").toLowerCase();

        const hasShss =
          doc.shssCertified !== undefined && doc.shssCertified !== null
            ? Boolean(doc.shssCertified)
            : (titleLower.includes("senior home safety") || titleLower.includes("shss") || specLower.some((s: string) => s.includes("shss") || s.includes("senior home safety")));

        const hasCpr =
          doc.cprCertified !== undefined && doc.cprCertified !== null
            ? Boolean(doc.cprCertified)
            : specLower.some((s: string) => s.includes("cpr"));

        const hasAed =
          doc.aedCertified !== undefined && doc.aedCertified !== null
            ? Boolean(doc.aedCertified)
            : specLower.some((s: string) => s.includes("aed"));

        const hasBg =
          doc.backgroundChecked !== undefined && doc.backgroundChecked !== null
            ? Boolean(doc.backgroundChecked)
            : (specLower.some((s: string) => s.includes("background")) || true);

        const hasBilingual =
          doc.bilingualSpanish !== undefined && doc.bilingualSpanish !== null
            ? Boolean(doc.bilingualSpanish)
            : specLower.some((s: string) => s.includes("bilingual") || s.includes("spanish"));

        const shssRenewalDate = parseDateStr(doc.shssRenewalDate || doc.shssExpiryDate);
        const cprExpiryDate = parseDateStr(doc.cprExpiryDate || doc.cprRenewalDate);
        const aedExpiryDate = parseDateStr(doc.aedExpiryDate || doc.aedRenewalDate);

        return {
          id,
          name: doc.name || "Specialist",
          email: doc.email || null,
          phone: doc.phone || null,
          title: doc.title || "Home Safety Specialist",
          specialties,
          shssCertified: hasShss,
          shssRenewalDate,
          shssExpiryDate: shssRenewalDate,
          cprCertified: hasCpr,
          cprExpiryDate,
          aedCertified: hasAed,
          aedExpiryDate,
          backgroundChecked: hasBg,
          bilingualSpanish: hasBilingual,
          color: doc.color || "#294B68",
          status: doc.status || "ACTIVE",
          notes: doc.notes || null,
          displayOrder: doc.displayOrder ?? 0,
          activeAssignmentsCount: 0,
          createdAt: doc.createdAt?.$date || doc.createdAt || new Date(),
          updatedAt: doc.updatedAt?.$date || doc.updatedAt || new Date(),
        };
      })
      .sort((a: any, b: any) => a.displayOrder - b.displayOrder);

    return mapped;
  } catch (rawErr) {
    try {
      const docs = await (prisma as any).technician.findMany({
        where: { isArchived: false },
        orderBy: { displayOrder: "asc" },
      });
      return docs.map((doc: any) => ({
        id: String(doc.id),
        name: doc.name || "Specialist",
        email: doc.email || null,
        phone: doc.phone || null,
        title: doc.title || "Home Safety Specialist",
        specialties: doc.specialties || [],
        shssCertified: Boolean(doc.shssCertified),
        shssRenewalDate: doc.shssRenewalDate || doc.shssExpiryDate || null,
        shssExpiryDate: doc.shssExpiryDate || doc.shssRenewalDate || null,
        cprCertified: Boolean(doc.cprCertified),
        cprExpiryDate: doc.cprExpiryDate || doc.cprRenewalDate || null,
        aedCertified: Boolean(doc.aedCertified),
        aedExpiryDate: doc.aedExpiryDate || doc.aedRenewalDate || null,
        backgroundChecked: Boolean(doc.backgroundChecked),
        bilingualSpanish: Boolean(doc.bilingualSpanish),
        color: doc.color || "#294B68",
        status: doc.status || "ACTIVE",
        notes: doc.notes || null,
        displayOrder: doc.displayOrder ?? 0,
        activeAssignmentsCount: 0,
        createdAt: doc.createdAt || new Date(),
        updatedAt: doc.updatedAt || new Date(),
      }));
    } catch {
      return [];
    }
  }
}

/**
 * Get single specialist by ID.
 */
export async function getSpecialistById(specialistId: string) {
  const all = await getAllSpecialists();
  const found = all.find((s: any) => s.id === specialistId);
  if (!found) {
    throw new Error("Specialist not found.");
  }
  return found;
}

/**
 * Create a new Specialist directly from Admin Dashboard (No user account required).
 */
export async function createSpecialist(input: CreateSpecialistInput, actorUserId?: string) {
  const nowIso = new Date().toISOString();
  const data = {
    name: input.name,
    email: input.email || null,
    phone: input.phone || null,
    title: input.title || "Home Safety Specialist",
    specialties: input.specialties || [],
    shssCertified: Boolean(input.shssCertified),
    shssRenewalDate: input.shssRenewalDate || input.shssExpiryDate || null,
    shssExpiryDate: input.shssExpiryDate || input.shssRenewalDate || null,
    cprCertified: Boolean(input.cprCertified),
    cprExpiryDate: input.cprExpiryDate || input.cprRenewalDate || null,
    aedCertified: Boolean(input.aedCertified),
    aedExpiryDate: input.aedExpiryDate || input.aedRenewalDate || null,
    backgroundChecked: Boolean(input.backgroundChecked),
    bilingualSpanish: Boolean(input.bilingualSpanish),
    color: input.color || "#294B68",
    status: input.status || "ACTIVE",
    notes: input.notes || null,
    displayOrder: input.displayOrder ?? 0,
    isArchived: false,
    createdAt: { $date: nowIso },
    updatedAt: { $date: nowIso },
  };

  try {
    await (prisma as any).$runCommandRaw({
      insert: "Technician",
      documents: [data],
    });
  } catch (err) {
    if ((prisma as any).technician?.create) {
      await (prisma as any).technician.create({ data });
    }
  }

  await createSpecialistAuditLog({
    actorUserId,
    action: "SPECIALIST_CREATED",
    entityType: "Specialist",
    entityId: input.name,
    newValues: data,
  });

  invalidateSpecialistsCache();
  return data;
}

/**
 * Update existing specialist.
 */
export async function updateSpecialist(
  specialistId: string,
  input: UpdateSpecialistInput,
  actorUserId?: string
) {
  const updateFields: any = {};
  if (input.name !== undefined) updateFields.name = input.name;
  if (input.email !== undefined) updateFields.email = input.email;
  if (input.phone !== undefined) updateFields.phone = input.phone;
  if (input.title !== undefined) updateFields.title = input.title;
  if (input.specialties !== undefined) updateFields.specialties = input.specialties;
  if (input.shssCertified !== undefined) updateFields.shssCertified = input.shssCertified;
  if (input.shssRenewalDate !== undefined) {
    updateFields.shssRenewalDate = input.shssRenewalDate;
    updateFields.shssExpiryDate = input.shssRenewalDate;
  } else if (input.shssExpiryDate !== undefined) {
    updateFields.shssRenewalDate = input.shssExpiryDate;
    updateFields.shssExpiryDate = input.shssExpiryDate;
  }
  if (input.cprCertified !== undefined) updateFields.cprCertified = input.cprCertified;
  if (input.cprExpiryDate !== undefined) {
    updateFields.cprExpiryDate = input.cprExpiryDate;
    updateFields.cprRenewalDate = input.cprExpiryDate;
  } else if (input.cprRenewalDate !== undefined) {
    updateFields.cprExpiryDate = input.cprRenewalDate;
    updateFields.cprRenewalDate = input.cprRenewalDate;
  }
  if (input.aedCertified !== undefined) updateFields.aedCertified = input.aedCertified;
  if (input.aedExpiryDate !== undefined) {
    updateFields.aedExpiryDate = input.aedExpiryDate;
    updateFields.aedRenewalDate = input.aedExpiryDate;
  } else if (input.aedRenewalDate !== undefined) {
    updateFields.aedExpiryDate = input.aedRenewalDate;
    updateFields.aedRenewalDate = input.aedRenewalDate;
  }
  if (input.backgroundChecked !== undefined) updateFields.backgroundChecked = input.backgroundChecked;
  if (input.bilingualSpanish !== undefined) updateFields.bilingualSpanish = input.bilingualSpanish;
  if (input.color !== undefined) updateFields.color = input.color;
  if (input.status !== undefined) updateFields.status = input.status;
  if (input.notes !== undefined) updateFields.notes = input.notes;
  if (input.displayOrder !== undefined) updateFields.displayOrder = input.displayOrder;
  if (input.isArchived !== undefined) updateFields.isArchived = input.isArchived;

  const rawSet = {
    ...updateFields,
    updatedAt: { $date: new Date().toISOString() },
  };

  try {
    await (prisma as any).$runCommandRaw({
      update: "Technician",
      updates: [
        {
          q: {
            $or: [
              { _id: { $oid: specialistId } },
              { _id: specialistId },
            ],
          },
          u: { $set: rawSet },
        },
      ],
    });
  } catch (rawErr) {
    if ((prisma as any).technician?.update) {
      await (prisma as any).technician.update({
        where: { id: specialistId },
        data: updateFields,
      });
    }
  }

  await createSpecialistAuditLog({
    actorUserId,
    action: "SPECIALIST_UPDATED",
    entityType: "Specialist",
    entityId: specialistId,
    newValues: updateFields,
  });

  invalidateSpecialistsCache();
  return getSpecialistById(specialistId);
}

/**
 * Archive / Delete Specialist.
 */
export async function deleteSpecialist(specialistId: string, actorUserId?: string) {
  try {
    if ((prisma as any).technician?.update) {
      await (prisma as any).technician.update({
        where: { id: specialistId },
        data: { isArchived: true, status: "INACTIVE", updatedAt: new Date() },
      });
    } else {
      throw new Error("fallback to raw");
    }
  } catch {
    try {
      await (prisma as any).$runCommandRaw({
        update: "Technician",
        updates: [
          {
            q: {
              $or: [
                { _id: { $oid: specialistId } },
                { _id: specialistId },
              ],
            },
            u: { $set: { isArchived: true, status: "INACTIVE", updatedAt: new Date() } },
          },
        ],
      });
    } catch (rawErr: any) {
      try {
        await (prisma as any).$runCommandRaw({
          delete: "Technician",
          deletes: [
            {
              q: {
                $or: [
                  { _id: { $oid: specialistId } },
                  { _id: specialistId },
                ],
              },
              limit: 1,
            },
          ],
        });
      } catch {}
    }
  }

  await createSpecialistAuditLog({
    actorUserId,
    action: "SPECIALIST_DELETED",
    entityType: "Specialist",
    entityId: specialistId,
  });

  invalidateSpecialistsCache();
  return { success: true, message: "Specialist removed from active directory." };
}

/**
 * Assign a specialist to an appointment/visit.
 */
export async function assignSpecialistToAppointment(
  input: AssignSpecialistInput,
  actorUserId?: string
) {
  const appointment = await (prisma.appointment.findUnique as any)({
    where: { id: input.appointmentId },
    include: {
      client: {
        include: {
          user: true,
          subscriptions: {
            where: { isArchived: false },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  if (!appointment) {
    throw new Error("Appointment not found.");
  }

  // Fetch specialist details
  const specialist = await (prisma.technician.findUnique as any)({
    where: { id: input.specialistId },
  });

  const specialistName = specialist?.name || "Assigned Specialist";
  const specialistTitle = specialist?.title || "Senior Home Safety Specialist® certified by Age Safe® America";

  // Verify that specialist is available during the appointment's interval [startAt, endAt)
  const overlapping = await (prisma.appointment.findFirst as any)({
    where: {
      id: { not: input.appointmentId },
      technicianId: input.specialistId,
      status: {
        in: ["SCHEDULED", "CONFIRMED", "RESCHEDULED"],
      },
      isArchived: false,
      startAt: { lt: appointment.endAt },
      endAt: { gt: appointment.startAt },
    },
  });

  if (overlapping) {
    const conflictErr = new Error(
      `Specialist ${specialistName} is already assigned to another appointment during this time window. Please select another specialist.`
    );
    (conflictErr as any).statusCode = 409;
    throw conflictErr;
  }

  const updatedAppointment = await prisma.appointment.update({
    where: { id: input.appointmentId },
    data: {
      technician: { connect: { id: input.specialistId } },
      status: "CONFIRMED",
    },
    include: {
      client: { include: { user: true } },
    },
  });

  // Update or link Visit record
  const existingVisit = await prisma.visit.findUnique({
    where: { appointmentId: input.appointmentId },
  });

  if (existingVisit) {
    await prisma.visit.update({
      where: { id: existingVisit.id },
      data: { technicianId: input.specialistId },
    });
  } else {
    await prisma.visit.create({
      data: {
        appointmentId: input.appointmentId,
        technicianId: input.specialistId,
        status: "SCHEDULED",
      },
    });
  }

  await createSpecialistAuditLog({
    actorUserId,
    action: "SPECIALIST_ASSIGNED_TO_APPOINTMENT",
    entityType: "Appointment",
    entityId: input.appointmentId,
    metadata: { specialistId: input.specialistId, specialistName },
  });

  // Dispatch In-App Notification and Email Notification for Client/Family
  if (appointment.client?.id) {
    try {
      await notifyClientAndFamily(
        appointment.client.id,
        {
          type: "SPECIALIST_ASSIGNED",
          title: "Specialist Assigned",
          message: `Specialist ${specialistName} has been assigned to your AgeWellRI visit (${appointment.serviceName || "Safety Visit"}).`,
          metadata: {
            appointmentId: input.appointmentId,
            technicianId: input.specialistId,
            technicianName: specialistName,
          },
        },
        "portalAccess",
      );

      const clientEmail = appointment.client.user?.email || appointment.client.primaryContactEmail;
      if (clientEmail) {
        const clientDisplayName = `${appointment.client.user?.firstName || appointment.client.primaryContactName || "Valued"} ${appointment.client.user?.lastName || "Member"}`.trim();

        const representatives = await (prisma.familyMember.findMany as any)({
          where: {
            clientId: appointment.client.id,
            OR: [{ isEmergencyContact: true }, { portalAccess: true }],
          },
          include: { user: true },
        });
        const recipientEmails = Array.from(
          new Set(
            [
              clientEmail,
              ...representatives
                .map((f: any) => f.email || f.user?.email)
                .filter(Boolean),
            ]
          )
        );

        const start = new Date(appointment.startAt);
        const end = new Date(appointment.endAt);
        const timeSlotStr = `${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} – ${end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

        await sendSpecialistAssignedEmail({
          to: recipientEmails.length === 1 ? recipientEmails[0] : recipientEmails,
          clientName: clientDisplayName || "Valued Member",
          specialistName,
          specialistTitle,
          specialistPhone: specialist?.phone || undefined,
          specialistBio: specialist?.bio || undefined,
          serviceName: appointment.serviceName || "Safety Oversight Visit",
          scheduledDate: appointment.startAt,
          timeSlot: timeSlotStr,
          location: appointment.location || undefined,
          notes: appointment.notes || undefined,
          accessMethodTitle: appointment.accessMethodTitle || undefined,
          accessMethodInstructions: appointment.accessMethodInstructions || undefined,
          portalUrl: process.env.FRONTEND_URL || "http://localhost:3000",
        });
      }
    } catch (notifErr: any) {
      console.warn("⚠️ Failed to dispatch specialist assigned notifications:", notifErr.message);
    }
  }

  return updatedAppointment;
}

/**
 * Seed initial Rhode Island specialists if catalog is empty.
 */
