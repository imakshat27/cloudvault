import express from 'express';
import crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import { db } from '../db/db.js';
import { storageService } from '../services/storage.js';
import { processDocumentIngestion } from '../services/ingestion.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Setup multer for local file uploads (storage: memory or disk)
const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB limit
});

// 1. POST /documents/upload-url
// Request an upload URL (pre-signed S3 URL in AWS mode, or local route in dev mode)
router.post('/upload-url', requireAuth, async (req, res) => {
  try {
    const { filename, fileSize, mimeType } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const sanitizedName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = path.extname(sanitizedName).toLowerCase();
    const validExts = ['.pdf', '.docx', '.txt', '.md'];

    if (!validExts.includes(ext)) {
      return res.status(400).json({
        error: `Unsupported file type: ${ext}. Supported formats: PDF, DOCX, TXT, MD`
      });
    }

    // Generate unique storage key: user-id/timestamp-random-filename
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const s3Key = `uploads/${req.user.id}/${uniqueSuffix}-${sanitizedName}`;

    // Get upload URL (S3 pre-signed URL or local endpoint)
    const { uploadUrl, storageType } = await storageService.getUploadUrl({
      key: s3Key,
      mimeType: mimeType || 'application/octet-stream'
    });

    // Create database entry with pending status
    const doc = await db.createDocument({
      ownerId: req.user.id,
      filename: sanitizedName,
      s3Key,
      fileSize: fileSize || 0,
      mimeType: mimeType || 'application/octet-stream'
    });

    return res.status(201).json({
      documentId: doc.id,
      uploadUrl,
      storageType,
      s3Key,
      expiresIn: 900 // 15 mins
    });
  } catch (err) {
    console.error('[Documents] upload-url error:', err);
    return res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// 2. PUT /documents/local-upload/:key (*)
// Local dev fallback endpoint for uploading file directly
router.put('/local-upload/*', upload.single('file'), async (req, res) => {
  try {
    const key = req.params[0];
    if (!key) {
      return res.status(400).json({ error: 'Missing storage key' });
    }

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
      return res.status(400).json({ error: 'No file content received' });
    }

    await storageService.saveLocalFile(key, buffer);
    return res.json({ success: true, key, size: buffer.length });
  } catch (err) {
    console.error('[Documents] Local upload error:', err);
    return res.status(500).json({ error: 'Failed to save local file' });
  }
});

// 3. POST /documents/:id/complete
// Frontend calls this once file upload finishes to initiate ingestion
router.post('/:id/complete', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { fileSize, mimeType } = req.body;

    const doc = await db.getDocumentById(id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (doc.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: not the owner' });
    }

    if (fileSize || mimeType) {
      await db.updateDocumentMetadata(id, { fileSize, mimeType });
    }

    // Trigger ingestion asynchronously (background execution on EC2)
    processDocumentIngestion(id).catch(err => {
      console.error(`[Documents] Background ingestion failed for ${id}:`, err);
    });

    return res.json({
      message: 'Upload completed. Document ingestion started.',
      documentId: id,
      status: 'processing'
    });
  } catch (err) {
    console.error('[Documents] Complete error:', err);
    return res.status(500).json({ error: 'Failed to complete document upload' });
  }
});

// 4. GET /documents
// List all accessible documents (owned + shared)
router.get('/', requireAuth, async (req, res) => {
  try {
    const docs = await db.listDocumentsForUser(req.user.id);
    return res.json({ documents: docs });
  } catch (err) {
    console.error('[Documents] List error:', err);
    return res.status(500).json({ error: 'Failed to retrieve documents' });
  }
});

// 5. GET /documents/:id/status
// Polled by frontend to check processing status
router.get('/:id/status', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.getDocumentById(id);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    return res.json({
      id: doc.id,
      filename: doc.filename,
      status: doc.status,
      errorMessage: doc.error_message,
      updatedAt: doc.updated_at
    });
  } catch (err) {
    console.error('[Documents] Status error:', err);
    return res.status(500).json({ error: 'Failed to fetch document status' });
  }
});

// 6. POST /documents/:id/share
// Share a document with another user by email
router.post('/:id/share', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { email, permission = 'view' } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email of user to share with is required' });
    }

    const doc = await db.getDocumentById(id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (doc.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the document owner can manage shares' });
    }

    const targetUser = await db.findUserByEmail(email.trim().toLowerCase());
    if (!targetUser) {
      return res.status(404).json({ error: `User with email "${email}" not found` });
    }

    if (targetUser.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot share a document with yourself' });
    }

    const share = await db.shareDocument({
      documentId: id,
      sharedWithUserId: targetUser.id,
      permission
    });

    return res.json({
      message: `Document successfully shared with ${email}`,
      share
    });
  } catch (err) {
    console.error('[Documents] Share error:', err);
    return res.status(500).json({ error: 'Failed to share document' });
  }
});

// 7. GET /documents/:id/shares
// Get all current shares for a document
router.get('/:id/shares', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.getDocumentById(id);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (doc.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only owner can view share settings' });
    }

    const shares = await db.getDocumentShares(id);
    return res.json({ shares });
  } catch (err) {
    console.error('[Documents] Get shares error:', err);
    return res.status(500).json({ error: 'Failed to get document shares' });
  }
});

// 8. DELETE /documents/:id
// Delete document, chunks, and storage object (owner only)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.getDocumentById(id);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (doc.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only document owner can delete this file' });
    }

    // Delete from storage
    await storageService.deleteFile(doc.s3_key);

    // Delete from DB (cascades to chunks and shares)
    await db.deleteDocument(id, req.user.id);

    return res.json({
      message: `Document "${doc.filename}" and its vector indices were deleted successfully.`
    });
  } catch (err) {
    console.error('[Documents] Delete error:', err);
    return res.status(500).json({ error: 'Failed to delete document' });
  }
});

// 9. POST /documents/:id/reindex
// Trigger re-processing if a file failed or needs re-embedding
router.post('/:id/reindex', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.getDocumentById(id);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (doc.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only document owner can re-index' });
    }

    processDocumentIngestion(id).catch(err => {
      console.error(`[Documents] Re-indexing failed for ${id}:`, err);
    });

    return res.json({ message: 'Re-indexing initiated.', status: 'processing' });
  } catch (err) {
    console.error('[Documents] Reindex error:', err);
    return res.status(500).json({ error: 'Failed to re-index document' });
  }
});

export default router;
