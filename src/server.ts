import app from "./app";
import { initRenewalScheduler } from "./modules/payment/scheduler.service";
import { seedDefaultAssessmentTemplate } from "./modules/report/report.service";
import { seedInitialPlansAndServices } from "./modules/plan/plan.service";

// Global process safety handlers for unhandled promise rejections & uncaught exceptions
process.on("unhandledRejection", (reason: any) => {
  console.error("💥 [PROCESS] Unhandled Promise Rejection:", reason?.message || reason);
});

process.on("uncaughtException", (error: Error) => {
  console.error("💥 [PROCESS] Uncaught Exception:", error.message);
  if (error.stack) {
    console.error(error.stack);
  }
});

const PORT = process.env.PORT || 5173;

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  initRenewalScheduler();
  seedDefaultAssessmentTemplate().catch((e) =>
    console.warn("⚠️ Assessment template seed notice:", e.message)
  );
  seedInitialPlansAndServices().catch((e) =>
    console.warn("⚠️ Plan seed notice:", e.message)
  );
});
