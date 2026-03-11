import dotenv from "dotenv";
dotenv.config();

export const env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_SECRET: process.env.JWT_SECRET || "maetra-dev-secret",
  CONTENT_ENCRYPTION_KEY: process.env.CONTENT_ENCRYPTION_KEY || "maetra-content-key-change-in-production",
  PORT: parseInt(process.env.PORT || "3001", 10),
};
