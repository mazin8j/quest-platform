terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

# ADR-003: EventBridge custom bus for domain events; SQS queues (with DLQs) per consumer group.
resource "aws_cloudwatch_event_bus" "domain" {
  name = "${var.name}-domain-events"
  tags = var.tags
}

# Archive every event for replay/debugging (retention is short in dev, longer in prod).
resource "aws_cloudwatch_event_archive" "domain" {
  name             = "${var.name}-domain-events"
  event_source_arn = aws_cloudwatch_event_bus.domain.arn
  retention_days   = var.archive_retention_days
}

resource "aws_sqs_queue" "dlq" {
  for_each                  = var.consumer_queues
  name                      = "${var.name}-${each.key}-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true
  tags                      = var.tags
}

resource "aws_sqs_queue" "consumer" {
  for_each                   = var.consumer_queues
  name                       = "${var.name}-${each.key}"
  visibility_timeout_seconds = each.value.visibility_timeout_seconds
  message_retention_seconds  = 345600 # 4 days
  receive_wait_time_seconds  = 20     # long polling
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = each.value.max_receive_count
  })
  tags = var.tags
}

resource "aws_cloudwatch_event_rule" "consumer" {
  for_each       = var.consumer_queues
  name           = "${var.name}-${each.key}"
  event_bus_name = aws_cloudwatch_event_bus.domain.name
  description    = "Route ${join(", ", each.value.event_type_prefixes)} events to ${each.key}"
  event_pattern = jsonencode({
    "detail-type" = [for p in each.value.event_type_prefixes : { prefix = p }]
  })
  tags = var.tags
}

resource "aws_cloudwatch_event_target" "consumer" {
  for_each       = var.consumer_queues
  rule           = aws_cloudwatch_event_rule.consumer[each.key].name
  event_bus_name = aws_cloudwatch_event_bus.domain.name
  arn            = aws_sqs_queue.consumer[each.key].arn
  dead_letter_config {
    arn = aws_sqs_queue.dlq[each.key].arn
  }
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 10
  }
}

data "aws_iam_policy_document" "queue" {
  for_each = var.consumer_queues
  statement {
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.consumer[each.key].arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.consumer[each.key].arn]
    }
  }
}

resource "aws_sqs_queue_policy" "consumer" {
  for_each  = var.consumer_queues
  queue_url = aws_sqs_queue.consumer[each.key].id
  policy    = data.aws_iam_policy_document.queue[each.key].json
}

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  for_each            = var.consumer_queues
  alarm_name          = "${var.name}-${each.key}-dlq-not-empty"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  dimensions          = { QueueName = aws_sqs_queue.dlq[each.key].name }
  alarm_actions       = var.alarm_topic_arn == null ? [] : [var.alarm_topic_arn]
  tags                = var.tags
}
