import { computed } from 'vue'
import { darkTheme, lightTheme } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'
import { useSettingsStore } from '../stores/settings'

/**
 * Naive UI 全局主题映射。
 *
 * 重要：此文件中的颜色值必须与 App.vue 中同名的 Design Token 保持一致。
 * 由于 Naive UI 的 themeOverrides 是 JS 对象，无法直接读取 CSS Variable，
 * 因此这里维护一份集中映射；修改颜色时请同步修改 App.vue 的对应 Token。
 */

const DARK_OVERRIDES: GlobalThemeOverrides = {
  common: {
    primaryColor: '#6ea8fe',
    primaryColorHover: '#8db8ff',
    primaryColorPressed: '#5b8fd9',
    primaryColorSuppl: '#5b8fd9',
    bodyColor: '#101319',
    cardColor: '#1e232b',
    modalColor: '#1e232b',
    popoverColor: '#1e232b',
    inputColor: '#181c22',
    borderColor: 'rgba(255, 255, 255, 0.10)',
    dividerColor: 'rgba(255, 255, 255, 0.06)',
    textColor1: 'rgba(255, 255, 255, 0.92)',
    textColor2: 'rgba(255, 255, 255, 0.64)',
    textColor3: 'rgba(255, 255, 255, 0.40)',
    borderRadius: '8px',
    fontSize: '13px',
    scrollbarColor: 'rgba(255, 255, 255, 0.12)',
    scrollbarColorHover: 'rgba(255, 255, 255, 0.24)',
  },
}

const LIGHT_OVERRIDES: GlobalThemeOverrides = {
  common: {
    primaryColor: '#3b82f6',
    primaryColorHover: '#60a5fa',
    primaryColorPressed: '#2563eb',
    primaryColorSuppl: '#93c5fd',
    bodyColor: '#f6f7f9',
    cardColor: '#ffffff',
    modalColor: '#ffffff',
    popoverColor: '#ffffff',
    inputColor: '#fbfbfc',
    borderColor: 'rgba(0, 0, 0, 0.10)',
    dividerColor: 'rgba(0, 0, 0, 0.06)',
    textColor1: 'rgba(0, 0, 0, 0.88)',
    textColor2: 'rgba(0, 0, 0, 0.58)',
    textColor3: 'rgba(0, 0, 0, 0.34)',
    borderRadius: '8px',
    fontSize: '13px',
    scrollbarColor: 'rgba(0, 0, 0, 0.12)',
    scrollbarColorHover: 'rgba(0, 0, 0, 0.24)',
  },
}

const BLUE_OVERRIDES: GlobalThemeOverrides = {
  common: {
    primaryColor: '#6ea8fe',
    primaryColorHover: '#8db8ff',
    primaryColorPressed: '#5b8fd9',
    primaryColorSuppl: '#5b8fd9',
    bodyColor: '#0a1628',
    cardColor: '#192f4d',
    modalColor: '#192f4d',
    popoverColor: '#192f4d',
    inputColor: '#12243e',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    dividerColor: 'rgba(255, 255, 255, 0.08)',
    textColor1: 'rgba(255, 255, 255, 0.94)',
    textColor2: 'rgba(255, 255, 255, 0.68)',
    textColor3: 'rgba(255, 255, 255, 0.42)',
    borderRadius: '8px',
    fontSize: '13px',
    scrollbarColor: 'rgba(255, 255, 255, 0.12)',
    scrollbarColorHover: 'rgba(255, 255, 255, 0.24)',
  },
}

export function useNaiveTheme() {
  const settings = useSettingsStore()

  const naiveTheme = computed(() => {
    if (settings.theme === 'dark') return darkTheme
    if (settings.theme === 'blue') return darkTheme
    return lightTheme
  })

  const themeOverrides = computed<GlobalThemeOverrides | undefined>(() => {
    if (settings.theme === 'dark') return DARK_OVERRIDES
    if (settings.theme === 'light') return LIGHT_OVERRIDES
    return BLUE_OVERRIDES
  })

  return { naiveTheme, themeOverrides }
}
