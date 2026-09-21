import type { ToolRegistry } from './tool-registry';

/** 从 LLM 回复中解析出的工具调用 */
export interface ParsedTool {
  type: string;
  params: Record<string, string>;
}

/**
 * 从 LLM 回复文本中解析工具调用标签。
 *
 * 支持三种语法形：
 *   1. 自闭标签：<read_file path="src/app.ts"/>
 *   2. content body：<file_write path="src/foo.ts">full file here</file_write>
 *   3. children body：<file_edit path="x"><old>...</old><new>...</new></file_edit>
 *
 * 哪种语法有效取决于工具本身的 `body` 声明（通过 ToolRegistry.getBodyMode 查询）。
 * 解析策略：先尝试匹配带闭合标签的形式，再回退到自闭合形式。
 */
export function parseToolCalls(text: string, registry: ToolRegistry): ParsedTool[] {
  const tools: ParsedTool[] = [];
  const seen = new Set<number>();

  // 先匹配带 body 的标签：<tag attrs>...</tag>
  // body 支持跨多行;[\\s\\S]*? 非贪婪避免一次吃到文件结尾
  const bodyRe = /<(\w+)([^>]*?)>([\s\S]*?)<\/\1\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = bodyRe.exec(text)) !== null) {
    const tag = m[1];
    const attrStr = m[2] || '';
    const body = m[3] ?? '';
    const bodyMode = registry.getBodyMode(tag);
    if (!bodyMode) {
      // 工具不支持 body —— 跳过,留给自闭合扫描处理
      continue;
    }
    const params = parseAttrs(attrStr);
    if (bodyMode === 'content') {
      params.content = body;
    } else {
      // children 模式:从 body 中提取所有 <key>value</key>
      const childRe = /<(\w+)>([\s\S]*?)<\/\1\s*>/g;
      let cm: RegExpExecArray | null;
      while ((cm = childRe.exec(body)) !== null) {
        params[cm[1]] = cm[2] ?? '';
      }
    }
    // 用整体匹配的索引去重,防止自闭合再扫一次产生重复
    seen.add(m.index);
    tools.push({ type: tag, params });
  }

  // 再匹配自闭合标签:<tag attr="..." />
  // 避开已识别为带 body 的位置
  const selfRe = /<(\w+)([^>]*?)\s*\/>/g;
  while ((m = selfRe.exec(text)) !== null) {
    if (seen.has(m.index)) continue;
    const tag = m[1];
    if (!registry.has(tag)) continue;
    const params = parseAttrs(m[2] || '');
    tools.push({ type: tag, params });
  }

  if (tools.length === 0) {
    return parseDsmlToolCalls(text, registry);
  }
  return tools;
}

/**
 * 回退解析 DeepSeek/Anthropic 风格 DSML 工具标记。
 * 部分国产模型会在 content 里吐 <｜｜DSML｜｜ invoke name="bash">… 而非我们的 XML 标签。
 */
export function parseDsmlToolCalls(text: string, registry: ToolRegistry): ParsedTool[] {
  const tools: ParsedTool[] = [];
  if (!text) return tools;
  const hasDsml = /[｜|]DSML[｜|]/.test(text) || /<invoke\b/i.test(text);
  if (!hasDsml) return tools;

  const bar = '[｜|]';
  const invokeBlock = new RegExp(
    `<${bar}+DSML${bar}+\\s*invoke\\b([^>]*)>([\\s\\S]*?)<\\/${bar}+DSML${bar}+\\s*invoke\\s*>`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = invokeBlock.exec(text)) !== null) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    const nameMatch = /name\s*=\s*"([^"]+)"/i.exec(attrs);
    if (!nameMatch) continue;
    // 兼容 name="list_dir path=..." 这种属性粘连：取第一个 token 作为工具名
    const rawName = nameMatch[1]!.trim();
    const toolName = rawName.split(/\s+/)[0]!;
    if (!registry.has(toolName)) continue;
    const params: Record<string, string> = {};
    // name 属性里粘连的 path="..."
    const gluedPath = /path\s*=\s*"([^"]*)"/i.exec(attrs);
    if (gluedPath) params.path = gluedPath[1]!;
    const paramRe = new RegExp(
      `<${bar}+DSML${bar}+\\s*parameter\\b([^>]*)>([\\s\\S]*?)<\\/${bar}+DSML${bar}+\\s*parameter\\s*>`,
      'gi',
    );
    let pm: RegExpExecArray | null;
    while ((pm = paramRe.exec(body)) !== null) {
      const pAttrs = pm[1] || '';
      const pName = /name\s*=\s*"([^"]+)"/i.exec(pAttrs);
      if (!pName) continue;
      const key = pName[1]!;
      params[key] = (pm[2] || '').trim();
    }
    tools.push({ type: toolName, params });
  }

  // 自闭合 / 残缺 invoke：仅匹配以 /> 结尾的标签，避免与成对 block 的开标签重复
  const invokeSelf = new RegExp(
    `<${bar}+DSML${bar}+\\s*invoke\\b([^>]*?)\\/\\s*>`,
    'gi',
  );
  while ((m = invokeSelf.exec(text)) !== null) {
    const attrs = m[1] || '';
    const nameMatch = /name\s*=\s*"([^"]*)"/i.exec(attrs);
    if (!nameMatch) continue;
    const raw = nameMatch[1]!.trim();
    const toolName = raw.split(/\s+/)[0]!;
    if (!registry.has(toolName)) continue;
    // 已在 block 解析中出现过同名且参数相近时仍允许（模型可能连发）
    const params: Record<string, string> = {};
    const pathM = /path\s*=\s*"([^"]*)"/i.exec(attrs) || /path\s*=\s*"([^"]*)/i.exec(raw + '"');
    if (pathM) params.path = pathM[1]!;
    // name="list_dir path="G:\..."  → path 可能残留在 name 值后半段
    if (!params.path) {
      const after = raw.split(/\s+/).slice(1).join(' ');
      const p2 = /path\s*=\s*"?([^"]*)"?/i.exec(after);
      if (p2) params.path = p2[1]!;
    }
    tools.push({ type: toolName, params });
  }

  return tools;
}

/** 解析属性字符串 `path="x" max="3"` 为 {path:"x",max:"3"} */
function parseAttrs(attrStr: string): Record<string, string> {
  const params: Record<string, string> = {};
  const attrRe = /(\w+)="([^"]*)"/g;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(attrStr)) !== null) {
    params[am[1]] = am[2];
  }
  return params;
}

