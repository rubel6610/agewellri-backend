import { generateNextClientNumber } from "./client-number.util";

async function runTests() {
  console.log("==================================================");
  console.log("🧪 RUNNING CLIENT NUMBER GENERATION TESTS");
  console.log("==================================================");

  let passed = 0;
  let total = 0;

  function assert(
    condition: boolean,
    testName: string,
    actual?: any,
    expected?: any,
  ) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      if (actual !== undefined) console.error(`   Actual:   ${actual}`);
      if (expected !== undefined) console.error(`   Expected: ${expected}`);
    }
  }

  try {
    const nextNumber = await generateNextClientNumber();
    console.log(`ℹ️ Generated Next Client Number from Database: ${nextNumber}`);
    assert(
      /^AW-\d+$/.test(nextNumber),
      "Generated client number matches AW-XXXX pattern",
      nextNumber,
      "AW-XXXX"
    );

    const num = parseInt(nextNumber.replace("AW-", ""), 10);
    assert(
      !isNaN(num) && num >= 1001,
      "Generated client number is at least AW-1001",
      num,
      ">= 1001"
    );
  } catch (err) {
    console.error("Test execution failed:", err);
  }

  console.log("\n==================================================");
  console.log(`📊 TEST SUMMARY: ${passed}/${total} Passed`);
  console.log("==================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
