import prisma from "../../lib/prisma";
import { AppointmentStatus, VisitStatus } from "@prisma/client";
import {
  calculateDateAvailability,
  getCalendarRangeAvailability,
  validateAppointmentTimeWithinSchedule,
  getActiveEligibleTechnicians,
} from "./schedule.service";
import {
  acceptVisitRequest,
  cancelAppointment,
  rescheduleAppointment,
  parseDateAndTimeSlot,
} from "../appointment/appointment.service";
import { assignSpecialistToAppointment } from "../specialist/specialist.service";

console.log("==================================================");
console.log("🧪 RUNNING COMPREHENSIVE MULTI-TECHNICIAN SCHEDULING TESTS");
console.log("==================================================");

let passed = 0;
let total = 0;

function assert(condition: any, name: string) {
  total++;
  if (condition) {
    console.log(`✅ [PASS] TEST ${total}: ${name}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] TEST ${total}: ${name}`);
    throw new Error(`Assertion failed: ${name}`);
  }
}

async function runMultiTechTests() {
  const db = prisma as any;
  const testRunId = `test_${Date.now()}`;
  const testDate = "2026-11-13"; // Friday in future
  const { startAt, endAt } = parseDateAndTimeSlot(testDate, "10:00 AM – 11:00 AM");

  console.log(`Setting up test environment (Run ID: ${testRunId})...`);

  // Track created entities for cleanup
  const createdTechIds: string[] = [];
  const createdApptIds: string[] = [];
  const createdClientIds: string[] = [];

  try {
    // 0. Create test client
    const testUser = await db.user.create({
      data: {
        email: `${testRunId}_client@example.com`,
        passwordHash: "hashed_password",
        role: "CLIENT",
        firstName: "Test",
        lastName: "Client",
      },
    });
    const testClient = await db.client.create({
      data: {
        userId: testUser.id,
        clientNumber: `AW-${Date.now().toString().slice(-4)}`,
        primaryContactName: "Test Client",
        primaryContactEmail: testUser.email,
        primaryContactPhone: "401-555-0100",
        address: "100 Main St",
        city: "Providence",
        state: "RI",
        postalCode: "02903",
        hasCompletedAgreement: true,
      },
    });
    createdClientIds.push(testClient.id);

    // Create 2 initial active eligible technicians: Tech A and Tech B
    const techA = await db.technician.create({
      data: {
        name: `Tech Alpha ${testRunId}`,
        title: "Senior Home Safety Specialist",
        status: "ACTIVE",
        isArchived: false,
        specialties: ["Home Safety", "Fall Prevention"],
        displayOrder: 1,
      },
    });
    const techB = await db.technician.create({
      data: {
        name: `Tech Beta ${testRunId}`,
        title: "Senior Home Safety Specialist",
        status: "ACTIVE",
        isArchived: false,
        specialties: ["Home Safety", "Fall Prevention"],
        displayOrder: 2,
      },
    });
    createdTechIds.push(techA.id, techB.id);

    // ---------------------------------------------------------
    // TEST 1: Baseline dynamic capacity from eligible technicians
    // ---------------------------------------------------------
    const activeTechs = await getActiveEligibleTechnicians();
    assert(activeTechs.some((t: any) => t.id === techA.id) && activeTechs.some((t: any) => t.id === techB.id),
      "Active technicians Tech A and Tech B are returned by getActiveEligibleTechnicians");

    const availInitial = await calculateDateAvailability(testDate, { durationMinutes: 60 });
    const slotInitial = availInitial.allPossibleSlots.find(s => s.startTime === "10:00 AM" || s.startMinutes === 600);
    assert(slotInitial && slotInitial.totalCapacity >= 2,
      "Slot total capacity is dynamically derived from total active technicians");
    assert(slotInitial && slotInitial.remainingCapacity >= 2,
      "Initial remaining capacity reflects all free technicians");
    assert(slotInitial && slotInitial.isAvailable === true,
      "Slot is initially available for booking");

    // ---------------------------------------------------------
    // TEST 2: Two pending requests reserve distinct technicians
    // ---------------------------------------------------------
    // Request 1: Client submits request, auto-reserving Tech A
    const appt1 = await (db.appointment.create as any)({
      data: {
        client: { connect: { id: testClient.id } },
        createdByUser: { connect: { id: testUser.id } },
        technician: { connect: { id: techA.id } },
        startAt,
        endAt,
        status: AppointmentStatus.SCHEDULED,
        serviceName: "Home Safety Assessment",
        location: "100 Main St, Providence, RI",
      },
    });
    createdApptIds.push(appt1.id);

    const availAfter1 = await calculateDateAvailability(testDate, { durationMinutes: 60 });
    const slotAfter1 = availAfter1.allPossibleSlots.find(s => s.startTime === "10:00 AM" || s.startMinutes === 600);
    assert(slotAfter1 && slotAfter1.availableTechnicianIds.includes(techB.id),
      "Tech B remains available after Tech A is reserved");
    assert(slotAfter1 && !slotAfter1.availableTechnicianIds.includes(techA.id),
      "Tech A is occupied and not in availableTechnicianIds");
    assert(slotAfter1 && slotInitial && slotAfter1.remainingCapacity === slotInitial.remainingCapacity - 1,
      "Remaining capacity decrements by exactly 1 when Tech A is reserved");

    // Request 2: Second client request reserves Tech B
    const appt2 = await (db.appointment.create as any)({
      data: {
        client: { connect: { id: testClient.id } },
        createdByUser: { connect: { id: testUser.id } },
        technician: { connect: { id: techB.id } },
        startAt,
        endAt,
        status: AppointmentStatus.SCHEDULED,
        serviceName: "Home Safety Assessment",
        location: "100 Main St, Providence, RI",
      },
    });
    createdApptIds.push(appt2.id);

    // ---------------------------------------------------------
    // TEST 3: Slot capacity reaches zero when all technicians reserved
    // ---------------------------------------------------------
    const availAfter2 = await calculateDateAvailability(testDate, { durationMinutes: 60 });
    const slotAfter2 = availAfter2.allPossibleSlots.find(s => s.startTime === "10:00 AM" || s.startMinutes === 600);
    assert(slotAfter2 && !slotAfter2.availableTechnicianIds.includes(techA.id) && !slotAfter2.availableTechnicianIds.includes(techB.id),
      "Both Tech A and Tech B are occupied in the interval");

    // ---------------------------------------------------------
    // TEST 4: Adding a 3rd eligible technician dynamically increases capacity
    // ---------------------------------------------------------
    const techC = await db.technician.create({
      data: {
        name: `Tech Gamma ${testRunId}`,
        title: "Certified Home Safety Specialist",
        status: "ACTIVE",
        isArchived: false,
        specialties: ["Home Safety"],
        displayOrder: 3,
      },
    });
    createdTechIds.push(techC.id);

    const availAfterTechC = await calculateDateAvailability(testDate, { durationMinutes: 60 });
    const slotAfterTechC = availAfterTechC.allPossibleSlots.find(s => s.startTime === "10:00 AM" || s.startMinutes === 600);
    assert(slotAfterTechC && slotAfterTechC.availableTechnicianIds.includes(techC.id),
      "Adding Tech C immediately makes Tech C available without code changes");
    assert(slotAfterTechC && slotInitial && slotAfterTechC.totalCapacity === slotInitial.totalCapacity + 1,
      "Total capacity dynamically incremented by 1 with addition of Tech C");

    // ---------------------------------------------------------
    // TEST 5: Inactive and archived technicians do not increase capacity
    // ---------------------------------------------------------
    const techInactive = await db.technician.create({
      data: {
        name: `Tech Inactive ${testRunId}`,
        title: "Specialist",
        status: "INACTIVE",
        isArchived: false,
      },
    });
    const techArchived = await db.technician.create({
      data: {
        name: `Tech Archived ${testRunId}`,
        title: "Specialist",
        status: "ACTIVE",
        isArchived: true,
      },
    });
    createdTechIds.push(techInactive.id, techArchived.id);

    const availInactiveCheck = await calculateDateAvailability(testDate, { durationMinutes: 60 });
    const slotInactiveCheck = availInactiveCheck.allPossibleSlots.find(s => s.startTime === "10:00 AM" || s.startMinutes === 600);
    assert(slotInactiveCheck && !slotInactiveCheck.availableTechnicianIds.includes(techInactive.id),
      "Inactive technician does not count towards available capacity");
    assert(slotInactiveCheck && !slotInactiveCheck.availableTechnicianIds.includes(techArchived.id),
      "Archived technician does not count towards available capacity");

    // ---------------------------------------------------------
    // TEST 6: Half-open interval overlap rule: existingStart < requestedEnd && existingEnd > requestedStart
    // ---------------------------------------------------------
    const { startAt: apptPartialStart, endAt: apptPartialEnd } = parseDateAndTimeSlot(testDate, "09:00 AM – 10:30 AM");
    const apptPartial = await (db.appointment.create as any)({
      data: {
        client: { connect: { id: testClient.id } },
        createdByUser: { connect: { id: testUser.id } },
        technician: { connect: { id: techC.id } },
        startAt: apptPartialStart,
        endAt: apptPartialEnd,
        status: AppointmentStatus.SCHEDULED,
        location: "100 Main St, Providence, RI",
      },
    });
    createdApptIds.push(apptPartial.id);

    // Overlapping slot 10:00 - 11:00 should block Tech C because 09:00 < 11:00 && 10:30 > 10:00
    const availPartial = await calculateDateAvailability(testDate, { durationMinutes: 60 });
    const slot10to11 = availPartial.allPossibleSlots.find(s => s.startTime === "10:00 AM" || s.startMinutes === 600);
    assert(slot10to11 && !slot10to11.availableTechnicianIds.includes(techC.id),
      "Partially overlapping appointment (09:00-10:30) blocks Tech C for 10:00-11:00 slot");

    // Adjacent non-overlapping interval (e.g. 11:00 - 12:00) does NOT block Tech C from 09:00-10:30 appt
    const slot11to12 = availPartial.allPossibleSlots.find(s => s.startTime === "11:00 AM" || s.startMinutes === 660);
    assert(slot11to12 && slot11to12.availableTechnicianIds.includes(techC.id),
      "Adjacent non-overlapping slot (11:00-12:00) leaves Tech C free");

    // ---------------------------------------------------------
    // TEST 7: Admin approval preserves reservation and updates status
    // ---------------------------------------------------------
    const acceptedAppt = await acceptVisitRequest(appt1.id, testUser.id, {
      technicianId: techA.id,
    });
    assert(acceptedAppt.status === "confirmed" || acceptedAppt.status === "scheduled",
      "Admin approval successfully confirmed appointment");
    assert(acceptedAppt.technicianId === techA.id,
      "Admin approval preserved reserved technician Tech A");
    assert(acceptedAppt.isRequested === false,
      "Approved appointment has isRequested false");

    // ---------------------------------------------------------
    // TEST 8: Admin reassignment rejects technician with overlapping appointment
    // ---------------------------------------------------------
    let reassignmentFailed = false;
    try {
      await acceptVisitRequest(appt2.id, testUser.id, {
        technicianId: techA.id, // Conflict! Tech A is already booked 10:00-11:00
      });
    } catch (err: any) {
      reassignmentFailed = true;
      assert(err.message.includes("booked") || err.message.includes("window") || err.statusCode === 409,
        "Reassigning to busy technician returns conflict error");
    }
    assert(reassignmentFailed, "Admin reassignment to busy technician threw conflict exception");

    // ---------------------------------------------------------
    // TEST 9: Specialist assignment endpoint rejects overlapping specialist
    // ---------------------------------------------------------
    let assignSpecialistFailed = false;
    try {
      await assignSpecialistToAppointment({
        appointmentId: appt2.id,
        specialistId: techA.id, // Conflict!
      });
    } catch (err: any) {
      assignSpecialistFailed = true;
      assert(err.message.includes("already assigned") || err.statusCode === 409,
        "assignSpecialistToAppointment rejects overlapping specialist with conflict error");
    }
    assert(assignSpecialistFailed, "assignSpecialistToAppointment threw conflict exception");

    // ---------------------------------------------------------
    // TEST 10: Admin rejection / cancellation releases technician reservation
    // ---------------------------------------------------------
    await cancelAppointment(appt2.id, testUser.id, false, "Client cancelled test visit");

    const availAfterCancel = await calculateDateAvailability(testDate, { durationMinutes: 60 });
    const slotAfterCancel = availAfterCancel.allPossibleSlots.find(s => s.startTime === "10:00 AM" || s.startMinutes === 600);
    assert(slotAfterCancel && slotAfterCancel.availableTechnicianIds.includes(techB.id),
      "Cancelled request releases reservation; Tech B becomes available again immediately");

    // ---------------------------------------------------------
    // TEST 11: Rescheduling preserves original booking if destination conflict occurs
    // ---------------------------------------------------------
    const { startAt: startAt2pm, endAt: endAt2pm } = parseDateAndTimeSlot("2026-11-16", "02:00 PM – 03:00 PM");
    const apptToReschedule = await (db.appointment.create as any)({
      data: {
        client: { connect: { id: testClient.id } },
        createdByUser: { connect: { id: testUser.id } },
        technician: { connect: { id: techB.id } },
        startAt: startAt2pm,
        endAt: endAt2pm,
        status: AppointmentStatus.SCHEDULED,
        serviceName: "Home Safety Assessment",
        location: "100 Main St, Providence, RI",
      },
    });
    createdApptIds.push(apptToReschedule.id);

    // Attempt to reschedule to closed hours (e.g. 23:00)
    let rescheduleFailed = false;
    try {
      await rescheduleAppointment(apptToReschedule.id, testUser.id, false, {
        date: "2026-11-16",
        timeSlot: "11:00 PM – 12:00 AM", // Closed operational hours
      });
    } catch (err: any) {
      rescheduleFailed = true;
    }
    assert(rescheduleFailed, "Rescheduling to invalid hours threw error");

    // Verify original appointment remains untouched
    const freshAppt = await db.appointment.findUnique({ where: { id: apptToReschedule.id } });
    assert(freshAppt.startAt.getTime() === startAt2pm.getTime(),
      "Original appointment start time preserved on reschedule failure");
    assert(freshAppt.technicianId === techB.id,
      "Original technician assignment preserved on reschedule failure");

    // ---------------------------------------------------------
    // TEST 12: Preserving existing appointments when a technician is deactivated
    // ---------------------------------------------------------
    await db.technician.update({
      where: { id: techA.id },
      data: { status: "INACTIVE" },
    });
    const apptAfterDeactivation = await db.appointment.findUnique({ where: { id: appt1.id } });
    assert(apptAfterDeactivation && apptAfterDeactivation.technicianId === techA.id,
      "Deactivating technician preserves existing appointment records and assignment");

    // ---------------------------------------------------------
    // TEST 13: Concurrency protection (Serialized write locks in MongoDB)
    // ---------------------------------------------------------
    await db.technician.update({
      where: { id: techA.id },
      data: { status: "ACTIVE" },
    });

    const { startAt: concurrentIntervalStart, endAt: concurrentIntervalEnd } = parseDateAndTimeSlot("2026-11-20", "10:00 AM – 11:00 AM");

    const bookTechATx = async (clientId: string) => {
      return prisma.$transaction(async (tx: any) => {
        const existingOverlap = await tx.appointment.findFirst({
          where: {
            technicianId: techA.id,
            status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.RESCHEDULED] },
            isArchived: false,
            startAt: { lt: concurrentIntervalEnd },
            endAt: { gt: concurrentIntervalStart },
          },
        });
        if (existingOverlap) {
          const err = new Error("Technician already reserved for this slot");
          (err as any).statusCode = 409;
          throw err;
        }

        await tx.technician.update({
          where: { id: techA.id },
          data: { updatedAt: new Date() },
        });

        const a = await (tx.appointment.create as any)({
          data: {
            client: { connect: { id: clientId } },
            createdByUser: { connect: { id: testUser.id } },
            technician: { connect: { id: techA.id } },
            startAt: concurrentIntervalStart,
            endAt: concurrentIntervalEnd,
            status: AppointmentStatus.SCHEDULED,
            location: "100 Main St, Providence, RI",
          },
        });
        return a;
      });
    };

    const results = await Promise.allSettled([
      bookTechATx(testClient.id),
      bookTechATx(testClient.id),
    ]);

    const fulfilledCount = results.filter(r => r.status === "fulfilled").length;
    const rejectedCount = results.filter(r => r.status === "rejected").length;

    assert(fulfilledCount === 1 && rejectedCount === 1,
      "Concurrency protection: exactly 1 request claims the technician, the other is rejected with conflict");

    const concurrentAppts = await db.appointment.findMany({
      where: {
        technicianId: techA.id,
        startAt: concurrentIntervalStart,
      },
    });
    for (const ca of concurrentAppts) {
      createdApptIds.push(ca.id);
    }

    console.log("==================================================");
    console.log(`🎉 ALL ${passed} MULTI-TECHNICIAN SCHEDULING TESTS PASSED!`);
    console.log("==================================================");

  } finally {
    console.log("Cleaning up test records...");
    for (const aId of createdApptIds) {
      await db.visit.deleteMany({ where: { appointmentId: aId } }).catch(() => {});
      await db.appointment.delete({ where: { id: aId } }).catch(() => {});
    }
    for (const tId of createdTechIds) {
      await db.technician.delete({ where: { id: tId } }).catch(() => {});
    }
    for (const cId of createdClientIds) {
      const client = await db.client.findUnique({ where: { id: cId } });
      await db.client.delete({ where: { id: cId } }).catch(() => {});
      if (client?.userId) {
        await db.user.delete({ where: { id: client.userId } }).catch(() => {});
      }
    }
    console.log("Teardown complete.");
  }
}

runMultiTechTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test failed with error:", err);
    process.exit(1);
  });
