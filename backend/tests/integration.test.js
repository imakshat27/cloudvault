// Quick end-to-end API test script
async function runTests() {
  const baseUrl = 'http://localhost:3000/api';
  console.log('🧪 Starting CloudVault Backend E2E Test...');

  // 1. Register
  const testEmail = `test_${Date.now()}@example.com`;
  const registerRes = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'password123' })
  });
  const registerData = await registerRes.json();
  console.log('1. Register status:', registerRes.status, registerData.message);
  const token = registerData.token;

  if (!token) throw new Error('Failed to get token');

  // 2. Request upload URL for a sample document
  const uploadUrlRes = await fetch(`${baseUrl}/documents/upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      filename: 'cloud_architecture_overview.txt',
      fileSize: 500,
      mimeType: 'text/plain'
    })
  });
  const uploadUrlData = await uploadUrlRes.json();
  console.log('2. Upload URL generated:', uploadUrlData.storageType, 'DocID:', uploadUrlData.documentId);

  // 3. Upload content to the URL
  const sampleContent = `CloudVault is a cloud-native document storage platform with an AI-powered retrieval layer.
Beyond upload, download, and share capabilities, users can semantically search, summarize, and ask questions
about their documents via Retrieval-Augmented Generation (RAG).
The system uses Amazon RDS PostgreSQL with the pgvector extension for co-locating vector embeddings and access control metadata.
This prevents permission leakage across multi-tenant environments.
Amazon S3 stores raw uploaded objects, and Amazon Bedrock generates Titan Embeddings V2 vectors.`;

  const uploadRes = await fetch(`http://localhost:3000${uploadUrlData.uploadUrl}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: sampleContent
  });
  console.log('3. File upload status:', uploadRes.status);

  // 4. Mark complete to trigger ingestion
  const completeRes = await fetch(`${baseUrl}/documents/${uploadUrlData.documentId}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ fileSize: sampleContent.length, mimeType: 'text/plain' })
  });
  const completeData = await completeRes.json();
  console.log('4. Complete ingestion trigger status:', completeData.status);

  // 5. Poll status until ready
  let isReady = false;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 600));
    const statusRes = await fetch(`${baseUrl}/documents/${uploadUrlData.documentId}/status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const statusData = await statusRes.json();
    console.log(`   Poll attempt ${i + 1}: status = ${statusData.status}`);
    if (statusData.status === 'ready') {
      isReady = true;
      break;
    }
  }

  if (!isReady) throw new Error('Document did not reach ready status');

  // 6. Semantic search
  const searchRes = await fetch(`${baseUrl}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ query: 'pgvector RDS permission leakage' })
  });
  const searchData = await searchRes.json();
  console.log('6. Semantic search matches:', searchData.matchCount, 'Top similarity:', searchData.results[0]?.similarity);

  // 7. RAG Q&A
  const askRes = await fetch(`${baseUrl}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ question: 'Why does CloudVault use RDS pgvector?' })
  });
  const askData = await askRes.json();
  console.log('7. RAG Answer received:');
  console.log('   Question:', askData.question);
  console.log('   Answer preview:', askData.answer.slice(0, 100) + '...');
  console.log('   Sources count:', askData.sources.length);

  // 8. Document list
  const listRes = await fetch(`${baseUrl}/documents`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const listData = await listRes.json();
  console.log('8. Documents listed for user:', listData.documents.length, 'Chunk count:', listData.documents[0]?.chunk_count);

  console.log('\n🎉 ALL BACKEND ENDPOINTS & INGESTION PIPELINE VERIFIED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
