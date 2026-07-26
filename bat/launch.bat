@echo off
title Blank-Slate
rem Launches Blank-Slate. Lives in bat\ — works from the app root one level up.
cd /d "%~dp0.."
if not exist "node_modules" (
    echo Installing dependencies... This may take a minute on first run.
    call npm install
)
call npx electron .
