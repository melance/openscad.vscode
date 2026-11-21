$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

try {
    $request = ConvertFrom-Json $env:OPENSCAD_PREVIEW_REQUEST
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class OpenScadWindows {
    private delegate bool WindowCallback(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint attach, uint target, bool enabled);
    [DllImport("user32.dll")] private static extern bool PeekMessage(IntPtr message, IntPtr window, uint min, uint max, uint command);
    [DllImport("user32.dll")] private static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetDlgItem(IntPtr dialog, int id);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, string value,
                                                     uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

    [StructLayout(LayoutKind.Sequential)]
    private struct GuiThreadInfo {
        public int Size;
        public uint Flags;
        public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        public int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input {
        public uint Type;
        public InputData Data;
    }
    [StructLayout(LayoutKind.Explicit)]
    private struct InputData {
        [FieldOffset(0)] public KeyInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct KeyInput {
        public ushort Key, Scan;
        public uint Flags, Time;
        public UIntPtr Extra;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput {
        public int X, Y;
        public uint Data, Flags, Time;
        public UIntPtr Extra;
    }

    public static void TypeFileName(IntPtr dialog, string filename) {
        if (GetForegroundWindow() != dialog) throw new InvalidOperationException("The OpenSCAD file picker lost focus.");
        keybd_event(0x12, 0, 0, UIntPtr.Zero); // Alt+N focuses File name in the native English dialog.
        keybd_event(0x4E, 0, 0, UIntPtr.Zero);
        keybd_event(0x4E, 0, 2, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        System.Threading.Thread.Sleep(120);
        Press(dialog, 0x41, true);
        var inputs = new Input[filename.Length * 2];
        for (int index = 0; index < filename.Length; index++) {
            inputs[index * 2] = new Input { Type = 1, Data = new InputData {
                Keyboard = new KeyInput { Scan = filename[index], Flags = 4 }
            }};
            inputs[index * 2 + 1] = new Input { Type = 1, Data = new InputData {
                Keyboard = new KeyInput { Scan = filename[index], Flags = 6 }
            }};
        }
        if (GetForegroundWindow() != dialog || SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input))) != inputs.Length)
            throw new InvalidOperationException("Could not enter the file name in the OpenSCAD file picker.");
        System.Threading.Thread.Sleep(120);
        Press(dialog, 0x0D, false);
    }

    private static bool IsFileNameEdit(IntPtr dialog, IntPtr edit) {
        if (!IsChild(dialog, edit) || ClassName(edit) != "Edit" || !IsWindowVisible(edit)) return false;
        while (edit != IntPtr.Zero && edit != dialog && GetDlgCtrlID(edit) != 1148)
            edit = GetParent(edit);
        return edit != IntPtr.Zero && edit != dialog;
    }

    public static bool SetFileName(IntPtr dialog, string path) {
        var info = new GuiThreadInfo { Size = Marshal.SizeOf(typeof(GuiThreadInfo)) };
        uint ignored;
        uint thread = GetWindowThreadProcessId(dialog, out ignored);
        var field = IntPtr.Zero;
        if (GetGUIThreadInfo(thread, ref info) && IsFileNameEdit(dialog, info.Focus)) field = info.Focus;
        if (field == IntPtr.Zero) {
            EnumChildWindows(dialog, (window, data) => {
                if (!IsFileNameEdit(dialog, window)) return true;
                field = window;
                return false;
            }, IntPtr.Zero);
        }
        if (field == IntPtr.Zero) return false;
        IntPtr result;
        return SendMessageTimeout(field, 0x000C, IntPtr.Zero, path, 2, 1200, out result) != IntPtr.Zero
            && result != IntPtr.Zero;
    }

    public static void OpenFile(IntPtr dialog) {
        if (GetForegroundWindow() != dialog) throw new InvalidOperationException("The OpenSCAD file picker lost focus.");
        var open = GetDlgItem(dialog, 1);
        if (open != IntPtr.Zero && PostMessage(open, 0x00F5, IntPtr.Zero, IntPtr.Zero)) return;
        Press(dialog, 0x0D, false);
    }

    public static void Press(IntPtr target, byte key, bool control) {
        if (GetForegroundWindow() != target) throw new InvalidOperationException("The OpenSCAD window lost focus.");
        if (control) keybd_event(0x11, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, 0, UIntPtr.Zero);
        keybd_event(key, 0, 2, UIntPtr.Zero);
        if (control) keybd_event(0x11, 0, 2, UIntPtr.Zero);
    }

    public static IntPtr[] VisibleWindows() {
        var windows = new List<IntPtr>();
        EnumWindows((window, data) => {
            if (IsWindowVisible(window)) windows.Add(window);
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static uint ProcessId(IntPtr window) {
        uint process;
        GetWindowThreadProcessId(window, out process);
        return process;
    }

    public static string Title(IntPtr window) {
        var text = new StringBuilder(2048);
        GetWindowText(window, text, text.Capacity);
        return text.ToString();
    }

    public static string ClassName(IntPtr window) {
        var text = new StringBuilder(256);
        GetClassName(window, text, text.Capacity);
        return text.ToString();
    }

    public static void Activate(IntPtr window) {
        if (IsIconic(window)) ShowWindowAsync(window, 9);
        SetForegroundWindow(window);
        var foreground = GetForegroundWindow();
        if (foreground == window || foreground == IntPtr.Zero) return;
        uint ignored;
        uint source = GetWindowThreadProcessId(foreground, out ignored);
        uint current = GetCurrentThreadId();
        if (source == current) return;
        // Ensure the helper thread has an input queue before attaching it.
        var message = Marshal.AllocHGlobal(64);
        try { PeekMessage(message, IntPtr.Zero, 0, 0, 0); }
        finally { Marshal.FreeHGlobal(message); }
        if (!AttachThreadInput(current, source, true)) return;
        try {
            BringWindowToTop(window);
            SetForegroundWindow(window);
        } finally {
            AttachThreadInput(current, source, false);
        }
    }
}
'@

    $name = [IO.Path]::GetFileName($request.file)
    $caption = '^(?:OpenSCAD\s+-\s+)?\*?\s*' + [regex]::Escape($name).Replace('&', '&{1,2}') +
        '\s*\*?(?:\s+[-–—]\s+OpenSCAD.*)?$'
    function Get-MainWindows {
        $scadIds = (Get-Process | Where-Object {
            $_.ProcessName -match '^openscad(?:[-_].*)?$' -or $_.ProcessName -eq $request.processName
        }).Id
        foreach ($window in [OpenScadWindows]::VisibleWindows()) {
            $processId = [OpenScadWindows]::ProcessId($window)
            if ($processId -notin $scadIds) { continue }
            $title = [OpenScadWindows]::Title($window)
            $className = [OpenScadWindows]::ClassName($window)
            if ($className -like 'Qt*' -and $title -match '(\.scad(?:\W|$)|^OpenSCAD(?:\W|$))') {
                [pscustomobject]@{ Handle = $window; ProcessId = $processId; Title = $title }
            }
        }
    }

    function Focus-Window($window, $processId) {
        [OpenScadWindows]::Activate($window)
        if ([OpenScadWindows]::GetForegroundWindow() -ne $window) {
            $shell = New-Object -ComObject WScript.Shell
            [void]$shell.AppActivate([int]$processId)
            [OpenScadWindows]::Activate($window)
        }
        if ([OpenScadWindows]::GetForegroundWindow() -ne $window) {
            throw 'Could not focus the OpenSCAD window. Close any OpenSCAD dialog and try again.'
        }
    }

    $deadline = [DateTime]::UtcNow.AddMilliseconds($request.wait)
    do {
        $windows = @(Get-MainWindows)
        if ($request.launchedId) { $windows = @($windows | Where-Object ProcessId -eq $request.launchedId) }
        if ($windows.Count -or [DateTime]::UtcNow -ge $deadline) { break }
        Start-Sleep -Milliseconds 120
    } while ($true)
    if (!$windows.Count) {
        @{ status = 'missing' } | ConvertTo-Json -Compress
        exit
    }

    $matching = @($windows | Where-Object Title -match $caption)
    $tracked = $matching | Where-Object {
        $_.ProcessId -eq $request.processId -and $_.Handle.ToInt64().ToString() -eq $request.handle
    } | Select-Object -First 1
    if ($tracked) {
        $chosen = $tracked
    } elseif ($request.launchedId -and $matching.Count -eq 1) {
        $chosen = $matching[0]
    } else {
        $chosen = if ($matching.Count) { $matching[0] } else { $windows[0] }
        Focus-Window $chosen.Handle $chosen.ProcessId
        [OpenScadWindows]::Press($chosen.Handle, 0x4F, $true)
        $deadline = [DateTime]::UtcNow.AddSeconds(4)
        do {
            $dialog = [OpenScadWindows]::GetForegroundWindow()
            $isOpenDialog = $dialog -ne $chosen.Handle -and
                [OpenScadWindows]::ProcessId($dialog) -eq $chosen.ProcessId -and
                [OpenScadWindows]::ClassName($dialog) -eq '#32770'
            if ($isOpenDialog) { break }
            Start-Sleep -Milliseconds 80
        } while ([DateTime]::UtcNow -lt $deadline)
        if (!$isOpenDialog) { throw 'OpenSCAD did not show its file picker.' }

        if (![OpenScadWindows]::SetFileName($dialog, $request.file)) {
            $scope = [Windows.Automation.TreeScope]::Descendants
            $root = [Windows.Automation.AutomationElement]::FromHandle($dialog)
            $idProperty = [Windows.Automation.AutomationElement]::AutomationIdProperty
            $filenameId = [Windows.Automation.PropertyCondition]::new($idProperty, '1148')
            $editType = [Windows.Automation.PropertyCondition]::new(
                [Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Edit)
            $field = $root.FindFirst($scope, [Windows.Automation.AndCondition]::new($filenameId, $editType))
            if (!$field) {
                $combo = $root.FindFirst($scope, $filenameId)
                if ($combo) { $field = $combo.FindFirst($scope, $editType) }
            }
            $pattern = $null
            if ($field -and $field.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
                $pattern.SetValue($request.file)
                $field.SetFocus()
            } elseif ([OpenScadWindows]::Title($dialog) -eq 'Open File') {
                [OpenScadWindows]::TypeFileName($dialog, $request.file)
                $submitted = $true
            } else {
                throw 'Could not locate the file name field in the OpenSCAD file picker.'
            }
        }
        if (!$submitted) { [OpenScadWindows]::OpenFile($dialog) }

        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        do {
            $foreground = [OpenScadWindows]::GetForegroundWindow()
            $opened = Get-MainWindows | Where-Object {
                $_.ProcessId -eq $chosen.ProcessId -and $_.Handle -eq $foreground -and $_.Title -match $caption
            } | Select-Object -First 1
            if ($opened) { break }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $deadline)
        if (!$opened) { throw 'OpenSCAD did not display the requested file.' }
        $chosen = $opened
    }

    Focus-Window $chosen.Handle $chosen.ProcessId
    [OpenScadWindows]::Press($chosen.Handle, 0x73, $false)
    Start-Sleep -Milliseconds 150
    # Reload and Preview may skip a file that has not changed on disk.
    if ([OpenScadWindows]::GetForegroundWindow() -eq $chosen.Handle) {
        [OpenScadWindows]::Press($chosen.Handle, 0x74, $false)
    }
    @{ status = 'previewed'; handle = $chosen.Handle.ToInt64().ToString(); processId = $chosen.ProcessId } |
        ConvertTo-Json -Compress
} catch {
    @{ status = 'error'; message = $_.Exception.Message } | ConvertTo-Json -Compress
}
