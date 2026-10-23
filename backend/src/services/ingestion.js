import { db } from '../db/db.js';
import { storageService } from './storage.js';
import { extractTextFromBuffer } from './extractor.js';
import { chunkText } from './chunker.js';
import { aiService } from './ai.js';

/**
 * Ingestion Pipeline
 * Orchestrates: Download -> Extract -> Chunk -> Embed -> Database Indexing
 * Implements resilient error handling and status tracking.
 */
export async function processDocumentIngestion(documentId) {
  console.log(`[Ingestion] Starting ingestion for document: ${documentId}`);

  try {
    // 1. Mark as processing
    await db.updateDocumentStatus(documentId, 'processing');

    const doc = await db.getDocumentById(documentId);
    if (!doc) {
      throw new Error(`Document ${documentId} not found in database`);
    }

    // 2. Fetch raw file from storage (S3 / local)
    console.log(`[Ingestion] Fetching file from storage: key=${doc.s3_key}`);
    const fileBuffer = await storageService.getFileBuffer(doc.s3_key);
    if (fileBuffer.length > 25 * 1024 * 1024) throw new Error('File exceeds 25 MB');

    // 3. Extract text
    console.log(`[Ingestion] Extracting text from ${doc.filename}...`);
    const { text } = await extractTextFromBuffer(fileBuffer, doc.filename);

    if (!text || text.length === 0) {
      throw new Error('Extracted text is empty. Document contains no readable text.');
    }
    console.log(`[Ingestion] Extracted ${text.length} characters.`);

    // 4. Chunk text
    const textChunks = chunkText(text, { targetChunkSize: 450, overlapSize: 50 });
    console.log(`[Ingestion] Created ${textChunks.length} chunks.`);

    if (textChunks.length === 0) {
      throw new Error('Unable to create text chunks from document.');
    }

    // 5. Clean up any existing chunks (in case of re-processing)
    await db.deleteChunksForDocument(documentId);

    // 6. Generate embeddings and prepare rows
    console.log(`[Ingestion] Generating vector embeddings for ${textChunks.length} chunks...`);
    const chunkRows = [];
    for (const chunk of textChunks) {
      const embedding = await aiService.generateEmbedding(chunk.content);
      chunkRows.push({
        documentId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        embedding
      });
    }

    // 7. Write chunks + embeddings to database
    console.log(`[Ingestion] Storing ${chunkRows.length} chunks in database...`);
    await db.insertChunks(chunkRows);

    // 8. Mark document as ready
    await db.updateDocumentStatus(documentId, 'ready');
    console.log(`[Ingestion] Successfully indexed document ${documentId} (${doc.filename}) - Status: READY`);

    return {
      success: true,
      documentId,
      chunkCount: chunkRows.length
    };
  } catch (err) {
    console.error(`[Ingestion] Error processing document ${documentId}:`, err);
    await db.updateDocumentStatus(documentId, 'failed', err.message);
    return {
      success: false,
      documentId,
      error: err.message
    };
  }
}
