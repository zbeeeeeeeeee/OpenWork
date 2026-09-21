import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { i18n } from '../locales'
import { configService } from '../services/configService'

export type Language = 'zh' | 'en'
export type Theme = 'dark' | 'light' | 'blue'
export type ToolProtocolSetting = 'xml' | 'fc' | 'auto'
export type PermissionModeSetting = 'suggest' | 'auto-edit' | 'full-auto'

const STORAGE_KEY_LANG = 'openwork-language'
const STORAGE_KEY_THEME = 'openwork-theme'
const STORAGE_KEY_PROTOCOL = 'openwork-tool-protocol'
const STORAGE_KEY_PERMISSION = 'openwork-permission-mode'
const CONFIG_FILENAME = 'settings.json'
const CONFIG_STORAGE_KEY = 'openwork-settings'

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_THEME)
    if (stored === 'dark' || stored === 'light' || stored === 'blue') return stored
  } catch {}
  return 'dark'
}

function loadToolProtocol(): ToolProtocolSetting {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PROTOCOL)
    if (stored === 'xml' || stored === 'fc' || stored === 'auto') return stored
  } catch {}
  /** 桌面默认 auto：按模型能力自动选 FC/XML */
  return 'auto'
}

function loadPermissionMode(): PermissionModeSetting {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PERMISSION)
    if (stored === 'suggest' || stored === 'auto-edit' || stored === 'full-auto') return stored
  } catch {}
  return 'auto-edit'
}

function saveToolProtocol(p: ToolProtocolSetting) {
  try { localStorage.setItem(STORAGE_KEY_PROTOCOL, p) } catch {}
}

function savePermissionMode(m: PermissionModeSetting) {
  try { localStorage.setItem(STORAGE_KEY_PERMISSION, m) } catch {}
}

function saveLanguage(lang: Language) {
  try { localStorage.setItem(STORAGE_KEY_LANG, lang) } catch {}
}

function saveTheme(theme: Theme) {
  try { localStorage.setItem(STORAGE_KEY_THEME, theme) } catch {}
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

async function persistToJson(lang: Language, theme: Theme, toolProtocol?: ToolProtocolSetting, permissionMode?: PermissionModeSetting) {
  await configService.saveJSON(
    CONFIG_FILENAME,
    {
      language: lang,
      theme,
      toolProtocol: toolProtocol || loadToolProtocol(),
      permissionMode: permissionMode || loadPermissionMode(),
    },
    CONFIG_STORAGE_KEY,
  )
}

async function loadFromJson(): Promise<{ language: Language; theme: Theme; toolProtocol?: ToolProtocolSetting; permissionMode?: PermissionModeSetting } | null> {
  const data = await configService.loadJSON<{ language?: string; theme?: string; toolProtocol?: string; permissionMode?: string }>(CONFIG_FILENAME, CONFIG_STORAGE_KEY)
  if (data && data.language && data.theme) {
    if (data.language === 'zh' || data.language === 'en') {
      if (data.theme === 'dark' || data.theme === 'light' || data.theme === 'blue') {
        const proto = data.toolProtocol === 'xml' || data.toolProtocol === 'fc' || data.toolProtocol === 'auto'
          ? data.toolProtocol
          : undefined
        const perm = data.permissionMode === 'suggest' || data.permissionMode === 'auto-edit' || data.permissionMode === 'full-auto'
          ? data.permissionMode
          : undefined
        return {
          language: data.language,
          theme: data.theme,
          toolProtocol: proto,
          permissionMode: perm,
        }
      }
    }
  }
  return null
}

export const useSettingsStore = defineStore('settings', () => {
  const language = computed<Language>(() => i18n.global.locale.value as Language)

  const initialTheme = loadTheme()
  applyTheme(initialTheme)
  const theme = ref<Theme>(initialTheme)
  const toolProtocol = ref<ToolProtocolSetting>(loadToolProtocol())
  const permissionMode = ref<PermissionModeSetting>(loadPermissionMode())

  async function initFromJson() {
    const data = await loadFromJson()
    if (data) {
      if (data.language !== i18n.global.locale.value) {
        i18n.global.locale.value = data.language
        saveLanguage(data.language)
      }
      if (data.theme !== theme.value) {
        theme.value = data.theme
        applyTheme(data.theme)
        saveTheme(data.theme)
      }
      if (data.toolProtocol && data.toolProtocol !== toolProtocol.value) {
        toolProtocol.value = data.toolProtocol
        saveToolProtocol(data.toolProtocol)
      }
      if (data.permissionMode && data.permissionMode !== permissionMode.value) {
        permissionMode.value = data.permissionMode
        savePermissionMode(data.permissionMode)
      }
    } else {
      await persistToJson(language.value, theme.value, toolProtocol.value, permissionMode.value)
    }
  }

  function setLanguage(lang: Language) {
    i18n.global.locale.value = lang
    saveLanguage(lang)
    persistToJson(lang, theme.value, toolProtocol.value, permissionMode.value)
  }

  function setTheme(t: Theme) {
    theme.value = t
    applyTheme(t)
    saveTheme(t)
    persistToJson(language.value, t, toolProtocol.value, permissionMode.value)
  }

  function setToolProtocol(p: ToolProtocolSetting) {
    toolProtocol.value = p
    saveToolProtocol(p)
    persistToJson(language.value, theme.value, p, permissionMode.value)
  }

  function setPermissionMode(m: PermissionModeSetting) {
    permissionMode.value = m
    savePermissionMode(m)
    persistToJson(language.value, theme.value, toolProtocol.value, m)
  }

  return {
    language,
    theme,
    toolProtocol,
    permissionMode,
    setLanguage,
    setTheme,
    setToolProtocol,
    setPermissionMode,
    initFromJson,
  }
})
