/**
 * 回归测试：useAiStream 的流式更新是否真正驱动 Vue 响应式（视图更新）。
 *
 * 背景：turn 是 `ref<AiTurn|null>`，若把「原始对象」而不是 ref 内部的 reactive 代理
 * 交给后续 mutation，Vue 不会 trigger 视图更新 —— 表现为 SSE 数据到了、界面不动，
 * 直到流结束才整段出现。本测试正是为了锁死这个行为。
 *
 * 跑法（Node 22 的实验性 TS 剥离，直接加载真实 composable）：
 *   node --experimental-strip-types frontend/_smoke_ai_stream.mjs
 */
import { effect } from 'vue';
import { useAiStream } from './src/composables/useAiStream.ts';

const enc = new TextEncoder();

function sse(events, gapMs = 20) {
  const stream = new ReadableStream({
    async start(controller) {
      for (const ev of events) {
        controller.enqueue(enc.encode('data: ' + JSON.stringify(ev) + '\n\n'));
        await new Promise((r) => setTimeout(r, gapMs));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const text = (turn) => (turn ? turn.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('') : '');
const tools = (turn) => (turn ? turn.blocks.filter((b) => b.type === 'tool') : []);
const asks = (turn) => (turn ? turn.blocks.filter((b) => b.type === 'ask') : []);

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? '✓ ' : '✗ ') + name + (pass ? '' : ' — ' + JSON.stringify(detail)));
}

// ── 用例 1：纯文本流式是否多次触发响应式更新 ──
async function case1() {
  const stream = useAiStream({
    request: async (action) =>
      action === 'stream'
        ? sse([
          { type: 'start', session_id: 11, run_id: 'r1', model: 'mock', reasoning: 'auto' },
          { type: 'reasoning', delta: '先想一下' },
          { type: 'text', delta: '你' },
          { type: 'text', delta: '好' },
          { type: 'text', delta: '，世界' },
          { type: 'done', session_id: 11, message_id: 5, reply: '你好，世界' },
        ])
        : sse([{ type: 'done', session_id: 11, message_id: 6, reply: '' }]),
  });

  const renders = [];
  const stop = effect(() => {
    const t = stream.turn.value;
    const sig = t ? t.status + '|' + text(t) : '';
    if (renders[renders.length - 1] !== sig) renders.push(sig);
  });

  await stream.run({ content: '你好', model: 'mock' });
  stop();

  record(
    '纯文本流式：触发多次响应式更新',
    renders.length >= 3 && renders.some((r) => r.endsWith('你')) && renders.some((r) => r.endsWith('你好，世界')),
    { renders, final: text(stream.turn.value) }
  );
  record('纯文本流式：最终文本与状态正确', text(stream.turn.value) === '你好，世界' && stream.turn.value?.status === 'done', {
    final: text(stream.turn.value),
    status: stream.turn.value?.status,
  });
  record('推理块被收下', (stream.turn.value?.blocks || []).some((b) => b.type === 'reasoning'), {});
}

// ── 用例 2：浏览器工具 await_tool → resume ──
async function case2() {
  let resumes = 0;
  const stream = useAiStream({
    request: async (action) => {
      if (action === 'stream') {
        return sse([
          { type: 'start', session_id: 12, run_id: 'r2', model: 'mock' },
          { type: 'await_tool', id: 'c1', name: 'get_editor_state', label: '读取编辑器状态', args: {}, risk: 'read' },
          { type: 'waiting', run_id: 'r2' },
        ]);
      }
      resumes += 1;
      return sse([
        { type: 'start', session_id: 12, run_id: 'r2', model: 'mock', resumed: true },
        { type: 'tool_end', id: 'c1', ok: true, summary: '当前文件 a.yml' },
        { type: 'text', delta: '编辑器里有 a.yml' },
        { type: 'done', session_id: 12, message_id: 7, reply: '编辑器里有 a.yml' },
      ]);
    },
    executeClientTool: async () => ({ ok: true, result: '当前文件 a.yml' }),
    hasEditor: () => true,
  });

  const renders = [];
  const stop = effect(() => {
    const t = stream.turn.value;
    if (!t) return;
    const sig = t.status + '|' + tools(t).map((b) => b.status).join(',') + '|' + text(t);
    if (renders[renders.length - 1] !== sig) renders.push(sig);
  });

  await stream.run({ content: '看编辑器', model: 'mock' });
  stop();

  const t = stream.turn.value;
  record(
    '浏览器工具：await_tool → resume → 完成',
    resumes === 1 && tools(t).length === 1 && tools(t)[0].status === 'done' && text(t).includes('a.yml'),
    { resumes, toolStatus: tools(t)[0] && tools(t)[0].status, final: text(t) }
  );
  record(
    '工具卡渲染过程可见 awaiting 与 done 两个阶段',
    renders.some((r) => r.includes('awaiting')) && renders.some((r) => r.includes('done')),
    { renders }
  );
}

// ── 用例 3：提问卡 await_user → answerAsk → resume ──
async function case3() {
  let resumes = 0;
  const stream = useAiStream({
    request: async (action) => {
      if (action === 'stream') {
        return sse([
          { type: 'start', session_id: 13, run_id: 'r3', model: 'mock' },
          { type: 'await_user', id: 'ask1', questions: [{ question: '要删除吗？', options: [{ label: '删除' }, { label: '取消' }] }] },
          { type: 'waiting', run_id: 'r3' },
        ]);
      }
      resumes += 1;
      return sse([
        { type: 'start', session_id: 13, run_id: 'r3', model: 'mock', resumed: true },
        { type: 'tool_end', id: 'ask1', ok: true, summary: '取消' },
        { type: 'text', delta: '好的，已取消' },
        { type: 'done', session_id: 13, message_id: 8, reply: '好的，已取消' },
      ]);
    },
  });

  let answered = false;
  const stop = effect(() => {
    const t = stream.turn.value;
    if (!t) return;
    const a = asks(t);
    if (!answered && a.length === 1 && a[0].status === 'pending') {
      answered = true;
      // 模拟用户在提问卡上点「取消」
      stream.answerAsk('ask1', ['取消']);
    }
  });

  const p = stream.run({ content: '删除文件', model: 'mock' });
  const raced = await Promise.race([p.then(() => 'resolved'), new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
  stop();

  const t = stream.turn.value;
  record(
    '提问卡：answerAsk → resume → 完成',
    raced === 'resolved' && resumes === 1 && asks(t).length === 1 && asks(t)[0].status === 'answered' && text(t).includes('已取消'),
    { raced, resumes, askStatus: asks(t)[0] && asks(t)[0].status, answers: asks(t)[0] && asks(t)[0].answers, final: text(t) }
  );
}

// ── 用例 4：等待回答时 stop() 不能悬挂 ──
async function case4() {
  const stream = useAiStream({
    request: async () =>
      sse([
        { type: 'start', session_id: 14, run_id: 'r4', model: 'mock' },
        { type: 'await_user', id: 'ask4', questions: [{ question: '继续吗？', options: [{ label: '继续' }] }] },
        { type: 'waiting', run_id: 'r4' },
      ], 5),
  });

  const p = stream.run({ content: 'x', model: 'mock' });
  // 等提问卡出现（模拟用户看到卡片）再点停止
  for (let i = 0; i < 100; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
    if (asks(stream.turn.value).length > 0) break;
  }
  stream.stop();
  const raced = await Promise.race([p.then(() => 'resolved'), new Promise((r) => setTimeout(() => r('timeout'), 3000))]);
  record('等待回答时 stop() 不会悬挂', raced === 'resolved', { raced });
}

// ── 用例 5：历史回填时保留本地更完整的块（避免工具卡/思考块被回填删掉） ──
async function case5() {
  const { pickRicherTurn } = await import('./src/composables/useAiStream.ts');
  const localRicher = {
    id: 'turn_x', role: 'assistant', status: 'done', startedAt: 1000, finishedAt: 5000,
    blocks: [
      { type: 'reasoning', text: '思考', done: true },
      { type: 'tool', id: 'c1', name: 'list_cloud_files', label: '列出云文件', args: {}, scope: 'server', risk: 'read', status: 'done', summary: '3 个文件' },
      { type: 'tool', id: 'c2', name: 'read_cloud_file', label: '读文件', args: {}, scope: 'server', risk: 'read', status: 'done', summary: 'ok' },
      { type: 'text', text: '最终回答' },
    ],
    messageId: null,
  };
  const storedPoorer = {
    id: 'turn_stored', role: 'assistant', status: 'done', startedAt: 0,
    blocks: [{ type: 'text', text: '最终回答' }],
    messageId: 42, usage: { prompt_tokens: 10, completion_tokens: 5 },
    alternatives: [{ message_id: 41, content: '旧版', blocks: [{ type: 'text', text: '旧版' }] }],
  };
  const merged = pickRicherTurn(localRicher, storedPoorer);
  record('回填合并：保留本地更完整的块', merged.blocks.length === 4 && merged.blocks.some((b) => b.type === 'tool'), { blocks: merged.blocks.length });
  record('回填合并：messageId/usage/alternatives 取服务端', merged.messageId === 42 && merged.usage && merged.usage.prompt_tokens === 10 && merged.alternatives.length === 1,
    { messageId: merged.messageId, usage: merged.usage, alts: (merged.alternatives || []).length });
  const storedRicher = {
    id: 'turn_s2', role: 'assistant', status: 'done', startedAt: 0,
    blocks: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
    messageId: 7,
  };
  const merged2 = pickRicherTurn({ ...localRicher, blocks: [{ type: 'text', text: 'a' }] }, storedRicher);
  record('回填合并：服务端更完整时用服务端块', merged2.blocks.length === 2, { blocks: merged2.blocks.length });
  const merged3 = pickRicherTurn(null, storedRicher);
  record('回填合并：无本地回合时直接用服务端', merged3.blocks.length === 2 && merged3.messageId === 7);
}

try {
  await case1();
  await case2();
  await case3();
  await case4();
  await case5();
} catch (e) {
  record('用例执行异常', false, { error: e && e.stack ? String(e.stack).slice(0, 500) : String(e) });
}

const failed = results.filter((r) => !r.pass);
console.log('\n──────────────────────────────');
console.log('PASS ' + (results.length - failed.length) + ' / FAIL ' + failed.length);
process.exit(failed.length === 0 ? 0 : 1);
