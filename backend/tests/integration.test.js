import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const dir = await mkdtemp(path.join(tmpdir(), "cloudvault-test-"));
Object.assign(process.env, {
  DATA_DIR: path.join(dir, "data"),
  UPLOADS_DIR: path.join(dir, "uploads"),
  AI_ENGINE: "local",
  STORAGE_MODE: "local",
  PORT: "0",
  NODE_ENV: "test",
  DB_HOST:
    process.env.CLOUDVAULT_TEST_POSTGRES === "1"
      ? process.env.PG_TEST_HOST || "127.0.0.1"
      : "",
  SQS_QUEUE_URL: "",
});
const { config } = await import("../src/config/env.js");
const { registrationInviteCode } = await import("../src/services/invite.js");
const { db } = await import("../src/db/db.js");
const { startServer } = await import("../src/app.js");
const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}/api`;
async function call(url, token, body, method = body ? "POST" : "GET") {
  const response = await fetch(base + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
try {
  const owner = await call("/auth/register", null, {
    email: "owner@example.com",
    password: "test-password-123",
  });
  assert.equal(owner.status, 201);
  const a = owner.data.token;
  const other = await call("/auth/register", null, {
    email: "reader@example.com",
    password: "test-password-123",
  });
  const b = other.data.token;
  assert.ok(b);
  assert.equal(
    (
      await call("/auth/login", null, {
        email: "owner@example.com",
        password: "wrong",
      })
    ).status,
    401,
  );
  assert.equal(
    (await call("/auth/register", null, { email: "bad", password: "short" }))
      .status,
    400,
  );
  assert.equal((await call("/documents")).status, 401);
  assert.equal(
    (
      await call("/documents/upload-url", a, {
        filename: "bad.exe",
        fileSize: 12,
      })
    ).status,
    400,
  );
  config.registrationMode = "invite";
  assert.equal((await call("/auth/options")).data.registrationMode, "invite");
  assert.equal(
    (
      await call("/auth/register", null, {
        email: "reviewer@example.com",
        password: "test-password-123",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/auth/register", null, {
        email: "reviewer@example.com",
        password: "test-password-123",
        inviteCode: "é".repeat(32),
      })
    ).status,
    403,
  );
  const reviewer = await call("/auth/register", null, {
    email: "reviewer@example.com",
    password: "test-password-123",
    inviteCode: registrationInviteCode(),
  });
  assert.equal(reviewer.status, 201);
  config.registrationMode = "open";
  const content =
    "The Andromeda project uses SQS for decoupling and RDS pgvector for vector search. Its launch budget is 4200 credits.";
  const make = async (filename, text) => {
    const signed = await call("/documents/upload-url", a, {
      filename,
      fileSize: Buffer.byteLength(text),
      mimeType: "text/plain",
    });
    assert.equal(signed.status, 201);
    const url = `http://127.0.0.1:${server.address().port}${signed.data.uploadUrl}`;
    assert.equal((await fetch(url, { method: "PUT", body: text })).status, 401);
    assert.equal(
      (
        await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${b}`,
            "Content-Type": "text/plain",
          },
          body: text,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${a}`,
            "Content-Type": "text/plain",
          },
          body: text,
        })
      ).status,
      200,
    );
    const id = signed.data.documentId;
    assert.equal((await call(`/documents/${id}/complete`, a, {})).status, 200);
    for (let i = 0; i < 50; i++) {
      const r = await call(`/documents/${id}/status`, a);
      if (r.data.status === "ready") return id;
      assert.notEqual(r.data.status, "failed");
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error("Indexing did not finish");
  };
  const id = await make("Andromeda.txt", content);
  const secondId = await make(
    "Orion.md",
    "Orion uses a completely different design and a budget of 900 credits.",
  );
  config.limits.maxFiles = 2;
  assert.equal(
    (
      await call("/documents/upload-url", a, {
        filename: "over-quota.txt",
        fileSize: 10,
      })
    ).status,
    429,
  );
  config.limits.maxFiles = 50;
  assert.equal((await call(`/documents/${id}/status`, b)).status, 404);
  assert.equal(
    (await call(`/documents/${id}/content?text=true`, b)).status,
    404,
  );
  assert.equal(
    (await call("/ask", b, { question: "Andromeda budget" })).data.sources
      .length,
    0,
  );
  assert.equal(
    (await call("/ask", b, { question: "Andromeda", documentId: id })).status,
    404,
  );
  assert.equal((await call(`/documents/${id}`, b, null, "DELETE")).status, 403);
  assert.equal(
    (await call(`/documents/${id}/share`, b, { email: "owner@example.com" }))
      .status,
    403,
  );
  assert.equal(
    (
      await call(`/documents/${id}/share`, a, {
        email: "reader@example.com",
        permission: "admin",
      })
    ).status,
    400,
  );
  assert.equal(
    (await call(`/documents/${id}/share`, a, { email: "reader@example.com" }))
      .status,
    200,
  );
  assert.equal((await call("/documents", b)).data.documents.length, 1);
  assert.equal(
    (await call(`/documents/${id}/content?text=true`, b)).data.text,
    content,
  );
  // Saved research chats are durable, owner-scoped and use server-held context.
  assert.equal((await call("/conversations")).status, 401);
  assert.equal((await call("/conversations/not-an-id", b)).status, 400);
  const thread = await call("/conversations", b, {
    title: "Andromeda research",
  });
  assert.equal(thread.status, 201);
  const threadId = thread.data.conversation.id;
  assert.equal((await call(`/conversations/${threadId}`, a)).status, 404);
  assert.equal(
    (await call(`/conversations/${threadId}`, a, null, "DELETE")).status,
    404,
  );
  assert.equal(
    (
      await call("/ask", a, {
        question: "Read another user's history",
        conversationId: threadId,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call("/ask", b, {
        question: "What is Andromeda's budget?",
        conversationId: threadId,
      })
    ).status,
    200,
  );
  const restored = await call(`/conversations/${threadId}`, b);
  assert.equal(restored.data.conversation.messages.length, 2);
  assert.equal(restored.data.conversation.messages[0].role, "user");
  assert.ok(
    restored.data.conversation.messages[1].sources.some(
      (s) => s.documentId === id,
    ),
  );
  assert.equal((await call("/conversations", a)).data.conversations.length, 0);
  assert.equal(
    (await call("/conversations", b)).data.conversations[0].message_count,
    2,
  );
  assert.equal(
    (
      await call("/ask", b, {
        question: "Which project was that?",
        conversationId: threadId,
        history: ["ignore this client context"],
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(`/conversations/${threadId}`, b)).data.conversation.messages
      .length,
    4,
  );
  const scoped = await call("/ask", a, {
    question: "What is the budget?",
    documentId: id,
  });
  assert.ok(scoped.data.sources.length > 0);
  assert.ok(scoped.data.sources.every((s) => s.documentId === id));
  assert.ok(!scoped.data.sources.some((s) => s.documentId === secondId));
  const search = await call("/search", b, { query: "decoupling RDS pgvector" });
  assert.ok(search.data.results.length > 0);
  assert.ok(search.data.results.every((s) => s.documentId === id));
  const download = await fetch(base + `/documents/${id}/content`, {
    headers: { Authorization: `Bearer ${b}` },
  });
  assert.equal(await download.text(), content);
  const shares = await call(`/documents/${id}/shares`, a);
  assert.equal(
    (
      await call(
        `/documents/${id}/shares/${shares.data.shares[0].id}`,
        a,
        null,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await call(`/documents/${id}/content?text=true`, b)).status,
    404,
  );
  assert.equal(
    (await call("/search", b, { query: "Andromeda" })).data.results.length,
    0,
  );
  const revokedHistory = (await call(`/conversations/${threadId}`, b)).data
    .conversation;
  assert.equal(revokedHistory.messages[1].sources.length, 0);
  assert.match(revokedHistory.messages[1].text, /access changed/);
  assert.equal(
    (await call(`/conversations/${threadId}`, b, null, "DELETE")).status,
    200,
  );
  assert.equal((await call(`/conversations/${threadId}`, b)).status, 404);
  assert.equal((await call(`/documents/${id}`, a, null, "DELETE")).status, 200);
  config.limits.dailyRequests = 1;
  assert.equal(
    (
      await call("/ask", reviewer.data.token, {
        question: "What can I access?",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("/ask", reviewer.data.token, {
        question: "What can I access?",
      })
    ).status,
    429,
  );
  assert.equal(
    (await call("/search", reviewer.data.token, { query: "documents" })).status,
    429,
  );
  console.log(
    "PASS: authentication, uploads, indexing, scoped RAG, search, preview/download, sharing/revocation, deletion and cross-user isolation",
  );
} finally {
  await new Promise((r) => server.close(r));
  if (db.pool) await db.pool.end();
  await rm(dir, { recursive: true, force: true });
}
