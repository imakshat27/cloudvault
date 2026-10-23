import crypto from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { config } from '../config/env.js';
import { db } from '../db/db.js';
import { processDocumentIngestion } from './ingestion.js';
const sqs = new SQSClient({ region: config.aws.region });
export async function enqueueDocument(documentId) {
 if (!await db.claimForQueue(documentId)) { const error = new Error('Document is already queued or processing'); error.status = 409; throw error; }
 if (config.aws.queueUrl) {
  try {
   await sqs.send(new SendMessageCommand({ QueueUrl: config.aws.queueUrl, MessageBody: JSON.stringify({ documentId }),
    ...(config.aws.queueUrl.endsWith('.fifo') ? { MessageGroupId: documentId, MessageDeduplicationId: crypto.randomUUID() } : {}) }));
  } catch (error) { await db.updateDocumentStatus(documentId, 'failed', 'Could not queue document. Retry indexing.'); throw error; }
 } else {
  setImmediate(() => processDocumentIngestion(documentId).catch(error => console.error('[Ingestion]', error.message)));
 }
}
