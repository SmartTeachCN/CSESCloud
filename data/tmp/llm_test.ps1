# 真流式透传 + 心跳验证（mock 慢速 LLM：20s 静默后出 token）
$base = 'http://127.0.0.1:8000'
$null = Invoke-WebRequest -Uri "$base/api/auth/alliance-login.php" -Method POST -Body '{"username":"admin"}' -ContentType 'application/json' -SessionVariable lv -UseBasicParsing -SkipHttpErrorCheck
$ck = ($lv.Cookies.GetCookies($base) | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; '

# 注册 mock 模型
$r = Invoke-WebRequest -Uri "$base/api/ai/models.php?action=create" -Method POST -Body '{"name":"MockSlow","provider":"openai_compatible","endpoint":"http://127.0.0.1:8099/v1/chat/completions","model_id":"mock-1","api_key":"test-key"}' -ContentType 'application/json' -Headers @{ Cookie = $ck } -UseBasicParsing -SkipHttpErrorCheck
$mid = ($r.Content | ConvertFrom-Json).data.id
Write-Output "mock模型 id=$mid"

# send_stream（20s 上游静默期间应收到心跳）
$req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "$base/api/ai/chat.php?action=send_stream")
$req.Content = [System.Net.Http.StringContent]::new('{"content":"测试流式","scope":"global","model":"MockSlow"}', [System.Text.Encoding]::UTF8, 'application/json')
$req.Headers.Add('Cookie', $ck)
$handler = [System.Net.Http.HttpClientHandler]::new()
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(120)
$resp = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
$reader = [System.IO.StreamReader]::new($resp.Content.ReadAsStreamAsync().Result)

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$hb = 0; $text = ''; $firstTokenAt = $null; $hasDone = $false
while (-not $reader.EndOfStream) {
  $line = $reader.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq ': hb') { $hb++; Write-Output ("  [{0:n1}s] 心跳" -f $sw.Elapsed.TotalSeconds) }
  elseif ($line -like 'data: *') {
    try {
      $j = $line.Substring(6) | ConvertFrom-Json
      if ($j.token) { if ($null -eq $firstTokenAt) { $firstTokenAt = [Math]::Round($sw.Elapsed.TotalSeconds, 1) }; $text += $j.token }
      if ($j.done) { $hasDone = $true }
    } catch {}
  }
}
$sw.Stop()
Write-Output "心跳数: $hb（预期>=1，20s静默/15s间隔）"
Write-Output "首token到达: ${firstTokenAt}s（预期≈20，证明为真流式透传而非等待完整响应）"
Write-Output "透传文本: $text"
Write-Output "done事件: $hasDone  总耗时: $([Math]::Round($sw.Elapsed.TotalSeconds,1))s"
$client.Dispose()

# 清理 mock 模型
$null = Invoke-WebRequest -Uri "$base/api/ai/models.php?action=delete" -Method POST -Body ('{"id":' + $mid + '}') -ContentType 'application/json' -Headers @{ Cookie = $ck } -UseBasicParsing -SkipHttpErrorCheck
Write-Output "mock模型已清理"
