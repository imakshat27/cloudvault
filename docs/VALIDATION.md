# Review deployment validation

Validated on 23 October 2026 in AWS Asia Pacific (Mumbai).

## Completed checks

- Public HTTPS endpoint: valid certificate, HTTP 200 health response, production RDS/pgvector, S3 and Bedrock reported active.
- Registration: invitation required; uninvited registration denied; invited registration and password login succeed.
- Upload and indexing: presigned PUT to private S3, completion event queued in SQS, Lambda extraction and Titan V2 embedding, document transitions to ready.
- Semantic retrieval: natural-language query retrieves the uploaded synthetic document from PostgreSQL vectors.
- RAG: Nova Micro answers a factual question from the document and returns a source citation for that document.
- Sharing: a second account cannot preview or query an unshared file; after sharing it can preview, download and ask a document question.
- Revocation: preview, download and document-scoped RAG are denied after the share is revoked.
- Cleanup: the smoke script removes its disposable document. Synthetic test accounts remain with random passwords that were not printed or persisted.
- GitHub CI: backend lifecycle tests in local mode and PostgreSQL/pgvector mode, restricted database-role checks, frontend lint/build, dependency audit, secret scan and CloudFormation lint pass.

Run `scripts/cloud-smoke.mjs` against your own review host with the URL and invitation code supplied privately. It makes real model calls and creates synthetic accounts; it is an operator check, not a public endpoint.

## Review profile limits

The cost-conscious review profile starts one EC2 API instance, permits scaling to two, uses one NAT gateway and single-AZ RDS, and retains one day of automated DB backups. The Free account plan rejected seven-day retention; the review profile uses the supported setting without a paid-plan upgrade.

The availability demonstration profile provides two initial API instances, two NAT gateways and Multi-AZ RDS. Controlled EC2 replacement, database failover and DLQ redrive exercises have not yet been performed in the review account; the successful smoke check does not establish those recovery guarantees.

Account identifiers, actual hostnames, invitation codes, signing keys and deployment parameters are deliberately omitted from this repository.
