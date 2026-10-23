import { db } from '../db/db.js';
import { processDocumentIngestion } from '../services/ingestion.js';
let initialized;
export async function handler(event) {
 initialized ||= db.init();
 await initialized;
 const batchItemFailures = [];
 for (const record of event.Records || []) {
  try {
   const { documentId } = JSON.parse(record.body);
   if (!documentId) throw new Error('Missing documentId');
   const doc = await db.getDocumentById(documentId);
   if (!doc || doc.status === 'ready') continue;
   const result = await processDocumentIngestion(documentId);
   if (!result.success) throw new Error('Ingestion failed');
  } catch (error) {
   console.error(JSON.stringify({ event: 'ingestion_failure', messageId: record.messageId, error: error.message }));
   batchItemFailures.push({ itemIdentifier: record.messageId });
   // FIFO ordering: stop after the first failure and return remaining records.
   const index = event.Records.indexOf(record);
   for (const remaining of event.Records.slice(index + 1)) batchItemFailures.push({ itemIdentifier: remaining.messageId });
   break;
  }
 }
 return { batchItemFailures };
}
