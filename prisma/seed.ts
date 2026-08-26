import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, UserRole, UserStatus } from "@prisma/client";
import { seedInitialPlansAndServices } from "../src/modules/plan/plan.service";
import { seedDefaultSpecialists } from "../src/modules/specialist/specialist.service";
import { seedDefaultAgreementTemplates } from "../src/modules/agreement/agreement.service";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting Admin, Plans, Specialists and State Agreements Seeding...");

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@yopmail.com").toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin123!";
  const firstName = process.env.ADMIN_FIRST_NAME || "System";
  const lastName = process.env.ADMIN_LAST_NAME || "Admin";
  const phone = process.env.ADMIN_PHONE || "(401) 712-3012";

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      firstName,
      lastName,
      phone,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: adminEmail,
      passwordHash,
      firstName,
      lastName,
      phone,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  console.log("\n=======================================================");
  console.log("✅ Admin User Seeded Successfully!");
  console.log("=======================================================");
  console.log(`👤 Name:     ${adminUser.firstName} ${adminUser.lastName}`);
  console.log(`📧 Email:    ${adminUser.email}`);
  console.log(`🔑 Password: ${adminPassword}`);
  console.log(`🛡️  Role:     ${adminUser.role}`);
  console.log(`🟢 Status:   ${adminUser.status}`);
  console.log(`🆔 ID:       ${adminUser.id}`);
  console.log("=======================================================\n");

  console.log("📦 Seeding initial dynamic service plans & catalog...");
  await seedInitialPlansAndServices();
  console.log("✅ Service plans & services catalog ready!");

  console.log("👷 Seeding default Rhode Island safety specialists...");
  await seedDefaultSpecialists();
  console.log("✅ Default specialists created successfully!");

  console.log("📜 Seeding State-Specific Agreement Templates (RI, CT, MA)...");
  await seedDefaultAgreementTemplates();
  console.log("✅ State agreements seeded successfully!\n");
}

main()
  .catch((e) => {
    console.error("❌ Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
