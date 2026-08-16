# SSE 流式升级验证：正常流 + 断连入库
$base = 'http://127.0.0.1:8000'

# 登录
$null = Invoke-WebRequest -Uri "$base/api/auth/alliance-login.php" -Method POST -Body '{"username":"admin"}' -ContentType 'application/json' -SessionVariable lv -UseBasicParsing -SkipHttpErrorCheck
$cookies = $lv.Cookies.GetCookies($base)
$cookieHeader = ($cookies | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; '

# ── 测试1：完整 SSE 流（规则引擎回退路径，token 事件 + done） ──
$req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "$base/api/ai/chat.php?action=send_stream")
$req.Content = [System.Net.Http.StringContent]::new('{"content":"你好","scope":"global"}', [System.Text.Encoding]::UTF8, 'application/json')
$req.Headers.Add('Cookie', $cookieHeader)
$handler = [System.Net.Http.HttpClientHandler]::new()
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(60)
$resp = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
Write-Output "TEST1 状态: $($resp.StatusCode)  Content-Type: $($resp.Content.Headers.ContentType)"
$stream = $resp.Content.ReadAsStreamAsync().Result
$reader = [System.IO.StreamReader]::new($stream)
$tokens = 0; $text = ''; $hasSession = $false; $hasDone = $false; $hb = 0
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while (-not $reader.EndOfStream) {
  $line = $reader.ReadLine()
  if ($line -like 'data: *') {
    $json = $null; try { $json = ($line.Substring(6) | ConvertFrom-Json) } catch {}
    if ($json) {
      if ($json.session_id) { $hasSession = $true; $script:sid = $json.session_id }
      elseif ($json.token) { $tokens++; $text += $json.token }
      elseif ($json.done) { $hasDone = $true }
    }
  } elseif ($line -like ':*') { $hb++ }
}
$sw.Stop()
Write-Output "TEST1 session事件: $hasSession  token事件数: $tokens  done事件: $hasDone"
Write-Output "TEST1 首token延迟内完成，总耗时: $($sw.ElapsedMilliseconds)ms"
Write-Output "TEST1 文本: $($text.Substring(0, [Math]::Min(60, $text.Length)))"

# 验证入库
$r = Invoke-WebRequest -Uri "$base/api/ai/chat.php?action=messages&session_id=$sid" -Headers @{ Cookie = $cookieHeader } -UseBasicParsing -SkipHttpErrorCheck
$j = $r.Content | ConvertFrom-Json
$lastMsg = $j.data[$j.data.Count - 1]
Write-Output "TEST1 入库校验: role=$($lastMsg.role) 内容一致=$($lastMsg.content -eq $text)"

# ── 测试2：客户端中途断连（部分token后关闭，验证不悬挂且入库） ──
$req2 = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "$base/api/ai/chat.php?action=send_stream")
$req2.Content = [System.Net.Http.StringContent]::new('{"content":"帮助","scope":"global"}', [System.Text.Encoding]::UTF8, 'application/json')
$req2.Headers.Add('Cookie', $cookieHeader)
$resp2 = $client.SendAsync($req2, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
$s2 = $resp2.Content.ReadAsStreamAsync().Result
$r2 = [System.IO.StreamReader]::new($s2)
$sid2 = 0; $got = 0
while (-not $r2.EndOfStream) {
  $line = $r2.ReadLine()
  if ($line -like 'data: *') {
    try {
      $j2 = $line.Substring(6) | ConvertFrom-Json
      if ($j2.session_id) { $sid2 = $j2.session_id }
      elseif ($j2.token) { $got++; if ($got -ge 3) { break } }
    } catch {}
  }
}
# 立即断连
$r2.Dispose(); $s2.Dispose(); $resp2.Dispose()
Write-Output "TEST2 已在收到 $got 个 token 后断连 (session=$sid2)"
Start-Sleep -Milliseconds 1500
# 服务进程不应崩溃：再发一个普通请求
$r3 = Invoke-WebRequest -Uri "$base/api/ai/chat.php?action=sessions" -Headers @{ Cookie = $cookieHeader } -UseBasicParsing -SkipHttpErrorCheck
Write-Output "TEST2 断连后服务存活: [$($r3.StatusCode)]"
# 检查断连会话是否入库（打字机被打断，仍应保存已输出内容或完整内容）
$r4 = Invoke-WebRequest -Uri "$base/api/ai/chat.php?action=messages&session_id=$sid2" -Headers @{ Cookie = $cookieHeader } -UseBasicParsing -SkipHttpErrorCheck
$j4 = $r4.Content | ConvertFrom-Json
Write-Output "TEST2 断连会话消息数: $($j4.data.Count)（>=2 表示用户+AI消息均已入库）"

$client.Dispose()
Write-Output "===== ALL DONE ====="
