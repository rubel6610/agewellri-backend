import { Application } from "express";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "AgeWellRI Backend API",
      version: "1.0.0",
      description:
        "Comprehensive REST API Documentation for the AgeWellRI Platform",
      contact: {
        name: "AgeWellRI API Support",
        email: "agewellri@gmail.com",
      },
    },
    servers: [
      {
        url: "http://localhost:" + process.env.PORT,
        description: "Local Development Server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Enter your JWT Bearer token in the format: Bearer <token>",
        },
      },
      schemas: {
        ApiResponse: {
          type: "object",
          properties: {
            statusCode: { type: "integer", example: 200 },
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Operation successful" },
            data: { type: "object", nullable: true },
            errors: { type: "object", nullable: true },
          },
        },
        RegisterInput: {
          type: "object",
          required: ["email", "password", "firstName", "lastName"],
          properties: {
            email: {
              type: "string",
              format: "email",
              example: "client@example.com",
            },
            password: { type: "string", minLength: 6, example: "Password123!" },
            firstName: { type: "string", example: "Eleanor" },
            lastName: { type: "string", example: "Vance" },
            phone: { type: "string", example: "401-555-0199" },
            role: {
              type: "string",
              enum: ["CLIENT", "ADMIN", "OWNER", "TECHNICIAN"],
              default: "CLIENT",
            },
            address: { type: "string", example: "100 Ocean Drive" },
            city: { type: "string", example: "Providence" },
            state: { type: "string", example: "RI" },
            postalCode: { type: "string", example: "02903" },
          },
        },
        LoginInput: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: {
              type: "string",
              format: "email",
              example: "client@example.com",
            },
            password: { type: "string", example: "Password123!" },
          },
        },
        ChangePasswordInput: {
          type: "object",
          required: ["oldPassword", "newPassword"],
          properties: {
            oldPassword: { type: "string", example: "OldPassword123!" },
            newPassword: {
              type: "string",
              minLength: 6,
              example: "NewPassword123!",
            },
          },
        },
        UpdateProfileInput: {
          type: "object",
          properties: {
            firstName: { type: "string", example: "Eleanor" },
            lastName: { type: "string", example: "Vance" },
            phone: { type: "string", example: "401-555-0199" },
            address: { type: "string", example: "148 Hope Street" },
            city: { type: "string", example: "Providence" },
            state: { type: "string", example: "RI" },
            postalCode: { type: "string", example: "02906" },
            emergencyContactName: { type: "string", example: "Sarah Jenkins" },
            emergencyContactPhone: { type: "string", example: "401-555-0182" },
            emergencyContactRelation: { type: "string", example: "Daughter" },
          },
        },
      },
    },
    paths: {
      "/api/v1/auth/register": {
        post: {
          tags: ["Authentication"],
          summary: "Register a new user account",
          description:
            "Registers a user. If role is CLIENT, auto-creates a Client profile with a unique clientNumber.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RegisterInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "User registered successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiResponse" },
                },
              },
            },
            "400": { description: "Validation error or email already exists" },
          },
        },
      },
      "/api/v1/auth/login": {
        post: {
          tags: ["Authentication"],
          summary: "Authenticate user & issue JWT token",
          description:
            "Validates user credentials, updates last login timestamp, and returns a signed JWT access token.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Login successful",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiResponse" },
                },
              },
            },
            "401": { description: "Invalid credentials or inactive account" },
          },
        },
      },
      "/api/v1/auth/me": {
        get: {
          tags: ["Authentication"],
          summary: "Get current authenticated user profile",
          description:
            "Fetches user details and linked Client or Technician profile for the currently logged-in user.",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "User profile retrieved successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiResponse" },
                },
              },
            },
            "401": { description: "Unauthorized or token missing/invalid" },
          },
        },
      },
      "/api/v1/auth/profile": {
        patch: {
          tags: ["Authentication"],
          summary: "Update user profile (email is immutable)",
          description:
            "Updates user profile information such as name, phone, service address, and emergency contact details. Email cannot be changed.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateProfileInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Profile updated successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiResponse" },
                },
              },
            },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/v1/auth/agreement": {
        post: {
          tags: ["Authentication"],
          summary: "Sign & Submit Initial Client Service Agreement",
          description:
            "Submits client agreement details, signature, and updates onboarding status to AGREEMENT_SIGNED.",
          security: [{ bearerAuth: [] }],
          responses: {
            "201": {
              description: "Agreement signed successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiResponse" },
                },
              },
            },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/v1/auth/forgot-password": {
        post: {
          tags: ["Authentication"],
          summary: "Send Password Reset OTP Code",
          description:
            "Sends a 6-digit verification code to the registered email address via Nodemailer.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: { email: { type: "string", format: "email" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "OTP sent to email" },
            "400": { description: "User not found or validation error" },
          },
        },
      },
      "/api/v1/auth/verify-otp": {
        post: {
          tags: ["Authentication"],
          summary: "Verify Password Reset OTP",
          description:
            "Verifies whether the 6-digit OTP is valid and within the 10-minute expiry window.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "otp"],
                  properties: {
                    email: { type: "string", format: "email" },
                    otp: { type: "string", example: "123456" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "OTP confirmed" },
            "400": { description: "Invalid or expired OTP" },
          },
        },
      },
      "/api/v1/auth/reset-password": {
        post: {
          tags: ["Authentication"],
          summary: "Reset Password with Verified OTP",
          description:
            "Resets account password to new password after validating the 6-digit OTP code.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "otp", "newPassword"],
                  properties: {
                    email: { type: "string", format: "email" },
                    otp: { type: "string", example: "123456" },
                    newPassword: {
                      type: "string",
                      format: "password",
                      minLength: 8,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Password reset successful" },
            "400": { description: "Invalid OTP or validation error" },
          },
        },
      },
      "/api/v1/auth/refresh-token": {
        post: {
          tags: ["Authentication"],
          summary: "Refresh Access Token & Session",
          description:
            "Exchanges a valid refresh token for a newly signed access token and user session.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["refreshToken"],
                  properties: {
                    refreshToken: {
                      type: "string",
                      description: "Long-lived refresh token",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Token refreshed successfully" },
            "400": { description: "Missing refresh token" },
            "401": { description: "Invalid or expired refresh token" },
          },
        },
      },
      "/api/v1/auth/change-password": {
        patch: {
          tags: ["Authentication"],
          summary: "Change user password",
          description:
            "Allows an authenticated user to update their account password.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChangePasswordInput" },
              },
            },
          },
          responses: {
            "200": { description: "Password updated successfully" },
            "400": {
              description: "Incorrect current password or invalid input",
            },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/v1/payments/config": {
        get: {
          tags: ["Payments & Stripe"],
          summary: "Get Stripe Publishable Key",
          description:
            "Returns the Stripe publishable key to initialize frontend Stripe Elements SDK.",
          responses: {
            "200": { description: "Stripe configuration retrieved" },
          },
        },
      },
      "/api/v1/payments/create-setup-intent": {
        post: {
          tags: ["Payments & Stripe"],
          summary: "Create Stripe SetupIntent",
          description:
            "Generates a SetupIntent clientSecret for saving a card during Agreement signing or billing management.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    plan: { type: "string", example: "Home Safety Oversight" },
                    hasCleaningAddon: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "SetupIntent created successfully" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/v1/payments/create-payment-intent": {
        post: {
          tags: ["Payments & Stripe"],
          summary: "Create Stripe PaymentIntent",
          description:
            "Generates a PaymentIntent clientSecret for charging a specific amount directly.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["amount"],
                  properties: {
                    amount: { type: "number", example: 99.0 },
                    currency: { type: "string", example: "usd" },
                    description: {
                      type: "string",
                      example: "Monthly Safety Membership",
                    },
                    selectedPlan: {
                      type: "string",
                      example: "Home Safety Oversight",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "PaymentIntent created successfully" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/v1/payments/save-payment-method": {
        post: {
          tags: ["Payments & Stripe"],
          summary: "Attach and save PaymentMethod",
          description:
            "Attaches a confirmed Stripe payment method (pm_...) to the client customer record.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["paymentMethodId"],
                  properties: {
                    paymentMethodId: {
                      type: "string",
                      example: "pm_card_visa",
                    },
                    setAsDefault: { type: "boolean", default: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Payment method attached successfully" },
            "400": { description: "Invalid paymentMethodId" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/v1/payments/payment-methods": {
        get: {
          tags: ["Payments & Stripe"],
          summary: "List saved payment methods",
          description:
            "Retrieves all saved cards attached to the authenticated client's Stripe customer account.",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "List of payment methods retrieved" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/v1/payments/billing-info": {
        get: {
          tags: ["Payments & Stripe"],
          summary: "Get Billing Overview & Invoices",
          description:
            "Returns client active subscription plan, stored card details, renewal date, and invoice history.",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Billing information retrieved" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/v1/payments/process-agreement-payment": {
        post: {
          tags: ["Payments & Stripe"],
          summary: "Process Agreement Payment & Activate Membership",
          description:
            "Attaches Stripe payment method, provisions the client's subscription, visit allocations, and generates the initial invoice.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    paymentMethodId: {
                      type: "string",
                      example: "pm_card_visa",
                    },
                    setupIntentId: { type: "string", example: "seti_12345" },
                    selectedPlan: {
                      type: "string",
                      example: "Home Safety Oversight",
                    },
                    hasCleaningAddon: { type: "boolean", default: false },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Agreement payment processed and membership activated",
            },
            "400": { description: "Invalid input" },
            "401": { description: "Unauthorized" },
          },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJSDoc(options);

export function setupSwagger(app: Application): void {
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.use("/docs-json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });
}

export default setupSwagger;
