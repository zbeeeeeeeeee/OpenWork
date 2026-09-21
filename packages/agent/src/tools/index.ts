import type { ITool } from '../types/tool';
import { BashTool } from './bash';
import { ListDirTool } from './list-dir';
import { SearchCodeTool } from './search-code';
import { DelegateTool } from './delegate';
import { FileReadTool } from './file-read';
import { FileWriteTool } from './file-write';
import { FileEditTool } from './file-edit';

export { BashTool } from './bash';
export { ListDirTool } from './list-dir';
export { SearchCodeTool } from './search-code';
export { DelegateTool } from './delegate';
export { FileReadTool } from './file-read';
export { FileWriteTool } from './file-write';
export { FileEditTool } from './file-edit';

/** 创建 Agent 默认工具集。
 *
 * 工具顺序即注册顺序,也是 ToolRegistry.buildSystemPromptSection()
 * 渲染给 LLM 的顺序——靠前的工具被 LLM 优先采用。
 * 问答/探索场景优先 list_dir / read_file / search_code；
 * 写文件工具靠后但仍保留 file_edit 优先于 file_write 的语义。
 *
 * enableBash=false 时 bash 工具不会注册(不进系统提示词,LLM 不会尝试调用)。
 */
export function createDefaultTools(options?: { enableBash?: boolean }): ITool[] {
  // 探索类工具靠前：问答场景优先 list_dir/read_file，减少 bash 误用
  const tools: ITool[] = [
    new ListDirTool(),
    new FileReadTool(),
    new SearchCodeTool(),
    new FileEditTool(),
    new FileWriteTool(),
  ];
  if (options?.enableBash !== false) {
    tools.push(new BashTool());
  }
  tools.push(new DelegateTool());
  return tools;
}
