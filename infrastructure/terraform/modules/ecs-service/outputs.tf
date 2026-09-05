output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "service_name" {
  value = aws_ecs_service.api.name
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "task_security_group_id" {
  value = aws_security_group.task.id
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}
