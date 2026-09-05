variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "container_image" {
  description = "Immutable image reference (ECR URI with digest/tag); supplied by CI, never hardcoded"
  type        = string
}

variable "container_port" {
  type    = number
  default = 4000
}

variable "task_cpu" {
  type    = number
  default = 512
}

variable "task_memory" {
  type    = number
  default = 1024
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "max_count" {
  type    = number
  default = 4
}

variable "use_fargate_spot" {
  description = "Spot for dev/staging cost savings; false in production"
  type        = bool
  default     = true
}

variable "enable_exec" {
  description = "ECS Exec for debugging (dev only)"
  type        = bool
  default     = false
}

variable "certificate_arn" {
  description = "ACM certificate in the same region for the ALB HTTPS listener (null = HTTP only, dev bootstrap)"
  type        = string
  default     = null
}

variable "origin_shared_secret" {
  description = "Value CloudFront sends in x-quest-origin-secret; ALB forwards only matching requests"
  type        = string
  sensitive   = true
  default     = ""
}

variable "environment" {
  description = "Plain (non-secret) environment variables for the container"
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Secret environment variables injected from Secrets Manager (name => secret ARN[:json-key])"
  type = list(object({
    name       = string
    value_from = string
  }))
  default = []
}

variable "media_bucket_arn" {
  type = string
}

variable "event_bus_arn" {
  type = string
}

variable "consumer_queue_arns" {
  type    = list(string)
  default = []
}

variable "log_group_name" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
