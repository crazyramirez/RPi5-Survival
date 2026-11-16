// Survivelia OS (Windows) — ADR 0019. Se compila al empaquetar con el csc.exe de .NET Framework 4 (incluido en
// Windows 10/11), sin dependencias:
//   csc /target:winexe /win32icon:icon.ico /r:System.Management.dll /r:System.Windows.Forms.dll SurvivalOS.cs
//
//   «Survivelia OS.exe»               en la raíz de la carpeta portable: abre Survivelia OS sin ventana de consola.
//   «Survivelia OS.exe» --watch       vigilante «abrir al conectar la memoria USB» (copia en %LOCALAPPDATA%).
//   «Survivelia OS.exe» --open-usb    acceso «Survivelia OS (USB)»: abre la memoria emparejada que esté conectada.
//
// Solo actúa con memorias EMPAREJADAS (identificador en <unidad>\.survival-os\volume-id, apuntado en
// autoopen.conf por la aplicación con permiso del usuario). Nunca ejecuta una memoria cualquiera.
// C# 5 (el compilador de .NET Framework): sin interpolación de cadenas ni otras novedades.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Survivelia OS")]
[assembly: AssemblyProduct("Survivelia OS")]
[assembly: AssemblyDescription("Survivelia OS")]
[assembly: AssemblyCompany("Survivelia OS")]
[assembly: AssemblyCopyright("Survivelia OS")]
[assembly: AssemblyVersion("__VERSION__.0")]
[assembly: AssemblyFileVersion("__VERSION__.0")]

static class SurvivalOS
{
    static readonly Regex IdRe = new Regex("^[0-9a-f]{32}$");

    [STAThread]
    static int Main(string[] args)
    {
        string self = AppDomain.CurrentDomain.BaseDirectory;
        if (Has(args, "--watch")) return Watch(self);
        if (!Has(args, "--open-usb") && File.Exists(Path.Combine(self, @"runtime\win-x64\node.exe"))) return Launch(self, args);
        return OpenUsb(self);
    }

    static bool Has(string[] args, string a)
    {
        foreach (string x in args) if (string.Equals(x, a, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    // ------------------------------------------------------------------ abrir Survivelia OS

    /** Comillas para CommandLineToArgvW (las barras antes de una comilla se duplican). */
    static string Quote(string s)
    {
        var sb = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in s)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') sb.Append('\\', slashes * 2 + 1);
            else sb.Append('\\', slashes);
            slashes = 0;
            sb.Append(c);
        }
        sb.Append('\\', slashes * 2);
        return sb.Append('"').ToString();
    }

    static int Launch(string root, string[] args)
    {
        string node = Path.Combine(root, @"runtime\win-x64\node.exe");
        string launcher = Path.Combine(root, @"app\portable\launcher.mjs");
        if (!File.Exists(launcher))
        {
            Error("Falta la aplicación (app\\portable\\launcher.mjs). Copia la carpeta completa de Survivelia OS y vuelve a intentarlo.");
            return 1;
        }
        var cmd = new StringBuilder(Quote(launcher));
        foreach (string a in args) cmd.Append(' ').Append(Quote(a));
        var psi = new ProcessStartInfo(node, cmd.ToString());
        psi.WorkingDirectory = root;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        try { Process.Start(psi); }
        catch (Exception e)
        {
            Error("No se pudo iniciar Survivelia OS:\n\n" + e.Message);
            return 1;
        }
        return 0;
    }

    /** Abre la copia de Survivelia OS de una memoria (su propio «Survivelia OS.exe», o el lanzador .vbs si no lo tiene). */
    static void LaunchTarget(string target)
    {
        string exe = Path.Combine(target, "Survivelia OS.exe");
        // Memorias preparadas con una versión anterior: «Survival OS.exe».
        if (!File.Exists(exe)) exe = Path.Combine(target, "Survival OS.exe");
        string vbs = Path.Combine(target, @"app\portable\win\survival-os.vbs");
        try
        {
            if (File.Exists(exe))
            {
                var psi = new ProcessStartInfo(exe);
                psi.WorkingDirectory = target;
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            else if (File.Exists(vbs))
            {
                string wscript = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "wscript.exe");
                var psi = new ProcessStartInfo(wscript, Quote(vbs));
                psi.WorkingDirectory = target;
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
        }
        catch (Exception e) { Error("No se pudo iniciar Survivelia OS:\n\n" + e.Message); }
    }

    static void Error(string text)
    {
        MessageBox.Show(text, "Survivelia OS", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    // ------------------------------------------------------------------ configuración (autoopen.conf)

    class Conf
    {
        public string Mode = "ask";
        public Dictionary<string, string> Volumes = new Dictionary<string, string>();
        public Dictionary<string, string> Msg = new Dictionary<string, string>();
        public string M(string key, string fallback)
        {
            string v;
            return Msg.TryGetValue(key, out v) && v.Length > 0 ? v : fallback;
        }
    }

    static Conf ReadConf(string dir)
    {
        string path = Path.Combine(dir, "autoopen.conf");
        if (!File.Exists(path)) return null;
        var c = new Conf();
        string[] lines;
        try { lines = File.ReadAllLines(path, Encoding.UTF8); }
        catch { return null; }
        foreach (string line in lines)
        {
            int i = line.IndexOf('=');
            if (line.StartsWith("#") || i < 0) continue;
            string k = line.Substring(0, i);
            string v = line.Substring(i + 1);
            if (k == "mode" && (v == "ask" || v == "open")) c.Mode = v;
            else if (k == "volume")
            {
                string[] parts = v.Split('\t');
                string rel = parts.Length > 1 && parts[1].Length > 0 ? parts[1] : ".";
                if (IdRe.IsMatch(parts[0]) && SafeRel(rel)) c.Volumes[parts[0]] = rel;
            }
            else if (k.StartsWith("msg.")) c.Msg[k.Substring(4)] = v;
        }
        return c;
    }

    static bool SafeRel(string rel)
    {
        if (rel.Length > 200 || Path.IsPathRooted(rel)) return false;
        foreach (string part in rel.Replace('\\', '/').Split('/')) if (part == "..") return false;
        return rel.IndexOfAny(Path.GetInvalidPathChars()) < 0;
    }

    /** Identificador de la memoria de la unidad «E:\», o null. */
    static string VolumeId(string driveRoot)
    {
        try
        {
            string f = Path.Combine(driveRoot, @".survival-os\volume-id");
            if (!File.Exists(f) || new FileInfo(f).Length > 256) return null;
            string id = File.ReadAllText(f, Encoding.ASCII).Trim();
            return IdRe.IsMatch(id) ? id : null;
        }
        catch { return null; }
    }

    static string TargetFor(Conf c, string driveRoot)
    {
        string id = VolumeId(driveRoot);
        string rel;
        if (id == null || !c.Volumes.TryGetValue(id, out rel)) return null;
        return rel == "." ? driveRoot : Path.Combine(driveRoot, rel.Replace('/', '\\'));
    }

    // ------------------------------------------------------------------ vigilante

    static int Watch(string dir)
    {
        bool created;
        using (var mutex = new Mutex(true, @"Local\SurvivalOS-USB-Watch", out created))
        {
            if (!created) return 0;
            var query = new WqlEventQuery("SELECT * FROM Win32_VolumeChangeEvent WHERE EventType = 2");
            using (var watcher = new ManagementEventWatcher(query))
            {
                watcher.Options.Timeout = TimeSpan.FromSeconds(10);
                string lastDrive = null;
                DateTime lastAt = DateTime.MinValue;
                while (true)
                {
                    Conf c = ReadConf(dir);
                    if (c == null || c.Volumes.Count == 0) return 0; // desactivado desde la aplicación
                    ManagementBaseObject e;
                    try { e = watcher.WaitForNextEvent(); }
                    catch (ManagementException ex)
                    {
                        if (ex.ErrorCode != ManagementStatus.Timedout) Thread.Sleep(5000);
                        continue;
                    }
                    catch { Thread.Sleep(5000); continue; }
                    string drive = Convert.ToString(e["DriveName"]);
                    if (string.IsNullOrEmpty(drive) || !Regex.IsMatch(drive, "^[A-Za-z]:$")) continue;
                    // Windows puede avisar dos veces de la misma llegada.
                    if (drive == lastDrive && (DateTime.Now - lastAt).TotalSeconds < 15) continue;
                    lastDrive = drive;
                    lastAt = DateTime.Now;
                    Thread.Sleep(1500); // que el sistema termine de montarla
                    c = ReadConf(dir);
                    if (c == null) return 0;
                    string target = TargetFor(c, drive + "\\");
                    if (target == null) continue;
                    if (c.Mode != "open" && !Ask(c, drive)) continue;
                    LaunchTarget(target);
                }
            }
        }
    }

    /** Pregunta en primer plano (los diálogos de un proceso en segundo plano quedarían detrás de otras ventanas). */
    static bool Ask(Conf c, string drive)
    {
        string text = c.M("ask", "¿Abrir Survivelia OS?").Replace("{name}", drive);
        using (var owner = new Form())
        {
            owner.TopMost = true;
            owner.ShowInTaskbar = false;
            owner.FormBorderStyle = FormBorderStyle.None;
            owner.StartPosition = FormStartPosition.CenterScreen;
            owner.Size = new System.Drawing.Size(1, 1);
            owner.Opacity = 0;
            owner.Show();
            owner.Activate();
            var r = MessageBox.Show(owner, text, c.M("title", "Survivelia OS"), MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button1);
            return r == DialogResult.Yes;
        }
    }

    // ------------------------------------------------------------------ acceso «Survivelia OS (USB)»

    static int OpenUsb(string dir)
    {
        Conf c = ReadConf(dir);
        if (c == null)
        {
            Error("No se encuentra runtime\\win-x64\\node.exe. Copia la carpeta completa de Survivelia OS y vuelve a intentarlo.");
            return 1;
        }
        foreach (DriveInfo d in DriveInfo.GetDrives())
        {
            bool ready;
            try { ready = d.IsReady; } catch { ready = false; }
            if (!ready) continue;
            string target = TargetFor(c, d.RootDirectory.FullName);
            if (target == null) continue;
            LaunchTarget(target);
            return 0;
        }
        MessageBox.Show(c.M("connect", "Conecta la memoria USB de Survivelia OS y vuelve a intentarlo."), c.M("title", "Survivelia OS"), MessageBoxButtons.OK, MessageBoxIcon.Information);
        return 0;
    }
}
