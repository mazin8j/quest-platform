variable "bucket_name" {
  description = "Globally unique bucket name, e.g. quest-dev-media-<account-suffix> (supplied via tfvars, never hardcoded)"
  type        = string
}

variable "allowed_origins" {
  description = "Origins allowed to PUT pre-signed uploads (web + admin URLs; mobile uses native origin)"
  type        = list(string)
}

variable "versioning" {
  type    = bool
  default = true
}

variable "force_destroy" {
  description = "Allow terraform destroy to delete objects (dev only)"
  type        = bool
  default     = false
}

variable "kms_key_arn" {
  type    = string
  default = null
}

variable "cloudfront_distribution_arn" {
  description = "When set, grants that distribution read access via OAC"
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
