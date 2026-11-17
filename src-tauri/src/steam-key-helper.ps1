$ErrorActionPreference = 'Stop'
$parentPid = __PARENT_PID__
$connection = [Net.Sockets.TcpClient]::new('127.0.0.1', __PORT__)
$reader = [IO.StreamReader]::new($connection.GetStream())
$writer = [IO.StreamWriter]::new($connection.GetStream(), [Text.UTF8Encoding]::new($false))
$writer.AutoFlush = $true
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SteamKeyDelivery {
 [StructLayout(LayoutKind.Sequential)] public struct KeyInput { public ushort key; public ushort scan; public uint flags; public uint time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Explicit, Size=32)] public struct InputUnion { [FieldOffset(0)] public KeyInput keyboard; }
 [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public InputUnion data; }
 [DllImport("user32.dll", EntryPoint="SendInput")] public static extern uint NativeInput(uint count, Input[] inputs, int size);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string name);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
 public static bool Keys(bool down) {
   var inputs = new Input[2];
   inputs[0].type=1;inputs[1].type=1;
   // Supply virtual keys as well as their scan codes so Steam's keyboard
   // hook and polling path see the same Shift+Tab chord.
   inputs[0].data.keyboard.key=(ushort)(down?16:9);
   inputs[1].data.keyboard.key=(ushort)(down?9:16);
   inputs[0].data.keyboard.scan=(ushort)(down?0x2a:0x0f);
   inputs[1].data.keyboard.scan=(ushort)(down?0x0f:0x2a);
   inputs[0].data.keyboard.flags=down?0u:2u;inputs[1].data.keyboard.flags=down?0u:2u;
   return NativeInput(2,inputs,Marshal.SizeOf(typeof(Input)))==2;
 }
}
'@
$injected = [SteamKeyDelivery]::GetModuleHandle('GameOverlayRenderer64.dll') -ne [IntPtr]::Zero
$writer.WriteLine('ready __TOKEN__ ' + $PID + ' ' + $injected)
while ($null -ne ($line = $reader.ReadLine())) {
    if ($line -notmatch '^(focus|toggle) ([0-9a-f]+)$') { break }
    $operation = $Matches[1]
    $targetText = $Matches[2]
    $target = [IntPtr][Convert]::ToInt64($targetText, 16)
    [uint32]$currentPid = 0
    [uint32]$targetPid = 0
    [SteamKeyDelivery]::GetWindowThreadProcessId([SteamKeyDelivery]::GetForegroundWindow(), [ref]$currentPid) | Out-Null
    [SteamKeyDelivery]::GetWindowThreadProcessId($target, [ref]$targetPid) | Out-Null
    if ($currentPid -ne $parentPid -or $targetPid -ne $parentPid) {
        $writer.WriteLine('ignored_foreground'); continue
    }
    [SteamKeyDelivery]::SetForegroundWindow($target) | Out-Null
    $deadline = [DateTime]::UtcNow.AddMilliseconds(500)
    while ([SteamKeyDelivery]::GetForegroundWindow() -ne $target -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 10 }
    if ([SteamKeyDelivery]::GetForegroundWindow() -ne $target) {
        $writer.WriteLine('ignored_focus'); continue
    }
    Start-Sleep -Milliseconds 40
    if ($operation -eq 'focus') { $writer.WriteLine('focused target=' + $targetText); continue }
    $down = [SteamKeyDelivery]::Keys($true)
    Start-Sleep -Milliseconds 150
    $up = [SteamKeyDelivery]::Keys($false)
    if ($down -and $up) { $writer.WriteLine('sent target=' + $targetText) }
    else { $writer.WriteLine('input_rejected') }
}
$connection.Dispose()
