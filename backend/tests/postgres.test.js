import assert from "node:assert/strict";
import pg from "pg";
import { provisionDatabase } from "../src/bootstrap/database.js";
const connection = {
  host: process.env.PG_TEST_HOST || "127.0.0.1",
  port: Number(process.env.PG_TEST_PORT || 5432),
  database: "cloudvault_test",
  user: "postgres",
  password: process.env.PG_TEST_PASSWORD,
};
if (!connection.password)
  throw new Error("Set PG_TEST_PASSWORD for the disposable test database");
const master = new pg.Client(connection);
const appUser = {
  username: "cloudvault_app",
  password: "ci-only-app-password-with-32-characters",
};
await master.connect();
try {
  await provisionDatabase(master, appUser);
  await provisionDatabase(master, appUser);
  const app = new pg.Client({
    ...connection,
    user: appUser.username,
    password: appUser.password,
  });
  await app.connect();
  try {
    await assert.rejects(
      app.query("CREATE TABLE public.forbidden_ddl (id int)"),
      (error) => error.code === "42501",
    );
    await assert.rejects(
      app.query("CREATE ROLE forbidden_role"),
      (error) => error.code === "42501",
    );
    await assert.rejects(
      app.query("SELECT rolpassword FROM pg_authid"),
      (error) => error.code === "42501",
    );
    const inserted = await app.query(
      "INSERT INTO users (email,password_hash) VALUES ($1,$2) RETURNING id",
      ["bootstrap-check@example.com", "not-a-login-hash"],
    );
    assert.ok(inserted.rows[0].id);
    await app.query("DELETE FROM users WHERE id=$1", [inserted.rows[0].id]);
    console.log(
      "PASS: privileged schema bootstrap and restricted runtime role (CRUD allowed, DDL/role creation/password access denied)",
    );
  } finally {
    await app.end();
  }
} finally {
  await master.end();
}
