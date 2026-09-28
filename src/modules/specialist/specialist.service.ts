import prisma from "../../lib/prisma";
import {
  CreateSpecialistInput,
  UpdateSpecialistInput,
  AssignSpecialistInput,
} from "./specialist.validation";

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
    if ((prisma as any).technician?.findMany) {
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
        shssRenewalDate: doc.shssRenewalDate || null,
        cprCertified: Boolean(doc.cprCertified),
        aedCertified: Boolean(doc.aedCertified),
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
    }
  } catch (err: any) {
    if (err?.code === "P2023" || String(err?.message || err).includes("Failed to convert")) {
      await repairTechnicianDates();
      try {
        const retryDocs = await (prisma as any).technician.findMany({
          where: { isArchived: false },
          orderBy: { displayOrder: "asc" },
        });
        return retryDocs.map((doc: any) => ({
          id: String(doc.id),
          name: doc.name || "Specialist",
          email: doc.email || null,
          phone: doc.phone || null,
          title: doc.title || "Home Safety Specialist",
          specialties: doc.specialties || [],
          shssCertified: Boolean(doc.shssCertified),
          shssRenewalDate: doc.shssRenewalDate || null,
          cprCertified: Boolean(doc.cprCertified),
          aedCertified: Boolean(doc.aedCertified),
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
      } catch (retryErr) {
        // quiet fallback
      }
    }
  }

  try {
    const result: any = await (prisma as any).$runCommandRaw({
      find: "Technician",
      filter: { isArchived: { $ne: true } },
    });

    const docs = result?.cursor?.firstBatch || [];

    const mapped = docs
      .map((doc: any) => ({
        id: doc._id?.$oid || String(doc._id),
        name: doc.name || "Specialist",
        email: doc.email || null,
        phone: doc.phone || null,
        title: doc.title || "Home Safety Specialist",
        specialties: doc.specialties || [],
        shssCertified: Boolean(doc.shssCertified),
        shssRenewalDate: doc.shssRenewalDate || null,
        cprCertified: Boolean(doc.cprCertified),
        aedCertified: Boolean(doc.aedCertified),
        backgroundChecked: Boolean(doc.backgroundChecked),
        bilingualSpanish: Boolean(doc.bilingualSpanish),
        color: doc.color || "#294B68",
        status: doc.status || "ACTIVE",
        notes: doc.notes || null,
        displayOrder: doc.displayOrder ?? 0,
        activeAssignmentsCount: 0,
        createdAt: doc.createdAt?.$date || doc.createdAt || new Date(),
        updatedAt: doc.updatedAt?.$date || doc.updatedAt || new Date(),
      }))
      .sort((a: any, b: any) => a.displayOrder - b.displayOrder);

    return mapped;
  } catch (rawErr) {
    return [];
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
  const data = {
    name: input.name,
    email: input.email || null,
    phone: input.phone || null,
    title: input.title || "Home Safety Specialist",
    specialties: input.specialties || [],
    shssCertified: Boolean(input.shssCertified),
    shssRenewalDate: input.shssRenewalDate || null,
    cprCertified: Boolean(input.cprCertified),
    aedCertified: Boolean(input.aedCertified),
    backgroundChecked: Boolean(input.backgroundChecked),
    bilingualSpanish: Boolean(input.bilingualSpanish),
    color: input.color || "#294B68",
    status: input.status || "ACTIVE",
    notes: input.notes || null,
    displayOrder: input.displayOrder ?? 0,
    isArchived: false,
  };

  let created: any;
  try {
    if ((prisma as any).technician?.create) {
      created = await (prisma as any).technician.create({ data });
    }
  } catch {}

  if (!created) {
    const nowIso = new Date().toISOString();
    const rawDoc = {
      ...data,
      createdAt: { $date: nowIso },
      updatedAt: { $date: nowIso },
    };
    await (prisma as any).$runCommandRaw({
      insert: "Technician",
      documents: [rawDoc],
    });
    created = rawDoc;
  }

  await createSpecialistAuditLog({
    actorUserId,
    action: "SPECIALIST_CREATED",
    entityType: "Specialist",
    entityId: input.name,
    newValues: data,
  });

  invalidateSpecialistsCache();
  return created;
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
  if (input.shssRenewalDate !== undefined) updateFields.shssRenewalDate = input.shssRenewalDate;
  if (input.cprCertified !== undefined) updateFields.cprCertified = input.cprCertified;
  if (input.aedCertified !== undefined) updateFields.aedCertified = input.aedCertified;
  if (input.backgroundChecked !== undefined) updateFields.backgroundChecked = input.backgroundChecked;
  if (input.bilingualSpanish !== undefined) updateFields.bilingualSpanish = input.bilingualSpanish;
  if (input.color !== undefined) updateFields.color = input.color;
  if (input.status !== undefined) updateFields.status = input.status;
  if (input.notes !== undefined) updateFields.notes = input.notes;
  if (input.displayOrder !== undefined) updateFields.displayOrder = input.displayOrder;
  if (input.isArchived !== undefined) updateFields.isArchived = input.isArchived;

  try {
    if ((prisma as any).technician?.update) {
      await (prisma as any).technician.update({
        where: { id: specialistId },
        data: updateFields,
      });
    } else {
      throw new Error("fallback to raw");
    }
  } catch {
    const rawSet = {
      ...updateFields,
      updatedAt: { $date: new Date().toISOString() },
    };
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

  const activeSub = appointment.client?.subscriptions?.[0];
  if (!activeSub || activeSub.status !== "ACTIVE") {
    const isInitialPayment = activeSub?.status === "PENDING";
    const paymentLabel = isInitialPayment ? "initial payment" : "monthly payment";
    const commencementStr = activeSub?.currentPeriodStart
      ? new Date(activeSub.currentPeriodStart).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : "the 1st of the month";
    throw new Error(
      `Cannot assign specialist: Client subscription is not active yet. Specialist assignment and visit fulfillment will open on ${commencementStr} once ${paymentLabel} is confirmed.`
    );
  }

  const updatedAppointment = await prisma.appointment.update({
    where: { id: input.appointmentId },
    data: {
      technicianId: input.specialistId,
      status: "CONFIRMED",
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
    metadata: { specialistId: input.specialistId },
  });

  return updatedAppointment;
}

/**
 * Seed initial Rhode Island specialists if catalog is empty.
 */
export async function seedDefaultSpecialists() {
  const existing = await getAllSpecialists();
  if (existing.length === 0) {
    await createSpecialist({
      name: "Mark Johnson",
      title: "Senior Home Safety Specialist",
      phone: "(401) 555-0144",
      email: "mark.johnson@agewellri.com",
      specialties: ["Home Safety Audits", "Fall Hazard Checks", "Grab Bar Positioning"],
      color: "#294B68",
      status: "ACTIVE",
      displayOrder: 1,
      notes: "Primary specialist for Washington County & Westerly area.",
    });

    await createSpecialist({
      name: "Sarah Miller",
      title: "Senior Environmental & Safety Specialist",
      phone: "(401) 555-0168",
      email: "sarah.miller@agewellri.com",
      specialties: ["Environmental Safety", "Pathway Clearance", "Hazard Mitigation"],
      color: "#3F8F6B",
      status: "ACTIVE",
      displayOrder: 2,
      notes: "Senior environmental safety specialist for South County residences.",
    });

    await createSpecialist({
      name: "David Chen",
      title: "Safety Specialist",
      phone: "(401) 555-0192",
      email: "david.chen@agewellri.com",
      specialties: ["Wellness Check-ins", "Lighting & Rug Safety", "Home Hazard Mitigation"],
      color: "#5E8FB2",
      status: "ACTIVE",
      displayOrder: 3,
      notes: "Certified environmental safety inspector.",
    });
  }
}
