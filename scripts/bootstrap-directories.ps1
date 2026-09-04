$dirs = @(
  'apps/mobile','apps/web','apps/admin','apps/api',
  'packages/ui','packages/types','packages/config','packages/events','packages/ai','packages/analytics',
  'infrastructure/terraform','infrastructure/docker',
  'docs/api','docs/data','docs/ai','docs/security','docs/safety','docs/ux',
  'tests'
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
Write-Host 'QUEST directory skeleton created.'
