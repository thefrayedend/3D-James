@echo off
rem Puts a 3DJames shortcut (with the 3DJames icon) on your desktop. You only need to run this once.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0icon\make-shortcut.ps1"
pause
