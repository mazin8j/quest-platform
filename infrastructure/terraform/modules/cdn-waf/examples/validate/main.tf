# Validation root for the cdn-waf module.
#
# The module declares `configuration_aliases = [aws.us_east_1]` because CloudFront-scoped WAF
# resources must be created in us-east-1. Terraform cannot validate such a module as a root module
# (no provider configuration exists for the alias — "Provider configuration not present"), so CI
# validates it through this root, exactly as environments/dev calls it. Never applied.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

variable "region" {
  description = "Primary region used only for validation; environments set the real value (ADR-008)."
  type        = string
  default     = "me-central-1"
}

provider "aws" {
  region                      = var.region
  skip_credentials_validation = true
  skip_requesting_account_id  = true
}

# CloudFront/WAF global scope is always us-east-1 — an AWS constraint, not an environment choice.
provider "aws" {
  alias                       = "us_east_1"
  region                      = "us-east-1"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
}

module "cdn" {
  source = "../.."
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name                              = "quest-validate"
  media_bucket_regional_domain_name = "quest-validate-media.s3.me-central-1.amazonaws.com"
  api_origin_domain_name            = "quest-validate-alb.me-central-1.elb.amazonaws.com"
  api_origin_shared_secret          = "validation-placeholder"
}
