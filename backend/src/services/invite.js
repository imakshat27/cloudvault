import crypto from "node:crypto";
import { config } from "../config/env.js";
export function registrationInviteCode() {
  return crypto
    .createHmac("sha256", config.jwt.secret)
    .update("cloudvault-registration-v1")
    .digest("hex")
    .slice(0, 32);
}
export function validInviteCode(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) return false;
  return crypto.timingSafeEqual(
    Buffer.from(value),
    Buffer.from(registrationInviteCode()),
  );
}
