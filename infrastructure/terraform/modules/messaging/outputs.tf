output "event_bus_name" {
  value = aws_cloudwatch_event_bus.domain.name
}

output "event_bus_arn" {
  value = aws_cloudwatch_event_bus.domain.arn
}

output "queue_urls" {
  value = { for k, q in aws_sqs_queue.consumer : k => q.url }
}

output "queue_arns" {
  value = { for k, q in aws_sqs_queue.consumer : k => q.arn }
}
