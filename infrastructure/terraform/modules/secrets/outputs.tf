output "secret_arns" {
  description = "Logical name => Secrets Manager ARN"
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}
