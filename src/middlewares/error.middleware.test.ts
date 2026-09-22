import { ZodError, z } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { globalErrorHandler } from "./error.middleware";

function mockResponse() {
  const res: any = {};
  res.statusCode = 200;
  res.jsonData = null;
  res.status = function (code: number) {
    res.statusCode = code;
    return res;
  };
  res.json = function (data: any) {
    res.jsonData = data;
    return res;
  };
  return res;
}

function runTests() {
  console.log("==================================================");
  console.log("🧪 RUNNING GLOBAL ERROR HANDLER FORMATTING TESTS");
  console.log("==================================================");

  let passed = 0;
  let total = 0;

  function assert(
    condition: boolean,
    testName: string,
    actual?: any,
    expected?: any
  ) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      if (actual !== undefined) console.error(`   Actual:   ${JSON.stringify(actual)}`);
      if (expected !== undefined) console.error(`   Expected: ${JSON.stringify(expected)}`);
    }
  }

  const req: any = { method: "POST", originalUrl: "/api/v1/test" };
  const next: any = () => {};

  // TEST 1: AppError
  {
    const res = mockResponse();
    const err = new AppError(403, "Access denied. Admin rights required.");
    globalErrorHandler(err, req, res, next);
    assert(
      res.statusCode === 403 && res.jsonData?.message === "Access denied. Admin rights required.",
      "1. AppError formats status and message correctly",
      res.jsonData
    );
  }

  // TEST 2: ZodError
  {
    const res = mockResponse();
    const schema = z.object({
      email: z.string().email("Please provide a valid email"),
      age: z.number().min(18, "Must be at least 18"),
    });
    const parsed = schema.safeParse({ email: "invalid", age: 10 });
    if (!parsed.success) {
      globalErrorHandler(parsed.error, req, res, next);
      assert(
        res.statusCode === 400 &&
          res.jsonData?.message?.includes("email: Please provide a valid email") &&
          res.jsonData?.errors?.email !== undefined,
        "2. ZodError formats field errors into clean human-readable text",
        res.jsonData
      );
    }
  }

  // TEST 3: Prisma P2002 Unique Constraint
  {
    const res = mockResponse();
    const prismaErr = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the constraint: Client_clientNumber_key",
      {
        code: "P2002",
        clientVersion: "6.0.0",
        meta: { target: ["clientNumber"] },
      }
    );
    globalErrorHandler(prismaErr, req, res, next);
    assert(
      res.statusCode === 409 &&
        res.jsonData?.message === "A record with this clientNumber already exists. Please use a different value.",
      "3. Prisma P2002 formats unique constraint error into human-readable message",
      res.jsonData
    );
  }

  // TEST 4: Prisma P2025 Record Not Found
  {
    const res = mockResponse();
    const prismaErr = new Prisma.PrismaClientKnownRequestError("Record to update not found.", {
      code: "P2025",
      clientVersion: "6.0.0",
      meta: { cause: "No User found with ID '123'" },
    });
    globalErrorHandler(prismaErr, req, res, next);
    assert(
      res.statusCode === 404 && res.jsonData?.message === "No User found with ID '123'",
      "4. Prisma P2025 formats not found error correctly",
      res.jsonData
    );
  }

  // TEST 5: JWT Token Expired
  {
    const res = mockResponse();
    const jwtErr = new Error("jwt expired");
    jwtErr.name = "TokenExpiredError";
    globalErrorHandler(jwtErr, req, res, next);
    assert(
      res.statusCode === 401 && res.jsonData?.message === "Your login session has expired. Please log in again.",
      "5. TokenExpiredError formats into friendly re-login prompt",
      res.jsonData
    );
  }

  // TEST 6: Multer File Size Limit
  {
    const res = mockResponse();
    const multerErr: any = new Error("File too large");
    multerErr.name = "MulterError";
    multerErr.code = "LIMIT_FILE_SIZE";
    globalErrorHandler(multerErr, req, res, next);
    assert(
      res.statusCode === 400 &&
        res.jsonData?.message === "The uploaded file is too large. Maximum allowed size is 10MB.",
      "6. Multer LIMIT_FILE_SIZE formats into clear size limit warning",
      res.jsonData
    );
  }

  // TEST 7: JSON Syntax Error
  {
    const res = mockResponse();
    const syntaxErr: any = new SyntaxError("Unexpected token } in JSON at position 12");
    syntaxErr.body = "{ invalid }";
    globalErrorHandler(syntaxErr, req, res, next);
    assert(
      res.statusCode === 400 &&
        res.jsonData?.message === "Malformed JSON syntax in request body. Please verify your payload format.",
      "7. JSON SyntaxError formats into clear payload explanation",
      res.jsonData
    );
  }

  console.log("\n==================================================");
  console.log(`📊 TEST SUMMARY: ${passed}/${total} Passed`);
  console.log("==================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
