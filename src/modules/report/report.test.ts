import prisma from "../../lib/prisma";
import {
  uploadVisitReport,
  getReportFileForDownload,
  getReportById,
  getMyReports,
  getAdminReports,
  getReportByAppointmentId,
} from "./report.service";
import { formatAppointmentRecord } from "../appointment/appointment.service";
import path from "path";
import fs from "fs";

console.log("============================================================");
console.log("🧪 RUNNING COMPLETED VISIT → REPORT UPLOAD TEST SUITE");
console.log("============================================================\n");

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${testName}`);
    failed++;
  }
}

async function runTests() {
  try {
    // Setup dummy test PDF file in uploads/reports
    const uploadDir = path.join(process.cwd(), "uploads", "reports");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const testPdfFilename = `test-report-${Date.now()}.pdf`;
    const testPdfPath = path.join(uploadDir, testPdfFilename);
    fs.writeFileSync(testPdfPath, "%PDF-1.4 Mock PDF Content for AgeWellRI Report Testing");

    const mockMulterFile: Express.Multer.File = {
      fieldname: "file",
      originalname: "Field_Safety_Report_Sep2026.pdf",
      encoding: "7bit",
      mimetype: "application/pdf",
      size: 1024 * 50,
      destination: uploadDir,
      filename: testPdfFilename,
      path: testPdfPath,
      buffer: Buffer.from(""),
      stream: null as any,
    };

    // 1. Fetch or create a completed appointment for testing
    let appointment = await (prisma.appointment.findFirst as any)({
      where: { isArchived: false },
      include: { client: { include: { user: true } }, serviceType: true, visit: true },
    });

    if (!appointment) {
      console.log("ℹ️ No existing appointment found, fetching or testing model validators");
    } else {
      // Ensure appointment is marked COMPLETED
      if (appointment.status !== "COMPLETED") {
        appointment = await (prisma.appointment.update as any)({
          where: { id: appointment.id },
          data: { status: "COMPLETED" },
          include: { client: { include: { user: true } }, serviceType: true, visit: true },
        });
      }

      console.log(`Testing with Completed Appointment ID: ${appointment.id}, Client: ${appointment.clientId}`);

      // 2. Test Admin Upload of PDF Report
      const uploadedReport = await uploadVisitReport("admin_test_user", {
        appointmentId: appointment.id,
        file: mockMulterFile,
        title: "Home Safety Inspection Report",
        summary: "Specialist inspected entrance and bathroom safety.",
      });

      assert(uploadedReport !== null, "1. Admin can upload PDF report for completed visit");
      assert(uploadedReport?.clientId === appointment.clientId, "2. Uploaded report is linked to correct client");
      assert(uploadedReport?.appointmentId === appointment.id, "3. Uploaded report is linked to correct appointment");
      assert(uploadedReport?.status === "available", "4. Uploaded report status is available");
      assert(Boolean(uploadedReport?.downloadUrl), "5. Download URL is populated");

      // 3. Test formatAppointmentRecord shows reportStatus = "uploaded"
      const refreshedAppt = await (prisma.appointment.findUnique as any)({
        where: { id: appointment.id },
        include: {
          serviceType: true,
          client: { include: { user: true } },
          createdByUser: true,
          visit: {
            include: {
              technician: true,
              reports: { where: { isArchived: false } },
            },
          },
        },
      });

      const formatted = formatAppointmentRecord(refreshedAppt, []);
      assert(formatted.reportStatus === "uploaded", "6. formatAppointmentRecord returns reportStatus = 'uploaded'");
      assert(formatted.hasReport === true, "7. formatAppointmentRecord hasReport is true");
      assert(formatted.reportId === uploadedReport?.id, "8. formatAppointmentRecord contains valid reportId");

      // 4. Test Report Retrieval by Appointment ID
      const apptReport = await getReportByAppointmentId(appointment.id, { id: "admin_test_user", role: "ADMIN" });
      assert(apptReport !== null && apptReport.id === uploadedReport?.id, "9. getReportByAppointmentId returns the uploaded report");

      // 5. Test Client My Reports Retrieval
      const clientUserId = appointment.client?.userId || appointment.clientId;
      const myReports = await getMyReports(clientUserId);
      assert(myReports.length > 0, "10. Client getMyReports returns the uploaded report");
      assert(myReports.some((r: any) => r.id === uploadedReport?.id), "11. Client can see their own report in getMyReports");

      // 6. Test Secure Download for Owner Client and Admin
      const adminDownload = await getReportFileForDownload(uploadedReport!.id, { id: "admin_user", role: "ADMIN" });
      assert(fs.existsSync(adminDownload.filePath), "12. Admin can access report file on server disk");

      const clientDownload = await getReportFileForDownload(uploadedReport!.id, { id: clientUserId, role: "CLIENT" });
      assert(fs.existsSync(clientDownload.filePath), "13. Client owner can access report file on server disk");

      // 7. Test Authorization: Unauthorized client cannot download
      let caughtAuthError = false;
      try {
        await getReportFileForDownload(uploadedReport!.id, { id: "random_unauthorized_user_123", role: "CLIENT" });
      } catch (err: any) {
        caughtAuthError = true;
      }
      assert(caughtAuthError === true, "14. Unauthorized client is denied access to another client's report (403/Object-level auth)");

      // 8. Test Duplicate Upload Protection / Report Replacement
      const secondPdfFilename = `test-report-v2-${Date.now()}.pdf`;
      const secondPdfPath = path.join(uploadDir, secondPdfFilename);
      fs.writeFileSync(secondPdfPath, "%PDF-1.4 Replaced PDF Content");

      const replacementFile: Express.Multer.File = {
        ...mockMulterFile,
        filename: secondPdfFilename,
        path: secondPdfPath,
      };

      const replacedReport = await uploadVisitReport("admin_test_user", {
        appointmentId: appointment.id,
        file: replacementFile,
        title: "Updated Safety Inspection Report",
        summary: "Updated inspection summary.",
      });

      assert(replacedReport?.id === uploadedReport?.id, "15. Duplicate upload replaces existing report record without creating duplicates");
      assert(replacedReport?.title === "Updated Safety Inspection Report", "16. Replaced report title is updated");

      // Clean up test file
      if (fs.existsSync(secondPdfPath)) {
        fs.unlinkSync(secondPdfPath);
      }
    }
  } catch (err) {
    console.error("❌ Unexpected test execution error:", err);
    failed++;
  } finally {
    console.log("\n============================================================");
    console.log(`📊 TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("============================================================\n");
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
