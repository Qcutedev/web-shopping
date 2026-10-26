# Builds the runtime and migrate images, starts a throwaway PostgreSQL, applies the committed
# migrations with the migrate image, starts the runtime image, and checks /api/health, one read
# path, and the security headers (T-071, T-072). Local use. Deploys nothing, pushes nothing.
#
#   pwsh/powershell -File scripts/container-smoke.ps1
#
# All secrets are generated for the run and exist only in this process and the containers,
# which are removed at the end. Requires Docker.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$suffix = -join ((48..57) + (97..122) | Get-Random -Count 8 | ForEach-Object { [char]$_ })
$net = "mkt-smoke-$suffix"
$netInternal = "mkt-smoke-int-$suffix"
$db = "mkt-smoke-db-$suffix"
$app = "mkt-smoke-app-$suffix"
$appImage = "marketplace:smoke"
$migImage = "marketplace-migrate:smoke"
# Staging and production serve over https; the build and the container must agree on this.
$appUrl = "https://smoke.invalid"
$hostPort = 3217

function New-RandomToken([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return [Convert]::ToBase64String($buffer).TrimEnd("=").Replace("+", "A").Replace("/", "B")
}

$dbPassword = New-RandomToken 24
$authSecret = New-RandomToken 48
$databaseUrl = "postgresql://smoke:$dbPassword@${db}:5432/smoke?schema=public"
$failed = $false

function Step([string]$text) { Write-Host "== $text" }
function Check([bool]$ok, [string]$text) {
  if ($ok) { Write-Host "PASS  $text" } else { Write-Host "FAIL  $text"; $script:failed = $true }
}

try {
  Step "build runtime and migrate images"
  docker build --target runtime --build-arg APP_URL=$appUrl -t $appImage .
  if ($LASTEXITCODE -ne 0) { throw "runtime build failed" }
  docker build --target migrate --build-arg APP_URL=$appUrl -t $migImage .
  if ($LASTEXITCODE -ne 0) { throw "migrate build failed" }

  Step "throwaway database"
  docker network create $net | Out-Null
  # No route to the internet: proves the migration step needs no download.
  docker network create --internal $netInternal | Out-Null
  docker run -d --name $db --network $net `
    -e POSTGRES_USER=smoke -e POSTGRES_PASSWORD=$dbPassword -e POSTGRES_DB=smoke `
    postgres:18-trixie@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336 | Out-Null
  docker network connect $netInternal $db | Out-Null
  for ($i = 0; $i -lt 40; $i++) {
    docker exec $db pg_isready -h 127.0.0.1 -U smoke -d smoke 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 2
  }
  Start-Sleep -Seconds 3

  Step "apply migrations (migrate image, internal network, no internet)"
  docker run --rm --network $netInternal -e DATABASE_URL=$databaseUrl $migImage
  Check ($LASTEXITCODE -eq 0) "prisma migrate deploy exit 0"

  Step "start runtime image"
  docker run -d --name $app --network $net -p "127.0.0.1:${hostPort}:3000" `
    -e APP_URL=$appUrl -e DATABASE_URL=$databaseUrl -e AUTH_SECRET=$authSecret `
    -e TRUSTED_PROXY_HOPS=0 -e LOG_LEVEL=info $appImage | Out-Null
  $code = ""
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $code = curl.exe --silent --output NUL --write-out "%{http_code}" "http://127.0.0.1:$hostPort/api/health"
    if ($code -eq "200") { break }
  }
  Check ($code -eq "200") "GET /api/health returns 200 (got $code)"
  Check ((curl.exe --silent "http://127.0.0.1:$hostPort/api/health") -eq '{"status":"ok","database":"up"}') "health body"
  $read = curl.exe --silent --output NUL --write-out "%{http_code}" "http://127.0.0.1:$hostPort/"
  Check ($read -eq "200") "GET / returns 200 (got $read)"

  Step "security headers from the running container"
  $headers = (curl.exe --silent --head "http://127.0.0.1:$hostPort/") -join "`n"
  foreach ($name in "content-security-policy", "x-content-type-options: nosniff", "x-frame-options: DENY",
      "referrer-policy", "permissions-policy", "cross-origin-opener-policy", "strict-transport-security") {
    Check ($headers -imatch [regex]::Escape($name)) "header $name"
  }
  Check ($headers -match "upgrade-insecure-requests") "CSP has upgrade-insecure-requests (APP_URL https at build)"
  Check ($headers -notmatch "(?i)x-powered-by") "no x-powered-by"

  Step "container facts"
  $user = docker exec $app id -u
  Check ($user -ne "0") "runs as non-root (uid $user)"
  docker exec $app sh -c "test ! -e node_modules/.bin/prisma"
  Check ($LASTEXITCODE -eq 0) "no prisma CLI in runtime image"
  docker exec $app sh -c "ls -A /app | grep -E '^\.env' ; test `$? -ne 0"
  Check ($LASTEXITCODE -eq 0) "no .env file in the runtime image"
  $status = ""
  for ($i = 0; $i -lt 20; $i++) {
    $status = docker inspect $app --format "{{.State.Health.Status}}"
    if ($status -eq "healthy") { break }
    Start-Sleep -Seconds 5
  }
  Check ($status -eq "healthy") "Docker HEALTHCHECK reports healthy (got $status)"
}
finally {
  docker rm -f $app $db 2>$null | Out-Null
  docker network rm $net $netInternal 2>$null | Out-Null
}
if ($failed) { Write-Host "SMOKE FAILED"; exit 1 }
Write-Host "SMOKE OK"
