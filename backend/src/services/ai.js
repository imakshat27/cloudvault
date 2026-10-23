import { config } from '../config/env.js';

// Vector dimension: 1024 (matches Amazon Titan Text Embeddings V2 & pgvector schema)
const EMBEDDING_DIM = 1024;

import crypto from 'crypto';

function createDeterministicEmbedding(text) {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    vector[0] = 1;
    return vector;
  }

  for (const word of words) {
    const hash = crypto.createHash('sha256').update(word).digest();
    for (let i = 0; i < 16; i++) {
      const idx = hash.readUInt16BE(i * 2) % EMBEDDING_DIM;
      const weight = ((hash[i] % 100) / 100.0) + 0.1;
      vector[idx] += weight;
    }
  }

  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vector[i] = parseFloat((vector[i] / norm).toFixed(6));
    }
  }

  return vector;
}

/**
 * Extracts a polished, concise answer from model output,
 * stripping any internal chain-of-thought analysis if present.
 */
function cleanModelOutput(rawText) {
  if (!rawText) return '';
  const text = rawText.trim();

  // If explicit answer marker exists
  const markers = ['Direct answer:', 'Direct Answer:', 'Final answer:', 'Final Answer:', 'Answer:'];
  for (const marker of markers) {
    if (text.includes(marker)) {
      return text.split(marker).pop().trim().replace(/^[*#\s]+/, '');
    }
  }

  const lines = text.split('\n');
  const answerLines = [];
  let inScratchpad = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isScratchpad = 
      trimmed.startsWith('*   User Role') ||
      trimmed.startsWith('* User Role') ||
      trimmed.startsWith('*   Role') ||
      trimmed.startsWith('* Role') ||
      trimmed.startsWith('*   Constraint') ||
      trimmed.startsWith('* Constraint') ||
      trimmed.startsWith('*   Guidelines') ||
      trimmed.startsWith('* Guidelines') ||
      trimmed.startsWith('*   User Question') ||
      trimmed.startsWith('* User Question') ||
      trimmed.startsWith('*   Context Excerpt') ||
      trimmed.startsWith('* Context Excerpt') ||
      trimmed.startsWith('*   Topic') ||
      trimmed.startsWith('* Topic') ||
      trimmed.startsWith('*   Target') ||
      trimmed.startsWith('* Target') ||
      trimmed.startsWith('*   Content') ||
      trimmed.startsWith('* Content') ||
      trimmed.startsWith('*   Source') ||
      trimmed.startsWith('* Source') ||
      trimmed.startsWith('*   Definition') ||
      trimmed.startsWith('* Definition') ||
      trimmed.startsWith('*   CloudVault usage') ||
      trimmed.startsWith('* CloudVault usage') ||
      trimmed.startsWith('*   Benefit') ||
      trimmed.startsWith('* Benefit') ||
      trimmed.startsWith('*   Input') ||
      trimmed.startsWith('* Input') ||
      trimmed.startsWith('*   Goal') ||
      trimmed.startsWith('* Goal') ||
      trimmed.startsWith('*   Draft') ||
      trimmed.startsWith('* Draft') ||
      trimmed.startsWith('*   Self-Correction') ||
      trimmed.startsWith('* Self-Correction') ||
      trimmed.startsWith('*   Check') ||
      trimmed.startsWith('* Check') ||
      trimmed.startsWith('*   Word count') ||
      trimmed.startsWith('* Word count') ||
      trimmed.startsWith('*   Instruction') ||
      trimmed.startsWith('* Instruction') ||
      trimmed.startsWith('*   Note') ||
      trimmed.startsWith('* Note') ||
      trimmed.startsWith('*   Correction') ||
      trimmed.startsWith('* Correction');

    if (!isScratchpad && inScratchpad) {
      inScratchpad = false;
    }

    if (!inScratchpad) {
      // Filter out trailing checklist / self-verification questions from Gemma
      const isChecklist = 
        trimmed.endsWith('? Yes.') || 
        trimmed.endsWith('? Yes') ||
        trimmed.startsWith('*   Only provided') ||
        trimmed.startsWith('* Only provided') ||
        trimmed.startsWith('*   Direct answer') ||
        trimmed.startsWith('* Direct answer') ||
        trimmed.startsWith('*   Bullet points?') ||
        trimmed.startsWith('* Bullet points?') ||
        trimmed.startsWith('*   Citations included?') ||
        trimmed.startsWith('* Citations included?') ||
        trimmed.startsWith('*   No scratch') ||
        trimmed.startsWith('* No scratch');

      if (!isChecklist) {
        answerLines.push(line);
      }
    }
  }

  if (answerLines.length > 0) {
    return answerLines.join('\n').replace(/^"|"$/g, '').trim();
  }

  return text;
}

/**
 * Single model invocation with timeout and output cleaning
 */
async function querySingleModel(model, prompt, apiKey, timeoutMs = 14000) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 350
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error(`Model ${model} returned no text (code: ${data.error?.code || 'empty'})`);
  }

  const cleaned = cleanModelOutput(rawText);
  if (!cleaned || cleaned.length < 5) {
    throw new Error(`Model ${model} returned empty cleaned text`);
  }

  return { text: cleaned, model };
}

/**
 * Call Gemini / Gemma API with fast parallel hedging (sub-10s response)
 */
async function callGemini(prompt, apiKey) {
  const candidateModels = [
    'gemma-4-26b-a4b-it',
    'gemini-3.5-flash-lite',
    config.gemini.model || 'gemini-3.6-flash'
  ];

  try {
    const winner = await Promise.any(
      candidateModels.map(m => querySingleModel(m, prompt, apiKey, 14000))
    );
    console.log(`[AI] Response synthesized by ${winner.model}`);
    return winner;
  } catch (err) {
    console.warn('[AI] All candidate models failed or timed out:', err.message);
    return null;
  }
}

export const aiService = {
  async generateEmbedding(text) {
    return createDeterministicEmbedding(text);
  },

  async generateEmbeddingsBatch(texts) {
    return Promise.all(texts.map(text => this.generateEmbedding(text)));
  },

  /**
   * Generates a grounded answer from context chunks using Gemini LLM.
   */
  async generateAnswer({ question, contextChunks }) {
    if (!contextChunks || contextChunks.length === 0) {
      return {
        answer: "I couldn't find any relevant information in your accessible documents to answer this question.",
        sources: []
      };
    }

    const sources = contextChunks.map(c => ({
      chunkId: c.id,
      documentId: c.document_id,
      filename: c.filename,
      chunkIndex: c.chunk_index,
      similarity: c.similarity,
      snippet: c.content.slice(0, 180) + '...'
    }));

    if (config.gemini.apiKey) {
      const contextText = contextChunks.map((c, i) => 
        `[Source ${i + 1}: ${c.filename} (Chunk #${c.chunk_index + 1})]:\n${c.content}`
      ).join('\n\n---\n\n');

      const prompt = `You are CloudVault AI, an intelligent RAG assistant integrated into an enterprise cloud storage platform.
Answer the user's question using ONLY the provided document excerpts below.

Guidelines:
1. Ground your answer strictly in the provided excerpts.
2. Directly answer the question with clear, concise formatting (use bullet points where appropriate).
3. Explicitly reference or cite the source documents (e.g. "[Source 1: filename]") when providing key facts.
4. If the provided excerpts do not contain enough information to answer the question, clearly state that the answer is not found in the uploaded documents.

Context Excerpts:
====================================
${contextText}
====================================

User Question: ${question}

Provide your direct answer below (do not output scratchpad notes):
Direct Answer:`;

      const result = await callGemini(prompt, config.gemini.apiKey);
      if (result) {
        return {
          answer: result.text,
          sources,
          llmModel: result.model
        };
      }
    }

    // Fallback if AI provider is unavailable
    const topChunk = contextChunks[0];
    const preview = topChunk.content.length > 250 ? topChunk.content.slice(0, 250) + '...' : topChunk.content;
    const answer = `Based on your document "${topChunk.filename}" (chunk #${topChunk.chunk_index + 1}):\n\n"${preview}"`;

    return {
      answer,
      sources
    };
  }
};
