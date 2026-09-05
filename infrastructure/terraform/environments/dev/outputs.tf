output "vpc_id" {
  value = module.networking.vpc_id
}

output "api_alb_dns_name" {
  value = module.api.alb_dns_name
}

output "cdn_domain_name" {
  value = module.cdn.distribution_domain_name
}

output "postgres_endpoint" {
  value = module.postgres.endpoint
}

output "postgres_master_user_secret_arn" {
  value = module.postgres.master_user_secret_arn
}

output "redis_primary_endpoint" {
  value = module.redis.primary_endpoint
}

output "media_bucket_name" {
  value = module.media.bucket_name
}

output "event_bus_name" {
  value = module.messaging.event_bus_name
}

output "queue_urls" {
  value = module.messaging.queue_urls
}

output "secret_arns" {
  value = module.secrets.secret_arns
}

output "alerts_topic_arn" {
  value = module.observability.alerts_topic_arn
}
