import { Application } from "express";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "AgeWellRI Backend API",
      version: "1.0.0",
      description: "Comprehensive REST API Documentation for the AgeWellRI Platform",
      contact: {
        name: "AgeWellRI API Support",
        email: "support@agewellri.com",
      },
    },
    servers: [
      {
        url: "http://localhost:3001",
        description: "Local Development Server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter your JWT Bearer token in the format: Bearer <token>",
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
            email: { type: "string", format: "email", example: "client@example.com" },
            password: { type: "string", minLength: 6, example: "Password123!" },
            firstName: { type: "string", example: "Eleanor" },
            lastName: { type: "string", example: "Vance" },
            phone: { type: "string", example: "401-555-0199" },
            role: { type: "string", enum: ["CLIENT", "ADMIN", "OWNER", "TECHNICIAN"], default: "CLIENT" },
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
            email: { type: "string", format: "email", example: "client@example.com" },
            password: { type: "string", example: "Password123!" },
          },
        },
        ChangePasswordInput: {
          type: "object",
          required: ["oldPassword", "newPassword"],
          properties: {
            oldPassword: { type: "string", example: "OldPassword123!" },
            newPassword: { type: "string", minLength: 6, example: "NewPassword123!" },
          },
        },
      },
    },
    paths: {
      "/api/v1/auth/register": {
        post: {
          tags: ["Authentication"],
          summary: "Register a new user account",
          description: "Registers a user. If role is CLIENT, auto-creates a Client profile with a unique clientNumber.",
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
          description: "Validates user credentials, updates last login timestamp, and returns a signed JWT access token.",
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
          description: "Fetches user details and linked Client or Technician profile for the currently logged-in user.",
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
      "/api/v1/auth/change-password": {
        patch: {
          tags: ["Authentication"],
          summary: "Change user password",
          description: "Allows an authenticated user to update their account password.",
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
            "400": { description: "Incorrect current password or invalid input" },
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
