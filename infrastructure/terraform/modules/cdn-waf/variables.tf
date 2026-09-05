variable "name" {
  type = string
}

variable "media_bucket_regional_domain_name" {
  type = string
}

variable "api_origin_domain_name" {
  description = "ALB DNS name of the API"
  type        = string
}

variable "api_origin_https" {
  type    = bool
  default = false
}

variable "api_origin_shared_secret" {
  description = "Header value the ALB listener rule requires, so the API is reachable only through CloudFront. Supplied from Secrets Manager at plan time — never committed."
  type        = string
  sensitive   = true
}

variable "aliases" {
  type    = list(string)
  default = []
}

variable "acm_certificate_arn" {
  description = "Certificate in us-east-1 for the aliases (null = CloudFront default domain)"
  type        = string
  default     = null
}

variable "price_class" {
  description = "PriceClass_All is required for full MENA edge coverage; PriceClass_200 excludes some edges"
  type        = string
  default     = "PriceClass_200"
}

variable "rate_limit_per_5_minutes" {
  type    = number
  default = 3000
}

variable "geo_blocked_countries" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
