import fs from "node:fs/promises";
import pg from "pg";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION });
const quoteIdentifier = (value) => '"' + value.replaceAll('"', '""') + '"';
const quoteLiteral = (value) => "'" + value.replaceAll("'", "''") + "'";
// Used only by the deployment bootstrap role, never by the runtime API or indexer.
export async function provisionDatabase(client, appUser) {
  if (
    !/^[a-z_][a-z0-9_]{0,62}$/.test(appUser.username) ||
    typeof appUser.password !== "string" ||
    appUser.password.length < 24
  )
    throw new Error("Invalid application database credentials");
  await client.query("SELECT pg_advisory_lock(842139)");
  try {
    await client.query(
      await fs.readFile(
        new URL("../db/migrations/001_init.sql", import.meta.url),
        "utf8",
      ),
    );
    const exists = await client.query(
      "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1",
      [appUser.username],
    );
    if (exists.rows.some((row) => Object.values(row).some(Boolean)))
      throw new Error("Application role has unexpected privileged attributes");
    const role = quoteIdentifier(appUser.username);
    await client.query(
      `${exists.rowCount ? "ALTER" : "CREATE"} ROLE ${role} LOGIN PASSWORD ${quoteLiteral(appUser.password)}`,
    );
    const {
      rows: [row],
    } = await client.query("SELECT current_database() AS name");
    await client.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(row.name)} TO ${role}`,
    );
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    );
    await client.query(
      `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    );
  } finally {
    await client.query("SELECT pg_advisory_unlock(842139)");
  }
}
async function secret(id) {
  const result = await secrets.send(
    new GetSecretValueCommand({ SecretId: id }),
  );
  return JSON.parse(result.SecretString);
}
export async function handler(event, context) {
  let status = "SUCCESS";
  try {
    if (event.RequestType !== "Delete") {
      const properties = event.ResourceProperties;
      const [master, appUser, ca] = await Promise.all([
        secret(properties.MasterSecretArn),
        secret(properties.AppSecretArn),
        fs.readFile(new URL("../../certs/rds.pem", import.meta.url), "utf8"),
      ]);
      const client = new pg.Client({
        host: properties.Host,
        port: 5432,
        database: "cloudvault",
        user: master.username,
        password: master.password,
        ssl: { ca, rejectUnauthorized: true },
        connectionTimeoutMillis: 20000,
        query_timeout: 60000,
      });
      await client.connect();
      try {
        await provisionDatabase(client, appUser);
      } finally {
        await client.end();
      }
    }
  } catch (error) {
    status = "FAILED";
    console.error(
      JSON.stringify({
        event: "database_bootstrap_failed",
        code: error.code || "BOOTSTRAP_ERROR",
      }),
    );
  }
  const body = JSON.stringify({
    Status: status,
    Reason:
      status === "SUCCESS"
        ? "Database bootstrap complete"
        : "Database bootstrap failed; inspect the bootstrap log group",
    PhysicalResourceId:
      event.PhysicalResourceId || `${event.StackId}/${event.LogicalResourceId}`,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: true,
    Data: {},
  });
  const response = await fetch(event.ResponseURL, {
    method: "PUT",
    headers: {
      "Content-Type": "",
      "Content-Length": String(Buffer.byteLength(body)),
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error("Could not report database bootstrap status");
  if (context) context.callbackWaitsForEmptyEventLoop = false;
}
