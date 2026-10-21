3DJames 0.13.0 Beta - Windows desktop edition
============================================

INSTALL
Run 3DJames-0.13.0-Windows-Setup.exe.
Choose installation for everyone (Program Files, administrator approval needed)
or just your Windows account (LocalAppData\Programs, no administrator needed).
The installer creates Start menu entries and an Installed apps entry.
A desktop shortcut is optional.

Windows 10 version 1809 or newer, or Windows 11, 64-bit x64.
The .NET Framework 4.7.2 or later and Microsoft WebView2 runtime are required.
Windows 10/11 normally includes the framework. If WebView2 is missing, the
installer downloads it from Microsoft; internet is needed for that step.
Modeling and project files work offline after setup.

USE
Launch 3DJames from Start. It opens in its own desktop window.
Open existing projects through the app's Open command; Save uses Windows dialogs.
Before switching from the browser edition, save current work as a .3dj project.
Browser-only sessions/backups are separate from the desktop edition's profile.

USER DATA AND UNINSTALL
Desktop settings and browser backups are stored under:
  %LOCALAPPDATA%\3DJames\WebView2
Your saved project files stay wherever you save them.
Uninstall from Windows Settings > Apps > Installed apps > 3DJames, or from the
Start menu's Uninstall 3DJames shortcut. Uninstall preserves your saved projects
and profile/backups so reinstalling can restore your work.

BUILD AND SOURCE
The installed folder includes 3DJames-Source.zip with the complete app and
desktop-host source. The app is GPL-3.0-or-later; see LICENSE.txt and the
licenses folder for bundled component notices. The WebView2 SDK is distributed
under Microsoft's SDK license, included separately.
To rebuild the installer on 64-bit Windows with Python 3 installed:
  python source\windows-desktop\build.py --app-root "path\to\3DJames"
Build dependencies are downloaded to the build folder on the first run.

This beta installer and launcher are unsigned. Windows may display an unknown
publisher or SmartScreen notice. A release signing certificate is needed before
distributing a signed public release.
