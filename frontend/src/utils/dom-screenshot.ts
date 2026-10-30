/**
 * 纯浏览器 DOM 截图工具（不依赖 html2canvas / dom-to-image 等第三方库）。
 *
 * 实现思路：
 *   1. 克隆目标元素，递归把 getComputedStyle 的关键属性内联到 style（白名单，覆盖布局/排版/边框/背景/颜色/透明度/变换等）；
 *   2. 用 <svg><foreignObject> 包住克隆节点，序列化成 data:image/svg+xml；
 *   3. 通过 <img> 加载该 SVG（矢量渲染，文字清晰）→ 画到 canvas（按 dpr 缩放、限制最大宽度）→ PNG dataURL。
 *
 * 已知限制（失败时会抛出说明性错误，而不是静默产出坏图）：
 *   - 跨域 <img>、WebGL/被污染的 <canvas> 无法内联，用占位色块代替；
 *   - <iframe>/<video> 内部内容无法截图，用占位色块代替；
 *   - 元素内部滚动位置不会保留（画 top-left 视口）；
 *   - 浏览器若不支持在 SVG-as-image 中使用 foreignObject（或页面被 CSP 限制 img-src data:），
 *     img.onerror 会触发；此时会自动去掉 <img>/<canvas> 位图再降级重试一次，仍失败才 reject。
 */

export interface CaptureOptions {
  /** 输出最大宽度（CSS px，默认 1600；超过时按比例缩小） */
  maxWidth?: number;
  /** 输出最大高度（CSS px，默认 2400） */
  maxHeight?: number;
  /** 手动指定缩放倍率（默认取 devicePixelRatio，上限 2） */
  scale?: number;
  /** 画布底色（默认取目标元素的 background-color，最终兜底 #ffffff） */
  background?: string;
  /** 等待 SVG 栅格化的超时（毫秒，默认 15000） */
  timeoutMs?: number;
}

interface WalkContext {
  count: number;
  trimmed: boolean;
  /** 是否内联 <img>/<canvas> 位图（栅格化失败时去掉图片重试一次） */
  includeImages: boolean;
}

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const MAX_NODES = 20000;

/** 需要内联的 CSS 属性白名单（使用 CSS 属性名，可直接喂给 getPropertyValue / setProperty） */
const STYLE_WHITELIST: readonly string[] = [
  // 布局 / 盒模型
  'display', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'float', 'clear', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'overflow-x', 'overflow-y',
  // Flex / Grid
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex',
  'align-items', 'align-self', 'align-content', 'justify-content', 'justify-items', 'justify-self',
  'gap', 'row-gap', 'column-gap', 'order',
  'grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'grid-column', 'grid-row', 'grid-area',
  // 层叠 / 视觉效果
  'z-index', 'opacity', 'visibility', 'transform', 'transform-origin', 'transform-style',
  'perspective', 'backface-visibility', 'box-shadow', 'mix-blend-mode', 'filter',
  'aspect-ratio', 'object-fit', 'object-position', 'table-layout', 'border-collapse', 'border-spacing',
  // 背景
  'background-color', 'background-image', 'background-repeat', 'background-size',
  'background-position', 'background-origin', 'background-clip',
  // 文字 / 排版
  'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant',
  'font-stretch', 'font-feature-settings', 'font-kerning', 'line-height',
  'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-transform',
  'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness',
  'text-shadow', 'text-overflow', 'white-space', 'overflow-wrap', 'word-break', 'word-wrap',
  'tab-size', 'vertical-align', 'direction', 'unicode-bidi', 'writing-mode',
  'list-style-type', 'list-style-position', 'list-style-image',
  '-webkit-text-fill-color', '-webkit-font-smoothing',
  // SVG 图形属性
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'stop-color', 'stop-opacity', 'paint-order', 'shape-rendering', 'image-rendering',
  'accent-color',
];

/**
 * 把 DOM 元素截图为 PNG dataURL。
 * @throws 目标无效 / 尺寸过小 / SVG 栅格化失败 / 超时 / 画布被污染
 */
export async function captureElementToDataUrl(
  el: HTMLElement,
  opts: CaptureOptions = {},
): Promise<string> {
  if (!el || typeof el.getBoundingClientRect !== 'function') {
    throw new Error('截图失败：目标不是有效的 DOM 元素');
  }
  if (!el.isConnected) {
    throw new Error('截图失败：目标元素当前不在页面中（可能已被卸载）');
  }

  const rect = el.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (width < 2 || height < 2) {
    throw new Error(`截图失败：目标区域尺寸过小（${width}×${height}）`);
  }

  // 字体就绪后再截，避免字体替换造成文字抖动/缺失
  try {
    await (document as any).fonts?.ready;
  } catch {
    /* 忽略：字体 API 不可用时继续 */
  }

  const maxWidth = Math.max(320, opts.maxWidth ?? 1600);
  const maxHeight = Math.max(320, opts.maxHeight ?? 2400);
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const scale = Math.min(opts.scale ?? dpr, maxWidth / width, maxHeight / height, 2);
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  const sourceStyle = window.getComputedStyle(el);
  const background = opts.background || sourceStyle.backgroundColor || '#ffffff';
  const timeoutMs = opts.timeoutMs ?? 15000;

  // 先尝试完整快照（内联位图）；若浏览器栅格化失败，去掉 <img>/<canvas> 位图再试一次
  const withImagesSvg = buildSvgSnapshot(el, width, height, outW, outH, sourceStyle, background, true);
  let img: HTMLImageElement;
  try {
    img = await loadImage(svgToDataUrl(withImagesSvg), timeoutMs);
  } catch (e: any) {
    // 超时不再重试（重试只会再等一轮）；栅格化失败（onerror）时降级重试
    if (e?.name === 'ScreenshotTimeout') throw e;
    try {
      const withoutImagesSvg = buildSvgSnapshot(el, width, height, outW, outH, sourceStyle, background, false);
      img = await loadImage(svgToDataUrl(withoutImagesSvg), timeoutMs);
    } catch (e2: any) {
      throw new Error(
        `${e2?.message || String(e2)}（已去掉图片降级重试仍失败；首次错误：${e?.message || String(e)}）`,
      );
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('截图失败：浏览器不支持 canvas 2D 上下文');
  }
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, 0, 0, outW, outH);

  try {
    return canvas.toDataURL('image/png');
  } catch (e: any) {
    throw new Error(`截图失败：画布被跨域内容污染（${e?.message || String(e)}）`);
  }
}

/** 克隆 + 内联样式 + 序列化，生成完整 SVG 字符串（includeImages=false 时位图用占位块） */
function buildSvgSnapshot(
  el: HTMLElement,
  width: number,
  height: number,
  outW: number,
  outH: number,
  sourceStyle: CSSStyleDeclaration,
  background: string,
  includeImages: boolean,
): string {
  const rootClone = buildClonedTree(el, width, height, includeImages);
  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', XHTML_NS);
  wrapper.setAttribute('style', [
    `width:${width}px`,
    `height:${height}px`,
    'overflow:hidden',
    'position:relative',
    'margin:0',
    'padding:0',
    'border:0',
    `background:${background}`,
    `color:${sourceStyle.color || '#1f2328'}`,
    `font-family:${sourceStyle.fontFamily || 'sans-serif'}`,
    `font-size:${sourceStyle.fontSize || '13px'}`,
    `line-height:${sourceStyle.lineHeight || 'normal'}`,
    `direction:${sourceStyle.direction || 'ltr'}`,
  ].join(';'));
  wrapper.appendChild(rootClone);

  let inner = '';
  try {
    inner = new XMLSerializer().serializeToString(wrapper);
  } catch (e: any) {
    throw new Error(`截图失败：DOM 序列化失败（${e?.message || String(e)}）`);
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    inner +
    '</foreignObject></svg>'
  );
}

/** 克隆目标元素并把计算样式内联，返回可直接放进 foreignObject 的根节点 */
function buildClonedTree(el: HTMLElement, width: number, height: number, includeImages: boolean): HTMLElement {
  const clone = el.cloneNode(true) as HTMLElement;
  const ctx: WalkContext = { count: 0, trimmed: false, includeImages };
  const processed = processElement(el, clone, true, ctx, width, height);
  if (ctx.trimmed && typeof console !== 'undefined') {
    console.warn('[dom-screenshot] DOM 节点数超过上限，部分节点样式未内联，截图可能不完整');
  }
  return processed as HTMLElement;
}

/**
 * 递归处理 src 与 dst 这一对节点：内联样式、处理特殊标签，并递归子节点。
 * 返回实际应放入克隆树的节点（通常是 dst 本身；<canvas>/<img> 等会被替换）。
 */
function processElement(
  src: Element,
  dst: Element,
  isRoot: boolean,
  ctx: WalkContext,
  width: number,
  height: number,
): Element {
  ctx.count += 1;
  if (ctx.count > MAX_NODES) {
    ctx.trimmed = true;
    return dst;
  }

  const tag = src.tagName.toUpperCase();
  const cs = window.getComputedStyle(src);

  // 脚本/元信息不进截图
  if (tag === 'SCRIPT' || tag === 'NOSCRIPT' || tag === 'LINK' || tag === 'META' || tag === 'TEMPLATE') {
    return hiddenNode();
  }

  // <canvas>：尝试 toDataURL 转成 <img>（被 WebGL/跨域污染时留空占位）
  if (tag === 'CANVAS') {
    const replacement = document.createElement('img');
    let dataUrl = '';
    if (ctx.includeImages) {
      try {
        dataUrl = (src as HTMLCanvasElement).toDataURL('image/png');
      } catch {
        dataUrl = '';
      }
    }
    if (dataUrl) replacement.setAttribute('src', dataUrl);
    inlineStyle(cs, replacement, isRoot, width, height);
    if (!dataUrl) {
      replacement.style.setProperty('background-color', 'rgba(127,127,127,0.12)');
    }
    return replacement;
  }

  // <img>：data: 直接用；同源图导成 data:；跨域留占位
  if (tag === 'IMG') {
    const replacement = document.createElement('img');
    inlineStyle(cs, replacement, isRoot, width, height);
    const source = src as HTMLImageElement;
    let dataUrl = '';
    if (ctx.includeImages) {
      if (source.currentSrc && source.currentSrc.startsWith('data:')) {
        dataUrl = source.currentSrc;
      } else {
        dataUrl = imageToDataUrl(source);
      }
    }
    if (dataUrl) {
      replacement.setAttribute('src', dataUrl);
    } else {
      replacement.style.setProperty('background-color', 'rgba(127,127,127,0.18)');
      replacement.style.setProperty('opacity', '0.5');
    }
    return replacement;
  }

  // iframe / video / object / embed：内部内容不可复制，用占位块
  if (tag === 'IFRAME' || tag === 'VIDEO' || tag === 'OBJECT' || tag === 'EMBED') {
    const replacement = document.createElement('div');
    inlineStyle(cs, replacement, isRoot, width, height);
    const bg = cs.backgroundColor;
    replacement.style.setProperty(
      'background-color',
      bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : 'rgba(127,127,127,0.12)',
    );
    return replacement;
  }

  // 常规元素：清掉原 style，改用计算样式；去掉编辑态光标/可编辑标记
  dst.removeAttribute('style');
  dst.removeAttribute('contenteditable');
  dst.removeAttribute('spellcheck');
  dst.removeAttribute('autofocus');
  inlineStyle(cs, dst, isRoot, width, height);

  // 表单控件的“当前值”不在 DOM 属性里，需要回写
  if (tag === 'INPUT') {
    const input = src as HTMLInputElement;
    dst.setAttribute('value', input.value ?? '');
    if (input.checked) dst.setAttribute('checked', 'checked');
    else dst.removeAttribute('checked');
  } else if (tag === 'TEXTAREA') {
    dst.textContent = (src as HTMLTextAreaElement).value ?? '';
  } else if (tag === 'OPTION') {
    if ((src as HTMLOptionElement).selected) dst.setAttribute('selected', 'selected');
    else dst.removeAttribute('selected');
  }

  // 递归子节点（克隆树与源树结构一一对应）
  const srcKids = Array.from(src.children);
  const dstKids = Array.from(dst.children);
  const count = Math.min(srcKids.length, dstKids.length);
  for (let i = 0; i < count; i++) {
    const s = srcKids[i];
    const d = dstKids[i];
    const next = processElement(s, d, false, ctx, width, height);
    if (next !== d && d.parentNode) {
      d.parentNode.replaceChild(next, d);
    }
  }

  return dst;
}

/** 把计算样式按白名单内联到目标元素 */
function inlineStyle(
  cs: CSSStyleDeclaration,
  target: Element,
  isRoot: boolean,
  width: number,
  height: number,
): void {
  const style = (target as HTMLElement).style as CSSStyleDeclaration | undefined;
  if (!style) return;
  (target as HTMLElement).removeAttribute('style');

  for (const prop of STYLE_WHITELIST) {
    let value = '';
    try {
      value = cs.getPropertyValue(prop);
    } catch {
      value = '';
    }
    if (!value) continue;
    // 外链背景图在 SVG-as-image 中无法加载，直接丢弃，避免整张图加载失败
    if (prop === 'background-image' && value.includes('url(') && !value.includes('data:')) continue;
    style.setProperty(prop, value);
  }

  // 禁用动画/过渡/光标/焦点框，保证截图稳定
  style.setProperty('animation', 'none');
  style.setProperty('transition', 'none');
  style.setProperty('caret-color', 'transparent');
  style.setProperty('outline', 'none');
  style.setProperty('outline-offset', '0');

  if (isRoot) {
    style.setProperty('position', 'relative');
    style.setProperty('inset', 'auto');
    style.setProperty('left', '0');
    style.setProperty('top', '0');
    style.setProperty('margin', '0');
    style.setProperty('transform', 'none');
    style.setProperty('width', `${width}px`);
    style.setProperty('height', `${height}px`);
    style.setProperty('min-width', '0');
    style.setProperty('min-height', '0');
    style.setProperty('max-width', 'none');
    style.setProperty('max-height', 'none');
    style.setProperty('overflow', 'hidden');
  }
}

function hiddenNode(): HTMLElement {
  const span = document.createElement('span');
  span.style.cssText = 'display:none';
  return span;
}

/** 同源 <img> 转 dataURL；跨域/未加载完成返回 '' */
function imageToDataUrl(img: HTMLImageElement): string {
  try {
    if (!img.complete || !img.naturalWidth || !img.naturalHeight) return '';
    // 超大图片不内联，避免 SVG 体积爆炸
    if (img.naturalWidth * img.naturalHeight > 4_000_000) return '';
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    // SecurityError：跨域图片污染画布
    return '';
  }
}

/** SVG 字符串 → data URL（按 UTF-8 分块 base64，避免超长参数栈溢出） */
function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/** 加载 SVG data URL 到 <img>，带超时与明确错误信息 */
function loadImage(url: string, timeoutMs: number): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'sync';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('截图失败：浏览器无法把 DOM 栅格化为图片（SVG foreignObject 渲染失败，可能包含不受支持的内容或页面 CSP 禁止 data: 图片）'));
    };
    timer = setTimeout(() => {
      cleanup();
      const err = new Error(`截图失败：渲染超时（>${Math.max(1000, timeoutMs)}ms）`);
      err.name = 'ScreenshotTimeout';
      reject(err);
    }, Math.max(1000, timeoutMs));
    try {
      img.src = url;
    } catch (e: any) {
      cleanup();
      reject(new Error(`截图失败：无法加载 SVG 快照（${e?.message || String(e)}）`));
    }
  });
}
