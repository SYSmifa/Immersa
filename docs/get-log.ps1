# Reads Immersa's event log from the headset (USB cable + adb) through the browser's DevTools, prints it and copies it to the clipboard.
# Run it while the app is open (also right after a restart). Usage (from the web project folder):
#   powershell -ExecutionPolicy Bypass -File .\docs\get-log.ps1
$ErrorActionPreference = 'Stop'
$port = 9333

# The DevTools sockets the headset's browser exposes
$socks = @(adb shell 'cat /proc/net/unix' | Select-String -Pattern '@(\S*devtools_remote\S*)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -Unique)
if (-not $socks.Count) { throw 'No DevTools socket on the headset: is the app open, the cable in, and USB debugging accepted in the headset?' }
Write-Host ("Sockets: " + ($socks -join ', '))

$page = $null
foreach ($s in $socks) {
  adb forward "tcp:$port" "localabstract:$s" | Out-Null
  try {
    $pages = Invoke-RestMethod "http://localhost:$port/json" -TimeoutSec 5
    $page = $pages | Where-Object { $_.url -like '*immersavr*' -or $_.url -like '*immersa*' } | Select-Object -First 1
    if ($page) { break }
  } catch { }
}
if (-not $page) { throw 'No Immersa page found among the inspectable pages. Is the app open in the headset?' }
Write-Host "Page: $($page.url)"

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
$expr = "JSON.stringify({log: JSON.parse(localStorage.getItem('immersa.log') || '[]'), pending: localStorage.getItem('immersa.pendingScanName')})"
$msg = @{ id = 1; method = 'Runtime.evaluate'; params = @{ expression = $expr; returnByValue = $true } } | ConvertTo-Json -Depth 5 -Compress
$bytes = [Text.Encoding]::UTF8.GetBytes($msg)
$ws.SendAsync([ArraySegment[byte]]$bytes, 'Text', $true, [Threading.CancellationToken]::None).Wait()

$buf = New-Object byte[] 65536
$result = $null
while (-not $result) {
  $sb = New-Object Text.StringBuilder
  do {
    $r = $ws.ReceiveAsync([ArraySegment[byte]]$buf, [Threading.CancellationToken]::None).Result
    [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Count))
  } until ($r.EndOfMessage)
  $o = $sb.ToString() | ConvertFrom-Json
  if ($o.id -eq 1) { $result = $o }
}
$ws.CloseAsync('NormalClosure', '', [Threading.CancellationToken]::None).Wait()

$data = $result.result.result.value | ConvertFrom-Json
$text = "Reminder: " + $(if ($data.pending) { $data.pending } else { 'none' }) + "`n" + ($data.log -join "`n")
Write-Host $text
Set-Clipboard -Value $text
Write-Host "`nCopied to the clipboard: paste it into the chat (Ctrl+V)."
