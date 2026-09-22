@echo off
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

rem Electron must not run as plain Node in this shell.
set "ELECTRON_RUN_AS_NODE="

set "PACKAGED=%ROOT%\dist\Mefi Studio AI+\Mefi Studio AI+.exe"
if exist "%PACKAGED%" (
    start "" "%PACKAGED%" %*
    exit /b 0
)

set "DEV_EXE=%ROOT%\node_modules\electron\dist\electron.exe"
if not exist "%DEV_EXE%" (
    echo Mefi's Studio AI+ is not installed yet.
    echo.
    echo Run once from a terminal (needs Node 24 and npm):
    echo   cd /d "%ROOT%"
    echo   npm ci
    echo   npm run build-booklet
    echo Then open this launcher again, or run: npm start
    echo Full steps: README.md and GETTING_STARTED.md in this folder.
    pause
    exit /b 1
)

pushd "%ROOT%"
start "Mefi's Studio AI+" "%DEV_EXE%" . %*
popd
exit /b 0
