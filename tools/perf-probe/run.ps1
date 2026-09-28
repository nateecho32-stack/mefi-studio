# Runs tools/perf-probe/probe.cjs on a plan with the repository's Electron.
#   powershell -File tools/perf-probe/run.ps1 -Plan tools/perf-probe/plans/before-after.json -Pages <dir with the probe pages> -Out <scratch>/result.json
# Pages come from make_probe.cjs; results, logs and screenshots land next to -Out.
param([Parameter(Mandatory)][string]$Plan, [Parameter(Mandatory)][string]$Out, [Parameter(Mandatory)][string]$Pages, [int]$TimeoutSec = 600)
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$env:PROBE_DIR = (Resolve-Path $Pages).Path
$env:PLAN = (Resolve-Path $Plan).Path
$env:OUT = [System.IO.Path]::GetFullPath($Out)
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
if (Test-Path $env:OUT) { Remove-Item $env:OUT }
$electron = Join-Path $repo "node_modules\electron\dist\electron.exe"
$p = Start-Process -FilePath $electron -ArgumentList "`"$PSScriptRoot\probe.cjs`"" -PassThru -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while (-not $p.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force; "killed after timeout" }
$log = $env:OUT -replace '\.json$', '.log'
Get-Content $log | Select-String "RESULT|SHOT|FAILED|failed|fatal|console" | ForEach-Object { $_.Line.Substring(0, [Math]::Min(2400, $_.Line.Length)) }
