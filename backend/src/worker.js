import { loadSecrets } from "./config/secrets.js";
let worker;
export async function handler(event, context) {
  if (context) context.callbackWaitsForEmptyEventLoop = false;
  worker ||= loadSecrets()
    .then(() => import("./workers/ingest.js"))
    .catch((error) => {
      worker = undefined;
      throw error;
    });
  return (await worker).handler(event, context);
}
