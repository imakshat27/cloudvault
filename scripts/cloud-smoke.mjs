// Run only against your own disposable review environment.
// CLOUDVAULT_URL=https://your-host CV_INVITE_CODE=... node scripts/cloud-smoke.mjs
// Secrets and generated test credentials are never printed or persisted.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const base = process.env.CLOUDVAULT_URL?.replace(/\/$/, '');
assert.ok(base?.startsWith('https://'), 'Set CLOUDVAULT_URL to your HTTPS review host');
const inviteCode = process.env.CV_INVITE_CODE;
assert.ok(inviteCode, 'Set CV_INVITE_CODE privately');
const nonce = randomBytes(8).toString('hex');
const password = randomBytes(24).toString('hex');
async function request(route, token, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${base}/api${route}`, {
    method,
    headers: {'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})},
    ...(body ? {body:JSON.stringify(body)} : {}),
    signal:AbortSignal.timeout(120000),
  });
  return {status:response.status, data:await response.json()};
}
function expect(result, status, label) {
  assert.equal(result.status,status,`${label}: unexpected HTTP status`);
  return result.data;
}
const health = expect(await request('/health'),200,'health');
assert.equal(health.aiEngine,'bedrock');
assert.equal(health.storageMode,'AWS S3');
assert.equal(expect(await request('/auth/options'),200,'auth options').registrationMode,'invite');
expect(await request('/documents'),401,'anonymous file access');
expect(await request('/auth/register',null,{email:`blocked-${nonce}@example.test`,password}),403,'uninvited signup');
const ownerEmail=`smoke-owner-${nonce}@example.test`;
const readerEmail=`smoke-reader-${nonce}@example.test`;
const owner=expect(await request('/auth/register',null,{email:ownerEmail,password,inviteCode}),201,'owner registration').token;
const reader=expect(await request('/auth/register',null,{email:readerEmail,password,inviteCode}),201,'reader registration').token;
expect(await request('/auth/login',null,{email:ownerEmail,password}),200,'login');
console.log('PASS HTTPS, cloud configuration, invitation gate, registration and login');
let documentId;
try {
  const content='The Aurora review project has a launch budget of 7319 credits. Its coordinator is Mira. SQS decouples document ingestion and RDS pgvector stores the semantic vectors.';
  const upload=expect(await request('/documents/upload-url',owner,{filename:`disposable-smoke-${nonce}.txt`,fileSize:Buffer.byteLength(content)}),201,'presign');
  documentId=upload.documentId;
  assert.equal(upload.storageType,'s3');
  const put=await fetch(upload.uploadUrl,{method:'PUT',headers:{'Content-Type':upload.mimeType,'If-None-Match':'*'},body:content,signal:AbortSignal.timeout(60000)});
  assert.equal(put.status,200,'S3 PUT');
  expect(await request(`/documents/${documentId}/complete`,owner,{}),200,'enqueue');
  let ready=false;
  for(let i=0;i<90;i++) {
    const state=expect(await request(`/documents/${documentId}/status`,owner),200,'ingestion status');
    assert.notEqual(state.status,'failed',`Ingestion failed: ${state.errorMessage || 'inspect worker logs'}`);
    if(state.status==='ready'){ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,4000));
  }
  assert.ok(ready,'SQS/Lambda ingestion did not become ready within six minutes');
  console.log('PASS private S3 upload, SQS/Lambda ingestion and vector indexing');
  const search=expect(await request('/search',owner,{query:'Aurora launch funding'}),200,'semantic search');
  assert.ok(search.results.some(row=>row.documentId===documentId),'Semantic search missed uploaded file');
  const answer=expect(await request('/ask',owner,{question:'What is the Aurora launch budget?',documentId}),200,'RAG');
  assert.match(answer.answer,/7[,.]?319/);
  assert.ok(answer.sources.some(row=>(row.documentId || row.document_id)===documentId),'Missing source citation');
  assert.match(answer.llmModel,/nova-micro/);
  console.log('PASS Titan semantic retrieval and cited Bedrock answer');
  expect(await request(`/documents/${documentId}/content?text=true`,reader),404,'unshared preview');
  expect(await request('/ask',reader,{question:'What is the budget?',documentId}),404,'unshared RAG');
  const share=expect(await request(`/documents/${documentId}/share`,owner,{email:readerEmail}),200,'share');
  const preview=expect(await request(`/documents/${documentId}/content?text=true`,reader),200,'shared preview');
  assert.equal(preview.text.trim(),content);
  const download=await fetch(`${base}/api/documents/${documentId}/content?download=true`,{headers:{Authorization:`Bearer ${reader}`}});
  assert.equal(download.status,200); assert.equal(await download.text(),content);
  const sharedAnswer=expect(await request('/ask',reader,{question:'Who coordinates Aurora?',documentId}),200,'shared RAG');
  assert.match(sharedAnswer.answer,/Mira/i);
  expect(await request(`/documents/${documentId}/shares/${share.share.id}`,owner,null,'DELETE'),200,'revoke');
  expect(await request(`/documents/${documentId}/content?text=true`,reader),404,'revoked preview');
  expect(await request('/ask',reader,{question:'What is the budget?',documentId}),404,'revoked RAG');
  const denied=await fetch(`${base}/api/documents/${documentId}/content?download=true`,{headers:{Authorization:`Bearer ${reader}`}});
  assert.equal(denied.status,404,'revoked download');
  console.log('PASS sharing, preview, download, document chat and revocation');
} finally {
  if(documentId) expect(await request(`/documents/${documentId}`,owner,null,'DELETE'),200,'delete disposable smoke document');
}
console.log('Cloud review smoke checks passed. Two synthetic test accounts remain; no test credentials were saved.');
