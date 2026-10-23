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
  DB_HOST: "",
  SQS_QUEUE_URL: "",
});
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
  assert.equal((await call(`/documents/${id}`, a, null, "DELETE")).status, 200);
  console.log(
    "PASS: authentication, uploads, indexing, scoped RAG, search, preview/download, sharing/revocation, deletion and cross-user isolation",
  );
} finally {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
}
