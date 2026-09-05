variable "name" {
  type = string
}

variable "consumer_queues" {
  description = "Consumer groups keyed by name; each receives events whose detail-type starts with any listed prefix"
  type = map(object({
    event_type_prefixes        = list(string)
    visibility_timeout_seconds = optional(number, 60)
    max_receive_count          = optional(number, 5)
  }))
  default = {
    workers = {
      event_type_prefixes = ["quest.", "participation.", "proof.", "identity."]
    }
  }
}

variable "archive_retention_days" {
  type    = number
  default = 7
}

variable "alarm_topic_arn" {
  type    = string
  default = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
