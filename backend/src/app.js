import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pathToFileURL } from "node:url";
import express from "express";
import cors from "cors";
import { config } from "./config/env.js";
import { db } from "./db/db.js";

import authRoutes from "./routes/auth.js";
import documentRoutes from "./routes/documents.js";
import searchRoutes from "./routes/search.js";
import askRoutes from "./routes/ask.js";

const app = express();

app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
        ],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "connect-src": [
          "'self'",
          ...(config.aws.storageMode === "s3"
            ? [
                `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com`,
                `https://${config.aws.bucketName}.s3.amazonaws.com`,
              ]
            : []),
        ],
        "frame-src": ["'self'", "blob:"],
        "img-src": ["'self'", "blob:", "data:"],
        "object-src": ["'none'"],
      },
    },
  }),
);
// Middleware
app.use(
  cors({
    origin: config.corsOrigin.split(","),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Raw body parser specifically for PUT local uploads (supports binary streams)
app.use(
  "/api/documents/local-upload",
  express.raw({ type: "*/*", limit: "50mb" }),
);

app.use(express.json({ limit: "32kb" }));
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
);
app.use("/api/ask", rateLimit({ windowMs: 60 * 1000, limit: 20 }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logging in development
if (config.nodeEnv === "development") {
  app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
  });
}

// Health check endpoint
app.get("/api/health", async (req, res) => {
  try {
    await db.healthcheck();
  } catch {
    return res.status(503).json({ status: "unavailable" });
  }
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "CloudVault API",
    version: "1.0.0",
    dbEngine: config.db.host
      ? "PostgreSQL (RDS / pgvector)"
      : "Local Embedded Storage",
    storageMode: config.aws.storageMode === "s3" ? "AWS S3" : "Local Storage",
    aiEngine: config.ai.engine,
  });
});

// Route registration
app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/ask", askRoutes);

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../frontend/dist",
);
if (fs.existsSync(webRoot)) {
  app.use(express.static(webRoot));
  app.get(/^(?!\/api(?:\/|$)).*/, (req, res) =>
    res.sendFile(path.join(webRoot, "index.html")),
  );
}

// 404 handler
app.use((req, res) => {
  res
    .status(404)
    .json({ error: `Endpoint not found: ${req.method} ${req.url}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("[App] Unhandled error:", err);
  res.status(err.status || 500).json({
    error:
      config.nodeEnv === "production" && (!err.status || err.status >= 500)
        ? "Internal server error"
        : err.message || "Internal server error",
  });
});

// Server bootstrap
export async function startServer() {
  try {
    // Initialize active database engine
    await db.init();

    return app.listen(config.port, () => {
      console.log("====================================================");
      console.log(`🚀 CloudVault API Server running on port ${config.port}`);
      console.log(
        `📡 Health Check: http://localhost:${config.port}/api/health`,
      );
      console.log(
        `🗄️  Database: ${config.db.host ? `PostgreSQL @ ${config.db.host}` : "Local Embedded Engine"}`,
      );
      console.log(
        `📦 Storage: ${config.aws.bucketName ? `AWS S3 (${config.aws.bucketName})` : "Local Filesystem"}`,
      );
      console.log("====================================================");
    });
  } catch (err) {
    console.error("Failed to start CloudVault backend server:", err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startServer();

export default app;
