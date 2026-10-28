// 3DJames Link: lets an AI helper (Gemini CLI, Claude...) work in the open 3DJames window.
//
// The AI starts this program and talks MCP to it over stdin/stdout (JSON-RPC, one message per line). 3DJames (the
// page, src/bridge.js) asks it for jobs over http://127.0.0.1:47831, which only their computer can reach. Several AIs
// can each start a copy: the first owns the port (the "hub"), the others hand their jobs to it with the key in
// %LOCALAPPDATA%\3DJames\link.key. Projects are read from and saved into the Projects folder only (meshes for Make
// editable may be read from anywhere the AI names).
//
// Built with the .NET Framework C# compiler (C# 5), like the desktop app: python build_link.py
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

[assembly: AssemblyTitle("3DJames Link")]
[assembly: AssemblyProduct("3DJames")]
[assembly: AssemblyDescription("Lets an AI helper work in the open 3DJames window (MCP server)")]
[assembly: AssemblyVersion("1.0.0.0")]

internal static class Link
{
    internal const string Version = "1.0.0";
    internal static int Port = 47831; // --port: only for tests, so they keep off the user's own 3DJames
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 512 };
    internal static string AppDir, ProjectsDir, Client = "An AI helper";
    private static readonly object OutLock = new object();
    private static TextWriter stdout;

    private static int Main(string[] args)
    {
        AppDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        for (int i = 0; i < args.Length; i++)
            if (args[i] == "--projects" && i + 1 < args.Length) ProjectsDir = Path.GetFullPath(args[++i]);
            else if (args[i] == "--port" && i + 1 < args.Length) Port = int.Parse(args[++i]);
        if (ProjectsDir == null)
            // the 3DJames folder's own Projects (the zip has one); installed in Program Files there is none: Documents
            ProjectsDir = File.Exists(Path.Combine(AppDir, "3DJames.html")) && Directory.Exists(Path.Combine(AppDir, "Projects")) ? Path.Combine(AppDir, "Projects")
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "3DJames", "Projects");
        if (args.Contains("--version")) { Console.WriteLine("3DJames Link " + Version); return 0; }
        if (args.Contains("--setup-antigravity")) return Setup.Antigravity();

        stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
        TextReader stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        Log("3DJames Link " + Version + ", projects in " + ProjectsDir);
        Hub.TryStart(); // be the hub straight away when we can, so 3DJames finds us
        string line;
        while ((line = stdin.ReadLine()) != null)
        {
            if (line.Trim().Length == 0) continue;
            Dictionary<string, object> msg;
            try { msg = Json.Deserialize<Dictionary<string, object>>(line); }
            catch (Exception) { Send(new Dictionary<string, object> { { "jsonrpc", "2.0" }, { "id", null }, { "error", Err(-32700, "Parse error") } }); continue; }
            if (msg == null) continue;
            Dictionary<string, object> m = msg;
            if (Get(m, "method") as string == "tools/call") ThreadPool.QueueUserWorkItem(_ => Answer(m));
            else Answer(m);
        }
        return 0;
    }

    internal static void Log(string s) { try { Console.Error.WriteLine("[3DJames Link] " + s); } catch (Exception) { } }

    private static void Send(object o)
    {
        string s = Json.Serialize(o);
        lock (OutLock) stdout.WriteLine(s);
    }
    private static Dictionary<string, object> Err(int code, string message) { return new Dictionary<string, object> { { "code", code }, { "message", message } }; }
    internal static object Get(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) ? v : null; }

    private static void Answer(Dictionary<string, object> m)
    {
        string method = Get(m, "method") as string;
        bool isRequest = m.ContainsKey("id");
        if (method == null || !isRequest) return; // notifications (initialized, cancelled) and replies need no answer
        object id = m["id"];
        var p = Get(m, "params") as Dictionary<string, object> ?? new Dictionary<string, object>();
        try
        {
            object result;
            if (method == "initialize") result = Initialize(p);
            else if (method == "ping") result = new Dictionary<string, object>();
            else if (method == "tools/list") result = new Dictionary<string, object> { { "tools", Tools.List() } };
            else if (method == "tools/call") result = Tools.Call(Get(p, "name") as string, Get(p, "arguments") as Dictionary<string, object> ?? new Dictionary<string, object>());
            else if (method == "resources/list") result = new Dictionary<string, object> { { "resources", new object[0] } };
            else if (method == "prompts/list") result = new Dictionary<string, object> { { "prompts", new object[0] } };
            else { Send(new Dictionary<string, object> { { "jsonrpc", "2.0" }, { "id", id }, { "error", Err(-32601, "Unknown method " + method) } }); return; }
            Send(new Dictionary<string, object> { { "jsonrpc", "2.0" }, { "id", id }, { "result", result } });
        }
        catch (Exception ex)
        {
            Send(new Dictionary<string, object> { { "jsonrpc", "2.0" }, { "id", id }, { "error", Err(-32603, ex.Message) } });
        }
    }

    private static object Initialize(Dictionary<string, object> p)
    {
        var info = Get(p, "clientInfo") as Dictionary<string, object>;
        string name = (Get(info, "name") as string ?? "").ToLowerInvariant();
        Client = name.Contains("gemini") ? "Gemini" : name.Contains("claude") ? "Claude" : name.Contains("copilot") ? "Copilot"
            : name.Contains("chatgpt") || name.Contains("openai") || name.Contains("codex") ? "ChatGPT" : "An AI helper";
        string asked = Get(p, "protocolVersion") as string;
        string[] known = { "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05" };
        return new Dictionary<string, object> {
            { "protocolVersion", known.Contains(asked) ? asked : known[1] },
            { "capabilities", new Dictionary<string, object> { { "tools", new Dictionary<string, object>() } } },
            { "serverInfo", new Dictionary<string, object> { { "name", "3djames" }, { "title", "3DJames" }, { "version", Version } } },
            { "instructions", Tools.Instructions },
        };
    }
}

/// <summary>A job for the 3DJames window, and its answer.</summary>
internal sealed class Job
{
    public string Id, Tool, Client, Window;
    public Dictionary<string, object> Args, Result;
    public string Error;
    public readonly ManualResetEvent Done = new ManualResetEvent(false);
}

internal sealed class Win
{
    public string Id;
    public long Focus;
    public DateTime Seen;
    public int Polling;
    public readonly Queue<Job> Queue = new Queue<Job>();
}

/// <summary>The copy of the link that owns the port: 3DJames windows connect to it.</summary>
internal static class Hub
{
    private static readonly object L = new object();
    private static readonly Dictionary<string, Win> windows = new Dictionary<string, Win>();
    private static readonly Dictionary<string, Job> running = new Dictionary<string, Job>();
    private static TcpListener listener;
    private static string key;
    private static DateTime launched = DateTime.MinValue;
    private static int seq;
    internal const string TellUser = "Tell the user this in plain words and wait for them. Do not look into files, programs or ports to work around it.";
    private static string KeyFile { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "3DJames", Link.Port == 47831 ? "link.key" : "link-" + Link.Port + ".key"); } }

    public static bool IsHub { get { return listener != null; } }

    public static bool TryStart()
    {
        lock (L)
        {
            if (listener != null) return true;
            try
            {
                var l = new TcpListener(IPAddress.Loopback, Link.Port);
                l.ExclusiveAddressUse = true;
                l.Start();
                listener = l;
            }
            catch (SocketException) { return false; }
            var bytes = new byte[24];
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            key = Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_');
            try { Directory.CreateDirectory(Path.GetDirectoryName(KeyFile)); File.WriteAllText(KeyFile, key); }
            catch (Exception ex) { Link.Log("could not write the key file: " + ex.Message); }
            new Thread(AcceptLoop) { IsBackground = true, Name = "hub" }.Start();
            Link.Log("listening on 127.0.0.1:" + Link.Port);
            return true;
        }
    }

    private static void AcceptLoop()
    {
        for (;;)
        {
            TcpClient c;
            try { c = listener.AcceptTcpClient(); } catch (Exception) { return; }
            var client = c;
            new Thread(() => Http.Serve(client, Route)) { IsBackground = true }.Start();
        }
    }

    /// <summary>Run a job here, or hand it to the copy that owns the port.</summary>
    public static Dictionary<string, object> Run(string tool, Dictionary<string, object> args, string client)
    {
        for (int attempt = 0; attempt < 3; attempt++)
        {
            if (IsHub || TryStart()) return RunHere(tool, args, client);
            try { return Forward(tool, args, client); }
            catch (WebException ex)
            {
                var r = ex.Response as HttpWebResponse;
                if (r != null && (int)r.StatusCode != 403) throw new Exception(ReadBody(r));
                Thread.Sleep(400); // the other copy just went away (or is starting): try to take over
            }
        }
        throw new Exception("3DJames Link could not reach the copy of itself that talks to 3DJames. Close the other AI windows and try again.");
    }

    private static Dictionary<string, object> Forward(string tool, Dictionary<string, object> args, string client)
    {
        string k = File.Exists(KeyFile) ? File.ReadAllText(KeyFile).Trim() : "";
        var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Link.Port + "/agent/job");
        req.Method = "POST"; req.Proxy = null; req.Timeout = req.ReadWriteTimeout = 12 * 60 * 1000;
        req.ContentType = "application/json"; req.Headers["X-Link-Key"] = k;
        byte[] body = Encoding.UTF8.GetBytes(Link.Json.Serialize(new Dictionary<string, object> { { "tool", tool }, { "args", args }, { "client", client } }));
        using (var s = req.GetRequestStream()) s.Write(body, 0, body.Length);
        using (var r = (HttpWebResponse)req.GetResponse())
        {
            var d = Link.Json.Deserialize<Dictionary<string, object>>(ReadBody(r));
            if (Link.Get(d, "error") != null) throw new Exception((string)d["error"]);
            return Link.Get(d, "result") as Dictionary<string, object> ?? new Dictionary<string, object>();
        }
    }
    private static string ReadBody(HttpWebResponse r) { using (var sr = new StreamReader(r.GetResponseStream(), Encoding.UTF8)) return sr.ReadToEnd(); }

    private static bool Alive(Win w) { return w.Polling > 0 || (DateTime.UtcNow - w.Seen).TotalSeconds < 45; }
    // A window doing a job (or asking the user "Allow?") only checks in now and then: Windows slows down pages in windows
    // behind others to about once a minute. Give it longer than the 3-minute question before calling it gone.
    private static bool StillThere(Win w) { return w.Polling > 0 || (DateTime.UtcNow - w.Seen).TotalSeconds < 200; }

    private static Win Pick()
    {
        Win best = null;
        foreach (var w in windows.Values)
            if (Alive(w) && (best == null || w.Focus > best.Focus || (w.Focus == best.Focus && w.Seen > best.Seen))) best = w;
        return best;
    }

    /// <summary>Is a 3DJames window connected right now?</summary>
    public static bool WindowOpen()
    {
        lock (L)
        {
            if (!IsHub) return false;
            // an open window asks again every 3 seconds when the link was not there yet
            DateTime until = DateTime.UtcNow.AddSeconds(4);
            while (Pick() == null && DateTime.UtcNow < until) Monitor.Wait(L, 500);
            return Pick() != null;
        }
    }

    private static Dictionary<string, object> RunHere(string tool, Dictionary<string, object> args, string client)
    {
        var job = new Job { Id = "j" + Interlocked.Increment(ref seq), Tool = tool, Args = args, Client = client };
        lock (L)
        {
            Win w = Pick();
            // an open window asks again every 3 seconds when the link was not there: give it time before opening another
            DateTime grace = DateTime.UtcNow.AddSeconds(8);
            while (w == null && DateTime.UtcNow < grace) { Monitor.Wait(L, 500); w = Pick(); }
            if (w == null)
            {
                if ((DateTime.UtcNow - launched).TotalSeconds > 60) { launched = DateTime.UtcNow; Launch(); }
                DateTime until = DateTime.UtcNow.AddSeconds(45);
                while ((w = Pick()) == null && DateTime.UtcNow < until) Monitor.Wait(L, 1000);
                if (w == null) throw new Exception("3DJames is not open (or it is an old version without the AI link). Ask the user to open 3DJames from its folder, then try again. " + TellUser);
            }
            job.Window = w.Id;
            w.Queue.Enqueue(job);
            running[job.Id] = job;
            Monitor.PulseAll(L);
        }
        try
        {
            DateTime until = DateTime.UtcNow.AddMinutes(11);
            while (!job.Done.WaitOne(3000))
            {
                lock (L)
                {
                    Win w;
                    if (!windows.TryGetValue(job.Window, out w) || !StillThere(w)) throw new Exception("The 3DJames window was closed or reloaded before it finished. " + TellUser);
                }
                if (DateTime.UtcNow > until) throw new Exception("3DJames took longer than 11 minutes to answer. " + TellUser);
            }
        }
        finally { lock (L) running.Remove(job.Id); }
        if (job.Error != null) throw new Exception(job.Error);
        return job.Result ?? new Dictionary<string, object>();
    }

    private static void Launch()
    {
        try
        {
            // the desktop app, the start-up file the user uses, the one in the shared zip, or the page itself
            string target = new[] { "3DJames.exe", "3DJames.cmd", "Open 3DJames.cmd", "3DJames.html" }
                .Select(n => Path.Combine(Link.AppDir, n)).FirstOrDefault(File.Exists);
            if (target == null) return;
            Link.Log("opening " + target);
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true, WorkingDirectory = Link.AppDir, WindowStyle = ProcessWindowStyle.Minimized });
        }
        catch (Exception ex) { Link.Log("could not open 3DJames: " + ex.Message); }
    }

    // ---------------------------------------------------------------- the web side
    private static readonly string[] PageOrigins = { "null", "https://app.3djames.local", "https://3djames-app.example" }; // a file, windows-desktop, the Installation folder

    private static Http.Reply Route(Http.Request q)
    {
        if (q.Method == "OPTIONS") return new Http.Reply(204, "");
        if (q.Path == "/hello") return Http.Reply.Of(new Dictionary<string, object> { { "name", "3DJames Link" }, { "version", Link.Version } });
        if (q.Path.StartsWith("/page/"))
        {
            // only the 3DJames page (opened from a file, or the desktop app); web sites have an origin of their own
            string origin = q.Header("origin");
            if (origin != null && !PageOrigins.Contains(origin)) return new Http.Reply(403, "{\"error\":\"not 3DJames\"}");
            if (q.Path == "/page/next" && q.Method == "GET") return Next(q.Query("w"), q.Query("focus"));
            if (q.Path == "/page/alive") { Touch(q.Query("w")); return Http.Reply.Of(new Dictionary<string, object>()); }
            if (q.Path == "/page/result" && q.Method == "POST") return Result(q.Body);
        }
        if (q.Path == "/agent/job" && q.Method == "POST")
        {
            // another copy of the link (a second AI): never a web page, and it must know the key
            if (q.Header("origin") != null || q.Header("x-link-key") != key) return new Http.Reply(403, "{\"error\":\"key\"}");
            try
            {
                var d = Link.Json.Deserialize<Dictionary<string, object>>(q.Text());
                var r = RunHere((string)d["tool"], Link.Get(d, "args") as Dictionary<string, object> ?? new Dictionary<string, object>(), Link.Get(d, "client") as string ?? "An AI helper");
                return Http.Reply.Of(new Dictionary<string, object> { { "result", r } });
            }
            catch (Exception ex) { return Http.Reply.Of(new Dictionary<string, object> { { "error", ex.Message } }); }
        }
        return new Http.Reply(404, "{\"error\":\"not found\"}");
    }

    private static void Touch(string id)
    {
        if (string.IsNullOrEmpty(id)) return;
        lock (L) { Win w; if (windows.TryGetValue(id, out w)) w.Seen = DateTime.UtcNow; }
    }

    private static Http.Reply Next(string id, string focus)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 40) return new Http.Reply(400, "{}");
        long f; long.TryParse(focus, out f);
        Job job = null;
        lock (L)
        {
            Win w;
            if (!windows.TryGetValue(id, out w)) { w = new Win { Id = id }; windows[id] = w; Link.Log("3DJames window " + id + " connected"); }
            w.Focus = f; w.Seen = DateTime.UtcNow; w.Polling++;
            foreach (var old in windows.Values.Where(x => x.Polling == 0 && (DateTime.UtcNow - x.Seen).TotalMinutes > 2 && x.Queue.Count == 0).ToList()) windows.Remove(old.Id);
            Monitor.PulseAll(L);
            DateTime until = DateTime.UtcNow.AddSeconds(20);
            while (w.Queue.Count == 0 && DateTime.UtcNow < until) Monitor.Wait(L, until - DateTime.UtcNow);
            if (w.Queue.Count > 0) job = w.Queue.Dequeue();
            w.Polling--; w.Seen = DateTime.UtcNow;
        }
        var reply = new Dictionary<string, object> { { "link", Link.Version } };
        if (job != null) reply["job"] = new Dictionary<string, object> { { "id", job.Id }, { "tool", job.Tool }, { "args", job.Args }, { "client", job.Client } };
        return Http.Reply.Of(reply);
    }

    private static Http.Reply Result(byte[] body)
    {
        Dictionary<string, object> d;
        try { d = Link.Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body)); }
        catch (Exception) { return new Http.Reply(400, "{}"); }
        Job job;
        lock (L) running.TryGetValue(Link.Get(d, "id") as string ?? "", out job);
        if (job != null)
        {
            if (Link.Get(d, "ok") is bool && (bool)d["ok"]) job.Result = Link.Get(d, "result") as Dictionary<string, object>;
            else job.Error = Link.Get(d, "error") as string ?? "3DJames could not do that.";
            job.Done.Set();
        }
        return Http.Reply.Of(new Dictionary<string, object>());
    }
}

/// <summary>Just enough HTTP for 3DJames' fetch() calls: one request per connection.</summary>
internal static class Http
{
    internal sealed class Request
    {
        public string Method, Path, RawQuery = "";
        public Dictionary<string, string> Headers = new Dictionary<string, string>();
        public byte[] Body = new byte[0];
        public string Header(string k) { string v; return Headers.TryGetValue(k, out v) ? v : null; }
        public string Text() { return Encoding.UTF8.GetString(Body); }
        public string Query(string k)
        {
            foreach (var part in RawQuery.Split('&'))
            {
                int i = part.IndexOf('=');
                if (i > 0 && Uri.UnescapeDataString(part.Substring(0, i)) == k) return Uri.UnescapeDataString(part.Substring(i + 1).Replace('+', ' '));
            }
            return null;
        }
    }
    internal sealed class Reply
    {
        public int Status; public string Body;
        public Reply(int status, string body) { Status = status; Body = body; }
        public static Reply Of(object o) { return new Reply(200, Link.Json.Serialize(o)); }
    }

    public static void Serve(TcpClient c, Func<Request, Reply> route)
    {
        try
        {
            using (c)
            {
                c.ReceiveTimeout = 30000; c.SendTimeout = 60000;
                var s = c.GetStream();
                var q = Read(s);
                if (q == null) return;
                Reply r;
                try { r = route(q); } catch (Exception ex) { r = new Reply(500, Link.Json.Serialize(new Dictionary<string, object> { { "error", ex.Message } })); }
                byte[] body = Encoding.UTF8.GetBytes(r.Body ?? "");
                string head = "HTTP/1.1 " + r.Status + " " + (r.Status == 200 ? "OK" : r.Status == 204 ? "No Content" : "Error") + "\r\n" +
                    "Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n" +
                    "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Allow-Private-Network: true\r\n" +
                    "Content-Length: " + body.Length + "\r\nConnection: close\r\n\r\n";
                byte[] h = Encoding.ASCII.GetBytes(head);
                s.Write(h, 0, h.Length); s.Write(body, 0, body.Length); s.Flush();
            }
        }
        catch (Exception) { /* the page went away */ }
    }

    private static Request Read(NetworkStream s)
    {
        var head = new MemoryStream();
        int b, state = 0;
        while (state < 4 && (b = s.ReadByte()) >= 0)
        {
            head.WriteByte((byte)b);
            state = (b == '\r' && (state == 0 || state == 2)) || (b == '\n' && (state == 1 || state == 3)) ? state + 1 : (b == '\r' ? 1 : 0);
            if (head.Length > 65536) return null;
        }
        if (state < 4) return null;
        string[] lines = Encoding.ASCII.GetString(head.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
        string[] first = lines[0].Split(' ');
        if (first.Length < 2) return null;
        var q = new Request { Method = first[0].ToUpperInvariant() };
        int qi = first[1].IndexOf('?');
        q.Path = qi < 0 ? first[1] : first[1].Substring(0, qi);
        if (qi >= 0) q.RawQuery = first[1].Substring(qi + 1);
        for (int i = 1; i < lines.Length; i++)
        {
            int k = lines[i].IndexOf(':');
            if (k > 0) q.Headers[lines[i].Substring(0, k).Trim().ToLowerInvariant()] = lines[i].Substring(k + 1).Trim();
        }
        long len; long.TryParse(q.Header("content-length") ?? "0", out len);
        if (len < 0 || len > 1024L * 1024 * 1024) return null;
        q.Body = new byte[len];
        int got = 0;
        while (got < len) { int n = s.Read(q.Body, got, (int)len - got); if (n <= 0) return null; got += n; }
        return q;
    }
}

/// <summary>"Connect Antigravity.cmd": tells Google Antigravity where the link is, and how to work with 3DJames.</summary>
internal static class Setup
{
    public static int Antigravity()
    {
        try
        {
            string config = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gemini", "config");
            Directory.CreateDirectory(Path.Combine(config, "rules"));
            // add (or update) 3djames in mcp_config.json, keeping any other helpers there
            string file = Path.Combine(config, "mcp_config.json");
            Dictionary<string, object> all = null;
            if (File.Exists(file) && File.ReadAllText(file).Trim().Length > 0) all = Link.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file));
            if (all == null) all = new Dictionary<string, object>();
            var servers = Link.Get(all, "mcpServers") as Dictionary<string, object> ?? new Dictionary<string, object>();
            servers["3djames"] = new Dictionary<string, object> {
                { "command", Path.Combine(Link.AppDir, "3DJamesLink.exe") }, { "args", new object[0] }, { "cwd", Link.AppDir }, { "timeoutSeconds", 660 } };
            all["mcpServers"] = servers;
            File.WriteAllText(file, Link.Json.Serialize(all));
            // the instructions, read by Antigravity when the user talks about 3DJames
            File.WriteAllText(Path.Combine(config, "rules", "3djames.md"),
                "---\ntrigger: model_decision\ndescription: \"Use whenever the user asks about 3DJames, their 3D models, CAD, STL files, or printing a part: how to work in their open 3DJames window with the 3djames tools.\"\n---\n\n" +
                Tools.Resource("GEMINI.md"), new UTF8Encoding(false));
            Console.WriteLine("Antigravity is now connected to 3DJames.");
            Console.WriteLine("If Antigravity is open, close it and open it again. Then ask it something about 3DJames.");
            return 0;
        }
        catch (Exception ex) { Console.WriteLine("Could not connect Antigravity: " + ex.Message); return 1; }
    }
}
