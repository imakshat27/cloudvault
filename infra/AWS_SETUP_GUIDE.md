# Deploy CloudVault on AWS

The stack is defined in `cloudformation.json`, generated from `stack.py`. It creates billable infrastructure, including **two NAT gateways, two EC2 instances, an ALB, and Multi-AZ RDS** by default. It has been linted, not deployed as part of the repository redesign. Review the template and your class budget before executing deployment commands.

## Prerequisites

- An AWS account and a deployment role/profile with CloudFormation, VPC, EC2, ELB, Auto Scaling, IAM, RDS, Lambda, SQS, S3, Secrets Manager, CloudWatch, and SNS permissions.
- A region with at least two availability zones and access to Titan Text Embeddings V2 plus a Converse-compatible Bedrock model.
- An ACM certificate in that region for your chosen application hostname. Validate the certificate before deploying.
- An existing **private artifact S3 bucket in the same region**. Enable encryption, block public access, and use immutable release keys.
- AWS CLI, Node.js 22.12+, Python 3, curl, zip, and optionally `cfn-lint`.
- A DNS zone you control. Supply its Route 53 zone ID for automatic DNS, or add an alias/CNAME to the ALB yourself.

No access keys or account-specific resource names belong in the repository. Prefer IAM Identity Center/SSO for CLI access and IAM roles for compute.

## 1. Build artifacts

```bash
./scripts/package.sh
```

This creates `build/app.tar.gz` and `build/worker.zip` using an explicit source allowlist. It includes the public RDS CA certificate bundle, not private credentials. Rebuild into a fresh `build/` directory for every release. The application archive includes the frontend build and backend dependencies; the Lambda archive includes the same backend with its ingestion handler.

The packaged backend currently has no native dependencies. If you add a native addon, build its Lambda dependencies for Linux x86_64 rather than copying them from macOS/Windows.

## 2. Upload immutable release artifacts

Choose your bucket and region in your shell:

```bash
export AWS_REGION=us-east-1
export CV_ARTIFACT_BUCKET=your-private-artifact-bucket
export CV_RELEASE=v1
aws s3 cp build/app.tar.gz "s3://$CV_ARTIFACT_BUCKET/releases/$CV_RELEASE/app.tar.gz"
aws s3 cp build/worker.zip "s3://$CV_ARTIFACT_BUCKET/releases/$CV_RELEASE/worker.zip"
```

Keep credentials out of shell command arguments and Git. Your CLI profile supplies authentication.

## 3. Review and deploy the stack

Regenerate and lint:

```bash
python3 infra/stack.py
cfn-lint infra/cloudformation.json
```

Create a local parameters JSON file outside the repository. Use the following parameter keys:

| Key                 | Value                                                   |
| ------------------- | ------------------------------------------------------- |
| `ArtifactBucket`    | Your existing private bucket                            |
| `AppArtifactKey`    | `releases/v1/app.tar.gz`                                |
| `WorkerArtifactKey` | `releases/v1/worker.zip`                                |
| `AppDomain`         | Your application hostname, without `https://`           |
| `CertificateArn`    | ACM certificate ARN in this region                      |
| `HostedZoneId`      | Optional Route 53 zone ID; omit for manual DNS          |
| `BedrockChatModel`  | Model ID or inference profile supporting Converse       |
| `DatabaseMultiAZ`   | `true` by default; `false` reduces redundancy and cost  |
| `InstanceType`      | `t3.micro` by default                                   |
| `DatabaseClass`     | `db.t4g.micro` by default; verify regional availability |

CloudFormation CLI parameter files use an array of `{"ParameterKey":"...","ParameterValue":"..."}` objects.

```bash
aws cloudformation create-stack \
  --stack-name cloudvault \
  --template-body file://infra/cloudformation.json \
  --parameters file:///absolute/path/to/your-parameters.json \
  --capabilities CAPABILITY_IAM
aws cloudformation wait stack-create-complete --stack-name cloudvault
aws cloudformation describe-stacks --stack-name cloudvault --query 'Stacks[0].Outputs'
```

The template accepts the AWS-managed current Amazon Linux 2023 image through an SSM parameter. EC2 instances run `node-22` under systemd, fetch DB/JWT values from Secrets Manager with their instance role, and send logs to CloudWatch. RDS provisions its managed master secret. DB traffic verifies the RDS CA certificate. The initialization code serializes schema setup across replicas with a PostgreSQL advisory lock.

If your model uses a cross-region inference profile, confirm your account's model availability and organization policies permit the destinations. Update the IAM model resources if your chosen profile requires additional scopes. The embedding worker is limited to Titan V2 in the deployment region.

## 4. Verify the cloud path

1. Open the HTTPS application URL and register two separate test accounts.
2. Upload a small text file. Verify the browser PUT goes to the private S3 bucket using its presigned URL.
3. Check `pending → queued → processing → ready`. SQS FIFO preserves ordering for each document; Lambda uses a batch size of one and partial-batch failure responses.
4. Inspect the Lambda CloudWatch log group. Confirm text extraction and vector indexing complete without errors.
5. Ask a factual question whose answer appears in the file. Check Bedrock inference succeeds, the answer cites sources, and each source opens the right document.
6. Share with the second account; verify preview, download, and RAG. Revoke access and confirm all three are denied.
7. Stop one EC2 instance through a controlled exercise. Check ALB health routing and ASG replacement. Run a separate RDS failover exercise if your class budget permits it.
8. Test a malformed document, inspect retries and the DLQ, repair the cause, then redrive the message. A ready document makes duplicate delivery a no-op. A timeout can leave the displayed status as processing until a retry/redrive completes.

Do not report these exercises as passed before running them in your account.

## Monitoring and operations

- API logs: the `ApiLogGroup` output. EC2 system logs are also available through Session Manager; there is no inbound SSH rule or SSH key pair.
- Worker logs: `/aws/lambda/<stack-name>-ingest`, retained for 14 days.
- Alarms: DLQ backlog, Lambda errors, unhealthy ALB targets, and RDS CPU.
- Subscribe your desired destination to `AlarmTopicArn` yourself. The stack does not send messages to anyone by default.
- FIFO queue visibility is 1800 seconds for a 300-second Lambda timeout, following [AWS's six-times-timeout guidance](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html). The worker reports individual failed messages as documented in [Lambda SQS error handling](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html).
- Bedrock uses [Titan V2 embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html) and [Converse](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html).
- After an embedding-model/engine change, reindex every file before serving retrieval from the new model.
- JWT secret changes invalidate sessions. Restart app instances after changing the JWT secret.
- RDS master credentials are loaded from Secrets Manager; use a dedicated application DB role with restricted SQL privileges before using this for a real organization. The classroom stack uses the managed master user to bootstrap extensions and tables.
- Queries are permission-filtered; filenames and question text should not be added to production request logs.

## Update a release

Build and upload under a new release key, then update `AppArtifactKey` and `WorkerArtifactKey` through a CloudFormation change set. The launch template version changes; the ASG rolling update replaces one instance at a time. Check `/api/health`, indexing, and chat after the update. Artifact keys must change: overwriting the same S3 key will not force a Lambda code update.

## Cost and cleanup

This is an availability demonstration, **not a promise of free-tier deployment**. NAT gateways, ALB, RDS standby, running EC2, inference, storage, logs, and network transfer can all incur charges. Use the AWS Pricing Calculator for your region and actual workload. Setting `DatabaseMultiAZ=false` reduces database redundancy; the stack still has two API instances and NAT gateways.

To clean up, disable RDS deletion protection deliberately, then delete the CloudFormation stack after preserving what you need. Database deletion creates a snapshot. The document bucket is retained, including object versions; delete its versions and the bucket separately if you intend to erase everything. Delete release artifacts, retained snapshots, log groups, and any externally created certificate/DNS entries when appropriate. A library deletion removes the live document and search index; S3 versioning and RDS backups can retain historical copies.
