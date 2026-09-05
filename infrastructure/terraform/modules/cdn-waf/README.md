# cdn-waf

CloudFront distribution (media via OAC + `/v*` API path) fronted by a CloudFront-scoped WAFv2 web
ACL. Because CloudFront-scoped WAF must be created in **us-east-1**, the module requires a second
provider configuration via `configuration_aliases = [aws.us_east_1]`.

Consequence: this module **cannot be validated as a root module** (`terraform validate` in this
directory fails with "Provider configuration not present"). Validate it through
`examples/validate/` (what CI does) or through `environments/dev`, both of which pass
`providers = { aws = aws, aws.us_east_1 = aws.us_east_1 }`.
