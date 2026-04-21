@echo off
REM start-backend.bat - Start the LexiThera backend server
setlocal
cd /d "%~dp0"

echo Starting LexiThera Backend API Server...
echo.

cd nodejs\backend
call npm start
if %ERRORLEVEL% neq 0 (
    echo.
    echo Backend server failed to start!
    pause
)

