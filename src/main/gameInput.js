import { spawn } from 'child_process';
import { StringDecoder } from 'node:string_decoder';

/**
 * Game Input Injection Helper (Windows)
 *
 * The legacy AHK translator lived and died by SendInput: it pulled text out of
 * the DOTA 2 chat box with Ctrl+A/Ctrl+C and typed the translation back. The
 * Electron migration lost that ability entirely (a renderer cannot inject keys
 * into another process), which is why F8 appeared dead in-game.
 *
 * This module restores it WITHOUT native npm modules: a persistent PowerShell
 * child process hosts a tiny Add-Type C# shim over user32!SendInput. Keeping
 * the child alive amortizes the one-time Add-Type JIT/compile cost (~500ms)
 * across every F8 press, and the newline-delimited JSON protocol passes text
 * as base64-UTF8 so console codepages can never mangle Chinese payloads.
 */

const PS_HELPER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Runtime.InteropServices;
public static class GI {
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    // SendInput strictly validates cbSize == sizeof(INPUT): the real INPUT is a
    // union whose largest member is MOUSEINPUT, so modeling ONLY KEYBDINPUT
    // yields 32 bytes on x64 instead of 40 and every call fails with
    // ERROR_INVALID_PARAMETER. The union layout below matches both arches.
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public INPUTUNION u; }
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    static void One(ushort vk, ushort scan, uint flags) {
        INPUT[] a = new INPUT[1];
        a[0].type = 1; a[0].u.ki.wVk = vk; a[0].u.ki.wScan = scan; a[0].u.ki.dwFlags = flags;
        if (SendInput(1, a, Marshal.SizeOf(typeof(INPUT))) != 1) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "SendInput failed");
    }
    public static void Tap(ushort vk) { One(vk, 0, 0); One(vk, 0, KEYEVENTF_KEYUP); }
    public static void Chord(ushort mod, ushort key) {
        One(mod, 0, 0); System.Threading.Thread.Sleep(30);
        One(key, 0, 0); One(key, 0, KEYEVENTF_KEYUP);
        System.Threading.Thread.Sleep(30); One(mod, 0, KEYEVENTF_KEYUP);
    }
    public static void TypeText(string s) {
        if (string.IsNullOrEmpty(s)) return;
        INPUT[] a = new INPUT[s.Length * 2];
        for (int i = 0; i < s.Length; i++) {
            a[2*i].type = 1; a[2*i].u.ki.wScan = s[i]; a[2*i].u.ki.dwFlags = KEYEVENTF_UNICODE;
            a[2*i+1].type = 1; a[2*i+1].u.ki.wScan = s[i]; a[2*i+1].u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        }
        if (SendInput((uint)a.Length, a, Marshal.SizeOf(typeof(INPUT))) != (uint)a.Length) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "SendInput type failed");
    }
    public static string ForegroundProcess() {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return "";
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (pid == 0) return "";
        try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
    }
}
'@
Add-Type -TypeDefinition $src
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $id = 0
    try {
        $req = $line | ConvertFrom-Json
        $id = $req.id
        $value = $null
        switch ($req.action) {
            'ping' { $value = 'pong' }
            'foreground' { $value = [GI]::ForegroundProcess() }
            'capture' {
                [GI]::Chord(0x11, 0x41)
                Start-Sleep -Milliseconds 130
                [GI]::Chord(0x11, 0x43)
                $value = 'ok'
            }
            'replace' {
                $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($req.text))
                [GI]::Chord(0x11, 0x41)
                Start-Sleep -Milliseconds 70
                [GI]::Tap(0x2E)
                Start-Sleep -Milliseconds 70
                [GI]::TypeText($text)
                $value = 'ok'
            }
            'enter' { [GI]::Tap(0x0D); $value = 'ok' }
            default { throw "unknown action: $($req.action)" }
        }
        $res = @{ id = $id; ok = $true; value = $value }
    } catch {
        $res = @{ id = $id; ok = $false; error = $_.Exception.Message }
    }
    [Console]::Out.WriteLine((ConvertTo-Json $res -Compress))
}
`;

// Base64-encoded once: the helper script is constant, only the JSON requests vary.
const PS_HELPER_ENCODED = Buffer.from(PS_HELPER_SCRIPT, 'utf16le').toString('base64');

export class GameInputHelper {
  constructor(options = {}) {
    this.spawnFn = options.spawnFn || spawn;
    this.platform = options.platform || process.platform;
    this.child = null;
    this.buffer = '';
    this.pending = new Map();
    this.nextId = 1;
  }

  isSupported() {
    return this.platform === 'win32';
  }

  ensureStarted() {
    if (!this.isSupported()) {
      throw new Error('游戏内按键注入仅支持 Windows 平台');
    }
    if (this.child) return;

    this.buffer = '';
    this.child = this.spawnFn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', PS_HELPER_ENCODED,
    ], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const child = this.child;
    const decoder = new StringDecoder('utf8');
    child.on('error', () => this.handleDead(child));
    child.on('exit', () => this.handleDead(child));
    // A dead helper turns every later stdin.write into an ASYNC EPIPE stream
    // error — without this listener it escapes as uncaughtException and takes
    // the whole Electron main process down (e.g. AV killed powershell.exe).
    child.stdin.on('error', () => this.handleDead(child));
    child.stdout.on('error', () => this.handleDead(child));
    child.stderr.on('error', () => this.handleDead(child));
    // stderr is drained so a noisy helper can never fill the pipe and wedge.
    child.stderr.on('data', () => {});
    child.stdout.on('data', (chunk) => {
      if (child !== this.child) return;
      this.buffer += decoder.write(chunk);
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (line) this.handleLine(line);
      }
    });
  }

  handleDead(child = this.child, err = new Error('按键注入助手进程已退出')) {
    // Exit/EPIPE/data events can arrive after a replacement has started.
    if (!child || child !== this.child) return;
    this.child = null;
    this.buffer = '';
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
    try { child.kill(); } catch { /* The process may already have exited. */ }
  }

  handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) {
      entry.resolve(msg.value);
    } else {
      entry.reject(new Error(msg.error || '按键注入助手执行失败'));
    }
  }

  call(action, { text = '', timeoutMs = 15000 } = {}) {
    try {
      this.ensureStarted();
    } catch (err) {
      return Promise.reject(err);
    }
    const child = this.child;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A hung child must not later execute queued capture/typing commands.
        this.handleDead(child, new Error(`按键注入超时 (${action})`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });

      const payload = {
        id,
        action,
        text: text ? Buffer.from(text, 'utf8').toString('base64') : '',
      };
      try {
        child.stdin.write(JSON.stringify(payload) + '\n');
      } catch (err) {
        this.handleDead(child, err);
      }
    });
  }

  /** Process name of the foreground window (e.g. "dota2"), '' when unknown. */
  foregroundProcessName(options) {
    return this.call('foreground', options);
  }

  /** Ctrl+A then Ctrl+C — mirrors legacy AHK CopyFromChatBox(). */
  sendCaptureChord() {
    return this.call('capture');
  }

  /** Ctrl+A, Delete, then Unicode-type the text — mirrors legacy SendToGame(). */
  replaceWithText(text) {
    return this.call('replace', { text });
  }

  sendEnter() {
    return this.call('enter');
  }

  dispose() {
    this.handleDead();
  }
}

export const gameInput = new GameInputHelper();
