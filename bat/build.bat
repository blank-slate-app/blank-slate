@echo off
REM Build the distributable Windows app → dist/Blank-Slate-<version>-win.zip
REM Users unzip it anywhere (e.g. Documents\Blank-Slate) and run
REM Blank-Slate.exe — no Node needed. On first run the app seeds _tools/,
REM _baseline/, _projects/ and _decks/ NEXT TO THE EXE, so every tool stays
REM a visible, editable file.
cd /d "%~dp0.."
echo Installing build dependencies (first run may take a few minutes)...
call npm install
if errorlevel 1 ( echo npm install failed & pause & exit /b 1 )
echo Building...
call npm run build
if errorlevel 1 ( echo Build failed & pause & exit /b 1 )
echo.
echo Done. The zip is in the dist\ folder — that file is the download.
pause
