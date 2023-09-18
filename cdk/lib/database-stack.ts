import {aws_ec2, aws_elasticache, aws_rds, Stack} from "aws-cdk-lib";
import {Construct} from "constructs";
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as rds from 'aws-cdk-lib/aws-rds';
import {DatabaseStackProps} from "./database-stack-props";
import {Credentials} from "aws-cdk-lib/aws-rds";
import {InstanceType, SubnetType} from "aws-cdk-lib/aws-ec2";
import {Key} from "aws-cdk-lib/aws-kms";
import * as bak from "aws-cdk-lib/aws-backup";

export class DatabaseStack extends Stack {
    readonly ckanAdminCredentials: rds.Credentials;
    readonly ckanInstance: rds.IDatabaseInstance;
    readonly databaseSecurityGroup: aws_ec2.ISecurityGroup;
    readonly redisSecurityGroup: aws_ec2.ISecurityGroup;
    readonly redisCluster: aws_elasticache.CfnCacheCluster;

    constructor(scope: Construct, id: string, props: DatabaseStackProps) {
        super(scope, id, props);


        const pDatabaseInstanceType = ssm.StringParameter.fromStringParameterName(this, 'pDatabaseInstanceType',
            `/${props.environment}/cdk/database_instance_type`)



        this.databaseSecurityGroup = new aws_ec2.SecurityGroup(this, 'databaseSecurityGroup', {
            vpc: props.vpc
        })

        const encryptionKey = Key.fromLookup(this, 'EncryptionKey', {
            aliasName: `alias/database-encryption-key-${props.environment}`
        })

        const databaseSecret = new aws_rds.DatabaseSecret(this,'databaseAdminSecret', {
            username: "databaseAdmin",
            encryptionKey: encryptionKey
        });

        this.ckanAdminCredentials = Credentials.fromSecret(databaseSecret);


        this.ckanInstance = new aws_rds.DatabaseInstance(this, 'databaseInstance', {
            engine: aws_rds.DatabaseInstanceEngine.POSTGRES,
            credentials: this.ckanAdminCredentials,
            vpc: props.vpc,
            port: 5432,
            instanceType: new InstanceType(pDatabaseInstanceType.stringValue),
            multiAz: props.multiAz,
            allocatedStorage: 20,
            maxAllocatedStorage: 100,
            vpcSubnets: {
                subnets: props.vpc.privateSubnets
            },
            securityGroups: [
                this.databaseSecurityGroup
            ]

        })

        if (props.backups && props.backupPlan ) {
            props.backupPlan.addSelection('backupPlanDatabaseSelection', {
                resources: [
                    bak.BackupResource.fromRdsDatabaseInstance(this.ckanInstance)
                ]
            });
        }

        const redisSubnets = props.vpc.selectSubnets({
          subnets: props.vpc.privateSubnets
        });

        const redisSubnetGroup = new aws_elasticache.CfnSubnetGroup(this, 'redisSubnetGroup', {
          subnetIds: redisSubnets.subnetIds,
          description: "Private subnets for redis cluster"
        })

        this.redisSecurityGroup = new aws_ec2.SecurityGroup(this, 'RedisSecurityGroup', {
          vpc: props.vpc
        })

        this.redisCluster = new aws_elasticache.CfnCacheCluster(this, 'RedisCluster', {
          cacheNodeType: props.cacheNodeType,
          engine: "redis",
          engineVersion: "6.x",
          numCacheNodes: props.numCacheNodes,
          cacheSubnetGroupName: redisSubnetGroup.ref,
          port: 6379,
          preferredMaintenanceWindow: 'sun:23:00-mon:01:30',
          vpcSecurityGroupIds: [this.redisSecurityGroup.securityGroupId],
      })
    }
}
