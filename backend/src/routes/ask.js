import express from "express";
import { db } from "../db/db.js";
import { aiService } from "../services/ai.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * POST /ask
 * Retrieval-Augmented Generation (RAG) Question Answering
 * Retrieves top matching chunks accessible to user, then synthesizes an answer with citations.
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const { question, limit = 4, documentId, history = [] } = req.body;

    if (
      !question ||
      typeof question !== "string" ||
      question.trim().length === 0
    ) {
      return res.status(400).json({ error: "Question string is required" });
    }

    if (
      !Array.isArray(history) ||
      history.length > 4 ||
      history.some((q) => typeof q !== "string" || q.length > 8000)
    )
      return res.status(400).json({ error: "Invalid conversation history" });
    const trimmedQuestion = question.trim();

    if (question.length > 8000)
      return res.status(400).json({ error: "Question is too long" });
    if (
      documentId &&
      !(await db.listDocumentsForUser(req.user.id)).some(
        (d) => d.id === documentId,
      )
    )
      return res.status(404).json({ error: "Document not found" });
    if (!(await db.consumeAiRequest(req.user.id)))
      return res
        .status(429)
        .json({
          error:
            "Your daily search and AI question limit has been reached. Try again tomorrow (UTC).",
        });
    // 1. Generate question embedding vector
    const questionEmbedding = await aiService.generateEmbedding(
      [...history.slice(-2), trimmedQuestion].join("\n").slice(-12000),
    );

    // 2. Retrieve top-k context chunks filtered by user's ACL
    const contextChunks = await db.searchSimilarChunks({
      queryEmbedding: questionEmbedding,
      userId: req.user.id,
      documentId,
      limit: Math.min(Math.max(parseInt(limit, 10) || 4, 1), 10),
    });

    // 3. Generate answer using AI synthesis
    const { answer, sources, llmModel } = await aiService.generateAnswer({
      question: trimmedQuestion,
      history,
      contextChunks,
    });

    return res.json({
      question: trimmedQuestion,
      answer,
      sources,
      llmModel: llmModel || "standard",
      retrievedChunksCount: contextChunks.length,
    });
  } catch (err) {
    console.error("[Ask] Error executing RAG question answering:", err);
    return res.status(500).json({ error: "Question answering failed" });
  }
});

export default router;
