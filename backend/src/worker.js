import { loadSecrets } from './config/secrets.js';
let worker;
export async function handler(event) {
 worker ||= loadSecrets().then(() => import('./workers/ingest.js'));
 return (await worker).handler(event);
}
