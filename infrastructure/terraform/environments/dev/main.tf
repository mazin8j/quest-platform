locals {
  name = "quest-${var.environment}"
  tags = {
    Project     = "quest"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

module "networking" {
  source             = "../../modules/networking"
  name               = local.name
  region             = var.region
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
  nat_gateway_count  = var.nat_gateway_count
  tags               = local.tags
}

module "observability" {
  source                  = "../../modules/observability"
  name                    = local.name
  log_retention_days      = var.log_retention_days
  rds_instance_identifier = "${local.name}-postgres"
  tags                    = local.tags
}

module "secrets" {
  source      = "../../modules/secrets"
  environment = var.environment
  tags        = local.tags
}

module "messaging" {
  source          = "../../modules/messaging"
  name            = local.name
  alarm_topic_arn = module.observability.alerts_topic_arn
  tags            = local.tags
}

module "media" {
  source          = "../../modules/s3-media"
  bucket_name     = var.media_bucket_name
  allowed_origins = var.web_origins
  force_destroy   = var.environment == "dev"
  tags            = local.tags
}

module "api" {
  source              = "../../modules/ecs-service"
  name                = local.name
  vpc_id              = module.networking.vpc_id
  public_subnet_ids   = module.networking.public_subnet_ids
  private_subnet_ids  = module.networking.private_subnet_ids
  container_image     = var.api_container_image
  desired_count       = var.api_desired_count
  use_fargate_spot    = var.environment != "production"
  enable_exec         = var.environment == "dev"
  certificate_arn     = var.alb_certificate_arn
  media_bucket_arn    = module.media.bucket_arn
  event_bus_arn       = module.messaging.event_bus_arn
  consumer_queue_arns = values(module.messaging.queue_arns)
  log_group_name      = module.observability.api_log_group_name

  environment = {
    NODE_ENV             = var.environment == "dev" ? "development" : var.environment
    LOG_LEVEL            = "info"
    API_PORT             = "4000"
    CORS_ALLOWED_ORIGINS = join(",", var.web_origins)
    # CloudFront -> ALB: two trusted hops, so rate limits key on the real client IP.
    TRUST_PROXY_HOPS  = "2"
    DATABASE_SSL      = "true"
    S3_REGION         = var.region
    S3_BUCKET         = module.media.bucket_name
    AI_PROVIDER       = "none"
    OTEL_ENABLED      = "false"
    OTEL_SERVICE_NAME = "quest-api"
  }

  # DATABASE_URL / REDIS_URL are assembled by the deploy pipeline from RDS/ElastiCache outputs plus
  # the RDS-managed secret; committed Terraform never sees a connection string.
  secrets = []

  tags = local.tags
}

module "postgres" {
  source                     = "../../modules/rds-postgres"
  name                       = local.name
  vpc_id                     = module.networking.vpc_id
  private_subnet_ids         = module.networking.private_subnet_ids
  allowed_security_group_ids = [module.api.task_security_group_id]
  instance_class             = var.db_instance_class
  multi_az                   = var.environment == "production"
  deletion_protection        = var.environment != "dev"
  backup_retention_days      = var.environment == "production" ? 14 : 3
  tags                       = local.tags
}

module "redis" {
  source                     = "../../modules/elasticache-redis"
  name                       = local.name
  vpc_id                     = module.networking.vpc_id
  private_subnet_ids         = module.networking.private_subnet_ids
  allowed_security_group_ids = [module.api.task_security_group_id]
  node_type                  = var.redis_node_type
  node_count                 = var.environment == "production" ? 2 : 1
  tags                       = local.tags
}

module "cdn" {
  source = "../../modules/cdn-waf"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
  name                              = local.name
  media_bucket_regional_domain_name = module.media.bucket_regional_domain_name
  api_origin_domain_name            = module.api.alb_dns_name
  api_origin_https                  = var.alb_certificate_arn != null
  api_origin_shared_secret          = var.cdn_origin_shared_secret
  aliases                           = var.cdn_aliases
  acm_certificate_arn               = var.cdn_certificate_arn
  tags                              = local.tags
}
