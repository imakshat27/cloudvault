import express from "express";
import crypto from "crypto";
import path from "path";
import multer from "multer";
import { db } from "../db/db.js";
import { storageService } from "../services/storage.js";
import { enqueueDocument } from "../services/queue.js";
import { extractTextFromBuffer } from "../services/extractor.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.param("id", (req, res, next, id) => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return res.status(400).json({ error: "Invalid document ID" });
  next();
});
router.param("shareId", (req, res, next, id) => {
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return res.status(400).json({ error: "Invalid share ID" });
  next();
});

// Setup multer for local file uploads (storage: memory or disk)
const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB limit
});

// 1. POST /documents/upload-url
// Request an upload URL (pre-signed S3 URL in AWS mode, or local route in dev mode)
router.post("/upload-url", requireAuth, async (req, res) => {
  try {
    const { filename, fileSize } = req.body;

    if (typeof filename !== "string" || !filename || filename.length > 255) {
      return res.status(400).json({ error: "Filename is required" });
    }

    if (
      !Number.isInteger(fileSize) ||
      fileSize <= 0 ||
      fileSize > 25 * 1024 * 1024
    )
      return res
        .status(400)
        .json({ error: "File must be between 1 byte and 25 MB" });
    const originalName = path
      .basename(filename.replace(/\\/g, "/"))
      .replace(/[\x00-\x1f\x7f]/g, "");
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = path.extname(sanitizedName).toLowerCase();
    const mimeType = {
      ".pdf": "application/pdf",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".txt": "text/plain",
      ".md": "text/markdown",
    }[ext];
    const validExts = [".pdf", ".docx", ".txt", ".md"];

    if (!validExts.includes(ext)) {
      return res.status(400).json({
        error: `Unsupported file type: ${ext}. Supported formats: PDF, DOCX, TXT, MD`,
      });
    }

    // Generate unique storage key: user-id/timestamp-random-filename
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const s3Key = `uploads/${req.user.id}/${uniqueSuffix}-${sanitizedName}`;

    // Get upload URL (S3 pre-signed URL or local endpoint)
    const { uploadUrl, storageType } = await storageService.getUploadUrl({
      key: s3Key,
      mimeType: mimeType || "application/octet-stream",
      fileSize,
    });

    // Create database entry with pending status
    const doc = await db.createDocument({
      ownerId: req.user.id,
      filename: originalName,
      s3Key,
      fileSize: fileSize || 0,
      mimeType: mimeType || "application/octet-stream",
    });

    return res.status(201).json({
      documentId: doc.id,
      uploadUrl,
      storageType,
      s3Key,
      mimeType,
      expiresIn: 900, // 15 mins
    });
  } catch (err) {
    console.error("[Documents] upload-url error:", err);
    return res
      .status(err.status || 500)
      .json({
        error:
          err.status === 429 ? err.message : "Failed to generate upload URL",
      });
  }
});

// 2. PUT /documents/local-upload/:key (*)
// Local dev fallback endpoint for uploading file directly
router.put(
  "/local-upload/*",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      const key = req.params[0];
      if (!key) {
        return res.status(400).json({ error: "Missing storage key" });
      }

      const docs = await db.listDocumentsForUser(req.user.id);
      const target = docs.find((d) => d.s3_key === key && d.is_owner);
      if (!target || target.status !== "pending")
        return res.status(403).json({ error: "Upload not authorized" });
      if (storageService.isS3Configured)
        return res.status(400).json({ error: "Use the S3 upload URL" });
      // Handle raw binary stream or multipart
      let buffer;
      if (req.file) {
        buffer = req.file.buffer;
      } else if (req.body && Buffer.isBuffer(req.body)) {
        buffer = req.body;
      } else {
        // Collect raw stream chunks
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        buffer = Buffer.concat(chunks);
      }

      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: "No file content received" });
      }

      if (buffer.length > 25 * 1024 * 1024)
        return res.status(413).json({ error: "Maximum file size is 25 MB" });
      await storageService.saveLocalFile(key, buffer);
      return res.json({ success: true, key, size: buffer.length });
    } catch (err) {
      console.error("[Documents] Local upload error:", err);
      return res.status(500).json({ error: "Failed to save local file" });
    }
  },
);

// 3. POST /documents/:id/complete
// Frontend calls this once file upload finishes to initiate ingestion
router.post("/:id/complete", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const doc = await db.getDocumentById(id);
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (doc.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Access denied: not the owner" });
    }

    const metadata = await storageService.getFileMetadata(doc.s3_key);
    if (!metadata.size || metadata.size > 25 * 1024 * 1024)
      return res
        .status(400)
        .json({ error: "Uploaded file must be between 1 byte and 25 MB" });
    await db.updateDocumentMetadata(id, {
      fileSize: metadata.size,
      mimeType: doc.mime_type,
    });

    // Trigger ingestion asynchronously (background execution on EC2)
    if (["queued", "processing", "ready"].includes(doc.status))
      return res.status(409).json({ error: "Document already submitted" });
    await enqueueDocument(id);

    return res.json({
      message: "Upload completed. Document ingestion started.",
      documentId: id,
      status: "processing",
    });
  } catch (err) {
    console.error("[Documents] Complete error:", err);
    return res.status(err.status || 500).json({
      error:
        err.status === 409 ? err.message : "Failed to complete document upload",
    });
  }
});

// 4. GET /documents
// List all accessible documents (owned + shared)
router.get("/", requireAuth, async (req, res) => {
  try {
    const docs = await db.listDocumentsForUser(req.user.id);
    return res.json({ documents: docs });
  } catch (err) {
    console.error("[Documents] List error:", err);
    return res.status(500).json({ error: "Failed to retrieve documents" });
  }
});

// 5. GET /documents/:id/status
// Polled by frontend to check processing status
router.get("/:id/status", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.getDocumentById(id);

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (!(await db.listDocumentsForUser(req.user.id)).some((d) => d.id === id))
      return res.status(404).json({ error: "Document not found" });
    return res.json({
      id: doc.id,
      filename: doc.filename,
      status: doc.status,
      errorMessage: doc.error_message,
      updatedAt: doc.updated_at,
    });
  } catch (err) {
    console.error("[Documents] Status error:", err);
    return res.status(500).json({ error: "Failed to fetch document status" });
  }
});

// 6. POST /documents/:id/share
// Share a document with another user by email
router.post("/:id/share", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { email, permission = "view" } = req.body;
    if (permission !== "view")
      return res
        .status(400)
        .json({ error: "Only view permission is supported" });

    if (typeof email !== "string" || !email || email.length > 254) {
      return res
        .status(400)
        .json({ error: "Email of user to share with is required" });
    }

    const doc = await db.getDocumentById(id);
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (doc.owner_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: "Only the document owner can manage shares" });
    }

    const targetUser = await db.findUserByEmail(email.trim().toLowerCase());
    if (!targetUser) {
      return res
        .status(404)
        .json({ error: `User with email "${email}" not found` });
    }

    if (targetUser.id === req.user.id) {
      return res
        .status(400)
        .json({ error: "You cannot share a document with yourself" });
    }

    const share = await db.shareDocument({
      documentId: id,
      sharedWithUserId: targetUser.id,
      permission,
    });

    return res.json({
      message: `Document successfully shared with ${email}`,
      share,
    });
  } catch (err) {
    console.error("[Documents] Share error:", err);
    return res.status(500).json({ error: "Failed to share document" });
  }
});

// 7. GET /documents/:id/shares
// Get all current shares for a document
router.get("/:id/shares", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.getDocumentById(id);

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (doc.owner_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: "Only owner can view share settings" });
    }

    const shares = await db.getDocumentShares(id);
    return res.json({ shares });
  } catch (err) {
    console.error("[Documents] Get shares error:", err);
    return res.status(500).json({ error: "Failed to get document shares" });
  }
});

// 8. DELETE /documents/:id
// Delete document, chunks, and storage object (owner only)
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.getDocumentById(id);

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (doc.owner_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: "Only document owner can delete this file" });
    }

    // Delete from storage
    await storageService.deleteFile(doc.s3_key);

    // Delete from DB (cascades to chunks and shares)
    await db.deleteDocument(id, req.user.id);

    return res.json({
      message: `Document "${doc.filename}" and its vector indices were deleted successfully.`,
    });
  } catch (err) {
    console.error("[Documents] Delete error:", err);
    return res.status(500).json({ error: "Failed to delete document" });
  }
});

// Authenticated preview and download: storage keys are never public capabilities.
router.get("/:id/content", requireAuth, async (req, res, next) => {
  try {
    const doc = (await db.listDocumentsForUser(req.user.id)).find(
      (d) => d.id === req.params.id,
    );
    if (!doc) return res.status(404).json({ error: "Document not found" });
    const buffer = await storageService.getFileBuffer(doc.s3_key);
    res.set("Cache-Control", "private, no-store");
    if (req.query.text === "true") {
      const { text } = await extractTextFromBuffer(buffer, doc.filename);
      return res.json({ text });
    }
    const pdf = doc.filename.toLowerCase().endsWith(".pdf");
    res.set(
      "Content-Type",
      pdf ? "application/pdf" : "application/octet-stream",
    );
    const asciiName = doc.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    res.set(
      "Content-Disposition",
      `${req.query.download === "true" || !pdf ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
    );
    return res.send(buffer);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id/shares/:shareId", requireAuth, async (req, res, next) => {
  try {
    const doc = await db.getDocumentById(req.params.id);
    if (!doc || doc.owner_id !== req.user.id)
      return res.status(404).json({ error: "Document not found" });
    await db.revokeShare(req.params.id, req.params.shareId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 9. POST /documents/:id/reindex
// Trigger re-processing if a file failed or needs re-embedding
router.post("/:id/reindex", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.getDocumentById(id);

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (doc.owner_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: "Only document owner can re-index" });
    }

    if (["queued", "processing"].includes(doc.status))
      return res.status(409).json({ error: "Document is already processing" });
    await enqueueDocument(id);

    return res.json({
      message: "Re-indexing initiated.",
      status: "processing",
    });
  } catch (err) {
    console.error("[Documents] Reindex error:", err);
    return res.status(500).json({ error: "Failed to re-index document" });
  }
});

export default router;
