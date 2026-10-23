#!/usr/bin/env bash
set -euo pipefail
export AWS_PAGER=''
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-south-1}"
# Read-only account checks. No secret values, mutations, or credential creation.
price() {
 local service="$1"
 shift
 aws pricing get-products --region us-east-1 --service-code "$service" --max-results 50 \
  --filters 'Type=TERM_MATCH,Field=location,Value=Asia Pacific (Mumbai)' "$@" \
  --output json | jq -r '.PriceList[] | fromjson | .terms.OnDemand[] | .priceDimensions[] | [.description,.pricePerUnit.USD] | @tsv'
}
printf '\nEC2 API instance: hourly USD\n'
price AmazonEC2 'Type=TERM_MATCH,Field=instanceType,Value=t3.micro' 'Type=TERM_MATCH,Field=operatingSystem,Value=Linux' 'Type=TERM_MATCH,Field=tenancy,Value=Shared' 'Type=TERM_MATCH,Field=preInstalledSw,Value=NA' 'Type=TERM_MATCH,Field=capacitystatus,Value=Used'
printf '\nRDS application database: hourly USD\n'
price AmazonRDS 'Type=TERM_MATCH,Field=instanceType,Value=db.t4g.micro' 'Type=TERM_MATCH,Field=databaseEngine,Value=PostgreSQL' 'Type=TERM_MATCH,Field=deploymentOption,Value=Single-AZ'
printf '\nNAT gateway: hourly USD\n'
price AmazonEC2 'Type=TERM_MATCH,Field=usagetype,Value=APS3-NatGateway-Hours'
printf '\nALB: hourly and usage USD\n'
price AWSELB 'Type=TERM_MATCH,Field=operation,Value=LoadBalancing:Application'
printf '\nReview chat model profiles\n'
aws bedrock list-inference-profiles --query 'inferenceProfileSummaries[?contains(inferenceProfileId,`nova-micro`)].[inferenceProfileId,status]' --output table
printf '\nExisting compute/database state\n'
aws ec2 describe-instances --query 'Reservations[].Instances[].[InstanceId,State.Name,InstanceType]' --output table
aws rds describe-db-instances --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceStatus,DBInstanceClass,MultiAZ,PubliclyAccessible]' --output table
printf '\nACM certificates in deployment region\n'
aws acm list-certificates --query 'CertificateSummaryList[].[DomainName,Status]' --output table
