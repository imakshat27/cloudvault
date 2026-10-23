import { getDatabasePassword } from "./secrets.js";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
dotenv.config({ path: path.join(root, ".env") });
const production = process.env.NODE_ENV === "production";
if (
  production &&
  process.env.RUNTIME_ROLE !== "worker" &&
  (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
)
  throw new Error("Set JWT_SECRET to at least 32 random characters");
if (production && !process.env.DB_HOST)
  throw new Error(
    "Production requires PostgreSQL; local storage cannot be shared across replicas",
  );
export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  jwt: {
    secret: process.env.JWT_SECRET || crypto.randomBytes(48).toString("hex"),
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  },
  registrationMode:
    process.env.REGISTRATION_MODE || (production ? "invite" : "open"),
  limits: {
    maxFiles: Number(process.env.MAX_FILES_PER_USER || 50),
    maxStorageBytes:
      Number(process.env.MAX_STORAGE_MB_PER_USER || 250) * 1024 * 1024,
    dailyRequests: Number(process.env.MAX_DAILY_AI_REQUESTS || 100),
  },
  db: {
    migrate: process.env.DB_MIGRATE !== "false",
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "cloudvault",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_SECRET_ARN
      ? getDatabasePassword
      : process.env.DB_PASSWORD,
    ssl:
      process.env.DB_SSL === "true"
        ? {
            rejectUnauthorized: true,
            ...(process.env.DB_CA_FILE
              ? { ca: fs.readFileSync(process.env.DB_CA_FILE, "utf8") }
              : {}),
          }
        : false,
  },
  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    bucketName: process.env.S3_BUCKET_NAME,
    storageMode: process.env.STORAGE_MODE || "local",
    queueUrl: process.env.SQS_QUEUE_URL,
  },
  ai: {
    engine: process.env.AI_ENGINE || "local",
    embeddingModel:
      process.env.BEDROCK_EMBEDDING_MODEL || "amazon.titan-embed-text-v2:0",
    chatModel: process.env.BEDROCK_CHAT_MODEL,
  },
  paths: {
    uploadsDir: process.env.UPLOADS_DIR || path.join(root, "uploads"),
    dataDir: process.env.DATA_DIR || path.join(root, "data"),
  },
};
if (!["local", "bedrock"].includes(config.ai.engine))
  throw new Error("AI_ENGINE must be local or bedrock");

if (config.aws.storageMode === "s3" && !config.aws.bucketName)
  throw new Error("S3_BUCKET_NAME is required for S3 storage");
if (config.ai.engine === "bedrock" && !config.ai.chatModel)
  throw new Error("BEDROCK_CHAT_MODEL is required for Bedrock mode");
if (config.aws.queueUrl && (!config.db.host || config.aws.storageMode !== "s3"))
  throw new Error("SQS indexing requires shared PostgreSQL and S3 storage");

if (!["open", "invite"].includes(config.registrationMode))
  throw new Error("REGISTRATION_MODE must be open or invite");
