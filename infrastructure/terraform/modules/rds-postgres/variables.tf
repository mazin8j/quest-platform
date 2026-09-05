variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "allowed_security_group_ids" {
  description = "Security groups (ECS tasks, migration runner) allowed to reach port 5432"
  type        = list(string)
}

variable "engine_version" {
  type    = string
  default = "16"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "allocated_storage_gb" {
  type    = number
  default = 50
}

variable "max_allocated_storage_gb" {
  type    = number
  default = 200
}

variable "database_name" {
  type    = string
  default = "quest"
}

variable "master_username" {
  type    = string
  default = "quest_admin"
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "kms_key_arn" {
  description = "Customer-managed KMS key for storage encryption (null = AWS-managed key)"
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
