variable "environment" {
  description = "dev | staging | production"
  type        = string
  default     = "dev"
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "environment must be dev, staging or production."
  }
}

variable "region" {
  description = "Initial region per ADR-008 (AWS Middle East UAE)"
  type        = string
  default     = "me-central-1"
}

variable "availability_zones" {
  type    = list(string)
  default = ["me-central-1a", "me-central-1b"]
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "nat_gateway_count" {
  type    = number
  default = 1
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "media_bucket_name" {
  description = "Globally unique; set in tfvars (e.g. quest-dev-media-<random-suffix>)"
  type        = string
}

variable "web_origins" {
  description = "Browser origins allowed for CORS and pre-signed uploads"
  type        = list(string)
  default     = ["http://localhost:3000", "http://localhost:3001"]
}

variable "api_container_image" {
  description = "ECR image URI for the API (built and pushed by CI)"
  type        = string
}

variable "api_desired_count" {
  type    = number
  default = 1
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "alb_certificate_arn" {
  description = "Regional ACM certificate for the ALB (null = HTTP-only bootstrap)"
  type        = string
  default     = null
}

variable "cdn_certificate_arn" {
  description = "us-east-1 ACM certificate for CloudFront aliases (null = default domain)"
  type        = string
  default     = null
}

variable "cdn_aliases" {
  type    = list(string)
  default = []
}

variable "cdn_origin_shared_secret" {
  description = "Supplied at plan/apply time from Secrets Manager (TF_VAR_cdn_origin_shared_secret); never committed"
  type        = string
  sensitive   = true
  default     = ""
}
