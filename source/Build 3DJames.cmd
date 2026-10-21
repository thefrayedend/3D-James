@echo off
rem Rebuilds 3DJames.html from the source folder after you change the code.
rem Double-click it (it lives in the "source" folder). The first time it downloads the building blocks (needs internet).
cd /d "%~dp0"
where node >nul 2>nul || (echo. & echo Node.js is not installed. Get the LTS version from https://nodejs.org then try again. & pause & exit /b 1)
set PY=python
where python >nul 2>nul || set PY=py
where %PY% >nul 2>nul || (echo. & echo Python is not installed. Get it from https://www.python.org (tick "Add python to PATH"^) then try again. & pause & exit /b 1)
if not exist node_modules (
  echo First time: downloading the building blocks...
  call npm install || (echo npm install failed & pause & exit /b 1)
)
echo Building...
%PY% build.py || (echo. & echo BUILD FAILED - see the message above. Your old 3DJames.html was not touched. & pause & exit /b 1)
copy /y "local\3DJames.html" "..\3DJames.html" >nul
echo.
echo Done! The new 3DJames.html is in the main 3DJames folder. Close 3DJames and open it again.
pause
