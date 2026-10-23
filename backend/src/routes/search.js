import express from 'express';
import { db } from '../db/db.js';
import { aiService } from '../services/ai.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /search
 * Semantic Vector Search across documents accessible to the authenticated user.
 * Access Control (ACL) is enforced at the database query layer.
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query string is required' });
    }

    if (query.length > 8000) return res.status(400).json({ error: 'Query is too long' });
    const trimmedQuery = query.trim();

    // 1. Generate query embedding vector (1024-dim)
    const queryEmbedding = await aiService.generateEmbedding(trimmedQuery);

    // 2. Perform vector similarity search filtered by user's ACL
    const results = await db.searchSimilarChunks({
      queryEmbedding,
      userId: req.user.id,
      limit: Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20)
    });

    return res.json({
      query: trimmedQuery,
      matchCount: results.length,
      results: results.map(r => ({
        id: r.id,
        documentId: r.document_id,
        filename: r.filename,
        chunkIndex: r.chunk_index,
        content: r.content,
        similarity: r.similarity
      }))
    });
  } catch (err) {
    console.error('[Search] Error executing semantic search:', err);
    return res.status(500).json({ error: 'Semantic search failed' });
  }
});

export default router;
