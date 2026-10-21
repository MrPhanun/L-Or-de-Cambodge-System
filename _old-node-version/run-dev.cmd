@echo off
rem DEVELOPMENT server (demo data, database LorDeCambodgeDB_Dev) on http://localhost:5500
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. & pause & exit /b 1)
if not exist node_modules call npm install
if not exist .env.development (echo Missing .env.development - see README.md & pause & exit /b 1)
start "LorDeCambodge-DEV" /min node server\index.js --env=development
timeout /t 3 >nul
start "" http://localhost:5500/login.html
echo DEV server running at http://localhost:5500/login.html   (stop.cmd stops it)
