// Mefi's Studio AI+ - the resource helper (Windows).
//
// A small program Studio starts on demand (scripts/resource-host.cjs) to look
// at this PC's processes and, when asked, to slow one down, pause it, give its
// memory back to Windows, ask it to close or end it. It reads one command per
// line on stdin and answers each with one JSON line on stdout. It keeps a
// ledger of everything it changed and undoes all of it when Studio says
// "restoreall", when Studio says "exit", and when its stdin closes: Studio
// quitting, crashing or being ended all close the pipe, so an app Studio
// paused never stays paused after Studio is gone.
//
// Commands (tokens separated by single spaces; a target is pid:creationTime,
// creationTime as a Windows FILETIME, so a reused pid never matches; it travels
// as a string because it is past 2^53):
//   <id> ping
//   <id> snap
//   <id> slow|unslow|pause|resume|trim|close|end|restore <pid:create>[,<pid:create>...]
//   <id> adopt <pid:create:flags:oldPriority:oldMemoryPriority>[,...]
//   <id> ledger
//   <id> restoreall
//   <id> exit
// slow is Task Manager's efficiency mode (idle priority and EcoQoS) plus a low
// memory priority; pause suspends every thread; trim empties the working set;
// close posts WM_CLOSE to the app's windows; end terminates it. adopt takes
// back what a helper that died without restoring left behind (flags p for
// paused, s for slowed), so the next restore undoes it.
//
// It never touches pid 0 or 4, itself, the pid Studio names as its own on the
// command line, a process Windows marks critical, or one in session 0 (a
// service). Which apps may be touched at all is Studio's decision
// (scripts/resource-rules.cjs); these are only the floor under it.
//
// Studio builds it with the C# compiler that ships with Windows (.NET
// Framework 4's csc.exe), once per version of this file, so it keeps to C# 5:
// no string interpolation, no ?. and no expression bodies.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace MefiStudio
{
    public static class ResourceHelper
    {
        const string Version = "1";

        // ---- Windows ------------------------------------------------------
        const int SystemProcessInformation = 5;
        const int STATUS_INFO_LENGTH_MISMATCH = unchecked((int)0xC0000004);
        const int PROCESS_TERMINATE = 0x0001;
        const int PROCESS_SET_QUOTA = 0x0100;
        const int PROCESS_SET_INFORMATION = 0x0200;
        const int PROCESS_QUERY_INFORMATION = 0x0400;
        const int PROCESS_SUSPEND_RESUME = 0x0800;
        const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        const int ProcessMemoryPriority = 0;
        const int ProcessPowerThrottling = 4;
        const uint PROCESS_POWER_THROTTLING_EXECUTION_SPEED = 0x1;
        const uint IDLE_PRIORITY_CLASS = 0x40;
        const uint NORMAL_PRIORITY_CLASS = 0x20;
        const int MEMORY_PRIORITY_LOW = 2;
        const int MEMORY_PRIORITY_NORMAL = 5;
        const uint WM_CLOSE = 0x0010;
        const uint GW_OWNER = 4;
        const int GWL_EXSTYLE = -20;
        const int WS_EX_TOOLWINDOW = 0x00000080;
        const int DWMWA_CLOAKED = 14;
        const int ERROR_ACCESS_DENIED = 5;
        const int ERROR_INVALID_PARAMETER = 87;

        [StructLayout(LayoutKind.Sequential)]
        struct PowerThrottlingState { public uint Version; public uint ControlMask; public uint StateMask; }

        [StructLayout(LayoutKind.Sequential)]
        struct MemoryPriorityInformation { public int MemoryPriority; }

        [StructLayout(LayoutKind.Sequential)]
        struct MemoryStatusEx
        {
            public uint Length; public uint MemoryLoad;
            public ulong TotalPhys; public ulong AvailPhys;
            public ulong TotalPageFile; public ulong AvailPageFile;
            public ulong TotalVirtual; public ulong AvailVirtual; public ulong AvailExtendedVirtual;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct LastInputInfo { public uint Size; public uint Time; }

        delegate bool EnumWindowsProc(IntPtr window, IntPtr param);

        [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int infoClass, IntPtr buffer, int length, out int needed);
        [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr process);
        [DllImport("ntdll.dll")] static extern int NtResumeProcess(IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetPriorityClass(IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetPriorityClass(IntPtr process, uint priorityClass);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetProcessInformation(IntPtr process, int infoClass, ref PowerThrottlingState info, int size);
        [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "SetProcessInformation")] static extern bool SetMemoryPriority(IntPtr process, int infoClass, ref MemoryPriorityInformation info, int size);
        [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "GetProcessInformation")] static extern bool GetMemoryPriority(IntPtr process, int infoClass, out MemoryPriorityInformation info, int size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessCritical(IntPtr process, out bool critical);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr process, int flags, StringBuilder name, ref int size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx status);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool K32EmptyWorkingSet(IntPtr process);
        [DllImport("kernel32.dll")] static extern uint GetTickCount();
        [DllImport("kernel32.dll")] static extern int GetCurrentProcessId();
        [DllImport("kernel32.dll")] static extern bool ProcessIdToSessionId(int pid, out int session);
        [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInputInfo info);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder text, int max);
        [DllImport("user32.dll")] static extern int GetWindowTextLengthW(IntPtr window);
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
        [DllImport("user32.dll")] static extern int GetWindowLongW(IntPtr window, int index);
        [DllImport("user32.dll", SetLastError = true)] static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);

        // ---- what this helper changed -------------------------------------
        // One row per process it changed, holding the handle it was changed
        // through: Windows does not reuse a pid while a handle to it is open,
        // so a restore can only ever reach the process that was changed.
        sealed class Change
        {
            public int Pid;
            public long Create;
            public string Name;
            public IntPtr Handle;
            public bool Slowed;
            public uint OldPriority;
            public int OldMemoryPriority;
            public bool Paused;
        }

        static readonly Dictionary<int, Change> ledger = new Dictionary<int, Change>();
        static readonly Dictionary<string, string> pathCache = new Dictionary<string, string>();
        static readonly Dictionary<string, string> describeCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        static int selfPid;
        static int studioPid;
        static TextWriter output;

        // args[0], when given, is Studio's own pid: never touched.
        public static int Main(string[] args)
        {
            studioPid = args != null && args.Length > 0 ? ParseInt(args[0], 0) : 0;
            Run();
            return 0;
        }

        // The loop: one command a line until stdin closes, then put everything back.
        public static void Run()
        {
            selfPid = GetCurrentProcessId();
            output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            ((StreamWriter)output).AutoFlush = true;
            TextReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            Write("{\"id\":0,\"ok\":true,\"ready\":true,\"version\":\"" + Version + "\",\"pid\":" + selfPid + ",\"bits\":" + (IntPtr.Size * 8) + "}");
            string line;
            while ((line = SafeRead(input)) != null)
            {
                line = line.Trim();
                if (line.Length == 0) continue;
                string[] parts = line.Split(' ');
                string id = Num(parts[0]);
                string op = parts.Length > 1 ? parts[1] : "";
                string arg = parts.Length > 2 ? parts[2] : "";
                if (op == "exit")
                {
                    Write("{\"id\":" + id + ",\"ok\":true,\"restored\":" + RestoreAll() + "}");
                    return;
                }
                string reply;
                try { reply = Handle(op, arg); }
                catch (Exception error) { reply = Fail("failed", error.Message); }
                Write("{\"id\":" + id + "," + reply + "}");
            }
            RestoreAll();
        }

        static string SafeRead(TextReader input)
        {
            try { return input.ReadLine(); } catch { return null; }
        }

        static void Write(string line)
        {
            try { output.Write(line + "\n"); } catch { }
        }

        static string Handle(string op, string arg)
        {
            switch (op)
            {
                case "ping": return "\"ok\":true,\"version\":\"" + Version + "\",\"pid\":" + selfPid;
                case "snap": return Snapshot();
                case "ledger": return "\"ok\":true,\"ledger\":" + LedgerJson();
                case "restoreall": return "\"ok\":true,\"restored\":" + RestoreAll() + ",\"ledger\":" + LedgerJson();
                case "slow":
                case "pause":
                case "resume":
                case "trim":
                case "close":
                case "end":
                case "restore":
                case "unslow":
                case "adopt":
                    return Act(op, arg);
                default: return Fail("unknown", "unknown command " + op);
            }
        }

        // ---- the snapshot -------------------------------------------------
        // Every process in one read of the kernel's table: pid, parent, name,
        // creation time, CPU time, memory, session, priority, threads, whether
        // every thread is suspended, its file and its window's title.
        static string Snapshot()
        {
            StringBuilder json = new StringBuilder(96 * 1024);
            long idle, kernel, user;
            GetSystemTimes(out idle, out kernel, out user);
            MemoryStatusEx memory = new MemoryStatusEx();
            memory.Length = (uint)Marshal.SizeOf(typeof(MemoryStatusEx));
            GlobalMemoryStatusEx(ref memory);
            int foreground = 0;
            IntPtr window = GetForegroundWindow();
            if (window != IntPtr.Zero) GetWindowThreadProcessId(window, out foreground);
            LastInputInfo last = new LastInputInfo();
            last.Size = (uint)Marshal.SizeOf(typeof(LastInputInfo));
            long idleMs = GetLastInputInfo(ref last) ? (long)unchecked(GetTickCount() - last.Time) : -1;
            int ownSession;
            if (!ProcessIdToSessionId(selfPid, out ownSession)) ownSession = -1;
            Dictionary<int, string> titles = WindowTitles();

            json.Append("\"ok\":true,\"at\":").Append(UnixMs())
                .Append(",\"cpus\":").Append(Environment.ProcessorCount)
                .Append(",\"sys\":[").Append(idle).Append(',').Append(kernel).Append(',').Append(user).Append(']')
                .Append(",\"mem\":[").Append(memory.TotalPhys).Append(',').Append(memory.AvailPhys).Append(',')
                .Append(memory.TotalPageFile).Append(',').Append(memory.AvailPageFile).Append(',').Append(memory.MemoryLoad).Append(']')
                .Append(",\"fg\":").Append(foreground)
                .Append(",\"idle\":").Append(idleMs)
                .Append(",\"self\":").Append(selfPid)
                .Append(",\"session\":").Append(ownSession)
                .Append(",\"procs\":[");

            List<string> files = new List<string>();
            Dictionary<string, int> fileIndex = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            HashSet<string> seen = new HashSet<string>();
            bool first = true;
            IntPtr buffer = IntPtr.Zero;
            try
            {
                buffer = QueryProcesses();
                // SYSTEM_PROCESS_INFORMATION and SYSTEM_THREAD_INFORMATION, laid out
                // for 64-bit and 32-bit pointers.
                int p = IntPtr.Size;
                int nameAt = 56, nameBufferAt = 56 + (p == 8 ? 8 : 4);
                int basePriorityAt = p == 8 ? 72 : 64;
                int pidAt = p == 8 ? 80 : 68;
                int parentAt = pidAt + p;
                int sessionAt = parentAt + p + 4;
                int workingSetAt = p == 8 ? 144 : 104;
                int privateAt = p == 8 ? 200 : 132;
                int threadsAt = p == 8 ? 256 : 184;
                int threadSize = p == 8 ? 80 : 64;
                int threadStateAt = p == 8 ? 68 : 52;
                long offset = 0;
                while (true)
                {
                    IntPtr entry = new IntPtr(buffer.ToInt64() + offset);
                    int next = Marshal.ReadInt32(entry, 0);
                    int threads = Marshal.ReadInt32(entry, 4);
                    long workingSetPrivate = Marshal.ReadInt64(entry, 8);
                    long create = Marshal.ReadInt64(entry, 32);
                    long cpu = Marshal.ReadInt64(entry, 40) + Marshal.ReadInt64(entry, 48);
                    int nameLength = Marshal.ReadInt16(entry, nameAt) & 0xFFFF;
                    IntPtr nameBuffer = Marshal.ReadIntPtr(entry, nameBufferAt);
                    string name = nameLength > 0 && nameBuffer != IntPtr.Zero ? Marshal.PtrToStringUni(nameBuffer, nameLength / 2) : "";
                    int basePriority = Marshal.ReadInt32(entry, basePriorityAt);
                    int pid = (int)Marshal.ReadIntPtr(entry, pidAt).ToInt64();
                    int parent = (int)Marshal.ReadIntPtr(entry, parentAt).ToInt64();
                    int session = Marshal.ReadInt32(entry, sessionAt);
                    long workingSet = Marshal.ReadIntPtr(entry, workingSetAt).ToInt64();
                    long privateBytes = Marshal.ReadIntPtr(entry, privateAt).ToInt64();
                    int suspended = 0;
                    for (int t = 0; t < threads; t++)
                    {
                        IntPtr thread = new IntPtr(entry.ToInt64() + threadsAt + (long)t * threadSize);
                        // KTHREAD_STATE Waiting (5) for KWAIT_REASON Suspended (5).
                        if (Marshal.ReadInt32(thread, threadStateAt) == 5 && Marshal.ReadInt32(thread, threadStateAt + 4) == 5) suspended++;
                    }
                    if (pid != 0)
                    {
                        string key = pid + ":" + create;
                        seen.Add(key);
                        // A service's file is never needed: services are never touched.
                        string path = session == 0 ? null : PathOf(pid, key);
                        int file = -1;
                        if (path != null && !fileIndex.TryGetValue(path, out file))
                        {
                            file = files.Count;
                            fileIndex[path] = file;
                            files.Add("[" + Str(path) + "," + Str(Describe(path)) + "]");
                        }
                        string title;
                        titles.TryGetValue(pid, out title);
                        if (!first) json.Append(',');
                        first = false;
                        json.Append('[').Append(pid).Append(',').Append(parent).Append(',').Append(Str(name)).Append(',')
                            .Append('"').Append(create).Append("\",").Append(cpu).Append(',').Append(workingSet).Append(',')
                            .Append(privateBytes).Append(',').Append(workingSetPrivate).Append(',').Append(session).Append(',')
                            .Append(basePriority).Append(',').Append(threads).Append(',')
                            .Append(threads > 0 && suspended == threads ? 1 : 0).Append(',')
                            .Append(file).Append(',').Append(title == null ? "null" : Str(title)).Append(']');
                    }
                    if (next == 0) break;
                    offset += next;
                }
            }
            finally
            {
                if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            }
            // Paths of processes that left are dropped, so the cache stays the size
            // of the table, and so is the ledger row of a process that ended.
            List<string> gone = new List<string>();
            foreach (string key in pathCache.Keys) if (!seen.Contains(key)) gone.Add(key);
            foreach (string key in gone) pathCache.Remove(key);
            foreach (Change change in new List<Change>(ledger.Values))
            {
                if (seen.Contains(change.Pid + ":" + change.Create)) continue;
                ledger.Remove(change.Pid);
                CloseHandle(change.Handle);
            }
            if (describeCache.Count > 4000) describeCache.Clear();

            json.Append("],\"files\":[").Append(string.Join(",", files.ToArray())).Append("],\"ledger\":").Append(LedgerJson());
            return json.ToString();
        }

        static IntPtr QueryProcesses()
        {
            int size = 1024 * 1024;
            for (int attempt = 0; attempt < 6; attempt++)
            {
                IntPtr buffer = Marshal.AllocHGlobal(size);
                int needed;
                int status = NtQuerySystemInformation(SystemProcessInformation, buffer, size, out needed);
                if (status == 0) return buffer;
                Marshal.FreeHGlobal(buffer);
                if (status != STATUS_INFO_LENGTH_MISMATCH) throw new InvalidOperationException("the process table could not be read (0x" + status.ToString("X8") + ")");
                size = Math.Max(size * 2, needed + 64 * 1024);
            }
            throw new InvalidOperationException("the process table kept growing");
        }

        static string PathOf(int pid, string key)
        {
            string path;
            if (pathCache.TryGetValue(key, out path)) return path;
            path = null;
            IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (handle != IntPtr.Zero)
            {
                try
                {
                    StringBuilder name = new StringBuilder(1024);
                    int size = name.Capacity;
                    if (QueryFullProcessImageNameW(handle, 0, name, ref size)) path = name.ToString(0, size);
                }
                finally { CloseHandle(handle); }
            }
            pathCache[key] = path;
            return path;
        }

        static string Describe(string path)
        {
            string description;
            if (describeCache.TryGetValue(path, out description)) return description;
            description = "";
            try
            {
                FileVersionInfo info = FileVersionInfo.GetVersionInfo(path);
                description = (info.FileDescription ?? "").Trim();
                if (description.Length == 0) description = (info.ProductName ?? "").Trim();
            }
            catch { }
            describeCache[path] = description;
            return description;
        }

        // The first visible, unowned, uncloaked window title of each process:
        // what a person would call that app's window.
        static Dictionary<int, string> WindowTitles()
        {
            Dictionary<int, string> titles = new Dictionary<int, string>();
            EnumWindows(delegate (IntPtr window, IntPtr param)
            {
                if (!IsWindowVisible(window)) return true;
                if (GetWindow(window, GW_OWNER) != IntPtr.Zero) return true;
                if ((GetWindowLongW(window, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
                int cloaked;
                if (DwmGetWindowAttribute(window, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
                int length = GetWindowTextLengthW(window);
                if (length <= 0) return true;
                int pid;
                GetWindowThreadProcessId(window, out pid);
                if (pid == 0 || titles.ContainsKey(pid)) return true;
                StringBuilder text = new StringBuilder(Math.Min(length, 300) + 1);
                GetWindowTextW(window, text, text.Capacity);
                titles[pid] = text.ToString();
                return true;
            }, IntPtr.Zero);
            return titles;
        }

        // ---- acting on processes ------------------------------------------
        // Each target answers on its own; the reply ends with the ledger as it
        // stands after all of them, which Studio keeps as its journal.
        static string Act(string op, string arg)
        {
            StringBuilder json = new StringBuilder();
            json.Append("\"ok\":true,\"results\":[");
            string[] targets = arg.Length == 0 ? new string[0] : arg.Split(',');
            bool first = true;
            foreach (string target in targets)
            {
                string[] fields = target.Split(':');
                int pid = ParseInt(fields[0], 0);
                long create = fields.Length > 1 ? ParseLong(fields[1], 0) : 0;
                string result;
                try { result = ActOne(op, pid, create, fields); }
                catch (Exception error) { result = Fail("failed", error.Message); }
                if (!first) json.Append(',');
                first = false;
                json.Append("{\"pid\":").Append(pid).Append(',').Append(result).Append('}');
            }
            json.Append("],\"ledger\":").Append(LedgerJson());
            return json.ToString();
        }

        static string ActOne(string op, int pid, long create, string[] fields)
        {
            if (pid <= 4) return Fail("system", null);
            if (pid == selfPid || pid == studioPid) return Fail("studio", null);
            if (create == 0) return Fail("gone", "no creation time");
            Change change;
            ledger.TryGetValue(pid, out change);
            if (change != null && change.Create != create) return Fail("gone", null);
            switch (op)
            {
                case "restore":
                    return change == null ? "\"ok\":true,\"was\":\"unchanged\"" : RestoreOne(change);
                case "adopt":
                    return change != null ? "\"ok\":true,\"was\":\"held\"" : Adopt(pid, create, fields);
                case "resume":
                    if (change == null || !change.Paused) return "\"ok\":true,\"was\":\"running\"";
                    if (NtResumeProcess(change.Handle) != 0) return Fail("failed", "Windows refused to resume it");
                    change.Paused = false;
                    Forget(change);
                    return "\"ok\":true";
                case "unslow":
                    if (change == null || !change.Slowed) return "\"ok\":true,\"was\":\"normal\"";
                    if (!Unslow(change)) return Fail(Code(), "Windows refused the old priority");
                    Forget(change);
                    return "\"ok\":true";
                case "close":
                    // A paused app cannot read its close message: let it run first.
                    if (change != null && change.Paused && NtResumeProcess(change.Handle) == 0) { change.Paused = false; Forget(change); }
                    return CloseWindows(pid, create);
                case "trim":
                    return WithHandle(pid, create, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA, delegate (IntPtr handle)
                    {
                        return K32EmptyWorkingSet(handle) ? "\"ok\":true" : Fail(Code(), "Windows refused to trim it");
                    });
                case "end":
                    return WithHandle(pid, create, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE, delegate (IntPtr handle)
                    {
                        if (!TerminateProcess(handle, 1)) return Fail(Code(), "Windows refused to end it");
                        if (change != null) { ledger.Remove(pid); CloseHandle(change.Handle); }
                        return "\"ok\":true";
                    });
                case "slow":
                case "pause":
                    break;
                default:
                    return Fail("unknown", op);
            }
            if (change == null)
            {
                string refusal;
                IntPtr handle = OpenForLedger(pid, create, out refusal);
                if (handle == IntPtr.Zero) return refusal;
                change = new Change();
                change.Pid = pid;
                change.Create = create;
                change.Name = NameOf(pid);
                change.Handle = handle;
                ledger[pid] = change;
            }
            if (op == "slow")
            {
                if (change.Slowed) return "\"ok\":true,\"was\":\"slowed\"";
                uint priority = GetPriorityClass(change.Handle);
                if (priority == 0) { Forget(change); return Fail(Code(), "its priority could not be read"); }
                MemoryPriorityInformation memory;
                change.OldMemoryPriority = GetMemoryPriority(change.Handle, ProcessMemoryPriority, out memory, 4) ? memory.MemoryPriority : MEMORY_PRIORITY_NORMAL;
                if (!SetPriorityClass(change.Handle, IDLE_PRIORITY_CLASS)) { string code = Code(); Forget(change); return Fail(code, "Windows refused the lower priority"); }
                change.OldPriority = priority;
                change.Slowed = true;
                // Efficiency mode (EcoQoS) and a low memory priority come with it
                // where Windows has them; an older Windows still gets the priority.
                PowerThrottlingState power = new PowerThrottlingState();
                power.Version = 1;
                power.ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
                power.StateMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
                bool eco = SetProcessInformation(change.Handle, ProcessPowerThrottling, ref power, Marshal.SizeOf(typeof(PowerThrottlingState)));
                MemoryPriorityInformation low = new MemoryPriorityInformation();
                low.MemoryPriority = MEMORY_PRIORITY_LOW;
                bool memoryLow = SetMemoryPriority(change.Handle, ProcessMemoryPriority, ref low, 4);
                return "\"ok\":true,\"eco\":" + (eco ? "true" : "false") + ",\"memoryLow\":" + (memoryLow ? "true" : "false");
            }
            if (change.Paused) return "\"ok\":true,\"was\":\"paused\"";
            int status = NtSuspendProcess(change.Handle);
            if (status != 0) { Forget(change); return Fail("failed", "Windows refused to pause it (0x" + status.ToString("X8") + ")"); }
            change.Paused = true;
            return "\"ok\":true";
        }

        // The ledger's handle carries every right a later restore needs; reading
        // the old memory priority is the one right it can do without.
        static IntPtr OpenForLedger(int pid, long create, out string refusal)
        {
            IntPtr handle = Open(pid, create, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_QUERY_INFORMATION | PROCESS_SET_INFORMATION | PROCESS_SUSPEND_RESUME, out refusal);
            if (handle == IntPtr.Zero && refusal.Contains("\"denied\"")) handle = Open(pid, create, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_INFORMATION | PROCESS_SUSPEND_RESUME, out refusal);
            return handle;
        }

        // Takes back a change a helper that died without restoring left behind:
        // fields are pid, create, flags (p paused, s slowed), the old priority
        // class and the old memory priority. Studio only sends what its snapshot
        // shows is still in effect.
        static string Adopt(int pid, long create, string[] fields)
        {
            string flags = fields.Length > 2 ? fields[2] : "";
            bool paused = flags.IndexOf('p') >= 0, slowed = flags.IndexOf('s') >= 0;
            if (!paused && !slowed) return "\"ok\":true,\"was\":\"unchanged\"";
            string refusal;
            IntPtr handle = OpenForLedger(pid, create, out refusal);
            if (handle == IntPtr.Zero) return refusal;
            Change change = new Change();
            change.Pid = pid;
            change.Create = create;
            change.Name = NameOf(pid);
            change.Handle = handle;
            change.Paused = paused;
            change.Slowed = slowed;
            long priority = fields.Length > 3 ? ParseLong(fields[3], 0) : 0;
            change.OldPriority = priority == 0x40 || priority == 0x4000 || priority == 0x20 || priority == 0x8000 || priority == 0x80 ? (uint)priority : NORMAL_PRIORITY_CLASS;
            int memory = fields.Length > 4 ? ParseInt(fields[4], 0) : 0;
            change.OldMemoryPriority = memory >= 1 && memory <= 5 ? memory : MEMORY_PRIORITY_NORMAL;
            ledger[pid] = change;
            return "\"ok\":true";
        }

        delegate string HandleUse(IntPtr handle);

        static string WithHandle(int pid, long create, int access, HandleUse use)
        {
            string refusal;
            IntPtr handle = Open(pid, create, access, out refusal);
            if (handle == IntPtr.Zero) return refusal;
            try { return use(handle); }
            finally { CloseHandle(handle); }
        }

        // Opens pid with `access` when it is still the process Studio saw (the
        // same creation time), Windows does not mark it critical and it is not
        // a service.
        static IntPtr Open(int pid, long create, int access, out string refusal)
        {
            refusal = null;
            int session;
            if (ProcessIdToSessionId(pid, out session) && session == 0)
            {
                refusal = Fail("system", "a Windows service");
                return IntPtr.Zero;
            }
            IntPtr handle = OpenProcess(access, false, pid);
            if (handle == IntPtr.Zero)
            {
                int code = Marshal.GetLastWin32Error();
                refusal = code == ERROR_ACCESS_DENIED ? Fail("denied", null) : code == ERROR_INVALID_PARAMETER ? Fail("gone", null) : Fail("failed", "OpenProcess error " + code);
                return IntPtr.Zero;
            }
            long creation, exit, kernel, user;
            if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user) || creation != create)
            {
                CloseHandle(handle);
                refusal = Fail("gone", null);
                return IntPtr.Zero;
            }
            bool critical;
            if (IsProcessCritical(handle, out critical) && critical)
            {
                CloseHandle(handle);
                refusal = Fail("critical", null);
                return IntPtr.Zero;
            }
            return handle;
        }

        // Asks every visible top-level window of pid to close, as its own close
        // button would; the app may ask to save first, or keep running in the tray.
        static string CloseWindows(int pid, long create)
        {
            string refusal;
            IntPtr handle = Open(pid, create, PROCESS_QUERY_LIMITED_INFORMATION, out refusal);
            if (handle == IntPtr.Zero) return refusal;
            CloseHandle(handle);
            List<IntPtr> windows = new List<IntPtr>();
            EnumWindows(delegate (IntPtr window, IntPtr param)
            {
                int owner;
                GetWindowThreadProcessId(window, out owner);
                if (owner == pid && IsWindowVisible(window) && GetWindow(window, GW_OWNER) == IntPtr.Zero) windows.Add(window);
                return true;
            }, IntPtr.Zero);
            int sent = 0;
            foreach (IntPtr window in windows) if (PostMessageW(window, WM_CLOSE, IntPtr.Zero, IntPtr.Zero)) sent++;
            return "\"ok\":true,\"windows\":" + sent;
        }

        static string RestoreOne(Change change)
        {
            List<string> failed = new List<string>();
            if (change.Paused)
            {
                if (NtResumeProcess(change.Handle) == 0) change.Paused = false;
                else failed.Add("resume");
            }
            if (change.Slowed && !Unslow(change)) failed.Add("priority");
            Forget(change);
            return failed.Count == 0 ? "\"ok\":true" : Fail("partial", string.Join(",", failed.ToArray()));
        }

        // The priority class, efficiency mode and memory priority the process
        // had before it was slowed; a failed priority keeps it marked slowed.
        static bool Unslow(Change change)
        {
            bool priority = SetPriorityClass(change.Handle, change.OldPriority == 0 ? NORMAL_PRIORITY_CLASS : change.OldPriority);
            // Version 1 with no control bits: Windows decides again, as before.
            PowerThrottlingState power = new PowerThrottlingState();
            power.Version = 1;
            SetProcessInformation(change.Handle, ProcessPowerThrottling, ref power, Marshal.SizeOf(typeof(PowerThrottlingState)));
            MemoryPriorityInformation memory = new MemoryPriorityInformation();
            memory.MemoryPriority = change.OldMemoryPriority <= 0 ? MEMORY_PRIORITY_NORMAL : change.OldMemoryPriority;
            SetMemoryPriority(change.Handle, ProcessMemoryPriority, ref memory, 4);
            if (priority) change.Slowed = false;
            return priority;
        }

        // Drops a ledger row, and its handle, once nothing of it is left to undo.
        static void Forget(Change change)
        {
            if (change.Slowed || change.Paused) return;
            ledger.Remove(change.Pid);
            CloseHandle(change.Handle);
        }

        static string RestoreAll()
        {
            int count = 0;
            foreach (Change change in new List<Change>(ledger.Values))
            {
                try { RestoreOne(change); count++; } catch { }
            }
            return count.ToString(CultureInfo.InvariantCulture);
        }

        static string LedgerJson()
        {
            StringBuilder json = new StringBuilder("[");
            bool first = true;
            foreach (Change change in ledger.Values)
            {
                if (!first) json.Append(',');
                first = false;
                json.Append("{\"pid\":").Append(change.Pid).Append(",\"create\":\"").Append(change.Create).Append('"')
                    .Append(",\"name\":").Append(Str(change.Name ?? ""))
                    .Append(",\"slowed\":").Append(change.Slowed ? "true" : "false")
                    .Append(",\"paused\":").Append(change.Paused ? "true" : "false")
                    .Append(",\"oldPriority\":").Append(change.OldPriority)
                    .Append(",\"oldMemoryPriority\":").Append(change.OldMemoryPriority).Append('}');
            }
            return json.Append(']').ToString();
        }

        static string NameOf(int pid)
        {
            string prefix = pid + ":";
            foreach (KeyValuePair<string, string> pair in pathCache)
            {
                if (pair.Value != null && pair.Key.StartsWith(prefix, StringComparison.Ordinal)) return Path.GetFileName(pair.Value);
            }
            return "";
        }

        static string Code()
        {
            return Marshal.GetLastWin32Error() == ERROR_ACCESS_DENIED ? "denied" : "failed";
        }

        static string Fail(string code, string detail)
        {
            return "\"ok\":false,\"error\":\"" + code + "\"" + (detail == null ? "" : ",\"detail\":" + Str(detail));
        }

        // ---- small things -------------------------------------------------
        static long UnixMs()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        static int ParseInt(string text, int fallback)
        {
            int value;
            return int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out value) ? value : fallback;
        }

        static long ParseLong(string text, long fallback)
        {
            long value;
            return long.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out value) ? value : fallback;
        }

        static string Num(string text)
        {
            long value;
            return long.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out value) ? value.ToString(CultureInfo.InvariantCulture) : "0";
        }

        static string Str(string text)
        {
            if (text == null) return "null";
            StringBuilder json = new StringBuilder(text.Length + 2);
            json.Append('"');
            foreach (char c in text)
            {
                switch (c)
                {
                    case '"': json.Append("\\\""); break;
                    case '\\': json.Append("\\\\"); break;
                    case '\n': json.Append("\\n"); break;
                    case '\r': json.Append("\\r"); break;
                    case '\t': json.Append("\\t"); break;
                    default:
                        // Control characters, the two JavaScript line breaks and every
                        // surrogate go out escaped: JSON.parse rebuilds a pair, and a
                        // lone half still leaves the line valid UTF-8.
                        if (c < 0x20 || c == (char)0x2028 || c == (char)0x2029 || (c >= 0xD800 && c <= 0xDFFF)) json.Append("\\u").Append(((int)c).ToString("x4"));
                        else json.Append(c);
                        break;
                }
            }
            return json.Append('"').ToString();
        }
    }
}
