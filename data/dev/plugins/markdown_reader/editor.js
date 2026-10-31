/* Markdown 阅读器 —— 离线 Markdown 渲染 + 分栏/全预览编辑器
 *
 * 平台协议（见 PluginEditorFrame.vue）：
 *   window.CSEditor.file      = { name, content }   初始文件内容
 *   window.CSEditor.emitSave  = (content) => void   保存
 *   window.CSEditor.request   = (action, payload)   平台请求（notify 等）
 *   window.CSEditor.setRibbon = (groups) => void    自定义左侧工具栏
 *   平台命令：window.postMessage({ __ceseCommand: 'save' }) → 调用全局 saveConfig()
 */

/* ============================ 渲染器（纯函数，无 DOM） ============================ */
/* @TEST:renderMarkdown:start */
function mdEscape(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mdSafeUrl(url) {
  var u = String(url || '').trim();
  if (!u) return false;
  var lower = u.toLowerCase();
  if (lower.indexOf('javascript:') === 0) return false;
  if (lower.indexOf('vbscript:') === 0) return false;
  if (lower.indexOf('data:') === 0 && lower.indexOf('data:image/') !== 0) return false;
  return true;
}

function mdInline(text, codeStore) {
  var s = mdEscape(text);

  // 行内代码：先占位，避免被粗体/斜体/链接语法误伤
  s = s.replace(/`([^`]+)`/g, function (_m, code) {
    codeStore.push({ type: 'inline', code: code });
    return '\u0001C' + (codeStore.length - 1) + '\u0001';
  });

  // 图片（先于链接，语法只差一个 !）
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (_m, alt, url, title) {
    if (!mdSafeUrl(url)) return mdEscape('![' + alt + '](' + url + ')');
    return '<img src="' + url + '" alt="' + mdEscape(alt) + '"'
      + (title ? ' title="' + mdEscape(title) + '"' : '') + ' loading="lazy" />';
  });

  // 链接
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (_m, label, url, title) {
    if (!mdSafeUrl(url)) return mdEscape(label);
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer"'
      + (title ? ' title="' + mdEscape(title) + '"' : '') + '>' + label + '</a>';
  });

  // 粗体 / 斜体 / 删除线
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');

  // 还原行内代码
  s = s.replace(/\u0001C(\d+)\u0001/g, function (_m, idx) {
    var item = codeStore[Number(idx)];
    return '<code>' + (item ? item.code : '') + '</code>';
  });

  // 软换行
  s = s.replace(/\n/g, '<br />');
  return s;
}

function mdLeadingIndent(line) {
  var m = /^(\s*)/.exec(String(line || ''));
  return m ? m[1].replace(/\t/g, '    ').length : 0;
}

function mdSplitRow(line) {
  var s = String(line || '').trim();
  if (s.charAt(0) === '|') s = s.slice(1);
  if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
  return s.split('|').map(function (cell) { return cell.trim(); });
}

function mdParseTable(lines, start, codeStore) {
  var header = mdSplitRow(lines[start]);
  var i = start + 2;
  var rows = [];
  while (i < lines.length && !/^\s*$/.test(lines[i]) && lines[i].indexOf('|') >= 0) {
    rows.push(mdSplitRow(lines[i]));
    i += 1;
  }
  var html = '<table><thead><tr>';
  for (var h = 0; h < header.length; h += 1) html += '<th>' + mdInline(header[h], codeStore) + '</th>';
  html += '</tr></thead><tbody>';
  for (var r = 0; r < rows.length; r += 1) {
    html += '<tr>';
    for (var c = 0; c < header.length; c += 1) {
      html += '<td>' + mdInline(rows[r][c] === undefined ? '' : rows[r][c], codeStore) + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return { html: html, next: i };
}

function mdParseList(lines, start, codeStore) {
  var baseIndent = mdLeadingIndent(lines[start]);
  var ordered = /^\s*\d+[.)]\s+/.test(lines[start]);
  var items = [];
  var i = start;

  while (i < lines.length) {
    var line = lines[i];
    if (/^\s*$/.test(line)) {
      // 空行后若紧跟同类（且不浅于当前层）列表项则继续
      var j = i + 1;
      while (j < lines.length && /^\s*$/.test(lines[j])) j += 1;
      if (j < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[j]) && mdLeadingIndent(lines[j]) >= baseIndent) {
        i = j;
        continue;
      }
      break;
    }
    var m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (!m) break;
    var indent = mdLeadingIndent(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      if (!items.length) break;
      var nested = mdParseList(lines, i, codeStore);
      items[items.length - 1].sub += nested.html;
      i = nested.next;
      continue;
    }
    var content = m[3];
    var task = /^\[([ xX])\]\s+(.*)$/.exec(content);
    var isTask = false;
    var checked = false;
    if (task) {
      isTask = true;
      checked = task[1].toLowerCase() === 'x';
      content = task[2];
    }
    items.push({ text: content, task: isTask, checked: checked, sub: '' });
    i += 1;
  }

  var tag = ordered ? 'ol' : 'ul';
  var html = '<' + tag + '>';
  for (var k = 0; k < items.length; k += 1) {
    var it = items[k];
    var box = it.task
      ? '<input type="checkbox" disabled' + (it.checked ? ' checked' : '') + ' /> '
      : '';
    html += '<li' + (it.task ? ' class="task"' : '') + '>'
      + box + mdInline(it.text, codeStore) + it.sub + '</li>';
  }
  html += '</' + tag + '>';
  return { html: html, next: i };
}

/**
 * Markdown → HTML（纯函数，不依赖 DOM，便于 Node 里单测）
 * @param {string} src
 * @returns {string}
 */
function renderMarkdown(src) {
  var text = String(src === undefined || src === null ? '' : src).replace(/\r\n?/g, '\n');
  var codeStore = [];

  // 1) 围栏代码块（含未闭合的情况）
  text = text.replace(/^```([^\n`]*)\n([\s\S]*?)\n?^```[ \t]*$/gm, function (_m, lang, code) {
    codeStore.push({ type: 'block', lang: String(lang || '').trim(), code: code });
    return '\u0000B' + (codeStore.length - 1) + '\u0000';
  });
  text = text.replace(/^```([^\n`]*)\n([\s\S]*)$/m, function (_m, lang, code) {
    codeStore.push({ type: 'block', lang: String(lang || '').trim(), code: code });
    return '\u0000B' + (codeStore.length - 1) + '\u0000';
  });

  var lines = text.split('\n');
  var out = [];
  var para = [];

  function flushPara() {
    if (!para.length) return;
    out.push('<p>' + mdInline(para.join('\n'), codeStore) + '</p>');
    para = [];
  }

  var i = 0;
  while (i < lines.length) {
    var line = lines[i];

    if (/^\s*$/.test(line)) { flushPara(); i += 1; continue; }

    // 代码占位行（独占一行）
    var blockMark = /^\u0000B(\d+)\u0000$/.exec(line);
    if (blockMark) {
      flushPara();
      var item = codeStore[Number(blockMark[1])];
      var langCls = item && item.lang ? ' class="language-' + mdEscape(item.lang) + '"' : '';
      var langLabel = item && item.lang ? '<span class="code-lang">' + mdEscape(item.lang) + '</span>' : '';
      out.push('<pre>' + langLabel + '<code' + langCls + '>' + mdEscape(item ? item.code : '') + '</code></pre>');
      i += 1;
      continue;
    }

    // ATX 标题
    var heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      var level = heading[1].length;
      out.push('<h' + level + '>' + mdInline(heading[2].replace(/\s+#+\s*$/, ''), codeStore) + '</h' + level + '>');
      i += 1;
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      out.push('<hr />');
      i += 1;
      continue;
    }

    // 引用块
    if (/^\s*>/.test(line)) {
      flushPara();
      var quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push('<blockquote>' + renderMarkdown(quote.join('\n')) + '</blockquote>');
      continue;
    }

    // 表格：当前行含 | 且下一行是分隔行
    if (line.indexOf('|') >= 0 && i + 1 < lines.length
      && lines[i + 1].indexOf('|') >= 0
      && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
      flushPara();
      var table = mdParseTable(lines, i, codeStore);
      out.push(table.html);
      i = table.next;
      continue;
    }

    // 列表
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      flushPara();
      var list = mdParseList(lines, i, codeStore);
      out.push(list.html);
      i = list.next;
      continue;
    }

    para.push(line);
    i += 1;
  }
  flushPara();

  return out.join('\n');
}
/* @TEST:renderMarkdown:end */

/* ============================ 编辑器 UI ============================ */
(function () {
  var SDK = window.CSEditor || null;
  var file = (SDK && SDK.file) || { name: '', content: '' };
  var STORAGE_KEY = 'cses.md.mode';
  var MAX_RENDER_BYTES = 800 * 1024;
  var TRUNCATE_BYTES = 300 * 1024;

  var state = {
    text: String(file.content || ''),
    lastSaved: String(file.content || ''),
    dirty: false,
    mode: 'split',
    renderTimer: 0,
  };

  function $(id) { return document.getElementById(id); }

  function readStoredMode() {
    try {
      var v = window.localStorage.getItem(STORAGE_KEY);
      if (v === 'split' || v === 'preview' || v === 'source') return v;
    } catch (_) { /* iframe 可能被 sandbox 限制 */ }
    return 'split';
  }

  function storeMode(mode) {
    try { window.localStorage.setItem(STORAGE_KEY, mode); } catch (_) { /* ignore */ }
  }

  function byteLength(s) {
    try { return new Blob([s]).size; } catch (_) { return String(s).length * 3; }
  }

  var els = {};

  function applyMode(mode, silent) {
    state.mode = mode;
    els.body.setAttribute('data-mode', mode);
    els.app.setAttribute('data-mode', mode);
    var buttons = document.querySelectorAll('[data-mode-btn]');
    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      var active = btn.getAttribute('data-mode-btn') === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    if (!silent) {
      storeMode(mode);
      if (mode !== 'preview') renderNow();
    }
    updateStats();
  }

  function renderNow() {
    var src = state.text;
    var bytes = byteLength(src);
    var truncated = false;
    if (bytes > MAX_RENDER_BYTES) {
      src = src.slice(0, TRUNCATE_BYTES);
      truncated = true;
      els.notice.hidden = false;
      els.notice.textContent = '文件较大（' + (bytes / 1024).toFixed(0) + ' KB），预览只渲染了前 ' + (TRUNCATE_BYTES / 1024) + ' KB 内容；源码编辑不受影响。';
    } else if (!els.notice.hidden) {
      els.notice.hidden = true;
      els.notice.textContent = '';
    }

    var html = '';
    try {
      html = renderMarkdown(src);
    } catch (e) {
      html = '<p style="color:#c42b1c">渲染失败：' + mdEscape(e && e.message ? e.message : String(e)) + '</p>';
    }
    if (truncated) html += '<div class="md-truncated">（预览已截断）</div>';

    els.preview.innerHTML = html;
    var isEmpty = String(src).trim() === '';
    els.empty.hidden = !isEmpty;
    els.preview.style.display = isEmpty ? 'none' : '';
    updateStats();
  }

  function scheduleRender() {
    if (state.renderTimer) window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(function () {
      state.renderTimer = 0;
      renderNow();
    }, 150);
  }

  function updateStats() {
    var text = state.text;
    els.statChars.textContent = text.length + ' 字符';
    els.statLines.textContent = (text === '' ? 0 : text.split('\n').length) + ' 行';
    var words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    els.statWords.textContent = words + ' 词';
    els.dirtyDot.hidden = !state.dirty;
    els.saveBtn.disabled = !state.dirty;
    els.statSaved.textContent = state.dirty ? '有未保存修改' : '已同步';
  }

  function markDirty() {
    state.dirty = state.text !== state.lastSaved;
    updateStats();
  }

  function save() {
    var text = state.text;
    try {
      if (SDK && typeof SDK.emitSave === 'function') {
        SDK.emitSave(text);
      } else {
        window.parent.postMessage({
          __csesPluginSave: true,
          content: text,
          fileName: file.name,
        }, '*');
      }
    } catch (e) {
      try { window.alert('保存失败：' + (e && e.message ? e.message : e)); } catch (_) { /* ignore */ }
      return;
    }
    state.lastSaved = text;
    state.dirty = false;
    updateStats();
    try {
      if (SDK && typeof SDK.request === 'function') {
        SDK.request('notify', { msg: '已保存' });
      }
    } catch (_) { /* 提示失败不影响保存 */ }
  }

  // 平台菜单/Ctrl+S 走 __ceseCommand:'save'
  window.saveConfig = save;

  function bindModeButtons() {
    var buttons = document.querySelectorAll('[data-mode-btn]');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener('click', function (e) {
        var target = e.currentTarget;
        applyMode(target.getAttribute('data-mode-btn'));
      });
    }
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      var meta = e.ctrlKey || e.metaKey;
      if (meta && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        save();
        return;
      }
      if (e.altKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
        e.preventDefault();
        applyMode(e.key === '1' ? 'split' : (e.key === '2' ? 'preview' : 'source'));
      }
    }, true);
  }

  function bindPlatformCommands() {
    window.addEventListener('message', function (e) {
      var data = e.data || {};
      var cmd = data.__ceseCommand;
      if (!cmd) return;
      if (cmd === 'md-mode-split') applyMode('split');
      else if (cmd === 'md-mode-preview') applyMode('preview');
      else if (cmd === 'md-mode-source') applyMode('source');
      else if (cmd === 'md-save') save();
      else if (cmd === 'md-refresh') { renderNow(); }
    });
  }

  function bindSplitter() {
    var dragging = false;
    var container = els.body;

    function onMove(e) {
      if (!dragging) return;
      var rect = container.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      var ratio = Math.min(0.85, Math.max(0.15, x / rect.width));
      container.style.gridTemplateColumns = (ratio * 100).toFixed(2) + '% 1fr';
      els.splitter.style.left = (ratio * 100).toFixed(2) + '%';
      try { window.localStorage.setItem('cses.md.split', String(ratio)); } catch (_) { /* ignore */ }
    }

    function onUp() {
      dragging = false;
      els.app.classList.remove('resizing');
      els.splitter.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    els.splitter.addEventListener('mousedown', function (e) {
      e.preventDefault();
      dragging = true;
      els.app.classList.add('resizing');
      els.splitter.classList.add('dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    try {
      var saved = Number(window.localStorage.getItem('cses.md.split'));
      if (saved >= 0.15 && saved <= 0.85) {
        container.style.gridTemplateColumns = (saved * 100).toFixed(2) + '% 1fr';
        els.splitter.style.left = (saved * 100).toFixed(2) + '%';
      }
    } catch (_) { /* ignore */ }
  }

  function bindScrollSync() {
    var lock = false;
    els.source.addEventListener('scroll', function () {
      if (lock || state.mode !== 'split') return;
      lock = true;
      var max = els.source.scrollHeight - els.source.clientHeight;
      var ratio = max > 0 ? els.source.scrollTop / max : 0;
      var pMax = els.preview.parentElement;
      var pMaxScroll = pMax.scrollHeight - pMax.clientHeight;
      if (pMaxScroll > 0) pMax.scrollTop = ratio * pMaxScroll;
      window.setTimeout(function () { lock = false; }, 40);
    });
  }

  function init() {
    els = {
      app: $('app'),
      body: $('body'),
      preview: $('preview'),
      empty: $('empty'),
      source: $('src'),
      dirtyDot: $('dirtyDot'),
      saveBtn: $('saveBtn'),
      notice: $('notice'),
      splitter: $('splitter'),
      statChars: $('statChars'),
      statLines: $('statLines'),
      statWords: $('statWords'),
      statSaved: $('statSaved'),
    };

    $('fileName').textContent = file.name || 'Markdown';
    els.source.value = state.text;

    els.source.addEventListener('input', function () {
      state.text = els.source.value;
      markDirty();
      scheduleRender();
    });
    els.saveBtn.addEventListener('click', save);

    bindModeButtons();
    bindKeys();
    bindPlatformCommands();
    bindSplitter();
    bindScrollSync();

    applyMode(readStoredMode(), true);
    markDirty();
    renderNow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
