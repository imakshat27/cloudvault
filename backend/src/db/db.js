import pg from "pg";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { config } from "../config/env.js";

const { Pool } = pg;

// Calculate cosine similarity between two 1D vectors
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// -------------------------------------------------------------
// POSTGRESQL + PGVECTOR ADAPTER
// -------------------------------------------------------------
class PostgresAdapter {
  constructor() {
    this.pool = new Pool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      ssl: config.db.ssl,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }

  async init() {
    console.log(
      `[DB] Connecting to PostgreSQL at ${config.db.host}:${config.db.port}...`,
    );
    const client = await this.pool.connect();
    try {
      if (!config.db.migrate) {
        await client.query("SELECT 1");
        return;
      }
      // Serialize schema setup across API replicas and Lambda cold starts.
      await client.query("SELECT pg_advisory_lock(842139)");
      // Enable pgvector and uuid
      await client.query(`CREATE EXTENSION IF NOT EXISTS "vector";`);
      await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

      // Run 001_init.sql
      const sqlPath = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        "migrations/001_init.sql",
      );
      if (fs.existsSync(sqlPath)) {
        const sql = fs.readFileSync(sqlPath, "utf8");
        await client.query(sql);
      }
      console.log(
        "[DB] PostgreSQL + pgvector connected and initialized successfully.",
      );
    } finally {
      if (config.db.migrate)
        await client.query("SELECT pg_advisory_unlock(842139)");
      client.release();
    }
  }

  async healthcheck() {
    await this.pool.query("SELECT 1");
  }

  async listConversations(userId) {
    return (
      await this.pool.query(
        "SELECT id,title,created_at,updated_at,jsonb_array_length(messages) AS message_count FROM conversations WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 100",
        [userId],
      )
    ).rows;
  }
  async getConversation(id, userId) {
    return (
      (
        await this.pool.query(
          "SELECT * FROM conversations WHERE id=$1 AND owner_id=$2",
          [id, userId],
        )
      ).rows[0] || null
    );
  }
  async createConversation(userId, title) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        userId,
      ]);
      const result = await client.query(
        "INSERT INTO conversations (owner_id,title) SELECT $1,$2 WHERE (SELECT count(*) FROM conversations WHERE owner_id=$1)<100 RETURNING *",
        [userId, title],
      );
      if (!result.rowCount)
        throw Object.assign(
          new Error(
            "You have 100 conversations. Delete an old chat before starting another.",
          ),
          { status: 429 },
        );
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async appendConversation(id, userId, messages) {
    const result = await this.pool.query(
      "UPDATE conversations SET messages=messages || $3::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND owner_id=$2 AND jsonb_array_length(messages)<=198 RETURNING id",
      [id, userId, JSON.stringify(messages)],
    );
    if (!result.rowCount)
      throw Object.assign(
        new Error(
          "This conversation is full or was deleted. Start a new conversation.",
        ),
        { status: 409 },
      );
  }
  async deleteConversation(id, userId) {
    return (
      (
        await this.pool.query(
          "DELETE FROM conversations WHERE id=$1 AND owner_id=$2 RETURNING id",
          [id, userId],
        )
      ).rowCount > 0
    );
  }

  // User queries
  async createUser({ email, passwordHash }) {
    const res = await this.pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at`,
      [email.toLowerCase(), passwordHash],
    );
    return res.rows[0];
  }

  async findUserByEmail(email) {
    const res = await this.pool.query(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1)`,
      [email],
    );
    return res.rows[0] || null;
  }

  async findUserById(id) {
    const res = await this.pool.query(
      `SELECT id, email, created_at FROM users WHERE id = $1`,
      [id],
    );
    return res.rows[0] || null;
  }

  async claimForQueue(id) {
    const result = await this.pool.query(
      "UPDATE documents SET status = 'queued', error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status NOT IN ('queued', 'processing') RETURNING id",
      [id],
    );
    return result.rowCount > 0;
  }

  // Document queries
  async createDocument({ ownerId, filename, s3Key, fileSize, mimeType }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        ownerId,
      ]);
      const {
        rows: [usage],
      } = await client.query(
        "SELECT COUNT(*)::int AS files, COALESCE(SUM(file_size),0)::bigint AS bytes FROM documents WHERE owner_id = $1",
        [ownerId],
      );
      if (
        usage.files >= config.limits.maxFiles ||
        Number(usage.bytes) + fileSize > config.limits.maxStorageBytes
      ) {
        const error = new Error(
          "Your workspace storage limit has been reached. Delete a file before uploading another.",
        );
        error.status = 429;
        throw error;
      }
      const result = await client.query(
        `INSERT INTO documents (owner_id,filename,s3_key,file_size,mime_type,status) VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`,
        [ownerId, filename, s3Key, fileSize, mimeType],
      );
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async consumeAiRequest(userId) {
    const result = await this.pool.query(
      `INSERT INTO daily_usage (user_id,usage_date,request_count) VALUES ($1,CURRENT_DATE,1)
      ON CONFLICT (user_id,usage_date) DO UPDATE SET request_count = daily_usage.request_count + 1
      WHERE daily_usage.request_count < $2 RETURNING request_count`,
      [userId, config.limits.dailyRequests],
    );
    return result.rowCount > 0;
  }

  async getDocumentById(id) {
    const res = await this.pool.query(`SELECT * FROM documents WHERE id = $1`, [
      id,
    ]);
    return res.rows[0] || null;
  }

  async updateDocumentStatus(id, status, errorMessage = null) {
    const res = await this.pool.query(
      `UPDATE documents SET status = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
      [status, errorMessage, id],
    );
    return res.rows[0];
  }

  async updateDocumentMetadata(id, { fileSize, mimeType }) {
    const res = await this.pool.query(
      `UPDATE documents SET file_size = COALESCE($1, file_size), mime_type = COALESCE($2, mime_type), updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
      [fileSize ?? null, mimeType ?? null, id],
    );
    return res.rows[0];
  }

  async listDocumentsForUser(userId) {
    // Return all documents owned by user OR shared with user
    const res = await this.pool.query(
      `SELECT d.*, 
              CASE WHEN d.owner_id = $1 THEN true ELSE false END as is_owner,
              ds.permission as share_permission,
              u.email as owner_email,
              (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id)::int as chunk_count
       FROM documents d
       JOIN users u ON d.owner_id = u.id
       LEFT JOIN document_shares ds ON d.id = ds.document_id AND ds.shared_with_user_id = $1
       WHERE d.owner_id = $1 OR ds.shared_with_user_id = $1
       ORDER BY d.uploaded_at DESC`,
      [userId],
    );
    return res.rows;
  }

  async deleteDocument(id, ownerId) {
    const res = await this.pool.query(
      `DELETE FROM documents WHERE id = $1 AND owner_id = $2 RETURNING *`,
      [id, ownerId],
    );
    return res.rows[0] || null;
  }

  // Share queries
  async shareDocument({ documentId, sharedWithUserId, permission = "view" }) {
    const res = await this.pool.query(
      `INSERT INTO document_shares (document_id, shared_with_user_id, permission)
       VALUES ($1, $2, $3)
       ON CONFLICT (document_id, shared_with_user_id) 
       DO UPDATE SET permission = EXCLUDED.permission
       RETURNING *`,
      [documentId, sharedWithUserId, permission],
    );
    return res.rows[0];
  }

  async getDocumentShares(documentId) {
    const res = await this.pool.query(
      `SELECT ds.*, u.email as shared_with_email
       FROM document_shares ds
       JOIN users u ON ds.shared_with_user_id = u.id
       WHERE ds.document_id = $1`,
      [documentId],
    );
    return res.rows;
  }

  async revokeShare(documentId, shareId) {
    await this.pool.query(
      "DELETE FROM document_shares WHERE id = $1 AND document_id = $2",
      [shareId, documentId],
    );
  }

  // Chunks & Vector storage
  async insertChunks(chunks) {
    if (!chunks || chunks.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const chunk of chunks) {
        // format vector for pgvector: '[0.1, 0.2, ...]'
        const vectorStr = `[${chunk.embedding.join(",")}]`;
        await client.query(
          `INSERT INTO chunks (document_id, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4::vector)`,
          [chunk.documentId, chunk.chunkIndex, chunk.content, vectorStr],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteChunksForDocument(documentId) {
    await this.pool.query(`DELETE FROM chunks WHERE document_id = $1`, [
      documentId,
    ]);
  }

  // Vector similarity search with strict Access Control (ACL)
  async searchSimilarChunks({
    queryEmbedding,
    userId,
    limit = 5,
    documentId = null,
  }) {
    const vectorStr = `[${queryEmbedding.join(",")}]`;
    const res = await this.pool.query(
      `SELECT c.id, c.document_id, c.chunk_index, c.content,
              d.filename, d.owner_id,
              1 - (c.embedding <=> $1::vector) as similarity
       FROM chunks c
       JOIN documents d ON c.document_id = d.id
       LEFT JOIN document_shares ds ON d.id = ds.document_id AND ds.shared_with_user_id = $2
       WHERE (d.owner_id = $2 OR ds.shared_with_user_id = $2)
         AND d.status = 'ready' AND ($4::uuid IS NULL OR d.id = $4::uuid)
       ORDER BY c.embedding <=> $1::vector ASC
       LIMIT $3`,
      [vectorStr, userId, limit, documentId],
    );
    return res.rows;
  }
}

// -------------------------------------------------------------
// LOCAL EMBEDDED FILE DB ADAPTER (Zero-dependency fallback)
// -------------------------------------------------------------
class LocalEmbeddedAdapter {
  constructor() {
    this.dataFile = path.resolve(
      config.paths.dataDir,
      "cloudvault_local_db.json",
    );
    this.data = {
      users: [],
      documents: [],
      document_shares: [],
      chunks: [],
    };
  }

  async init() {
    if (!fs.existsSync(config.paths.dataDir)) {
      fs.mkdirSync(config.paths.dataDir, { recursive: true });
    }
    if (fs.existsSync(this.dataFile)) {
      try {
        const raw = fs.readFileSync(this.dataFile, "utf8");
        this.data = JSON.parse(raw);
        console.log(
          `[DB] Local embedded database loaded from ${this.dataFile}`,
        );
      } catch (err) {
        console.warn(
          "[DB] Failed to read local db file, initializing fresh store.",
        );
        this._save();
      }
    } else {
      this._save();
      console.log(
        `[DB] Created fresh local embedded database at ${this.dataFile}`,
      );
    }
  }

  _save() {
    fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2), "utf8");
  }

  async healthcheck() {
    return true;
  }

  async listConversations(userId) {
    return (this.data.conversations || [])
      .filter((c) => c.owner_id === userId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 100)
      .map(({ messages, ...c }) => ({ ...c, message_count: messages.length }));
  }
  async getConversation(id, userId) {
    const c = (this.data.conversations || []).find(
      (c) => c.id === id && c.owner_id === userId,
    );
    return c ? structuredClone(c) : null;
  }
  async createConversation(userId, title) {
    this.data.conversations ||= [];
    if (
      this.data.conversations.filter((c) => c.owner_id === userId).length >= 100
    )
      throw Object.assign(
        new Error(
          "You have 100 conversations. Delete an old chat before starting another.",
        ),
        { status: 429 },
      );
    const c = {
      id: crypto.randomUUID(),
      owner_id: userId,
      title,
      messages: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.conversations.push(c);
    this._save();
    return structuredClone(c);
  }
  async appendConversation(id, userId, messages) {
    const c = (this.data.conversations || []).find(
      (c) => c.id === id && c.owner_id === userId,
    );
    if (!c || c.messages.length > 198)
      throw Object.assign(
        new Error(
          "This conversation is full or was deleted. Start a new conversation.",
        ),
        { status: 409 },
      );
    c.messages.push(...messages);
    c.updated_at = new Date().toISOString();
    this._save();
  }
  async deleteConversation(id, userId) {
    const before = (this.data.conversations || []).length;
    this.data.conversations = (this.data.conversations || []).filter(
      (c) => !(c.id === id && c.owner_id === userId),
    );
    this._save();
    return this.data.conversations.length < before;
  }

  // User queries
  async createUser({ email, passwordHash }) {
    const existing = this.data.users.find(
      (u) => u.email.toLowerCase() === email.toLowerCase(),
    );
    if (existing) {
      const err = new Error("User already exists");
      err.code = "23505"; // PostgreSQL unique violation code
      throw err;
    }
    const user = {
      id: crypto.randomUUID(),
      email: email.toLowerCase(),
      password_hash: passwordHash,
      created_at: new Date().toISOString(),
    };
    this.data.users.push(user);
    this._save();
    return { id: user.id, email: user.email, created_at: user.created_at };
  }

  async findUserByEmail(email) {
    const user = this.data.users.find(
      (u) => u.email.toLowerCase() === email.toLowerCase(),
    );
    return user || null;
  }

  async findUserById(id) {
    const user = this.data.users.find((u) => u.id === id);
    if (!user) return null;
    return { id: user.id, email: user.email, created_at: user.created_at };
  }

  async claimForQueue(id) {
    const doc = this.data.documents.find((d) => d.id === id);
    if (!doc || ["queued", "processing"].includes(doc.status)) return false;
    doc.status = "queued";
    doc.error_message = null;
    doc.updated_at = new Date().toISOString();
    this._save();
    return true;
  }

  // Document queries
  async createDocument({ ownerId, filename, s3Key, fileSize, mimeType }) {
    const owned = this.data.documents.filter((d) => d.owner_id === ownerId);
    if (
      owned.length >= config.limits.maxFiles ||
      owned.reduce((total, d) => total + Number(d.file_size), 0) + fileSize >
        config.limits.maxStorageBytes
    ) {
      const error = new Error(
        "Your workspace storage limit has been reached. Delete a file before uploading another.",
      );
      error.status = 429;
      throw error;
    }
    const doc = {
      id: crypto.randomUUID(),
      owner_id: ownerId,
      filename,
      s3_key: s3Key,
      file_size: fileSize || 0,
      mime_type: mimeType || "application/octet-stream",
      status: "pending",
      error_message: null,
      uploaded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.documents.push(doc);
    this._save();
    return doc;
  }

  async consumeAiRequest(userId) {
    this.data.daily_usage ||= [];
    const today = new Date().toISOString().slice(0, 10);
    this.data.daily_usage = this.data.daily_usage.filter(
      (x) => x.date === today,
    );
    let usage = this.data.daily_usage.find((x) => x.userId === userId);
    if (!usage) {
      usage = { userId, date: today, count: 0 };
      this.data.daily_usage.push(usage);
    }
    if (usage.count >= config.limits.dailyRequests) return false;
    usage.count++;
    this._save();
    return true;
  }

  async getDocumentById(id) {
    return this.data.documents.find((d) => d.id === id) || null;
  }

  async updateDocumentStatus(id, status, errorMessage = null) {
    const doc = this.data.documents.find((d) => d.id === id);
    if (doc) {
      doc.status = status;
      doc.error_message = errorMessage;
      doc.updated_at = new Date().toISOString();
      this._save();
    }
    return doc || null;
  }

  async updateDocumentMetadata(id, { fileSize, mimeType }) {
    const doc = this.data.documents.find((d) => d.id === id);
    if (doc) {
      if (fileSize !== undefined) doc.file_size = fileSize;
      if (mimeType !== undefined) doc.mime_type = mimeType;
      doc.updated_at = new Date().toISOString();
      this._save();
    }
    return doc || null;
  }

  async listDocumentsForUser(userId) {
    const userShares = this.data.document_shares.filter(
      (s) => s.shared_with_user_id === userId,
    );
    const sharedDocIds = new Set(userShares.map((s) => s.document_id));

    return this.data.documents
      .filter((d) => d.owner_id === userId || sharedDocIds.has(d.id))
      .map((d) => {
        const owner = this.data.users.find((u) => u.id === d.owner_id);
        const share = userShares.find((s) => s.document_id === d.id);
        const chunkCount = this.data.chunks.filter(
          (c) => c.document_id === d.id,
        ).length;
        return {
          ...d,
          is_owner: d.owner_id === userId,
          share_permission: share ? share.permission : null,
          owner_email: owner ? owner.email : "unknown",
          chunk_count: chunkCount,
        };
      })
      .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
  }

  async deleteDocument(id, ownerId) {
    const index = this.data.documents.findIndex(
      (d) => d.id === id && d.owner_id === ownerId,
    );
    if (index === -1) return null;
    const [deleted] = this.data.documents.splice(index, 1);
    // Cascade delete shares and chunks
    this.data.document_shares = this.data.document_shares.filter(
      (s) => s.document_id !== id,
    );
    this.data.chunks = this.data.chunks.filter((c) => c.document_id !== id);
    this._save();
    return deleted;
  }

  // Share queries
  async shareDocument({ documentId, sharedWithUserId, permission = "view" }) {
    let share = this.data.document_shares.find(
      (s) =>
        s.document_id === documentId &&
        s.shared_with_user_id === sharedWithUserId,
    );
    if (share) {
      share.permission = permission;
    } else {
      share = {
        id: crypto.randomUUID(),
        document_id: documentId,
        shared_with_user_id: sharedWithUserId,
        permission,
        created_at: new Date().toISOString(),
      };
      this.data.document_shares.push(share);
    }
    this._save();
    return share;
  }

  async getDocumentShares(documentId) {
    return this.data.document_shares
      .filter((s) => s.document_id === documentId)
      .map((s) => {
        const user = this.data.users.find(
          (u) => u.id === s.shared_with_user_id,
        );
        return {
          ...s,
          shared_with_email: user ? user.email : "unknown",
        };
      });
  }

  async revokeShare(documentId, shareId) {
    this.data.document_shares = this.data.document_shares.filter(
      (s) => !(s.id === shareId && s.document_id === documentId),
    );
    this._save();
  }

  // Chunks & Vector storage
  async insertChunks(chunks) {
    if (!chunks || chunks.length === 0) return;
    for (const chunk of chunks) {
      this.data.chunks.push({
        id: crypto.randomUUID(),
        document_id: chunk.documentId,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        embedding: chunk.embedding,
        created_at: new Date().toISOString(),
      });
    }
    this._save();
  }

  async deleteChunksForDocument(documentId) {
    this.data.chunks = this.data.chunks.filter(
      (c) => c.document_id !== documentId,
    );
    this._save();
  }

  // Vector similarity search with strict Access Control (ACL)
  async searchSimilarChunks({
    queryEmbedding,
    userId,
    limit = 5,
    documentId = null,
  }) {
    // 1. Identify accessible document IDs
    const userShares = this.data.document_shares.filter(
      (s) => s.shared_with_user_id === userId,
    );
    const accessibleDocIds = new Set(
      this.data.documents
        .filter(
          (d) =>
            (d.owner_id === userId ||
              userShares.some((s) => s.document_id === d.id)) &&
            d.status === "ready" &&
            (!documentId || d.id === documentId),
        )
        .map((d) => d.id),
    );

    // 2. Score chunks belonging to accessible documents
    const scoredChunks = [];
    for (const chunk of this.data.chunks) {
      if (accessibleDocIds.has(chunk.document_id)) {
        const doc = this.data.documents.find((d) => d.id === chunk.document_id);
        const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
        scoredChunks.push({
          id: chunk.id,
          document_id: chunk.document_id,
          chunk_index: chunk.chunk_index,
          content: chunk.content,
          filename: doc ? doc.filename : "document",
          owner_id: doc ? doc.owner_id : null,
          similarity: parseFloat(similarity.toFixed(5)),
        });
      }
    }

    // 3. Sort by highest similarity
    scoredChunks.sort((a, b) => b.similarity - a.similarity);
    return scoredChunks.slice(0, limit);
  }
}

// -------------------------------------------------------------
// SELECT ACTIVE DATABASE ADAPTER
// -------------------------------------------------------------
let dbInstance;

if (config.db.host) {
  console.log("[DB] Configured for PostgreSQL (RDS / Local)");
  dbInstance = new PostgresAdapter();
} else {
  console.log(
    "[DB] No PostgreSQL host provided; activating local embedded DB engine",
  );
  dbInstance = new LocalEmbeddedAdapter();
}

export const db = dbInstance;
