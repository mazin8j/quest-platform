variable "environment" {
  type = string
}

variable "secret_names" {
  description = "Map of logical secret name => description. Keys become Secrets Manager names quest/<env>/<key>."
  type        = map(string)
  default = {
    "api/session-signing-key"  = "Signing key for API sessions/tokens (Phase 01 Identity)"
    "api/ai-provider-api-key"  = "AI provider API key used only by the AI Gateway (Phase 06)"
    "cdn/origin-shared-secret" = "Header value proving requests to the ALB came through CloudFront"
  }
}

variable "kms_key_arn" {
  type    = string
  default = null
}

variable "recovery_window_in_days" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
