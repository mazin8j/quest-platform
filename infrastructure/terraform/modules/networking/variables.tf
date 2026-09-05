variable "name" {
  description = "Name prefix, e.g. quest-dev"
  type        = string
}

variable "region" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "availability_zones" {
  description = "Two or more AZs in the target region"
  type        = list(string)
  validation {
    condition     = length(var.availability_zones) >= 2
    error_message = "Provide at least two availability zones."
  }
}

variable "nat_gateway_count" {
  description = "0 = no egress from private subnets, 1 = shared NAT (dev), az_count = HA"
  type        = number
  default     = 1
}

variable "enable_flow_logs" {
  type    = bool
  default = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
