@echo off
rem PRODUCTION server (real data, database LorDeCambodgeDB) on http://localhost:5600
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. & pause & exit /b 1)
if not exist node_modules call npm install --omit=dev
if not exist .env.production (echo Missing .env.production - see README.md & pause & exit /b 1)
start "LorDeCambodge-PROD" /min node server\index.js --env=production
timeout /t 3 >nul
start "" http://localhost:5600/login.html
echo PROD server running at http://localhost:5600/login.html   (stop.cmd stops it)
