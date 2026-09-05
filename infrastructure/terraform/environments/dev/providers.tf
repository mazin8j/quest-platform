terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }

  # Remote state: bucket/table/key are supplied with `-backend-config` (see README.md) so no
  # account-specific value is committed (CLAUDE.md rule 13).
  backend "s3" {
    encrypt = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = local.tags
  }
}

# CloudFront-scoped WAF and ACM certificates for CloudFront must be created in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = local.tags
  }
}
