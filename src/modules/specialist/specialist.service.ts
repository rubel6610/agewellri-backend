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
 * List all specialists directly from database (100% real-time).
 */
export async function getAllSpecialists(_forceRefresh = true) {
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
      specialties: doc.specialties || ["Safety Oversight", "Fall Hazard Mitigation"],
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
  const doc = {
    name: input.name,
    email: input.email || null,
    phone: input.phone || null,
    title: input.title || "Home Safety Specialist",
    specialties: input.specialties || ["Home Safety Checks", "Fall Prevention"],
    color: input.color || "#294B68",
    status: input.status || "ACTIVE",
    notes: input.notes || null,
    displayOrder: input.displayOrder ?? 0,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const insertResult: any = await (prisma as any).$runCommandRaw({
    insert: "Technician",
    documents: [doc],
  });

  await createSpecialistAuditLog({
    actorUserId,
    action: "SPECIALIST_CREATED",
    entityType: "Specialist",
    entityId: input.name,
    newValues: doc,
  });

  invalidateSpecialistsCache();
  return doc;
}

/**
 * Update existing specialist.
 */
export async function updateSpecialist(
  specialistId: string,
  input: UpdateSpecialistInput,
  actorUserId?: string
) {
  const updateFields: any = { updatedAt: new Date() };
  if (input.name !== undefined) updateFields.name = input.name;
  if (input.email !== undefined) updateFields.email = input.email;
  if (input.phone !== undefined) updateFields.phone = input.phone;
  if (input.title !== undefined) updateFields.title = input.title;
  if (input.specialties !== undefined) updateFields.specialties = input.specialties;
  if (input.color !== undefined) updateFields.color = input.color;
  if (input.status !== undefined) updateFields.status = input.status;
  if (input.notes !== undefined) updateFields.notes = input.notes;
  if (input.displayOrder !== undefined) updateFields.displayOrder = input.displayOrder;
  if (input.isArchived !== undefined) updateFields.isArchived = input.isArchived;

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
        u: { $set: updateFields },
      },
    ],
  });

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
  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
  });

  if (!appointment) {
    throw new Error("Appointment not found.");
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
      title: "Senior Environmental & Cleaning Specialist",
      phone: "(401) 555-0168",
      email: "sarah.miller@agewellri.com",
      specialties: ["HEPA Allergen Cleaning", "Pathway Clearance", "Sanitization"],
      color: "#3F8F6B",
      status: "ACTIVE",
      displayOrder: 2,
      notes: "Lead cleaning specialist for South County residences.",
    });

    await createSpecialist({
      name: "David Chen",
      title: "Safety Specialist & Care Assessor",
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
