// The MCP tools of 3DJames Link (described in tools.json): most become a job for the 3DJames window (src/bridge.js);
// files are read and written here, only in the Projects folder (meshes for Make editable from anywhere named).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;

internal static class Tools
{
    public const string Instructions =
        "3DJames is the user's parametric CAD app (3D Builder look). These tools work in the 3DJames window open on their computer; " +
        "they see every change, and each change is one Undo step. Read how_to_write_steps once before writing steps. " +
        "After each change, look at the problems in the build report and fix them; use picture to check the shape. " +
        "Prefer changing variables and existing steps over adding new ones, name every step and object clearly, and " +
        "never save over a file or throw away unsaved work unless the user said so. If a tool reports a problem, tell the user " +
        "what it says in plain words and wait: never inspect, search, decompile or run 3DJamesLink.exe, 3DJames.html " +
        "or other files, ports or processes to work around it.";

    private static object[] list;
    private static string guide;

    internal static string Resource(string name)
    {
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        using (var r = new StreamReader(s)) return r.ReadToEnd();
    }

    public static object[] List()
    {
        if (list == null) list = Link.Json.Deserialize<object[]>(Resource("tools.json"));
        return list;
    }

    private static Dictionary<string, object> Text(object o, bool error = false)
    {
        string text = o as string ?? Link.Json.Serialize(o);
        var r = new Dictionary<string, object> { { "content", new object[] { new Dictionary<string, object> { { "type", "text" }, { "text", text } } } } };
        if (error) r["isError"] = true;
        return r;
    }

    private static Dictionary<string, object> Job(string tool, Dictionary<string, object> args) { return Hub.Run(tool, args, Link.Client); }

    public static Dictionary<string, object> Call(string name, Dictionary<string, object> a)
    {
        try
        {
            switch (name)
            {
                case "status":
                    if (!Hub.WindowOpen() && Hub.IsHub) return Text(new Dictionary<string, object> { { "open", false }, { "note", "3DJames is not open. Any other tool opens it (the user is asked to allow you in)." }, { "projects_folder", Link.ProjectsDir } });
                    var st = Job("status", a); st["open"] = true; st["projects_folder"] = Link.ProjectsDir; return Text(st);
                case "how_to_write_steps":
                    if (guide == null) guide = Guide();
                    return Text(guide);
                case "list_projects": return Text(ListProjects());
                case "open_project":
                {
                    string path = Find(Str(a, "name"), new[] { ".3dj", ".3mf", ".json", ".stl", ".obj", ".step", ".stp" });
                    return Text(Job("open_project", new Dictionary<string, object> { { "name", Path.GetFileName(path) }, { "data", Convert.ToBase64String(File.ReadAllBytes(path)) }, { "discard_changes", Link.Get(a, "discard_changes") } }));
                }
                case "make_editable":
                {
                    var args = new Dictionary<string, object>();
                    string file = Link.Get(a, "file") as string;
                    if (!string.IsNullOrEmpty(file))
                    {
                        string path = Find(file, new[] { ".stl", ".obj", ".3mf" });
                        args["name"] = Path.GetFileName(path);
                        args["data"] = Convert.ToBase64String(File.ReadAllBytes(path));
                    }
                    else if (Link.Get(a, "object") is string) args["id"] = a["object"];
                    else throw new Exception("Give \"file\" (an STL, OBJ or 3MF) or \"object\" (a mesh already in the project).");
                    string detail = Link.Get(a, "detail") as string;
                    if (!string.IsNullOrEmpty(detail)) args["detail"] = detail;
                    return Text(Job("make_editable", args));
                }
                case "picture":
                {
                    var r = Job("picture", a);
                    return new Dictionary<string, object> { { "content", new object[] {
                        new Dictionary<string, object> { { "type", "image" }, { "data", r["image"] }, { "mimeType", "image/png" } },
                        new Dictionary<string, object> { { "type", "text" }, { "text", "The model in 3DJames, view: " + (Link.Get(a, "view") ?? "home") } } } } };
                }
                case "save_project": return Text(Save(a));
                case "new_project": case "get_project": case "build": case "add_steps": case "change_step": case "delete_steps":
                case "set_vars": case "set_objects": case "replace_project": case "undo":
                    return Text(Job(name, a));
                default: return Text("There is no tool called " + name + ".", true);
            }
        }
        catch (Exception ex) { return Text(ex.Message, true); }
    }

    private static string Str(Dictionary<string, object> a, string k)
    {
        string s = Link.Get(a, k) as string;
        if (string.IsNullOrWhiteSpace(s)) throw new Exception("\"" + k + "\" is needed.");
        return s.Trim();
    }

    /// <summary>A file the AI named: a full path, or a name (with or without its extension) in the Projects folder.</summary>
    private static string Find(string name, string[] exts)
    {
        var tries = new List<string>();
        if (Path.IsPathRooted(name)) tries.Add(Path.GetFullPath(name));
        else
        {
            string root = Path.GetFullPath(Link.ProjectsDir).TrimEnd('\\') + "\\";
            string p = Path.GetFullPath(Path.Combine(root, name));
            if (!p.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new Exception("Names are looked up in the Projects folder; use a full path for other places.");
            tries.Add(p);
            tries.AddRange(exts.Select(e => p + e));
        }
        foreach (string t in tries)
            if (File.Exists(t) && exts.Contains(Path.GetExtension(t).ToLowerInvariant())) return t;
        throw new Exception("There is no " + string.Join(" / ", exts) + " file called \"" + name + "\"" + (Path.IsPathRooted(name) ? "" : " in " + Link.ProjectsDir) + ". list_projects shows what is there.");
    }

    private static object ListProjects()
    {
        if (!Directory.Exists(Link.ProjectsDir)) return new Dictionary<string, object> { { "folder", Link.ProjectsDir }, { "projects", new object[0] } };
        string[] exts = { ".3dj", ".3mf", ".json", ".stl", ".obj", ".step", ".stp" };
        var root = new DirectoryInfo(Link.ProjectsDir);
        var files = root.EnumerateFiles("*", SearchOption.AllDirectories)
            .Where(f => exts.Contains(f.Extension.ToLowerInvariant()))
            .OrderByDescending(f => f.LastWriteTime).Take(300)
            .Select(f => (object)new Dictionary<string, object> {
                { "name", f.FullName.Substring(root.FullName.TrimEnd('\\').Length + 1) },
                { "kb", (f.Length + 1023) / 1024 },
                { "changed", f.LastWriteTime.ToString("yyyy-MM-dd HH:mm") } }).ToArray();
        return new Dictionary<string, object> { { "folder", Link.ProjectsDir }, { "projects", files } };
    }

    private static object Save(Dictionary<string, object> a)
    {
        string format = (Link.Get(a, "format") as string ?? "3dj").ToLowerInvariant().TrimStart('.');
        if (format == "stp") format = "step";
        if (!new[] { "3dj", "stl", "step", "3mf" }.Contains(format)) throw new Exception("format is 3dj, stl, step or 3mf.");
        string name = Link.Get(a, "name") as string;
        if (string.IsNullOrWhiteSpace(name)) name = Job("status", new Dictionary<string, object>())["project"] as string;
        if (string.IsNullOrWhiteSpace(name)) name = "Model";
        name = Path.GetFileName(name.Trim());
        if (name.EndsWith("." + format, StringComparison.OrdinalIgnoreCase)) name = name.Substring(0, name.Length - format.Length - 1);
        foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '-');
        name = name.Trim(' ', '.');
        if (name.Length == 0) throw new Exception("That name has no usable letters.");
        string file = name + "." + format, path = Path.Combine(Link.ProjectsDir, file);
        bool exists = File.Exists(path);
        bool overwrite = Link.Get(a, "overwrite") is bool && (bool)a["overwrite"];
        if (exists && !overwrite) throw new Exception(file + " already exists in Projects. Choose another name, or ask the user and then pass overwrite: true (3DJames asks them too).");
        var r = Job("file_data", new Dictionary<string, object> { { "name", file }, { "format", format }, { "exists", exists } });
        byte[] data = Convert.FromBase64String((string)r["data"]);
        Directory.CreateDirectory(Link.ProjectsDir);
        string tmp = path + ".saving";
        File.WriteAllBytes(tmp, data);
        if (exists) File.Replace(tmp, path, null); else File.Move(tmp, path);
        Job("saved", new Dictionary<string, object> { { "name", file } });
        return new Dictionary<string, object> { { "saved", path }, { "kb", (data.Length + 1023) / 1024 } };
    }

    /// <summary>The step guide: the 3djames-project skill from its modelling part on (build_link.py trims it).</summary>
    private static string Guide()
    {
        string s = Resource("SKILL.md");
        return "How 3DJames project JSON works. With the 3DJames tools you do not write or zip files: pass steps to add_steps / " +
            "change_step / replace_project, read problems from the build report, and save with save_project. Ignore any part below " +
            "about project.json files, zipping, running the checker or where to write files.\n\n" + s;
    }
}
