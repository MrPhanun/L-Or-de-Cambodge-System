@echo off
rem Stops the DEV (5500) and PROD (5600) servers if they are running.
powershell -NoProfile -Command "foreach ($p in 5500,5600) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; Write-Host \"Stopped server on port $p.\" } else { Write-Host \"Nothing running on port $p.\" } }"
