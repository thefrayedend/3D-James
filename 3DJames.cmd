@echo off
rem Opens 3DJames in its own app window (Microsoft Edge app mode). Nothing is sent online.
start "" msedge --app="file:///%~dp03DJames.html" --window-size=1440,900
