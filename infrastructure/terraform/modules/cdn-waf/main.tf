terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.80"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

# ---------- WAF (CloudFront scope must live in us-east-1) ----------
resource "aws_wafv2_web_acl" "cdn" {
  provider = aws.us_east_1
  name     = "${var.name}-cdn"
  scope    = "CLOUDFRONT"
  tags     = var.tags

  default_action {
    allow {}
  }

  rule {
    name     = "aws-common"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-cdn-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-cdn-kbi"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 10
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5_minutes
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-cdn-rate"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name}-cdn"
    sampled_requests_enabled   = true
  }
}

# ---------- CloudFront in front of the media bucket (OAC) and the API (ALB) ----------
resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${var.name}-media-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = "QUEST ${var.name}: media (S3/OAC) + API (ALB)"
  price_class         = var.price_class
  web_acl_id          = aws_wafv2_web_acl.cdn.arn
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  aliases             = var.aliases
  default_root_object = null
  tags                = var.tags

  origin {
    origin_id                = "media"
    domain_name              = var.media_bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  origin {
    origin_id   = "api"
    domain_name = var.api_origin_domain_name
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = var.api_origin_https ? "https-only" : "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
    custom_header {
      name  = "x-quest-origin-secret"
      value = var.api_origin_shared_secret
    }
  }

  # Media: cacheable, immutable object keys.
  default_cache_behavior {
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # AWS managed: CachingOptimized
  }

  # API: never cached at the edge; forwards all headers/cookies/query strings.
  ordered_cache_behavior {
    path_pattern             = "/v*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # AWS managed: CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AWS managed: AllViewer
  }

  restrictions {
    geo_restriction {
      restriction_type = length(var.geo_blocked_countries) > 0 ? "blacklist" : "none"
      locations        = var.geo_blocked_countries
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == null
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = var.acm_certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.acm_certificate_arn == null ? "TLSv1" : "TLSv1.2_2021"
  }
}
