import app from "./app";
import { initRenewalScheduler } from "./modules/payment/scheduler.service";
import { seedDefaultAssessmentTemplate } from "./modules/report/report.service";

const PORT = process.env.PORT || 5173;

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  initRenewalScheduler();
  seedDefaultAssessmentTemplate().catch((e) =>
    console.warn("⚠️ Assessment template seed notice:", e.message)
  );
});
