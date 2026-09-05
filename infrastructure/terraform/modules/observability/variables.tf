variable "name" {
  type = string
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "kms_key_arn" {
  type    = string
  default = null
}

variable "api_5xx_threshold_per_minute" {
  type    = number
  default = 10
}

variable "rds_instance_identifier" {
  type    = string
  default = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
