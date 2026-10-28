@echo off
rem Connects Google Antigravity (free, from antigravity.google) to 3DJames, so its AI can work in the open
rem 3DJames window. Run it once after installing Antigravity (and again if you move the 3DJames folder).
title Connect Antigravity to 3DJames
"%~dp03DJamesLink.exe" --setup-antigravity
echo.
pause
