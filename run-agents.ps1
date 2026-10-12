# Runs Claude Code headless, one task per round, until ALL_DONE or LOOP_BLOCKED
# appears in docs/STATUS.md. Output is also appended to logs/run-agents.log.
Set-Location $PSScriptRoot

# PowerShell 5.1 mangles non-ASCII native-command arguments, so the Thai prompt
# goes through stdin as UTF-8 without BOM.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) {
    $fallback = Join-Path $env:APPDATA 'SPB_Data\.local\bin\claude.exe'
    if (Test-Path $fallback) { $claude = $fallback }
}
if (-not $claude) {
    Write-Host 'ไม่พบคำสั่ง claude ใน PATH'
    exit 1
}

$prompt = @"
อ่าน CLAUDE.md และ docs/STATUS.md แล้วรัน git status ตรวจงานค้างตามกฎใน CLAUDE.md
ทำงานถัดไปเพียง 1 งาน จบแล้ว commit และอัปเดต docs/STATUS.md แล้วหยุด
ถ้าไม่มีงานเหลือ ให้เขียนคำว่า ALL_DONE ใน docs/STATUS.md
ถ้าเจองานค้างที่พังหรือไม่สมบูรณ์ หรือต้องให้เจ้าของตัดสินใจหรืออนุมัติตาม CLAUDE.md
ห้ามเดา ห้ามลบงานค้าง ให้เขียนคำว่า LOOP_BLOCKED พร้อมเหตุผลเป็นภาษาไทยใน docs/STATUS.md แล้วหยุด
"@

# Headless mode cannot ask for permission, so allow edits and a fixed command set.
# Destructive git operations, pushes, and deploys stay denied.
$claudeArgs = @(
    '-p'
    '--model', 'sonnet'
    '--effort', 'medium'
    '--permission-mode', 'acceptEdits'
    '--allowedTools',
        'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)', 'Bash(git commit:*)',
        'PowerShell(git status:*)', 'PowerShell(git diff:*)', 'PowerShell(git log:*)', 'PowerShell(git add:*)', 'PowerShell(git commit:*)',
        'Bash(pnpm:*)', 'PowerShell(pnpm:*)'
)

$maxRounds = 10
$maxFailures = 4
$failures = 0
$statusPath = Join-Path $PSScriptRoot 'docs/STATUS.md'
$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir 'run-agents.log'

$round = 1
while ($round -le $maxRounds) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host "=== รอบที่ $round ($stamp) ==="
    Add-Content -Path $logPath -Value "=== round $round ($stamp) ==="

    $prompt | & $claude @claudeArgs 2>&1 | Tee-Object -FilePath $logPath -Append

    if ($LASTEXITCODE -ne 0) {
        $failures++
        if ($failures -ge $maxFailures) {
            Write-Host "ล้มเหลวติดกัน $failures ครั้ง หยุดการทำงาน ดู $logPath"
            exit 1
        }
        Write-Host 'ล้มเหลว (อาจโควต้าเต็ม) รอ 30 นาทีแล้วลองใหม่ รอบนี้ไม่นับ'
        Start-Sleep -Seconds 1800
        continue
    }
    $failures = 0

    if (Select-String -Path $statusPath -Pattern 'ALL_DONE' -Quiet) {
        Write-Host 'งานเสร็จครบ (ALL_DONE)'
        break
    }
    if (Select-String -Path $statusPath -Pattern 'LOOP_BLOCKED' -Quiet) {
        Write-Host 'ติดเรื่องที่ต้องให้เจ้าของตัดสินใจ (LOOP_BLOCKED) ดู docs/STATUS.md'
        break
    }

    $round++
    Start-Sleep -Seconds 10
}
