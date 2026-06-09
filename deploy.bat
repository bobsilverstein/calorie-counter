@echo off
firebase deploy --only hosting
if %errorlevel%==0 (
    timeout /t 1 >nul
    exit
) else (
    echo.
    echo Deployment FAILED. Window will remain open.
    echo.
    pause
)

