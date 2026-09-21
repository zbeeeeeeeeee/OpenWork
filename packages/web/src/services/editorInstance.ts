// Monaco 编辑器实例的模块级单例
// 用于在组件间共享编辑器引用，避免 prop 透传
// MainLayout、StatusBar、useFileSystem 等均通过此模块访问编辑器

let instance: import('monaco-editor').editor.IStandaloneCodeEditor | null = null

export function getEditorInstance() {
  return instance
}

export function setEditorInstance(editor: typeof instance) {
  instance = editor
}

/** 销毁编辑器实例并清空引用（仅当当前单例就是该实例时） */
export function clearEditorInstance(onlyIf?: import('monaco-editor').editor.IStandaloneCodeEditor | null) {
  if (!instance) return
  if (onlyIf && instance !== onlyIf) return
  try {
    instance.dispose()
  } catch {
    /* ignore */
  }
  instance = null
}
