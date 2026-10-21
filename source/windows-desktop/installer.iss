#ifndef BuildRoot
  #error BuildRoot must name the build folder
#endif
#ifndef OutputRoot
  #error OutputRoot must name the output folder
#endif

[Setup]
AppId={{1DD45557-392A-4857-A312-BE7CA2B8D634}
AppName=3DJames
AppVersion=0.13.0
AppVerName=3DJames 0.13.0 Beta
AppPublisher=3DJames
DefaultDirName={autopf}\3DJames
DefaultGroupName=3DJames
DisableProgramGroupPage=yes
AllowNoIcons=no
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputRoot}
OutputBaseFilename=3DJames-0.13.0-Windows-Setup
SetupIconFile={#BuildRoot}\payload\3DJames.ico
UninstallDisplayIcon={app}\3DJames.exe
LicenseFile={#BuildRoot}\payload\LICENSE.txt
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UninstallDisplayName=3DJames
AppMutex=3DJames.Desktop.Running
ChangesAssociations=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#BuildRoot}\payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#BuildRoot}\deps\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{group}\3DJames"; Filename: "{app}\3DJames.exe"; WorkingDir: "{app}"; AppUserModelID: "3DJames.Desktop"
Name: "{group}\Uninstall 3DJames"; Filename: "{uninstallexe}"
Name: "{autodesktop}\3DJames"; Filename: "{app}\3DJames.exe"; WorkingDir: "{app}"; Tasks: desktopicon; AppUserModelID: "3DJames.Desktop"

[Run]
Filename: "{app}\3DJames.exe"; Description: "Launch 3DJames"; Flags: nowait postinstall skipifsilent

[Code]
const
  WebViewKey = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function RuntimeInstalled: Boolean;
var
  Version: String;
begin
  Result := (RegQueryStringValue(HKLM32, WebViewKey, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM64, WebViewKey, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, WebViewKey, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if not RuntimeInstalled then
  begin
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      Result := 'The Microsoft WebView2 runtime installer could not start. Connect to the internet and try again.'
    else if not RuntimeInstalled then
      Result := 'Microsoft WebView2 could not be installed (exit code ' + IntToStr(ExitCode) + '). Connect to the internet and try again, or install the WebView2 Evergreen runtime from Microsoft first.';
  end;
end;
