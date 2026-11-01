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
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
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

// Looks on GitHub for a newer 3DJames.html when the program starts, and keeps the newest copy in the user's own app data
// folder (the install folder may be Program Files, which a normal program may not write to). The next start shows it.
// Nothing of the user's is sent: it is two plain downloads (update.json, then 3DJames.html if there is a newer one).
static class Updates
{
    // update.json and 3DJames.html sit side by side in the GitHub project (tools/ship.py writes update.json)
    const string ManifestUrl = "https://raw.githubusercontent.com/thefrayedend/3D-James/main/update.json";
    const string Marker = "window.__3DJ_VERSION=\"";
    public static string Root;                    // ...\3DJames in the user's local app data
    public static string Pending;                 // a newer version downloaded during this run
    static readonly object gate = new object();

    public static string Dir { get { return Path.Combine(Root, "update"); } }
    static string OffFile { get { return Path.Combine(Dir, "updates-off"); } }

    // TDJ_UPDATE_URL points the check at another address (tests only; plain http is accepted only on this computer)
    static string Manifest
    {
        get
        {
            string o = Environment.GetEnvironmentVariable("TDJ_UPDATE_URL");
            return string.IsNullOrEmpty(o) ? ManifestUrl : o;
        }
    }

    public static bool Enabled
    {
        get { return !File.Exists(OffFile); }
        set
        {
            try
            {
                Directory.CreateDirectory(Dir);
                if (value) { if (File.Exists(OffFile)) File.Delete(OffFile); }
                else File.WriteAllText(OffFile, "off");
            }
            catch { }
        }
    }

    static int[] Parse(string v)
    {
        if (v == null || !Regex.IsMatch(v, @"^\d+(\.\d+){1,3}$")) return null;
        string[] p = v.Split('.');
        int[] r = new int[4];
        for (int i = 0; i < p.Length; i++) { int n; if (!int.TryParse(p[i], out n)) return null; r[i] = n; }
        return r;
    }

    // > 0 when a is newer than b; an unreadable version counts as older than any readable one
    public static int Compare(string a, string b)
    {
        int[] x = Parse(a), y = Parse(b);
        if (x == null && y == null) return 0;
        if (x == null) return -1;
        if (y == null) return 1;
        for (int i = 0; i < 4; i++) if (x[i] != y[i]) return x[i] < y[i] ? -1 : 1;
        return 0;
    }

    // the version a 3DJames.html says it is (window.__3DJ_VERSION="x.y.z"), or null
    public static string ScanVersion(string path)
    {
        try
        {
            byte[] key = Encoding.ASCII.GetBytes(Marker);
            const int chunk = 4 << 20, keepBytes = 64;
            using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 20))
            {
                byte[] buf = new byte[chunk + keepBytes];
                int keep = 0;
                while (true)
                {
                    int n = fs.Read(buf, keep, chunk);
                    if (n <= 0) return null;
                    int total = keep + n;
                    for (int i = 0; i + key.Length < total; i++)
                    {
                        if (buf[i] != key[0]) continue;
                        int j = 1;
                        while (j < key.Length && buf[i + j] == key[j]) j++;
                        if (j < key.Length) continue;
                        int s = i + key.Length, e = s;
                        while (e < total && e - s < 24 && buf[e] != (byte)'"') e++;
                        if (e < total && buf[e] == (byte)'"') return Encoding.ASCII.GetString(buf, s, e - s);
                    }
                    keep = Math.Min(keepBytes, total);
                    Buffer.BlockCopy(buf, total - keep, buf, 0, keep);
                }
            }
        }
        catch { return null; }
    }

    // The folder to show 3DJames from: a downloaded copy when it is newer than the installed one, else the install folder.
    // Older and unfinished downloads are removed.
    public static string Best(string appDir, out string version)
    {
        version = ScanVersion(Path.Combine(appDir, "3DJames.html"));
        string best = appDir;
        try
        {
            if (!Directory.Exists(Dir)) return best;
            foreach (string d in Directory.GetDirectories(Dir))
            {
                string v = Path.GetFileName(d), html = Path.Combine(d, "3DJames.html"), ok = Path.Combine(d, "ok");
                if (Parse(v) == null || !File.Exists(html) || !File.Exists(ok)) continue;
                long size;
                if (!long.TryParse(File.ReadAllText(ok).Trim(), out size) || new FileInfo(html).Length != size) continue;
                if (Compare(v, version) > 0) { version = v; best = d; }
            }
            foreach (string d in Directory.GetDirectories(Dir))
            {
                if (string.Equals(d, best, StringComparison.OrdinalIgnoreCase)) continue;
                try { Directory.Delete(d, true); } catch { }
            }
            foreach (string f in Directory.GetFiles(Dir, "*.part")) { try { File.Delete(f); } catch { } }
        }
        catch { }
        return best;
    }

    public class Result { public string Status; public string Version; }

    static HttpWebRequest Ask(string url)
    {
        Uri u = new Uri(url);
        bool testing = u.IsLoopback && Environment.GetEnvironmentVariable("TDJ_UPDATE_URL") != null;
        if (u.Scheme != "https" && !(testing && u.Scheme == "http")) throw new InvalidOperationException("not https");
        HttpWebRequest r = (HttpWebRequest)WebRequest.Create(u);
        r.UserAgent = "3DJames";
        r.Timeout = 15000;
        r.ReadWriteTimeout = 30000;
        r.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
        return r;
    }

    // a different address each time, so GitHub's five-minute cache can't hand back an older file
    static string Fresh(string url) { return url + (url.Contains("?") ? "&" : "?") + "t=" + DateTime.UtcNow.Ticks; }

    // Looks for a newer version than the one running; downloads it when there is one. Blocking: call from a worker thread.
    public static Result Run(string running)
    {
        lock (gate)
        {
            string newest = running;
            if (Pending != null && Compare(Pending, newest) > 0) newest = Pending;
            string part = null;
            try
            {
                ServicePointManager.SecurityProtocol = ServicePointManager.SecurityProtocol | (SecurityProtocolType)3072;
                string manifestUrl = Manifest, text;
                using (WebResponse rs = Ask(Fresh(manifestUrl)).GetResponse())
                using (StreamReader sr = new StreamReader(rs.GetResponseStream(), Encoding.UTF8))
                {
                    char[] b = new char[8192];
                    int n = sr.Read(b, 0, b.Length);
                    text = n > 0 ? new string(b, 0, n) : "";
                }
                Match mv = Regex.Match(text, "\"version\"\\s*:\\s*\"([0-9.]+)\"");
                Match mh = Regex.Match(text, "\"sha256\"\\s*:\\s*\"([0-9a-fA-F]{64})\"");
                Match ms = Regex.Match(text, "\"size\"\\s*:\\s*(\\d+)");
                if (!mv.Success || !mh.Success || !ms.Success || Parse(mv.Groups[1].Value) == null) return new Result { Status = "failed" };
                string ver = mv.Groups[1].Value, sha = mh.Groups[1].Value.ToLowerInvariant();
                long size = long.Parse(ms.Groups[1].Value);
                if (Compare(ver, newest) <= 0)
                {
                    if (Pending != null && Compare(Pending, running) > 0) return new Result { Status = "downloaded", Version = Pending };
                    return new Result { Status = "current", Version = running };
                }
                if (size < 200 || size > 300L * 1024 * 1024) return new Result { Status = "failed" };

                // 3DJames.html sits next to update.json
                string htmlUrl = manifestUrl.Substring(0, manifestUrl.LastIndexOf('/') + 1) + "3DJames.html";
                Directory.CreateDirectory(Dir);
                part = Path.Combine(Dir, ver + ".part");
                long got = 0;
                string have;
                using (HashAlgorithm h = SHA256.Create())
                {
                    HttpWebRequest hq = Ask(Fresh(htmlUrl));
                    hq.Timeout = 30000;
                    using (WebResponse hs = hq.GetResponse())
                    using (Stream ins = hs.GetResponseStream())
                    using (FileStream outs = new FileStream(part, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        byte[] buf = new byte[1 << 16];
                        int k;
                        while ((k = ins.Read(buf, 0, buf.Length)) > 0)
                        {
                            got += k;
                            if (got > size) break;
                            h.TransformBlock(buf, 0, k, null, 0);
                            outs.Write(buf, 0, k);
                        }
                    }
                    h.TransformFinalBlock(new byte[0], 0, 0);
                    have = BitConverter.ToString(h.Hash).Replace("-", "").ToLowerInvariant();
                }
                // complete, unchanged, and really that version: otherwise it is thrown away and tried again next start
                if (got != size || have != sha || ScanVersion(part) != ver)
                {
                    try { File.Delete(part); } catch { }
                    return new Result { Status = "failed" };
                }
                string dir = Path.Combine(Dir, ver);
                Directory.CreateDirectory(dir);
                string dest = Path.Combine(dir, "3DJames.html");
                if (File.Exists(dest)) File.Delete(dest);
                File.Move(part, dest);
                File.WriteAllText(Path.Combine(dir, "ok"), size.ToString());   // written last: a folder without it is ignored
                Pending = ver;
                return new Result { Status = "downloaded", Version = ver };
            }
            catch (WebException)
            {
                if (part != null) { try { File.Delete(part); } catch { } }
                return new Result { Status = "offline" };
            }
            catch
            {
                if (part != null) { try { File.Delete(part); } catch { } }
                return new Result { Status = "failed" };
            }
        }
    }
}

class MainForm : Form
{
    // The 3DJames Link (the AI link, 3DJamesLink.exe) accepts this address: keep the two the same.
    const string Host = "3djames-app.example";
    readonly WebView2 web;
    bool isFullscreen;
    FormWindowState savedState;
    string runningVersion;          // the version being shown
    string lastStatus = "idle";     // what the page was last told about updates
    string lastVersion;
    bool checking;
    bool pageAsks;                  // the page answers the close button (it asks about unsaved changes)
    bool closeOk;                   // the page said it may close
    System.Windows.Forms.Timer closeTimer;

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
        FormClosing += OnClosing;
    }

    async void OnLoad(object sender, EventArgs e)
    {
        try
        {
            // TDJ_DATA moves everything the program keeps (tests only)
            string baseDir = Environment.GetEnvironmentVariable("TDJ_DATA");
            if (string.IsNullOrEmpty(baseDir)) baseDir = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            Updates.Root = Path.Combine(baseDir, "3DJames");
            string dataDir = Path.Combine(Updates.Root, "WebView2");
            // The page talks to the AI link on this computer (http://127.0.0.1:47831): don't block or ask about that.
            var options = new CoreWebView2EnvironmentOptions(
                "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights");
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, dataDir, options);
            await web.EnsureCoreWebView2Async(env);

            CoreWebView2 core = web.CoreWebView2;
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            // the installed 3DJames.html, or a newer one downloaded earlier: same address either way, so saved settings stay
            string shownFrom = Updates.Best(appDir, out runningVersion);
            core.SetVirtualHostNameToFolderMapping(Host, shownFrom, CoreWebView2HostResourceAccessKind.Allow);

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

            // a page that is (re)loading has not said yet that it answers the close button
            core.NavigationStarting += delegate { pageAsks = false; };

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

            // F11 toggles fullscreen like a browser; the page also asks about updates here.
            core.WebMessageReceived += delegate (object s, CoreWebView2WebMessageReceivedEventArgs a)
            {
                string msg = null;
                try { msg = a.TryGetWebMessageAsString(); } catch { }
                if (msg == "__3dj_f11") SetFullscreen(!isFullscreen);
                else if (msg == "__3dj_updates_on") { Updates.Enabled = true; PostStatus(); }
                else if (msg == "__3dj_updates_off") { Updates.Enabled = false; PostStatus(); }
                else if (msg == "__3dj_status") PostStatus();
                else if (msg == "__3dj_check") StartCheck();
                else if (msg == "__3dj_close_asks") pageAsks = true;
                else if (msg == "__3dj_close_wait") StopCloseTimer();
                else if (msg == "__3dj_close_ok") { StopCloseTimer(); closeOk = true; try { BeginInvoke(new Action(Close)); } catch { } }
            };
            await core.AddScriptToExecuteOnDocumentCreatedAsync(
                "window.addEventListener('keydown',function(e){if(e.key==='F11'){e.preventDefault();" +
                "window.chrome.webview.postMessage('__3dj_f11');}},true);");
            // tells the page it is in the program, and whether it looks for updates
            await core.AddScriptToExecuteOnDocumentCreatedAsync(
                "window.__3DJ_HOST={program:true,updates:" + (Updates.Enabled ? "true" : "false") + "};");

            core.Navigate("https://" + Host + "/3DJames.html");

            // once, a few seconds after starting, so it never slows down the page loading
            if (Updates.Enabled)
            {
                int wait;
                if (!int.TryParse(Environment.GetEnvironmentVariable("TDJ_UPDATE_WAIT"), out wait) || wait <= 0) wait = 4000;
                System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
                t.Interval = wait;
                t.Tick += delegate { t.Stop(); t.Dispose(); StartCheck(); };
                t.Start();
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show("3DJames couldn't start:\n\n" + ex.Message, "3DJames",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    // The close button: the page asks "Save changes?" when there are unsaved changes, then says when to close.
    // Shutting Windows down closes straight away; the page's backup brings the work back next start.
    void OnClosing(object sender, FormClosingEventArgs e)
    {
        // (Task Manager's "End task" asks too, like Notepad; it offers to force it if the question is not answered)
        if (closeOk || !pageAsks || web.CoreWebView2 == null || e.CloseReason == CloseReason.WindowsShutDown) return;
        e.Cancel = true;
        try { web.CoreWebView2.PostWebMessageAsJson("{\"type\":\"3dj-close\"}"); } catch { }
        if (closeTimer != null) return;
        // a page that does not answer (frozen) can still be closed
        closeTimer = new System.Windows.Forms.Timer();
        closeTimer.Interval = 4000;
        closeTimer.Tick += delegate
        {
            StopCloseTimer();
            if (MessageBox.Show(this, "3DJames is not answering, so it can't check for unsaved changes.\n\nClose it anyway?",
                "3DJames", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
            {
                closeOk = true;
                Close();
            }
        };
        closeTimer.Start();
    }

    void StopCloseTimer()
    {
        if (closeTimer == null) return;
        closeTimer.Stop();
        closeTimer.Dispose();
        closeTimer = null;
    }

    void StartCheck()
    {
        if (checking) return;
        checking = true;
        SetStatus("checking", null);
        string running = runningVersion;
        Task.Factory.StartNew(delegate
        {
            Updates.Result r = Updates.Run(running);
            try { BeginInvoke(new Action(delegate { checking = false; SetStatus(r.Status, r.Version); })); } catch { }
        });
    }

    void SetStatus(string status, string version)
    {
        lastStatus = status;
        lastVersion = version;
        PostStatus();
    }

    // tells the page where updates stand: idle, checking, current, downloaded (opens next start), offline, failed
    void PostStatus()
    {
        try
        {
            string json = "{\"type\":\"3dj-update\",\"status\":\"" + lastStatus + "\",\"version\":" +
                (lastVersion == null ? "null" : "\"" + lastVersion + "\"") + ",\"current\":" +
                (runningVersion == null ? "null" : "\"" + runningVersion + "\"") + ",\"enabled\":" +
                (Updates.Enabled ? "true" : "false") + "}";
            if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(json);
        }
        catch { }
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

[UninstallDelete]
; newer copies of the app that the program downloaded by itself (see Updates in the program's source)
Type: filesandordirs; Name: "{localappdata}\3DJames\update"

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
