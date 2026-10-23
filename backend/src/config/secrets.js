import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { fileURLToPath } from "node:url";
// Load secrets before importing modules that construct database pools or JWT configuration.
export async function loadSecrets() {
  if (!process.env.DB_SECRET_ARN && !process.env.APP_SECRET_ARN) return;
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  if (process.env.DB_SECRET_ARN) {
    const value = await client.send(
      new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }),
    );
    const secret = JSON.parse(value.SecretString);
    process.env.DB_USER = secret.username;
    process.env.DB_PASSWORD = secret.password;
  }
  if (process.env.APP_SECRET_ARN) {
    const value = await client.send(
      new GetSecretValueCommand({ SecretId: process.env.APP_SECRET_ARN }),
    );
    process.env.JWT_SECRET = JSON.parse(value.SecretString).jwtSecret;
  }
  process.env.DB_CA_FILE ||= fileURLToPath(
    new URL("../../certs/rds.pem", import.meta.url),
  );
}

// pg supports an async password callback, so new connections see RDS secret rotation.
export async function getDatabasePassword() {
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  const result = await client.send(
    new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }),
  );
  return JSON.parse(result.SecretString).password;
}
