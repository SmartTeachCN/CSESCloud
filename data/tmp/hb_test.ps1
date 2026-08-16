# 心跳保活验证：挂起 SSE 17 秒，观察 : hb 注释行
$base = 'http://127.0.0.1:8000'
$null = Invoke-WebRequest -Uri "$base/api/auth/alliance-login.php" -Method POST -Body '{"username":"admin"}' -ContentType 'application/json' -SessionVariable lv -UseBasicParsing -SkipHttpErrorCheck
$ck = ($lv.Cookies.GetCookies($base) | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; '

$req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "$base/api/ai/chat.php?action=send_stream")
$req.Content = [System.Net.Http.StringContent]::new('{"content":"你好","scope":"global"}', [System.Text.Encoding]::UTF8, 'application/json')
$req.Headers.Add('Cookie', $ck)
$handler = [System.Net.Http.HttpClientHandler]::new()
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(120)
$resp = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
$stream = $resp.Content.ReadAsStreamAsync().Result
$reader = [System.IO.StreamReader]::new($stream)

$hb = 0; $dataLines = 0; $done = $false
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 17 -and -not $reader.EndOfStream) {
  $line = $reader.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq ': hb') { $hb++; Write-Output ("[{0:n1}s] 心跳" -f $sw.Elapsed.TotalSeconds) }
  elseif ($line -like 'data: *') { $dataLines++; if ($line -match '"done"') { $done = $true } }
}
$sw.Stop()
Write-Output "结果: 心跳行=$hb  data行=$dataLines  done事件=$done  观察时长=$([Math]::Round($sw.Elapsed.TotalSeconds,1))s"
$client.Dispose()
