@echo off
rem Starts the L'Or de Cambodge POS server (Node.js + SQL Server) and opens the login page.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
if not exist node_modules call npm install
if not exist .env (
  echo Missing .env file with the SQL Server settings. See README.md ^(Setup^).
  pause
  exit /b 1
)
start "LorDeCambodge-POS" /min node server\index.js
timeout /t 3 >nul
start "" http://localhost:5500/login.html
echo Server running at http://localhost:5500/login.html
echo Run stop.cmd to stop it.
