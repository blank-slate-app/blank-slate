@echo off
REM Stage + push the community catalog. Edit REPO_URL if your repo differs.
set REPO_URL=https://github.com/blank-slate-app/community.git

cd /d "%~dp0.."
echo Staging the community package from _decks/ ...
call node js\publish-community.js
if errorlevel 1 (
    echo Staging failed.
    pause
    exit /b 1
)

cd /d "..\_TECH Blank Slate Community"
if not exist ".git" (
    git init -b main
    git remote add origin %REPO_URL%
)
git add -A
git commit -m "Update community catalog" || echo Nothing new to commit.
git push -u origin main
echo.
echo Done — the app's Community panels update within a minute.
pause
