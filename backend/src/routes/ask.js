import express from 'express';
import { db } from '../db/db.js';
import { aiService } from '../services/ai.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /ask
 * Retrieval-Augmented Generation (RAG) Question Answering
 * Retrieves top matching chunks accessible to user, then synthesizes an answer with citations.
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { question, limit = 4 } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ error: 'Question string is required' });
    }

    const trimmedQuestion = question.trim();

    // 1. Generate question embedding vector
    const questionEmbedding = await aiService.generateEmbedding(trimmedQuestion);

    // 2. Retrieve top-k context chunks filtered by user's ACL
    const contextChunks = await db.searchSimilarChunks({
      queryEmbedding: questionEmbedding,
      userId: req.user.id,
      limit: Math.min(Math.max(parseInt(limit, 10) || 4, 1), 10)
    });

    // 3. Generate answer using AI synthesis
    const { answer, sources, llmModel } = await aiService.generateAnswer({
      question: trimmedQuestion,
      contextChunks
    });

    return res.json({
      question: trimmedQuestion,
      answer,
      sources,
      llmModel: llmModel || 'standard',
      retrievedChunksCount: contextChunks.length
    });
  } catch (err) {
    console.error('[Ask] Error executing RAG question answering:', err);
    return res.status(500).json({ error: 'Question answering failed' });
  }
});

export default router;
