# AgeWell RI - Backend API

Backend server and REST API services for the AgeWell RI platform, built with Node.js, Express, Prisma ORM, and MongoDB.

## 🔐 Admin Credentials

- **Email:** `admin@yopmail.com`
- **Password:** `Admin123!`

---

## 🚀 Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Environment Variables

Ensure `.env` is properly configured with your MongoDB connection string and environment variables.

### 3. Database Setup & Seeding

```bash
pnpm prisma generate
pnpm seed:admin
```

### 4. Run the Development Server

```bash
pnpm dev
```

The API server will start at `http://localhost:5173`.

### 5. Build for Production

```bash
pnpm build
pnpm start
```
