// Mock 慢速 LLM SSE 服务器：延迟 20s 后流式输出（模拟 reasoning 模型思考）
const http = require('http');
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => body += c);
  req.on('end', () => {
    console.log(`[mock] ${new Date().toISOString()} 收到请求，${18000}ms 后开始发token`);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    // 静默（模拟思考）
    setTimeout(() => {
      console.log(`[mock] ${new Date().toISOString()} 开始发token`);
      const tokens = ['这是', 'Mock', '慢速', '模型', '的', '流式', '回复', '。'];
      let i = 0;
      const timer = setInterval(() => {
        if (i >= tokens.length) {
          clearInterval(timer);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        const chunk = {
          choices: [{ delta: { content: tokens[i] }, index: 0 }],
        };
        res.write('data: ' + JSON.stringify(chunk) + '\n\n');
        i++;
      }, 300);
    }, 18000);
  });
}).listen(8099, '127.0.0.1', () => console.log('mock-llm listening on 8099'));
