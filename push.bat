@echo off
setlocal EnableDelayedExpansion
title Blank-Slate - push update
cd /d "%~dp0"

rem ── guard: needs the git repo (see README.md "Git & GitHub" to set up) ──
if not exist ".git" (
    echo This folder is not a git repository yet.
    echo See README.md, section "Git ^& GitHub", then run push.bat again.
    pause
    exit /b 1
)

rem ── anything new? ──
git status --porcelain > "%TEMP%\bs_status.tmp"
set CHANGES=
for /f "usebackq delims=" %%s in ("%TEMP%\bs_status.tmp") do set CHANGES=1
del "%TEMP%\bs_status.tmp" >nul 2>&1

if not defined CHANGES (
    echo No file changes - pushing any unpushed commits...
    git push -u origin main --follow-tags
    pause
    exit /b 0
)

rem ── commit message ──
set MSG=
set /p MSG="Commit message (Enter for 'update'): "
if "!MSG!"=="" set MSG=update

rem ── bump the version (patch: 2.0.1 -> 2.0.2). Edit 'patch' to 'minor'
rem    or 'major' for bigger releases. ──
set NEWVER=
for /f "delims=" %%v in ('npm version patch --no-git-tag-version') do set NEWVER=%%v
if not defined NEWVER (
    echo Version bump failed - is npm installed?
    pause
    exit /b 1
)

echo.
echo Committing !NEWVER!: !MSG!
git add -A
git commit -m "!NEWVER!: !MSG!"
git tag -a "!NEWVER!" -m "!MSG!"
git push -u origin main --follow-tags

echo.
echo Pushed !NEWVER! to https://github.com/blank-slate-app/blank-slate
pause
