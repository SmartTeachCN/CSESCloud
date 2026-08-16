# 真流式+心跳 复测（保留记录排查）
$base = 'http://127.0.0.1:8000'
$null = Invoke-WebRequest -Uri "$base/api/auth/alliance-login.php" -Method POST -Body '{"username":"admin"}' -ContentType 'application/json' -SessionVariable lv -UseBasicParsing -SkipHttpErrorCheck
$ck = ($lv.Cookies.GetCookies($base) | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; '

$r = Invoke-WebRequest -Uri "$base/api/ai/models.php?action=create" -Method POST -Body '{"name":"MockSlow","provider":"openai_compatible","endpoint":"http://127.0.0.1:8099/v1/chat/completions","model_id":"mock-1","api_key":"test-key"}' -ContentType 'application/json' -Headers @{ Cookie = $ck } -UseBasicParsing -SkipHttpErrorCheck
Write-Output "create: $($r.Content)"

# 确认 list 可见
$r = Invoke-WebRequest -Uri "$base/api/ai/models.php?action=list" -Headers @{ Cookie = $ck } -UseBasicParsing -SkipHttpErrorCheck
$j = $r.Content | ConvertFrom-Json
$found = $false
foreach ($m in $j.data) { if ($m.name -eq 'MockSlow') { $found = $true; Write-Output "list命中: owner_key=$($m.owner_key) provider=$($m.provider) endpoint=$($m.endpoint) key长度=$($m.api_key.Length)" } }
if (-not $found) { Write-Output "list未命中!" }

# send_stream
$req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "$base/api/ai/chat.php?action=send_stream")
$req.Content = [System.Net.Http.StringContent]::new('{"content":"测试流式","scope":"global","model":"MockSlow"}', [System.Text.Encoding]::UTF8, 'application/json')
$req.Headers.Add('Cookie', $ck)
$handler = [System.Net.Http.HttpClientHandler]::new()
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(120)
$resp = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
$reader = [System.IO.StreamReader]::new($resp.Content.ReadAsStreamAsync().Result)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$hb = 0; $text = ''; $firstTok = $null; $hasDone = $false
while (-not $reader.EndOfStream) {
  $line = $reader.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq ': hb') { $hb++; Write-Output ("  [{0:n1}s] 心跳" -f $sw.Elapsed.TotalSeconds) }
  elseif ($line -like 'data: *') {
    try {
      $j2 = $line.Substring(6) | ConvertFrom-Json
      if ($j2.token) { if ($null -eq $firstTok) { $firstTok = [Math]::Round($sw.Elapsed.TotalSeconds, 1) }; $text += $j2.token }
      if ($j2.done) { $hasDone = $true }
    } catch {}
  }
}
$sw.Stop()
Write-Output "心跳: $hb  首token: ${firstTok}s  done: $hasDone  总耗时: $([Math]::Round($sw.Elapsed.TotalSeconds,1))s"
Write-Output "文本: $text"
$client.Dispose()
