@echo off
title Blank-Slate
rem Launches Blank-Slate from wherever this .bat lives (safe to move/rename the folder)
cd /d "%~dp0"
if not exist "node_modules" (
    echo Installing dependencies... This may take a minute on first run.
    call npm install
)
call npx electron .
