import { loadSecrets } from "./config/secrets.js";
await loadSecrets();
const { startServer } = await import("./app.js");
await startServer();
