@echo off
rem Makes the installer (dist folder, 3DJames-Setup.exe) from the 3DJames folder above this one.
title Make 3DJames Installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build-3DJames.ps1" %*
pause
