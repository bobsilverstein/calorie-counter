@echo off
setlocal enabledelayedexpansion

:: --- ABSOLUTE PATHS ---
set REPO=G:\Users\Bob\Documents\CalorieCounter
set HOST=G:\Users\Bob\Documents\CalorieCounter\Firebase-hosting
set PUB=%HOST%\public
set LOG=%HOST%\deploy.log

:: --- TIMESTAMP (YYYY-MM-DD_HH-MM-SS) ---
for /f "tokens=1-3 delims=/ " %%a in ("%date%") do (
    set MM=%%a
    set DD=%%b
    set YYYY=%%c
)
set HH=%time:~0,2%
if "%HH:~0,1%"==" " set HH=0%HH:~1,1%
set TS=%YYYY%-%MM%-%DD%_%HH%-%time:~3,2%-%time:~6,2%

:: --- VERSION NUMBER (AUTO-INCREMENT) ---
set VERFILE=%HOST%\version.txt

if not exist "%VERFILE%" (
    echo 1 > "%VERFILE%"
)

set /p BUILD=<"%VERFILE%"
set /a BUILD=BUILD+1
echo %BUILD% > "%VERFILE%"

set VERSION=v%BUILD%_%TS%

cls
echo Pulling latest changes...

:: --- GIT PULL (silent) ---
cd /d "%REPO%"
git pull >nul 2>&1

echo Stamping version: %VERSION%

:: --- WRITE VERSION INTO index.html ---
powershell -command "(Get-Content '%PUB%\index.html') -replace '<!--VERSION-->', '%VERSION%' | Set-Content '%PUB%\index.html'"

:: --- WRITE VERSION INTO app.js (top comment) ---
powershell -command \"\"\"$v='// %VERSION%'; $c=Get-Content '%PUB%\app.js'; $v, $c | Set-Content '%PUB%\app.js'\"\"\" >nul 2>&1

echo Deploying to Firebase...

:: --- FIREBASE DEPLOY (silent) ---
cd /d "%HOST%"
firebase deploy --only hosting >nul 2>&1

if %errorlevel%==0 (
    echo [%TS%] SUCCESS %VERSION% >> "%LOG%"
    echo Done.

    :: --- AUTO-OPEN LIVE SITE WITH CACHE-BUSTER ---
    start "" "https://calorie-counter-cdcbe.web.app/?force=%TS%"

    timeout /t 1 >nul
    exit
) else (
    echo [%TS%] FAILURE %VERSION% >> "%LOG%"
    echo Deployment FAILED.
    echo.
    pause
)
