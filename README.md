# AgeWell RI - Backend API & Services

RESTful API backend for the **AgeWell RI** platform — providing appointment scheduling, client onboarding, family member reporting, visit documentation, subscription billing, and dynamic Stripe payment processing.

---

## 🛠️ Technology Stack

- **Runtime & Language:** Node.js (v20+), TypeScript, Express.js 5
- **Database & ORM:** MongoDB (with Replica Set), Prisma ORM 6
- **Authentication:** JWT (JSON Web Tokens), bcryptjs password hashing
- **Payments:** Stripe API (with AES-256-GCM encrypted database storage & live hot-reloading)
- **Emails:** Nodemailer (SMTP transactional email notifications)
- **Validation:** Zod runtime validation
- **Documentation:** Swagger / OpenAPI UI
- **Package Manager:** `pnpm` (v11+)

---

## 📋 Prerequisites

Before starting, ensure you have the following installed on your system:

1. **Node.js** (v20.0.0 or higher) - [Download](https://nodejs.org/)
2. **pnpm** (v9.0.0 or higher) - Install via `npm install -g pnpm`
3. **MongoDB** (v6.0 or higher) with a **Replica Set** enabled (Prisma transactions require MongoDB to be run as a replica set, such as `rs0`, or MongoDB Atlas).

---

## 🚀 Setup & Installation

### 1. Clone & Navigate to Repository

```bash
git clone <repository-url>
cd age-well-ri-backend
```

### 2. Install Dependencies

```bash
pnpm install
```

> **Note:** The `postinstall` script will automatically run `prisma generate` to compile the Prisma client.

### 3. Configure Environment Variables

Create your local `.env` file by copying the provided `.env.example`:

```bash
cp .env.example .env
```

Open `.env` in your text editor and customize the values:
- Set `DATABASE_URL` to your MongoDB replica set connection string.
- Generate a secure string for `JWT_SECRET`.
- Configure `FRONTEND_URL` (default: `http://localhost:3000`).
- Configure SMTP credentials for sending transactional emails.

### 4. Seed the Database

Seed the initial system administrator account:

```bash
pnpm db:seed
```

Default seeded credentials (configurable in `.env`):
- **Email:** `admin@agewellri.com`
- **Password:** `Admin123!`

---

## 💻 Running the Application

### Development Mode

Runs the server with hot-reload via `tsx`:

```bash
pnpm dev
```

The API will be accessible at:
- **API Base:** `http://localhost:5173/api/v1`
- **Interactive Swagger Docs:** `http://localhost:5173/api/docs`

### Production Build

Compile TypeScript and run the production server:

```bash
pnpm build
pnpm start
```

---

## 💳 Stripe Gateway & Webhook Setup

Payment keys can be configured in two ways:
1. **Fallback in `.env`:** Provide `STRIPE_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET`.
2. **Admin Dashboard (Recommended):** Log in as an Administrator, navigate to **Billing & Payments**, and click **Payment Gateway Settings**. Keys entered in the Admin UI are encrypted with AES-256-GCM, stored in MongoDB, and instantly hot-reloaded by the server without restarting.

### Webhook Endpoint

Stripe webhooks should be forwarded to:
```
POST /api/v1/payments/webhook
```

Using the Stripe CLI for local testing:
```bash
stripe listen --forward-to localhost:5173/api/v1/payments/webhook
```

---

## 📂 Project Structure

```
age-well-ri-backend/
├── prisma/
│   ├── schema/              # Multi-file Prisma schemas (auth, billing, client, visit, etc.)
│   └── seed.ts              # Database seeding script
├── src/
│   ├── config/              # Stripe, Swagger, and system configurations
│   ├── middlewares/         # Auth guard, error handlers, and logging middlewares
│   ├── modules/
│   │   ├── agreement/       # Client service agreements & e-signatures
│   │   ├── appointment/     # Specialist scheduling and calendar logic
│   │   ├── auth/            # Registration, login, password reset
│   │   ├── client/          # Client profiles & health questionnaire
│   │   ├── family/          # Family member invitations & notifications
│   │   ├── payment/         # Subscriptions, invoices, and Stripe webhook handling
│   │   ├── plan/            # Service plans & pricing tiers
│   │   ├── report/          # Specialist visit reports & PDF generation
│   │   └── specialist/      # Technician profiles & assignments
│   ├── utils/               # AES-256 encryption, email, PDF generation utilities
│   ├── app.ts               # Express application initialization & middleware
│   ├── routes.ts            # Top-level API router
│   └── server.ts            # Server entrypoint and graceful shutdown
├── .env.example             # Documented environment variable template
├── pnpm-workspace.yaml      # Dependency overrides & security policies
└── tsconfig.json            # TypeScript compiler configuration
```

---

## 🔒 Security & Code Quality

- **Vulnerability Scans:** Run `pnpm audit` to verify all dependencies are free of security issues.
- **TypeScript Typecheck:** Run `npx tsc --noEmit` to validate all typings.
