@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 goto failed

rem Keep this file ASCII and save with Windows CRLF line endings.
rem Prefer an installed Node.js, then use the runtime already on this PC.
set "PVZ_NODE_EXE="
for /f "delims=" %%N in ('where.exe node.exe 2^>nul') do call :check_node "%%N"
call :check_node "%ProgramFiles%\nodejs\node.exe"
call :check_node "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined PVZ_NODE_EXE goto missing_node

rem npm and build tools must use the same Node.js as the server.
for %%N in ("%PVZ_NODE_EXE%") do set "PATH=%%~dpN;%PATH%"
if not exist server\index.ts goto incomplete
if exist dist\index.html goto run
where.exe npm.cmd >nul 2>&1
if errorlevel 1 goto missing_build_tools
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 goto failed
)
call npm.cmd run build
if errorlevel 1 goto failed

:run
if not defined HOST set "HOST=127.0.0.1"
if not defined PORT set "PORT=3001"
echo Game URL: http://%HOST%:%PORT%
echo Keep this window open. Press Ctrl+C to stop the server.
echo Node.js: "%PVZ_NODE_EXE%"
"%PVZ_NODE_EXE%" server/index.ts
if errorlevel 1 goto failed
exit /b 0

:check_node
if defined PVZ_NODE_EXE exit /b 0
if not exist "%~1" exit /b 0
"%~1" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>&1
if errorlevel 1 exit /b 0
set "PVZ_NODE_EXE=%~1"
exit /b 0

:missing_node
echo Node.js 24 or newer was not found.
echo Install Node.js 24 LTS from https://nodejs.org and run this file again.
goto failed

:incomplete
echo Missing server\index.ts. Put this launcher inside the complete pvz folder.
goto failed

:missing_build_tools
echo Missing dist\index.html and npm.cmd.
echo Restore the complete dist folder, or install Node.js 24 LTS with npm.
goto failed

:failed
echo Startup failed. Please send the error messages above for troubleshooting.
pause
exit /b 1
