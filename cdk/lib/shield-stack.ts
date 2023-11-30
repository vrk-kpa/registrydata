import {
  aws_cloudwatch,
  aws_lambda,
  aws_lambda_event_sources,
  aws_shield,
  aws_sns,
  aws_ssm,
  aws_wafv2,
  Stack, Token, CfnParameter
} from "aws-cdk-lib";
import {Construct} from "constructs";

import {ShieldStackProps} from "./shield-stack-props";
import any = jasmine.any;


export class ShieldStack extends Stack {
  constructor(scope: Construct, id: string, props: ShieldStackProps) {
    super(scope, id, props);

    const cfnProtection = new aws_shield.CfnProtection(this, 'ShieldProtection', {
      name: 'Application Load Balancers',
      resourceArn: props.loadBalancer.loadBalancerArn
    })

    const banned_ips = aws_ssm.StringListParameter.fromStringListParameterName(this, 'bannedIpsList',
      `/${props.environment}/waf/banned_ips`);

    const whitelisted_ips = aws_ssm.StringListParameter.fromStringListParameterName(this, 'whitelistedIpsList',
      `/${props.environment}/waf/whitelisted_ips`);


    const cfnBannedIPSet = new aws_wafv2.CfnIPSet(this, 'BannedIPSet', {
      name: 'banned-ips',
      scope: 'REGIONAL',
      ipAddressVersion: "IPV4",
      addresses: banned_ips.stringListValue
    })

    const cfnWhiteListedIpSet = new aws_wafv2.CfnIPSet(this, 'WhitelistedIPSet', {
      name: 'whitelisted-ips',
      scope: 'REGIONAL',
      ipAddressVersion: "IPV4",
      addresses: whitelisted_ips.stringListValue
    })


    const highPriorityCountryCodesParameter = new CfnParameter(this,  'highPriorityCountryCodesParameter', {
      type: 'AWS::SSM::Parameter::Value<List<String>>',
      default: `/${props.environment}/waf/high_priority_country_codes`
    });


    const highPriorityRateLimit = aws_ssm.StringParameter.fromStringParameterName(this, 'highPriorityRateLimit',
      `/${props.environment}/waf/high_priority_rate_limit`);

    const rateLimit = aws_ssm.StringParameter.fromStringParameterName(this, 'rateLimit',
      `/${props.environment}/waf/rate_limit`);


    const managedRulesParameter = aws_ssm.StringParameter.valueFromLookup(this, `/${props.environment}/waf/managed_rules`)

    const managedRules = managedRulesParameter.startsWith("dummy-value") ? "dummy" : JSON.parse(managedRulesParameter)

    let rules = [
      {
        name: "block-banned_ips",
        priority: 0,
        action: {
          block: {
          }
        },
        statement: {
          ipSetReferenceStatement: {
            arn: cfnBannedIPSet.attrArn
          }
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: "banned-ips",
          sampledRequestsEnabled: props.bannedIpsRequestSamplingEnabled
        },
      },
      {
        name: "allow-whitelisted_ips",
        priority: 1,
        action: {
          allow: {
          }
        },
        statement: {
          ipSetReferenceStatement: {
            arn: cfnWhiteListedIpSet.attrArn
          }
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: "whitelisted-ips",
          sampledRequestsEnabled: false
        },
      },
      {
        name: "WAFAutomationProtectionRule",
        priority: 2,
        action: {
          count: {
          }
        },
        statement: {
          notStatement: {
            statement: {
              geoMatchStatement: {
                countryCodes: highPriorityCountryCodesParameter.valueAsList
              }
            }
          }
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: "waf-automation-geoblocked-requests",
          sampledRequestsEnabled: true
        },
      },
      {
        name: "rate-limit-finland",
        priority: 3,
        action: {
          block: {
          }
        },
        statement: {
          rateBasedStatement: {
            limit: Token.asNumber(highPriorityRateLimit.stringValue),
            aggregateKeyType: "IP",
            scopeDownStatement: {
              geoMatchStatement: {
                countryCodes: highPriorityCountryCodesParameter.valueAsList
              }
            }
          }
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: "request-rate-limit-finland",
          sampledRequestsEnabled: props.highPriorityRequestSamplingEnabled
        },
      },
      {
        name: "rate-limit-world",
        priority: 4,
        action: {
          block: {
          }
        },
        statement: {
          rateBasedStatement: {
            limit: Token.asNumber(rateLimit.stringValue),
            aggregateKeyType: "IP",
            scopeDownStatement: {
              notStatement: {
                statement: {
                  geoMatchStatement: {
                    countryCodes: highPriorityCountryCodesParameter.valueAsList
                  }
                }
              }
            }
          }
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: "request-rate-limit-world",
          sampledRequestsEnabled: props.rateLimitRequestSamplingEnabled
        },
      },
    ]

    type RuleGroup = {
      groupName: string,
      vendorName: string,
      excludedRules: string[],
      enableRequestSampling: boolean
    }


    if ( managedRules !== "dummy"){
      let ruleList: any[] = []

      managedRules.forEach((rule: RuleGroup, index: number) => {

        let ruleActionOverrides = []

        for (let excludedRule in rule.excludedRules) {
          let excludedRuleObj = {
            actionToUse: {
              count: {}
            },
            name: excludedRule
          }

          ruleActionOverrides.push(excludedRuleObj)
        }

        let managedRuleGroup: aws_wafv2.CfnWebACL.RuleProperty = {
          name: "managed-rule-group-" + rule.groupName,
          priority: 5 + index,
          overrideAction: {
            none: {}
          },
          statement: {
            managedRuleGroupStatement: {
              name: rule.groupName,
              vendorName: rule.vendorName,
              ruleActionOverrides: ruleActionOverrides
            }
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "request-managed-rule-group-" + rule.groupName,
            sampledRequestsEnabled: rule.enableRequestSampling
          }
        }


        ruleList.push(managedRuleGroup)

      })

      rules = rules.concat(ruleList)
    }


    const cfnWebAcl = new aws_wafv2.CfnWebACL(this, 'WAFWebACL', {
      scope: "REGIONAL",
      defaultAction: {
        allow: {}
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "DVVWAF",
        sampledRequestsEnabled: props.requestSampleAllTrafficEnabled
      },
      rules: rules
    })


    const WafAutomationArn = aws_ssm.StringParameter.fromStringParameterName(this, 'WafAutomationArn',
      `/${props.environment}/waf/waf_automation_arn`);

    const WafAutomationLambdaFunction = aws_lambda.Function.fromFunctionArn(this, "WafAutomation", WafAutomationArn.stringValue)

    const CloudWatchAlarmArn = aws_ssm.StringParameter.fromStringParameterName(this, 'CloudWatchAlarmArn',
      `/${props.environment}/waf/cloudwatch_alarm_arn`);

    const DDoSDetectedAlarm = aws_cloudwatch.Alarm.fromAlarmArn(this, "DDosDetectedAlarm", CloudWatchAlarmArn.stringValue)

    const topic = new aws_sns.Topic(this, 'DDoSProtectionTopic', {
      displayName: 'DDoS protection',
    });

    const eventSource = new aws_lambda_event_sources.SnsEventSource(topic);

    WafAutomationLambdaFunction.addEventSource(eventSource)

  }
}