<#
  Build-3DJames.ps1  -  builds the Windows installer for 3DJames.  Double-click "Make 3DJames Installer.cmd".

  It takes the app from the 3DJames folder (the folder above this one), as it is now:
    3DJames.html, 3DJamesLink.exe (the AI link), Connect Antigravity.cmd, GEMINI.md, .mcp.json,
    LICENSE.txt and the licenses folder.

  Output:  dist\3DJames-Setup.exe

  Before it makes the installer, it checks every file going in for personal details: your Windows user name,
  your full name, the computer's name, folder paths like C:\Users\..., and every word in "Private words.txt"
  (one per line, next to this script; that file never goes in). If one turns up, it stops and says where.

  Everything it needs is free and downloaded automatically the first time:
    - C# compiler: already built into Windows (.NET Framework 4.x)
    - Microsoft WebView2 SDK (from nuget.org)
    - Inno Setup 6 (installer builder, from jrsoftware.org - installed for your user only)

  Optional: -Version "1.2.0" (otherwise the version of the 3DJames app is used)
#>
param([string]$Version)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root      = $PSScriptRoot
$AppFolder = Split-Path $Root -Parent           # the 3DJames folder
$Work      = Join-Path $Root 'build'
$Tools     = Join-Path $Work 'tools'
$AppOut    = Join-Path $Work 'app'
$Dist      = Join-Path $Root 'dist'

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }

# ---------- 0. What goes in ----------
$Ico = Join-Path $Root '3DJames.ico'
if (-not (Test-Path $Ico)) { $Ico = Join-Path $AppFolder 'source\assets\3DJames.ico' }
if (-not (Test-Path $Ico)) { throw "3DJames.ico not found (put it next to this script)." }
$Need = @('3DJames.html', '3DJamesLink.exe')
$Extra = @('Connect Antigravity.cmd', 'GEMINI.md', '.mcp.json', 'LICENSE.txt')
foreach ($f in $Need) {
    if (-not (Test-Path (Join-Path $AppFolder $f))) { throw "$f not found in $AppFolder" }
}
if (-not $Version) {
    $vf = Join-Path $AppFolder 'source\VERSION'
    if (Test-Path $vf) { $Version = (Get-Content $vf -TotalCount 1).Trim() }
    else { $Version = Get-Date -Format 'yyyy.MM.dd' }
}

New-Item -ItemType Directory -Force -Path $Work, $Tools, $Dist | Out-Null
if (Test-Path $AppOut) { Remove-Item $AppOut -Recurse -Force }
New-Item -ItemType Directory -Force -Path $AppOut | Out-Null

# ---------- 1. WebView2 SDK ----------
$WvDir = Join-Path $Tools 'webview2'
if (-not (Test-Path (Join-Path $WvDir 'lib'))) {
    Step "Downloading Microsoft WebView2 SDK..."
    $zip = Join-Path $Tools 'webview2.zip'
    Invoke-WebRequest 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2' -OutFile $zip -UseBasicParsing
    if (Test-Path $WvDir) { Remove-Item $WvDir -Recurse -Force }
    Expand-Archive $zip -DestinationPath $WvDir -Force
    Remove-Item $zip
}
$WvLib = Get-ChildItem (Join-Path $WvDir 'lib') -Directory |
    Where-Object { $_.Name -like 'net4*' -and (Test-Path (Join-Path $_.FullName 'Microsoft.Web.WebView2.WinForms.dll')) } |
    Sort-Object Name -Descending | Select-Object -First 1
if (-not $WvLib) { throw "Couldn't find the .NET Framework WebView2 libraries in the SDK." }
$WvCore    = Join-Path $WvLib.FullName 'Microsoft.Web.WebView2.Core.dll'
$WvForms   = Join-Path $WvLib.FullName 'Microsoft.Web.WebView2.WinForms.dll'
$WvLoader  = Join-Path $WvDir 'runtimes\win-x64\native\WebView2Loader.dll'
if (-not (Test-Path $WvLoader)) { throw "WebView2Loader.dll not found in the SDK." }

# ---------- 2. Compile 3DJames.exe ----------
Step "Compiling 3DJames.exe..."
$Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $Csc)) { throw "C# compiler not found at $Csc (.NET Framework 4.x is required)." }

$AppCs = Join-Path $Work 'App.cs'
$AppSource = @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Reflection.AssemblyTitle("3DJames")]
[assembly: System.Reflection.AssemblyProduct("3DJames")]
[assembly: System.Reflection.AssemblyCompany("3DJames")]

static class Program
{
    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string ver = null;
        try { ver = CoreWebView2Environment.GetAvailableBrowserVersionString(); } catch { }
        if (string.IsNullOrEmpty(ver))
        {
            if (MessageBox.Show(
                    "3DJames needs the Microsoft Edge WebView2 Runtime, which isn't installed on this PC.\n\nOpen the download page now?",
                    "3DJames", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
            {
                try { Process.Start("https://go.microsoft.com/fwlink/p/?LinkId=2124703"); } catch { }
            }
            return;
        }
        Application.Run(new MainForm());
    }
}

class MainForm : Form
{
    // The 3DJames Link (the AI link, 3DJamesLink.exe) accepts this address: keep the two the same.
    const string Host = "3djames-app.example";
    readonly WebView2 web;
    bool isFullscreen;
    FormWindowState savedState;

    public MainForm()
    {
        Text = "3DJames";
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1440, 900);
        MinimumSize = new Size(640, 480);
        WindowState = FormWindowState.Maximized;
        BackColor = Color.FromArgb(32, 32, 32);

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.FromArgb(32, 32, 32);
        Controls.Add(web);

        Load += OnLoad;
    }

    async void OnLoad(object sender, EventArgs e)
    {
        try
        {
            string dataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "3DJames", "WebView2");
            // The page talks to the AI link on this computer (http://127.0.0.1:47831): don't block or ask about that.
            var options = new CoreWebView2EnvironmentOptions(
                "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights");
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, dataDir, options);
            await web.EnsureCoreWebView2Async(env);

            CoreWebView2 core = web.CoreWebView2;
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            core.SetVirtualHostNameToFolderMapping(Host, appDir, CoreWebView2HostResourceAccessKind.Allow);

            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = true;

            core.PermissionRequested += delegate (object s, CoreWebView2PermissionRequestedEventArgs a)
            {
                string kind = a.PermissionKind.ToString();
                if (kind.Contains("LocalNetwork")) a.State = CoreWebView2PermissionState.Allow;
            };

            core.DocumentTitleChanged += delegate
            {
                string t = core.DocumentTitle;
                Text = string.IsNullOrEmpty(t) ? "3DJames" : t;
            };

            // Links that open a new window (target=_blank, window.open) go to the default browser.
            core.NewWindowRequested += delegate (object s, CoreWebView2NewWindowRequestedEventArgs a)
            {
                a.Handled = true;
                try { Process.Start(a.Uri); } catch { }
            };

            // Page-requested fullscreen (Element.requestFullscreen) fills the whole window.
            core.ContainsFullScreenElementChanged += delegate
            {
                SetFullscreen(core.ContainsFullScreenElement);
            };

            // F11 toggles fullscreen like a browser.
            core.WebMessageReceived += delegate (object s, CoreWebView2WebMessageReceivedEventArgs a)
            {
                string msg = null;
                try { msg = a.TryGetWebMessageAsString(); } catch { }
                if (msg == "__3dj_f11") SetFullscreen(!isFullscreen);
            };
            await core.AddScriptToExecuteOnDocumentCreatedAsync(
                "window.addEventListener('keydown',function(e){if(e.key==='F11'){e.preventDefault();" +
                "window.chrome.webview.postMessage('__3dj_f11');}},true);");

            core.Navigate("https://" + Host + "/3DJames.html");
        }
        catch (Exception ex)
        {
            MessageBox.Show("3DJames couldn't start:\n\n" + ex.Message, "3DJames",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    void SetFullscreen(bool on)
    {
        if (on == isFullscreen) return;
        isFullscreen = on;
        if (on)
        {
            savedState = WindowState;
            WindowState = FormWindowState.Normal; // needed so borderless covers the taskbar
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = savedState;
        }
    }
}
'@
Set-Content -Path $AppCs -Value $AppSource -Encoding UTF8

& $Csc /nologo /target:winexe /platform:x64 /optimize+ /debug- `
    "/win32icon:$Ico" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    "/r:$WvCore" "/r:$WvForms" `
    "/out:$(Join-Path $AppOut '3DJames.exe')" `
    $AppCs
if ($LASTEXITCODE -ne 0) { throw "Compiling 3DJames.exe failed." }

Copy-Item $WvCore, $WvForms, $WvLoader, $Ico -Destination $AppOut
foreach ($f in $Need + $Extra) {
    $p = Join-Path $AppFolder $f
    if (Test-Path $p) { Copy-Item -LiteralPath $p -Destination $AppOut }
}
$Lic = Join-Path $AppFolder 'licenses'
if (Test-Path $Lic) { Copy-Item $Lic -Destination $AppOut -Recurse }

# ---------- 3. Check for personal details ----------
Step "Checking every file for personal details..."
$words = New-Object System.Collections.Generic.List[string]
$words.Add($env:USERNAME); $words.Add($env:COMPUTERNAME)
try {
    $full = ([adsi]"WinNT://$env:USERDOMAIN/$env:USERNAME,user").FullName
    if ($full) { $words.Add([string]$full); foreach ($part in ([string]$full -split '\s+')) { $words.Add($part) } }
} catch { }
$PrivateFile = Join-Path $Root 'Private words.txt'
if (Test-Path $PrivateFile) {
    foreach ($line in Get-Content $PrivateFile) {
        $w = $line.Trim()
        if ($w -and -not $w.StartsWith('#')) { $words.Add($w) }
    }
}
$words = $words | Where-Object { $_ -and $_.Length -ge 3 } | Sort-Object -Unique
$checks = @($words | ForEach-Object { '(?<![A-Za-z0-9])' + [regex]::Escape($_) + '(?![A-Za-z0-9])' })
$checks += '[A-Za-z]:\\{1,2}Users\\{1,2}(?!(Public|you|name)\b)[^\\"''<>\s]+'   # someone's own folder, like C:\Users\name
$Microsoft = @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll')
$latin1 = [Text.Encoding]::GetEncoding(28591)
$found = @()
foreach ($file in Get-ChildItem $AppOut -Recurse -File) {
    if ($Microsoft -contains $file.Name) { continue }   # Microsoft's own files, as downloaded
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    # long runs of base64 are embedded pictures and fonts: random letters, no words (pictures are checked by eye)
    $texts = @($latin1.GetString($bytes), [Text.Encoding]::Unicode.GetString($bytes)) |
        ForEach-Object { [regex]::Replace($_, '[A-Za-z0-9+/=]{200,}', ' ') }
    foreach ($rx in $checks) {
        foreach ($t in $texts) {
            $m = [regex]::Match($t, $rx, 'IgnoreCase')
            if ($m.Success) {
                $a = [Math]::Max(0, $m.Index - 40); $len = [Math]::Min(100, $t.Length - $a)
                $around = ($t.Substring($a, $len) -replace '[^\x20-\x7E]', ' ')
                $found += "  $($file.FullName.Substring($AppOut.Length + 1)): ""$($m.Value)""   ...$around..."
                break
            }
        }
    }
}
if ($found.Count) {
    Write-Host ""
    Write-Host "STOPPED: personal details found in the files going into the installer:" -ForegroundColor Red
    $found | ForEach-Object { Write-Host $_ }
    Write-Host ""
    Write-Host "No installer was made. Ask Claude to remove these from 3DJames, then run this again." -ForegroundColor Red
    exit 1
}
Write-Host "None found ($($words.Count) words and folder paths checked)."

# ---------- 4. Inno Setup ----------
function Find-Iscc {
    foreach ($base in "${env:ProgramFiles(x86)}", "$env:ProgramFiles", "$env:LOCALAPPDATA\Programs") {
        if (-not $base) { continue }
        $hit = Get-ChildItem $base -Directory -Filter 'Inno Setup*' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'ISCC.exe' } |
            Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($hit) { return $hit }
    }
    return $null
}
$Iscc = Find-Iscc
if (-not $Iscc) {
    Step "Installing Inno Setup (one time, for your user only)..."

    # Try winget first
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        & winget install --id JRSoftware.InnoSetup -e --source winget --scope user --silent `
            --disable-interactivity --accept-package-agreements --accept-source-agreements | Out-Null
        $Iscc = Find-Iscc
    }

    # Fall back to the official GitHub release
    if (-not $Iscc) {
        Write-Host "Downloading Inno Setup from GitHub..."
        $rels = Invoke-RestMethod 'https://api.github.com/repos/jrsoftware/issrc/releases?per_page=20' `
            -Headers @{ 'User-Agent' = '3DJames-build' } -UseBasicParsing
        $asset = $rels | Where-Object { -not $_.prerelease } | ForEach-Object { $_.assets } |
            Where-Object { $_.name -match '(?i)^innosetup.*\.exe$' } | Select-Object -First 1
        if (-not $asset) { throw "Couldn't find the Inno Setup installer on GitHub." }
        $isExe = Join-Path $Tools $asset.name
        Invoke-WebRequest $asset.browser_download_url -OutFile $isExe -UseBasicParsing `
            -Headers @{ 'User-Agent' = '3DJames-build' }
        $head = [System.IO.File]::ReadAllBytes($isExe)[0..1]
        if ($head[0] -ne 0x4D -or $head[1] -ne 0x5A) { throw "The Inno Setup download wasn't a valid program." }
        Unblock-File $isExe -ErrorAction SilentlyContinue
        $p = Start-Process $isExe -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXRESTARTS', '/NORESTART', '/CURRENTUSER' -Wait -PassThru
        Remove-Item $isExe -ErrorAction SilentlyContinue
        $Iscc = Find-Iscc
    }

    if (-not $Iscc) { throw "Inno Setup didn't install. Install it from https://jrsoftware.org/isdl.php and run this again." }
}
Write-Host "Using Inno Setup"

# ---------- 5. Build installer ----------
Step "Building 3DJames-Setup.exe (version $Version)..."
$Iss = Join-Path $Work '3DJames.iss'
$IssSource = @'
#ifndef AppVersion
  #define AppVersion "1.0"
#endif

[Setup]
AppId={{8F3B6E2A-5C1D-4E7B-9A2F-3D1A5B7C9E01}
AppName=3DJames
AppVersion={#AppVersion}
AppVerName=3DJames {#AppVersion}
AppPublisher=3DJames
VersionInfoCompany=3DJames
VersionInfoProductName=3DJames
DefaultDirName={autopf}\3DJames
DefaultGroupName=3DJames
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutDir}
OutputBaseFilename=3DJames-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\3DJames.exe
UninstallDisplayName=3DJames
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Dirs]
Name: "{userdocs}\3DJames\Projects"; Flags: uninsneveruninstall

[Files]
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\3DJames\3DJames"; Filename: "{app}\3DJames.exe"
Name: "{autoprograms}\3DJames\Connect Antigravity to 3DJames"; Filename: "{app}\Connect Antigravity.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\3DJames.ico"
Name: "{autoprograms}\3DJames\Uninstall 3DJames"; Filename: "{uninstallexe}"
Name: "{autodesktop}\3DJames"; Filename: "{app}\3DJames.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\3DJames.exe"; Description: "{cm:LaunchProgram,3DJames}"; Flags: nowait postinstall skipifsilent
'@
Set-Content -Path $Iss -Value $IssSource -Encoding UTF8

& $Iscc /Q "/DAppVersion=$Version" "/DSrcDir=$AppOut" "/DOutDir=$Dist" "/DIconFile=$Ico" $Iss
if ($LASTEXITCODE -ne 0) { throw "Building the installer failed." }

$Setup = Join-Path $Dist '3DJames-Setup.exe'
Write-Host ""
Write-Host "Done! Installer: $Setup" -ForegroundColor Green
if (-not $env:TDJ_NO_EXPLORER) { Start-Process explorer.exe "/select,`"$Setup`"" }
