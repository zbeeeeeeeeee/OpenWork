<template>
  <div class="chat-footer">
    <n-space align="center" :size="6">
      <ProviderSelect
        :providers="providers"
        :activeId="activeProviderId"
        @select="$emit('select-provider', $event)"
      />
      <n-button text size="tiny" @click="$emit('open-settings')" :title="t('agent.providerSettings')">
        &#9881;
      </n-button>
      <n-button
        text
        size="tiny"
        :disabled="!canUndo"
        :loading="undoing"
        :title="t('agent.undoAgentWrite')"
        @click="$emit('undo-write')"
      >
        &#8630; {{ t('agent.undo') }}
      </n-button>
      <n-select
        :value="settings.permissionMode"
        :options="permissionOptions"
        size="tiny"
        style="width: 120px"
        :title="t('settings.permissionModeHint')"
        @update:value="(v: PermissionModeSetting) => settings.setPermissionMode(v)"
      />
    </n-space>
    <ModeSelector v-model="modeModel" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace, NSelect } from 'naive-ui';
import ProviderSelect from '../ProviderSelect.vue';
import ModeSelector from '../ModeSelector.vue';
import type { ProviderConfig } from '../../../composables/useLLMSettings';
import { useSettingsStore, type PermissionModeSetting } from '../../../stores/settings';

const props = defineProps<{
  providers: ProviderConfig[];
  activeProviderId: string | null;
  currentMode: string;
  canUndo?: boolean;
  undoing?: boolean;
}>();

const emit = defineEmits<{
  'select-provider': [id: string];
  'update:currentMode': [mode: string];
  'open-settings': [];
  'undo-write': [];
}>();

const settings = useSettingsStore();
const { t } = useI18n();

const permissionOptions = computed(() => [
  { label: t('settings.permSuggest'), value: 'suggest' as PermissionModeSetting },
  { label: t('settings.permAutoEdit'), value: 'auto-edit' as PermissionModeSetting },
  { label: t('settings.permFullAuto'), value: 'full-auto' as PermissionModeSetting },
]);

const modeModel = computed({
  get: () => props.currentMode as 'build' | 'plan',
  set: (val) => emit('update:currentMode', val),
});
</script>

<style scoped>
.chat-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}
</style>
