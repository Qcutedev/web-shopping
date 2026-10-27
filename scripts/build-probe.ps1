# Runs `next build` with NEXT_DIST_DIR set, so the build does not touch the shared `.next/`
# or the e2e server's `.next-e2e/`. Next rewrites tsconfig.json on such a build (adds include
# entries for the dist dir). This script reports that change, restores tsconfig.json to its
# pre-build content, and removes the dist dir. Local use. Deploys nothing.
#
#   powershell -File scripts/build-probe.ps1 [-DistDir .next-probe] [-KeepDist]
#
# Exit codes: 0 build passed and tsconfig.json change (if any) only adds entries that name the
# dist dir; 1 build failed or tsconfig.json changed in any other way; 2 bad arguments.
# tsconfig.json is restored in every case. It is restored to the content it had when the
# script started, so uncommitted edits you made on purpose are kept.
param(
  [string]$DistDir = ".next-probe",
  [switch]$KeepDist
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# The dist dir is deleted at the end, so only a dedicated `.next-<name>` directory is allowed.
if ($DistDir -notmatch '^\.next-[A-Za-z0-9_-]+$' -or $DistDir -eq ".next-e2e") {
  Write-Host "FAIL  -DistDir must match .next-<name> and must not be .next-e2e (got '$DistDir')"
  exit 2
}
if (Test-Path -LiteralPath $DistDir) {
  Write-Host "FAIL  $DistDir already exists; another run may be using it. Pick another -DistDir."
  exit 2
}

$tsconfig = Join-Path $root "tsconfig.json"
$original = [IO.File]::ReadAllBytes($tsconfig)
$originalText = [Text.Encoding]::UTF8.GetString($original)
$exit = 0
$prevDist = $env:NEXT_DIST_DIR

try {
  Write-Host "== next build with NEXT_DIST_DIR=$DistDir"
  $env:NEXT_DIST_DIR = $DistDir
  pnpm exec next build
  $buildCode = $LASTEXITCODE
  if ($buildCode -ne 0) {
    Write-Host "FAIL  next build exited $buildCode"
    $exit = 1
  } else {
    Write-Host "PASS  next build exited 0"
  }

  Write-Host "== tsconfig.json after build"
  $after = [IO.File]::ReadAllBytes($tsconfig)
  $afterText = [Text.Encoding]::UTF8.GetString($after)
  if ($afterText -ceq $originalText) {
    Write-Host "PASS  tsconfig.json unchanged"
  } else {
    # Next reformats the JSON layout, so compare parsed content, not lines.
    $o = $originalText | ConvertFrom-Json
    $n = $afterText | ConvertFrom-Json
    $oInc = @($o.include)
    $nInc = @($n.include)
    $removed = @($oInc | Where-Object { $nInc -notcontains $_ })
    $added = @($nInc | Where-Object { $oInc -notcontains $_ })
    $o.PSObject.Properties.Remove("include")
    $n.PSObject.Properties.Remove("include")
    $otherChanged = (($o | ConvertTo-Json -Depth 20 -Compress) -ne ($n | ConvertTo-Json -Depth 20 -Compress))
    Write-Host "tsconfig.json changed by the build (parsed comparison):"
    $removed | ForEach-Object { Write-Host "  include - $_" }
    $added | ForEach-Object { Write-Host "  include + $_" }
    if ($otherChanged) { Write-Host "  other settings differ" }
    $escaped = [regex]::Escape($DistDir)
    $unexpected = @($added | Where-Object { $_ -notmatch $escaped }) + $removed
    if ($otherChanged -or $unexpected.Count -gt 0) {
      Write-Host "FAIL  unexpected tsconfig.json change (only added include entries naming $DistDir are expected)"
      $exit = 1
    } else {
      Write-Host "INFO  expected: only include entries naming $DistDir were added (file layout may also be reformatted)"
    }
    Write-Host "== git diff --stat -- tsconfig.json (against HEAD, includes your own edits)"
    git diff --stat -- tsconfig.json
  }
}
finally {
  [IO.File]::WriteAllBytes($tsconfig, $original)
  Write-Host "== restored tsconfig.json to its content at script start"
  if ($null -eq $prevDist) { Remove-Item Env:NEXT_DIST_DIR -ErrorAction SilentlyContinue } else { $env:NEXT_DIST_DIR = $prevDist }
  if (-not $KeepDist -and (Test-Path -LiteralPath $DistDir)) {
    Remove-Item -LiteralPath $DistDir -Recurse -Force
    Write-Host "== removed $DistDir"
  }
}

if ($exit -eq 0) { Write-Host "PASS  build probe" } else { Write-Host "FAIL  build probe" }
exit $exit
