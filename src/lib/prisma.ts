import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const dbUrl = process.env.DATABASE_URL;

export const prisma = new PrismaClient(
  dbUrl
    ? {
        datasources: {
          db: {
            url: dbUrl,
          },
        },
      }
    : undefined
);

export default prisma;
