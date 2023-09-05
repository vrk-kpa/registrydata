import {Construct} from "constructs";
import {NodejsFunction} from "aws-cdk-lib/aws-lambda-nodejs";
import {aws_ec2, aws_rds} from "aws-cdk-lib";
import {CreateDatabasesAndUsersProps} from "./create-databases-and-users-props";
import {Trigger, TriggerFunction} from "aws-cdk-lib/triggers";
import {Key} from "aws-cdk-lib/aws-kms";
import {ISecret} from "aws-cdk-lib/aws-secretsmanager";


export class CreateDatabasesAndUsers extends Construct {
  readonly ckanSecret: ISecret;

  constructor(scope: Construct, id: string, props: CreateDatabasesAndUsersProps) {
    super(scope, id);

    const encryptionKey = Key.fromLookup(this, 'EncryptionKey', {
      aliasName: `alias/secrets-key-${props.environment}`
    })

    this.ckanSecret = new aws_rds.DatabaseSecret(this, "ckanSecret", {
      username: "ckan",
      encryptionKey: encryptionKey
    })

    const ckanAdminSecret = props.ckanAdminCredentials.secret

    if (ckanAdminSecret?.secretName !== undefined) {

      const secGroup = new aws_ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
        vpc: props.vpc
      })

      const createDatabasesAndUsersFunction = new NodejsFunction(this, 'function', {
        environment: {
          ADMIN_SECRET: ckanAdminSecret.secretName,
          CKAN_SECRET: this.ckanSecret.secretName,
        },
        vpc: props.vpc,
        securityGroups: [secGroup],
        bundling: {
          externalModules: [
            "sqlite3",
            "better-sqlite3",
            "mysql",
            "mysql2",
            "oracledb",
            "tedious",
            "pg-query-stream"
          ]
        }
      })

      this.ckanSecret.grantRead(createDatabasesAndUsersFunction)
      
      encryptionKey.grantDecrypt(createDatabasesAndUsersFunction)

      createDatabasesAndUsersFunction.connections.allowTo(props.ckanInstance, aws_ec2.Port.tcp(5432))

      new Trigger(this, 'CreateDatabasesTrigger', {
        handler: createDatabasesAndUsersFunction,
      })
    }
  }
}
