using System;
using System.IO;
using System.Drawing;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Reflection.AssemblyTitle("3DJames")]
[assembly: System.Reflection.AssemblyProduct("3DJames")]
[assembly: System.Reflection.AssemblyDescription("Offline parametric 3D modeler")]
[assembly: System.Reflection.AssemblyVersion("0.13.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.13.0.0")]

internal static class Program
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    internal static extern int SetCurrentProcessExplicitAppUserModelID(string id);

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        SetCurrentProcessExplicitAppUserModelID("3DJames.Desktop");
        string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "3DJames", "WebView2");
        string smoke = null, suite = null;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--profile-dir" && i + 1 < args.Length) profile = Path.GetFullPath(args[++i]);
            else if (args[i] == "--smoke-test" && i + 1 < args.Length) smoke = Path.GetFullPath(args[++i]);
            else if (args[i] == "--test-suite" && i + 1 < args.Length) suite = Path.GetFullPath(args[++i]);
        }
        try
        {
            Directory.CreateDirectory(profile);
            using (System.Threading.Mutex appMutex = new System.Threading.Mutex(false, "3DJames.Desktop.Running"))
                Application.Run(new MainWindow(profile, smoke, suite));
            return Environment.ExitCode;
        }
        catch (Exception ex)
        {
            if (smoke != null) File.WriteAllText(smoke, new JavaScriptSerializer().Serialize(new { ok = false, error = ex.ToString() }));
            else MessageBox.Show("3DJames could not start.\n\n" + ex.Message, "3DJames", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

internal sealed class MainWindow : Form
{
    private const string Origin = "https://app.3djames.local";
    private readonly WebView2 browser = new WebView2();
    private readonly string profile, smoke, suite;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private bool closing, checkingClose;
    private System.Windows.Forms.Timer testWatchdog;
    private void Log(string message) { if (smoke != null) File.AppendAllText(smoke + ".log", DateTime.UtcNow.ToString("O") + " " + message + Environment.NewLine); }

    internal MainWindow(string profile, string smoke, string suite)
    {
        this.profile = profile; this.smoke = smoke; this.suite = suite;
        Text = "3DJames";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        ClientSize = new Size(1440, 900);
        MinimumSize = new Size(900, 600);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        browser.Dock = DockStyle.Fill;
        Controls.Add(browser);
        if (smoke != null)
        {
            ShowInTaskbar = false; StartPosition = FormStartPosition.Manual; Location = new Point(-20000, -20000);
            testWatchdog = new System.Windows.Forms.Timer { Interval = 180000 };
            testWatchdog.Tick += (sender, args) => { testWatchdog.Stop(); Fail(new TimeoutException("The offscreen desktop test timed out.")); };
            testWatchdog.Start();
        }
        Shown += async (sender, args) => await Initialize();
        FormClosing += OnClosing;
    }

    protected override bool ShowWithoutActivation { get { return smoke != null; } }

    private async Task Initialize()
    {
        try
        {
            Log("Initializing desktop host");
            string assets = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app");
            if (!File.Exists(Path.Combine(assets, "3DJames.html"))) throw new FileNotFoundException("The app files are missing. Run the 3DJames installer again.");
            Log("Creating environment in " + profile);
            CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions();
            if (smoke != null) options.AdditionalBrowserArguments = "--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=CalculateNativeWinOcclusion";
            Task<CoreWebView2Environment> environmentTask = CoreWebView2Environment.CreateAsync(null, profile, options);
            if (await Task.WhenAny(environmentTask, Task.Delay(45000)) != environmentTask) throw new TimeoutException("WebView2 did not start within 45 seconds.");
            CoreWebView2Environment env = await environmentTask;
            Log("Environment ready");
            Task controllerTask = browser.EnsureCoreWebView2Async(env);
            if (await Task.WhenAny(controllerTask, Task.Delay(45000)) != controllerTask) throw new TimeoutException("The desktop window did not become ready within 45 seconds.");
            await controllerTask;
            Log("Controller ready");
            CoreWebView2 core = browser.CoreWebView2;
            if (smoke != null)
            {
                core.WebResourceResponseReceived += (sender, args) => Log("Resource " + args.Response.StatusCode + " " + args.Request.Uri);
                core.DOMContentLoaded += (sender, args) => Log("DOM loaded");
                core.WebMessageReceived += (sender, args) => Log("Page: " + args.TryGetWebMessageAsString());
                await core.AddScriptToExecuteOnDocumentCreatedAsync("window.chrome.webview.postMessage('document created');window.addEventListener('error',e=>window.chrome.webview.postMessage('error: '+e.message));");
            }
            core.SetVirtualHostNameToFolderMapping("app.3djames.local", assets, CoreWebView2HostResourceAccessKind.DenyCors);
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = smoke != null;
            core.DocumentTitleChanged += (sender, args) => { Text = core.DocumentTitle; };
            core.NavigationStarting += (sender, args) => {
                Uri uri;
                Log("Navigation starting: " + args.Uri);
                if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out uri) || uri.GetLeftPart(UriPartial.Authority) != Origin) args.Cancel = true;
            };
            core.NewWindowRequested += (sender, args) => {
                args.Handled = true;
                Uri uri;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http"))
                    Process.Start(new ProcessStartInfo(args.Uri) { UseShellExecute = true });
            };
            core.DownloadStarting += (sender, args) => {
                CoreWebView2Deferral deferral = args.GetDeferral();
                try
                {
                    using (SaveFileDialog dialog = new SaveFileDialog())
                    {
                        dialog.FileName = Path.GetFileName(args.ResultFilePath);
                        dialog.Filter = "All files (*.*)|*.*";
                        if (dialog.ShowDialog(this) == DialogResult.OK) { args.ResultFilePath = dialog.FileName; args.Handled = true; }
                        else args.Cancel = true;
                    }
                }
                finally { deferral.Complete(); }
            };
            core.ProcessFailed += (sender, args) => {
                if (smoke != null) { Fail(new Exception("WebView process failed: " + args.ProcessFailedKind)); return; }
                if (MessageBox.Show(this, "The rendering engine stopped. Reload 3DJames? Your automatic backup will be reopened.", "3DJames", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes) core.Reload();
            };
            core.NavigationCompleted += async (sender, args) => {
                if (smoke != null) await RunSmoke(args.IsSuccess);
            };
            core.Navigate(Origin + "/3DJames.html");
            Log("Navigation requested");
        }
        catch (Exception ex) { Fail(ex); }
    }

    private async Task RunSmoke(bool loaded)
    {
        try
        {
            Log("Navigation completed: " + loaded);
            if (!loaded) throw new Exception("App navigation failed.");
            bool ready = false;
            for (int i = 0; i < 1800; i++)
            {
                string state = await browser.ExecuteScriptAsync("!!(window.__3dj && document.getElementById('loading').hidden && !window.__3dj.app.building && !window.__3dj.app.pending)");
                if (state == "true") { ready = true; break; }
                await Task.Delay(100);
            }
            if (!ready) throw new Exception("The geometry engine did not become ready.");
            await browser.ExecuteScriptAsync("window.__desktopTest={ready:true};");
            string script = suite == null ? @"(async()=>{
              const {app,commands:C}=window.__3dj;
              const zip=await C.readZip(await C.buildFileData('3mf'));
              return {ok:app.results.bodies.size>0 && !Object.keys(app.results.errors).length && zip.has('3D/3dmodel.model'),
                bodies:app.results.bodies.size,openPicker:typeof showOpenFilePicker,savePicker:typeof showSaveFilePicker,
                directoryPicker:typeof showDirectoryPicker,origin:location.origin};
            })()" : "(async()=>{" + File.ReadAllText(suite) + "; return await window.__runDesktopTests();})()";
            await browser.ExecuteScriptAsync("Promise.resolve(" + script + ").then(r=>{window.__desktopResult=JSON.stringify(r)},e=>{window.__desktopResult=JSON.stringify({ok:false,error:String(e),stack:e.stack})});");
            for (int i = 0; i < 6000; i++)
            {
                string result = await browser.ExecuteScriptAsync("window.__desktopResult || null");
                if (result != "null")
                {
                    string decoded = json.Deserialize<string>(result);
                    File.WriteAllText(smoke, decoded);
                    var data = json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(decoded);
                    Environment.ExitCode = data.ContainsKey("ok") && data["ok"] is bool && (bool)data["ok"] ? 0 : 1;
                    closing = true; Close(); return;
                }
                await Task.Delay(100);
            }
            throw new Exception("Desktop tests timed out.");
        }
        catch (Exception ex) { Fail(ex); }
    }

    private void Fail(Exception ex)
    {
        Environment.ExitCode = 1;
        if (smoke != null) File.WriteAllText(smoke, json.Serialize(new { ok = false, error = ex.ToString() }));
        else MessageBox.Show(this, "3DJames could not start.\n\n" + ex.Message + "\n\nIf the WebView2 runtime is missing, rerun the installer while connected to the internet.", "3DJames", MessageBoxButtons.OK, MessageBoxIcon.Error);
        closing = true; Close();
    }

    private async void OnClosing(object sender, FormClosingEventArgs e)
    {
        if (closing || browser.CoreWebView2 == null) { browser.Dispose(); return; }
        e.Cancel = true;
        if (checkingClose) return;
        checkingClose = true;
        try
        {
            string dirty = await browser.ExecuteScriptAsync("!!(window.__3dj && window.__3dj.app.dirty)");
            if (dirty == "true" && MessageBox.Show(this, "There are unsaved changes. Close without saving a project file?", "3DJames", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
            await browser.ExecuteScriptAsync("window.__desktopCloseReady=false;if(window.__3dj) window.__3dj.commands.idb.put('kv',JSON.stringify(window.__3dj.store.doc),'current').then(()=>window.__desktopCloseReady=true,()=>window.__desktopCloseReady=true);else window.__desktopCloseReady=true;");
            for (int i = 0; i < 40; i++)
            {
                if (await browser.ExecuteScriptAsync("!!window.__desktopCloseReady") == "true") break;
                await Task.Delay(50);
            }
            closing = true; Close();
        }
        catch { closing = true; Close(); }
        finally { checkingClose = false; }
    }
}
