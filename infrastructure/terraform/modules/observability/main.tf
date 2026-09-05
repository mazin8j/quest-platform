terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

# Alert fan-out. Subscriptions (email/PagerDuty/Slack) are added per environment out of band.
resource "aws_sns_topic" "alerts" {
  name              = "${var.name}-alerts"
  kms_master_key_id = "alias/aws/sns"
  tags              = var.tags
}

# Structured JSON logs from the API (pino) land here; CloudWatch Logs Insights queries them by field.
resource "aws_cloudwatch_log_group" "api" {
  name              = "/quest/${var.name}/api"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

# Metric filter: count 5xx responses from structured logs (pino-http `res.statusCode`).
resource "aws_cloudwatch_log_metric_filter" "api_5xx" {
  name           = "${var.name}-api-5xx"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.res.statusCode >= 500 }"
  metric_transformation {
    name      = "Api5xxCount"
    namespace = "QUEST/${var.name}"
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.name}-api-5xx-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Api5xxCount"
  namespace           = "QUEST/${var.name}"
  period              = 60
  statistic           = "Sum"
  threshold           = var.api_5xx_threshold_per_minute
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  count               = var.rds_instance_identifier == null ? 0 : 1
  alarm_name          = "${var.name}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  dimensions          = { DBInstanceIdentifier = var.rds_instance_identifier }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  count               = var.rds_instance_identifier == null ? 0 : 1
  alarm_name          = "${var.name}-rds-free-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Minimum"
  threshold           = 5 * 1024 * 1024 * 1024 # 5 GiB
  dimensions          = { DBInstanceIdentifier = var.rds_instance_identifier }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = var.tags
}
