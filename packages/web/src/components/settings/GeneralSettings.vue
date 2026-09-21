<template>
  <div class="general-settings">
    <n-form label-placement="top" size="small">
      <n-form-item :label="$t('settings.language')">
        <n-select
          :value="settings.language"
          :options="langOptions"
          @update:value="(v: Language) => settings.setLanguage(v)"
        />
      </n-form-item>
      <n-form-item :label="$t('settings.theme')">
        <n-select
          :value="settings.theme"
          :options="themeOptions"
          @update:value="(v: Theme) => settings.setTheme(v)"
        />
      </n-form-item>
      <n-form-item :label="$t('settings.toolProtocol')">
        <n-select
          :value="settings.toolProtocol"
          :options="protocolOptions"
          @update:value="(v: ToolProtocolSetting) => settings.setToolProtocol(v)"
        />
        <div class="hint">{{ $t('settings.toolProtocolHint') }}</div>
      </n-form-item>
      <n-form-item :label="$t('settings.permissionMode')">
        <n-select
          :value="settings.permissionMode"
          :options="permissionOptions"
          @update:value="(v: PermissionModeSetting) => settings.setPermissionMode(v)"
        />
        <div class="hint">{{ $t('settings.permissionModeHint') }}</div>
      </n-form-item>
    </n-form>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NForm, NFormItem, NSelect } from 'naive-ui'
import {
  useSettingsStore,
  type Language,
  type Theme,
  type ToolProtocolSetting,
  type PermissionModeSetting,
} from '../../stores/settings'

const { t } = useI18n()
const settings = useSettingsStore()

const langOptions = [
  { label: 'English', value: 'en' as Language },
  { label: '中文', value: 'zh' as Language },
]

const themeOptions = computed(() => [
  { label: t('theme.dark'), value: 'dark' as Theme },
  { label: t('theme.light'), value: 'light' as Theme },
  { label: t('theme.blue'), value: 'blue' as Theme },
])

const protocolOptions = computed(() => [
  { label: t('settings.protocolAuto'), value: 'auto' as ToolProtocolSetting },
  { label: t('settings.protocolFc'), value: 'fc' as ToolProtocolSetting },
  { label: t('settings.protocolXml'), value: 'xml' as ToolProtocolSetting },
])

const permissionOptions = computed(() => [
  { label: t('settings.permAutoEdit'), value: 'auto-edit' as PermissionModeSetting },
  { label: t('settings.permSuggest'), value: 'suggest' as PermissionModeSetting },
  { label: t('settings.permFullAuto'), value: 'full-auto' as PermissionModeSetting },
])
</script>

<style scoped>
.general-settings {
  padding: 8px 0;
}
.hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary, #888);
  line-height: 1.4;
}
</style>
