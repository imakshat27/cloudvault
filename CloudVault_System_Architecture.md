# CloudVault — Intelligent Cloud Storage & Retrieval Platform

## Abstract

CloudVault combines document storage and collaboration with natural-language retrieval. Users upload documents, organize their library, share read access, and ask questions against permitted content. An event-driven ingestion pipeline extracts text, generates embeddings, and writes vector indexes independently of interactive API requests. A React workspace provides both a dedicated research chat and a document viewer with a scoped assistant.

The design demonstrates scalability, elasticity, fault isolation, access control, observability, and availability through managed AWS services. It separates a runnable local development mode from a cloud deployment using genuine semantic embeddings and generation.

## Objectives and implementation

| Objective           | Implementation                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Secure storage      | Private encrypted S3, short-lived signed PUT URLs, authenticated download endpoints      |
| Collaboration       | Owner-managed read-only shares with immediate permission checks and revocation           |
| Scalable web/API    | Two private EC2 instances behind HTTPS ALB, CPU-based Auto Scaling                       |
| Available metadata  | Private encrypted PostgreSQL RDS with optional Multi-AZ standby                          |
| Decoupled ingestion | Upload completion publishes SQS FIFO messages; Lambda processes independently            |
| Semantic retrieval  | Bedrock Titan V2 vectors in PostgreSQL pgvector; cosine distance plus access filtering   |
| Grounded answers    | Bedrock Converse synthesizes from retrieved passages, returns citations and source cards |
| Monitoring          | CloudWatch API/worker logs, failure and capacity alarms, SNS topic                       |
| Reproducibility     | CloudFormation, Docker, package scripts, integration tests, GitHub Actions               |

## User experience

The workspace has four destinations: all files, research chat, shared files, and starred files. The file library supports filename matching, natural-language content search, type filtering, sorting, grid/list views, and indexed status. A document opens with a viewer and a separate chat restricted to that document. Source cards take the reader back to the original file.

New accounts start empty. Optional sample text documents exercise the real upload and indexing path. Local development is explicitly labeled as lexical retrieval rather than AI synthesis. The light visual system uses quiet sage surfaces, forest actions, typographic hierarchy, accessible controls, focus states, reduced motion, mobile navigation, and stacked viewer/chat layouts.

## Service responsibilities

| AWS service                   | Responsibility                                    | Why it belongs                                                                 |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| S3                            | Original documents and release artifacts          | Durable object storage and direct uploads                                      |
| RDS PostgreSQL                | Users, metadata, permissions, chunks, pgvector    | Transactional metadata with permission-aware vector retrieval                  |
| EC2                           | Express API and compiled React client             | Demonstrates application compute and role-based service access                 |
| Application Load Balancer     | HTTPS termination, health checks, routing         | Removes a single API instance as the entry point                               |
| Auto Scaling                  | Two initial instances, up to four                 | Demonstrates elasticity and unhealthy-instance replacement                     |
| SQS FIFO                      | Per-document indexing jobs                        | Buffers bursts and decouples compute; retries are ordered per document         |
| Lambda                        | Extraction, chunking, embedding, vector insertion | Independently scales indexing work with bounded concurrency                    |
| Bedrock                       | Titan embeddings and Converse generation          | Provides semantic representations and source-grounded answers                  |
| IAM                           | Separate API/worker roles and policies            | Removes static AWS credentials from application configuration                  |
| Secrets Manager               | Managed DB credentials and JWT signing secret     | Shares runtime secrets without writing them to source control                  |
| VPC, subnets, security groups | Two-AZ network isolation                          | Keeps application and database hosts private                                   |
| NAT gateways and S3 endpoint  | Outbound managed-service access                   | Private workloads can reach Bedrock/Secrets Manager; S3 has a gateway endpoint |
| CloudWatch                    | Logs and operational alarms                       | Makes failures and resource pressure visible                                   |
| SNS                           | Optional alarm delivery                           | An explicit subscription is required; no contacts are embedded                 |
| Route 53                      | Optional app DNS record                           | Connects the chosen hostname to the ALB                                        |
| ACM                           | Existing validated HTTPS certificate              | Enables TLS at the ALB                                                         |
| Systems Manager               | AMI lookup and instance administration            | Supports current base images and access without SSH keys                       |
| CloudFormation                | Declarative resource deployment                   | Makes architecture reviewable and repeatable                                   |

The template creates the application/network/data resources and optionally DNS. It references an existing artifact bucket, ACM certificate, and AWS-managed AMI parameter. It does not claim those external prerequisites were provisioned or that a live AWS deployment has been verified.

## Upload and indexing flow

1. The authenticated client requests an upload URL with filename and size. The API checks format/size, creates a pending metadata row, and signs a private S3 PUT.
2. The browser uploads directly to S3. The object key includes its owner ID and a unique suffix; readable filenames are preserved separately.
3. The owner calls upload completion. The API atomically claims the document for queueing and publishes a FIFO message with the document ID as its group ID.
4. Lambda reads the object, validates its size, extracts text from PDF/DOCX/TXT/Markdown, and chunks it with overlap.
5. Titan V2 produces 1024-dimensional embeddings. The worker replaces the document's prior chunks and updates status to ready only after indexing completes.
6. Failures are marked failed; SQS retries. After three deliveries the message moves to a DLQ. Duplicate deliveries for an already-ready document do no additional work.

The application publishes the event after upload completion; this implementation does not use a raw S3 object-created notification. That boundary lets the API validate document ownership and track the intended metadata row.

Local mode uses the same pipeline in a background task in one process. It is useful for development but has no durable queue across restarts.

## Retrieval and answer flow

1. The API authenticates the request and validates question length and optional document scope.
2. The query is embedded with the same configured engine as the indexed documents. Recent user questions supply limited conversational context.
3. PostgreSQL joins vectors with document ownership and shares, excludes files that are not ready, applies optional document scope, and ranks by cosine distance. Inaccessible chunks are not returned to the generation stage.
4. The top passages are labeled as numbered sources. The model is instructed to treat document contents as data and to use those passages as factual evidence.
5. The response returns answer text and source metadata. Source cards open the same authenticated preview endpoint used by the library.

Retrieval is top-k, so a query can return imperfect matches. Prompts reduce hallucination and prompt-injection risk but do not mathematically guarantee correctness. Users can inspect passages and originals. Changing embedding engines/models requires reindexing all documents.

## Database and security model

`users` stores a normalized email and bcrypt password hash. `documents` stores owner, object key, format, size, and indexing state. `document_shares` maps registered accounts to read-only document permission. `chunks` stores source text, chunk order, and a 1024-dimensional vector, with a cosine HNSW index.

Access checks apply to listing, status, viewing, downloading, sharing, deletion, retrieval, and document-scoped chat. Owners alone can share, revoke, delete, or reindex. Local upload endpoints require an authenticated owner and a pending upload; path resolution cannot escape the upload directory.

Production uses a shared randomly generated JWT secret, hashed passwords, TLS, restricted CORS, security headers, auth/answer rate limits, private network placement, encrypted storage, and IAM roles. New PostgreSQL connections fetch the current managed password so RDS secret rotation can be picked up. Only the deployment bootstrap function uses the RDS managed master user; a separate bootstrap Lambda provisions a dedicated restricted application DB role. Runtime services cannot read the master secret. JWT sessions are browser-local, expire, and are invalidated if the signing secret changes.

## Availability, elasticity, and fault tolerance

API replicas run across two availability zones. ALB health probes include a database readiness query. Auto Scaling targets 60% CPU and replaces unhealthy instances. Shared metadata, objects, and signing configuration let any API instance serve a request.

RDS Multi-AZ provides a managed standby when enabled. Each AZ has outbound routing through its own NAT gateway. Lambda has reserved concurrency of five to avoid unbounded indexing load on a small database. FIFO grouping serializes work for the same document while allowing different files to process concurrently. Queue visibility is six times the function timeout; the worker returns partial-batch failures.

Operations still require exercises: API replacement, RDS failover, model access failure, malformed input, DLQ redrive, and load testing. A linter or local test does not establish a deployed availability guarantee.

## Cost and operational tradeoffs

The high-availability topology intentionally uses resources that incur ongoing cost: NAT gateways, ALB, running EC2, RDS standby, logs, inference, and data transfer. It should be sized and torn down around the class budget. Single-AZ RDS is a lower-cost option with reduced availability. Local/Docker mode avoids cloud spending for application development.

S3 versioning and RDS snapshots help recovery but can retain historical content after deletion from the library. The document bucket is retained on stack deletion and RDS deletion protection must be deliberately disabled for teardown. Notifications require an explicit SNS subscription, and no student's contact details are embedded in the stack.

## Validation and limitations

CI verifies the database bootstrap and denied DDL/role/password access for the restricted runtime role, then runs the API lifecycle on real PostgreSQL/pgvector. Local integration tests cover the authentication and storage lifecycle, private upload/download access, successful indexing, document-scoped retrieval, read-only sharing, revocation, and cross-user isolation. The frontend is built and linted, dependencies audited, and browser flows checked at desktop and phone widths. CloudFormation is checked with `cfn-lint`.

Live Bedrock calls, production PostgreSQL performance, AWS resource creation, Docker execution, and failover/load exercises need the corresponding available runtime/account. Current document extraction does not provide OCR. DOCX previews are extracted text and Markdown is rendered safely. Conversation history is session-local; previous user questions are used for context. Stars are browser-local. There is no public anonymous link sharing or email invitation delivery.
