terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

# Secret *containers* only. Values are written out-of-band (console/CLI/rotation lambda) and are
# never present in Terraform state, variables or version control. The API reads them via the ECS
# task execution role at container start (env var injection) — see modules/ecs-service.
resource "aws_secretsmanager_secret" "this" {
  for_each                = var.secret_names
  name                    = "quest/${var.environment}/${each.key}"
  description             = each.value
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
  tags                    = var.tags
}
