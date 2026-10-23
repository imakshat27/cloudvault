"""Generate the reviewable CloudFormation JSON; no credentials or account identifiers."""
import json
from pathlib import Path
R = lambda name: {'Ref': name}
A = lambda name, attr='Arn': {'Fn::GetAtt': [name, attr]}
S = lambda value: {'Fn::Sub': value}
resources = {}
def resource(name, kind, **props):
    resources[name] = {'Type': 'AWS::' + kind, 'Properties': props}
    return R(name)
def policy(actions, resources): return {'Effect': 'Allow', 'Action': actions, 'Resource': resources}
def role(name, service, statements, managed=[]):
    return resource(name, 'IAM::Role', AssumeRolePolicyDocument={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':service},'Action':'sts:AssumeRole'}]}, ManagedPolicyArns=managed, Policies=[{'PolicyName':'CloudVaultAccess','PolicyDocument':{'Version':'2012-10-17','Statement':statements}}])
resource('VPC','EC2::VPC',CidrBlock='10.42.0.0/16',EnableDnsSupport=True,EnableDnsHostnames=True,Tags=[{'Key':'Name','Value':'CloudVault'}])
resource('InternetGateway','EC2::InternetGateway')
resource('GatewayAttachment','EC2::VPCGatewayAttachment',VpcId=R('VPC'),InternetGatewayId=R('InternetGateway'))
resource('PublicRoutes','EC2::RouteTable',VpcId=R('VPC'))
resource('InternetRoute','EC2::Route',RouteTableId=R('PublicRoutes'),DestinationCidrBlock='0.0.0.0/0',GatewayId=R('InternetGateway'))
resources['InternetRoute']['DependsOn']='GatewayAttachment'
for i in range(2):
    az={'Fn::Select':[i,{'Fn::GetAZs':''}]}
    public=f'PublicSubnet{i}'; private=f'PrivateSubnet{i}'
    resource(public,'EC2::Subnet',VpcId=R('VPC'),CidrBlock=f'10.42.{i}.0/24',AvailabilityZone=az)
    resource(private,'EC2::Subnet',VpcId=R('VPC'),CidrBlock=f'10.42.{i+10}.0/24',AvailabilityZone=az)
    resource(f'PublicAssociation{i}','EC2::SubnetRouteTableAssociation',SubnetId=R(public),RouteTableId=R('PublicRoutes'))
    resource(f'NatIP{i}','EC2::EIP',Domain='vpc')
    resource(f'Nat{i}','EC2::NatGateway',SubnetId=R(public),AllocationId=A(f'NatIP{i}','AllocationId'))
    resources[f'Nat{i}']['DependsOn']='GatewayAttachment'
    resource(f'PrivateRoutes{i}','EC2::RouteTable',VpcId=R('VPC'))
    resource(f'PrivateAssociation{i}','EC2::SubnetRouteTableAssociation',SubnetId=R(private),RouteTableId=R(f'PrivateRoutes{i}'))
    resource(f'PrivateRoute{i}','EC2::Route',RouteTableId=R(f'PrivateRoutes{i}'),DestinationCidrBlock='0.0.0.0/0',NatGatewayId=R(f'Nat{i}'))
resource('S3Endpoint','EC2::VPCEndpoint',VpcId=R('VPC'),ServiceName=S('com.amazonaws.${AWS::Region}.s3'),RouteTableIds=[R('PrivateRoutes0'),R('PrivateRoutes1')],VpcEndpointType='Gateway')
resource('LoadBalancerSG','EC2::SecurityGroup',GroupDescription='Public HTTPS and HTTP redirect only',VpcId=R('VPC'),SecurityGroupIngress=[{'IpProtocol':'tcp','FromPort':80,'ToPort':80,'CidrIp':'0.0.0.0/0'},{'IpProtocol':'tcp','FromPort':443,'ToPort':443,'CidrIp':'0.0.0.0/0'}])
resource('AppSG','EC2::SecurityGroup',GroupDescription='API traffic only from ALB',VpcId=R('VPC'),SecurityGroupIngress=[{'IpProtocol':'tcp','FromPort':3000,'ToPort':3000,'SourceSecurityGroupId':R('LoadBalancerSG')}])
resource('WorkerSG','EC2::SecurityGroup',GroupDescription='No inbound access to Lambda',VpcId=R('VPC'))
resource('DatabaseSG','EC2::SecurityGroup',GroupDescription='PostgreSQL only from API and worker',VpcId=R('VPC'),SecurityGroupIngress=[{'IpProtocol':'tcp','FromPort':5432,'ToPort':5432,'SourceSecurityGroupId':R(x)} for x in ['AppSG','WorkerSG']])
resource('DatabaseSubnets','RDS::DBSubnetGroup',DBSubnetGroupDescription='Private database subnets in two AZs',SubnetIds=[R('PrivateSubnet0'),R('PrivateSubnet1')])
resource('Database','RDS::DBInstance',Engine='postgres',DBInstanceClass=R('DatabaseClass'),DBName='cloudvault',MasterUsername='cloudvault',ManageMasterUserPassword=True,AllocatedStorage='20',MaxAllocatedStorage=100,StorageType='gp3',StorageEncrypted=True,MultiAZ=R('DatabaseMultiAZ'),BackupRetentionPeriod=7,PubliclyAccessible=False,DBSubnetGroupName=R('DatabaseSubnets'),VPCSecurityGroups=[R('DatabaseSG')],DeletionProtection=True,CopyTagsToSnapshot=True,AutoMinorVersionUpgrade=True)
resources['Database'].update(DeletionPolicy='Snapshot',UpdateReplacePolicy='Snapshot')
resource('AppSecret','SecretsManager::Secret',Description='Shared JWT signing key for all CloudVault replicas',GenerateSecretString={'SecretStringTemplate':'{}','GenerateStringKey':'jwtSecret','PasswordLength':64,'ExcludePunctuation':True})
resource('Documents','S3::Bucket',BucketEncryption={'ServerSideEncryptionConfiguration':[{'ServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]},PublicAccessBlockConfiguration={'BlockPublicAcls':True,'BlockPublicPolicy':True,'IgnorePublicAcls':True,'RestrictPublicBuckets':True},VersioningConfiguration={'Status':'Enabled'},CorsConfiguration={'CorsRules':[{'AllowedOrigins':[S('https://${AppDomain}')],'AllowedMethods':['PUT'],'AllowedHeaders':['content-type'],'MaxAge':900}]},LifecycleConfiguration={'Rules':[{'Id':'AbortIncompleteUploads','Status':'Enabled','AbortIncompleteMultipartUpload':{'DaysAfterInitiation':1}}]})
resources['Documents'].update(DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
resource('DocumentsPolicy','S3::BucketPolicy',Bucket=R('Documents'),PolicyDocument={'Version':'2012-10-17','Statement':[{'Effect':'Deny','Principal':'*','Action':'s3:*','Resource':[A('Documents'),S('${Documents.Arn}/*')],'Condition':{'Bool':{'aws:SecureTransport':'false'}}}]})
resource('DeadLetterQueue','SQS::Queue',FifoQueue=True,MessageRetentionPeriod=1209600,SqsManagedSseEnabled=True)
resource('IngestionQueue','SQS::Queue',FifoQueue=True,VisibilityTimeout=1800,MessageRetentionPeriod=345600,SqsManagedSseEnabled=True,RedrivePolicy={'deadLetterTargetArn':A('DeadLetterQueue'),'maxReceiveCount':3})
for name in ['IngestionQueue','DeadLetterQueue']:
    resource(name+'Policy','SQS::QueuePolicy',Queues=[R(name)],PolicyDocument={'Version':'2012-10-17','Statement':[{'Effect':'Deny','Principal':'*','Action':'sqs:*','Resource':A(name),'Condition':{'Bool':{'aws:SecureTransport':'false'}}}]})
secretAccess=policy(['secretsmanager:GetSecretValue'],[R('AppSecret'),A('Database','MasterUserSecret.SecretArn')])
modelResources=[S('arn:${AWS::Partition}:bedrock:*::foundation-model/*'),S('arn:${AWS::Partition}:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/*')]
role('ApiRole','ec2.amazonaws.com',[
    secretAccess,
    policy(['s3:GetObject','s3:PutObject','s3:DeleteObject'],S('${Documents.Arn}/uploads/*')),
    policy(['s3:GetObject'],S('arn:${AWS::Partition}:s3:::${ArtifactBucket}/${AppArtifactKey}')),
    policy(['sqs:SendMessage'],A('IngestionQueue')),
    policy(['bedrock:InvokeModel'],modelResources),
    policy(['logs:CreateLogStream','logs:PutLogEvents','logs:DescribeLogStreams'],S('${ApiLogs.Arn}:*')),
], [S('arn:${AWS::Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore')])
resource('ApiProfile','IAM::InstanceProfile',Roles=[R('ApiRole')])
role('WorkerRole','lambda.amazonaws.com',[
    secretAccess,
    policy(['s3:GetObject'],S('${Documents.Arn}/uploads/*')),
    policy(['sqs:ReceiveMessage','sqs:DeleteMessage','sqs:GetQueueAttributes'],A('IngestionQueue')),
    policy(['bedrock:InvokeModel'],S('arn:${AWS::Partition}:bedrock:${AWS::Region}::foundation-model/amazon.titan-embed-text-v2:0')),
], [S('arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole')])
resource('WorkerLogs','Logs::LogGroup',LogGroupName=S('/aws/lambda/${AWS::StackName}-ingest'),RetentionInDays=14)
resource('ApiLogs','Logs::LogGroup',RetentionInDays=14)
commonEnv={'NODE_ENV':'production','DB_HOST':A('Database','Endpoint.Address'),'DB_NAME':'cloudvault','DB_SSL':'true','DB_SECRET_ARN':A('Database','MasterUserSecret.SecretArn'),'APP_SECRET_ARN':R('AppSecret'),'STORAGE_MODE':'s3','S3_BUCKET_NAME':R('Documents'),'AI_ENGINE':'bedrock','BEDROCK_CHAT_MODEL':R('BedrockChatModel'),'SQS_QUEUE_URL':R('IngestionQueue'),'CORS_ORIGIN':S('https://${AppDomain}')}
resource('Worker','Lambda::Function',FunctionName=S('${AWS::StackName}-ingest'),Runtime='nodejs22.x',Handler='src/worker.handler',Role=A('WorkerRole'),Timeout=300,MemorySize=1024,ReservedConcurrentExecutions=5,Code={'S3Bucket':R('ArtifactBucket'),'S3Key':R('WorkerArtifactKey')},VpcConfig={'SubnetIds':[R('PrivateSubnet0'),R('PrivateSubnet1')],'SecurityGroupIds':[R('WorkerSG')]},Environment={'Variables':commonEnv})
resources['Worker']['DependsOn']='WorkerLogs'
resource('QueueConsumer','Lambda::EventSourceMapping',EventSourceArn=A('IngestionQueue'),FunctionName=R('Worker'),BatchSize=1,FunctionResponseTypes=['ReportBatchItemFailures'],Enabled=True)
resource('LoadBalancer','ElasticLoadBalancingV2::LoadBalancer',Scheme='internet-facing',Subnets=[R('PublicSubnet0'),R('PublicSubnet1')],SecurityGroups=[R('LoadBalancerSG')],LoadBalancerAttributes=[{'Key':'idle_timeout.timeout_seconds','Value':'120'}])
resource('TargetGroup','ElasticLoadBalancingV2::TargetGroup',Port=3000,Protocol='HTTP',VpcId=R('VPC'),HealthCheckPath='/api/health',Matcher={'HttpCode':'200'},TargetGroupAttributes=[{'Key':'deregistration_delay.timeout_seconds','Value':'30'}])
resource('HTTPListener','ElasticLoadBalancingV2::Listener',LoadBalancerArn=R('LoadBalancer'),Port=80,Protocol='HTTP',DefaultActions=[{'Type':'redirect','RedirectConfig':{'Protocol':'HTTPS','Port':'443','StatusCode':'HTTP_301'}}])
resource('HTTPSListener','ElasticLoadBalancingV2::Listener',LoadBalancerArn=R('LoadBalancer'),Port=443,Protocol='HTTPS',SslPolicy='ELBSecurityPolicy-TLS13-1-2-2021-06',Certificates=[{'CertificateArn':R('CertificateArn')}],DefaultActions=[{'Type':'forward','TargetGroupArn':R('TargetGroup')}])
# Environment references contain no secrets. Secrets are fetched at boot with the instance role.
env='\n'.join(f'{k}={"${"+v["Ref"]+"}" if isinstance(v,dict) and "Ref" in v else "${"+".".join(v["Fn::GetAtt"])+"}" if isinstance(v,dict) and "Fn::GetAtt" in v else v["Fn::Sub"] if isinstance(v,dict) else v}' for k,v in commonEnv.items())
userData='''#!/bin/bash
set -euo pipefail
dnf install -y nodejs22 nodejs22-npm amazon-cloudwatch-agent
mkdir -p /opt/cloudvault
aws s3 cp s3://${ArtifactBucket}/${AppArtifactKey} /tmp/app.tar.gz
tar -xzf /tmp/app.tar.gz -C /opt/cloudvault
useradd --system --home-dir /opt/cloudvault cloudvault || true
chown -R cloudvault:cloudvault /opt/cloudvault
cat > /etc/cloudvault.env <<'ENV'
AWS_REGION=${AWS::Region}
'''+env+'''
ENV
chmod 600 /etc/cloudvault.env
cat > /etc/systemd/system/cloudvault.service <<'SERVICE'
[Unit]
Description=CloudVault API and web
After=network-online.target
[Service]
User=cloudvault
WorkingDirectory=/opt/cloudvault/backend
EnvironmentFile=/etc/cloudvault.env
ExecStart=/usr/bin/node-22 src/start.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
PrivateTmp=true
StandardOutput=append:/var/log/cloudvault.log
StandardError=append:/var/log/cloudvault.log
[Install]
WantedBy=multi-user.target
SERVICE
cat > /opt/aws/amazon-cloudwatch-agent/etc/config.json <<'LOGS'
{"logs":{"logs_collected":{"files":{"collect_list":[{"file_path":"/var/log/cloudvault.log","log_group_name":"${ApiLogs}","log_stream_name":"{instance_id}"}]}}}}
LOGS
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json -s
systemctl daemon-reload
systemctl enable --now cloudvault
'''
resource('LaunchTemplate','EC2::LaunchTemplate',LaunchTemplateData={'ImageId':R('AmiId'),'InstanceType':R('InstanceType'),'IamInstanceProfile':{'Arn':A('ApiProfile')},'SecurityGroupIds':[R('AppSG')],'MetadataOptions':{'HttpTokens':'required','HttpEndpoint':'enabled'},'BlockDeviceMappings':[{'DeviceName':'/dev/xvda','Ebs':{'VolumeSize':16,'VolumeType':'gp3','Encrypted':True}}],'UserData':{'Fn::Base64':S(userData)}})
resource('ApiFleet','AutoScaling::AutoScalingGroup',MinSize='2',MaxSize='4',DesiredCapacity='2',VPCZoneIdentifier=[R('PrivateSubnet0'),R('PrivateSubnet1')],TargetGroupARNs=[R('TargetGroup')],HealthCheckType='ELB',HealthCheckGracePeriod=600,LaunchTemplate={'LaunchTemplateId':R('LaunchTemplate'),'Version':A('LaunchTemplate','LatestVersionNumber')},Tags=[{'Key':'Name','Value':'CloudVault API','PropagateAtLaunch':True}])
resources['ApiFleet']['DependsOn']=['PrivateRoute0','PrivateRoute1','HTTPSListener']
resources['ApiFleet']['UpdatePolicy']={'AutoScalingRollingUpdate':{'MaxBatchSize':1,'MinInstancesInService':1,'PauseTime':'PT5M'}}
resource('ScalingPolicy','AutoScaling::ScalingPolicy',AutoScalingGroupName=R('ApiFleet'),PolicyType='TargetTrackingScaling',TargetTrackingConfiguration={'PredefinedMetricSpecification':{'PredefinedMetricType':'ASGAverageCPUUtilization'},'TargetValue':60})
resource('DNS','Route53::RecordSet',HostedZoneId=R('HostedZoneId'),Name=R('AppDomain'),Type='A',AliasTarget={'DNSName':A('LoadBalancer','DNSName'),'HostedZoneId':A('LoadBalancer','CanonicalHostedZoneID')})
resources['DNS']['Condition']='HasHostedZone'
resource('Alerts','SNS::Topic')
for name,namespace,metric,dimensions,threshold in [
    ('FailedJobs','AWS/SQS','ApproximateNumberOfMessagesVisible',[{'Name':'QueueName','Value':A('DeadLetterQueue','QueueName')}],1),
    ('WorkerErrors','AWS/Lambda','Errors',[{'Name':'FunctionName','Value':R('Worker')}],1),
    ('UnhealthyAPI','AWS/ApplicationELB','UnHealthyHostCount',[{'Name':'LoadBalancer','Value':A('LoadBalancer','LoadBalancerFullName')},{'Name':'TargetGroup','Value':A('TargetGroup','TargetGroupFullName')}],1),
    ('DatabaseCPU','AWS/RDS','CPUUtilization',[{'Name':'DBInstanceIdentifier','Value':R('Database')}],85),
]:
    resource(name,'CloudWatch::Alarm',Namespace=namespace,MetricName=metric,Dimensions=dimensions,Statistic='Maximum',Period=60,EvaluationPeriods=2,Threshold=threshold,ComparisonOperator='GreaterThanOrEqualToThreshold',TreatMissingData='notBreaching',AlarmActions=[R('Alerts')])
params={
    'ArtifactBucket':{'Type':'String','Description':'Existing private S3 artifact bucket in this region'},
    'AppArtifactKey':{'Type':'String','Default':'releases/v1/app.tar.gz'},
    'WorkerArtifactKey':{'Type':'String','Default':'releases/v1/worker.zip'},
    'AppDomain':{'Type':'String','Description':'Hostname covered by the supplied ACM certificate'},
    'CertificateArn':{'Type':'String','Description':'ACM certificate ARN in this region'},
    'HostedZoneId':{'Type':'String','Default':'','Description':'Optional Route 53 hosted zone; otherwise configure DNS yourself'},
    'BedrockChatModel':{'Type':'String','Description':'Converse-compatible model ID or inference profile available in your account'},
    'AmiId':{'Type':'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>','Default':'/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64'},
    'InstanceType':{'Type':'String','Default':'t3.micro','AllowedValues':['t3.micro','t3.small','t3.medium']},
    'DatabaseClass':{'Type':'String','Default':'db.t4g.micro'},
    'DatabaseMultiAZ':{'Type':'String','Default':'true','AllowedValues':['true','false']},
}
outputs={'ApplicationURL':{'Value':S('https://${AppDomain}')},'ArtifactBucket':{'Value':R('ArtifactBucket')},'FilesBucket':{'Value':R('Documents')},'DeadLetterQueueURL':{'Value':R('DeadLetterQueue')},'AlarmTopicArn':{'Value':R('Alerts')},'ApiLogGroup':{'Value':R('ApiLogs')},'LoadBalancerDNS':{'Value':A('LoadBalancer','DNSName')}}
template={'AWSTemplateFormatVersion':'2010-09-09','Description':'CloudVault: private compute and RDS, S3, SQS/Lambda, Bedrock, ALB/ASG, Secrets Manager and CloudWatch','Parameters':params,'Conditions':{'HasHostedZone':{'Fn::Not':[{'Fn::Equals':[R('HostedZoneId'),'']}]}},'Resources':resources,'Outputs':outputs}
Path(__file__).with_name('cloudformation.json').write_text(json.dumps(template,indent=2)+'\n')
print(f'Generated {len(resources)} CloudFormation resources')
