$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
$entryPoint = Join-Path $projectRoot 'index.js'
$running = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and
  $_.CommandLine -match [regex]::Escape($entryPoint)
}

if ($running) {
  Write-Output "daily-news-bot is already running (PID $($running[0].ProcessId))."
  exit 0
}

$logDir = Join-Path $projectRoot 'tmp'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Start-Process -FilePath $nodePath -ArgumentList "`"$entryPoint`"" -WorkingDirectory $projectRoot -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir 'bot-runtime.stdout.log') `
  -RedirectStandardError (Join-Path $logDir 'bot-runtime.stderr.log')
Write-Output 'daily-news-bot started.'
