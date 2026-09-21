<template>
  <div class="git-panel">
    <div class="gp-header">
      <span v-if="!status?.isRepo" class="gp-muted">{{ t('git.notRepo') }}</span>
      <template v-else>
        <span class="gp-branch">{{ status.branch }}</span>
        <n-button size="tiny" quaternary :loading="loading" @click="refresh">{{ t('git.refresh') }}</n-button>
      </template>
    </div>

    <div v-if="status?.isRepo" class="gp-body">
      <div v-if="status.entries.length === 0" class="gp-muted">{{ t('git.clean') }}</div>
      <div
        v-for="e in status.entries"
        :key="e.path"
        class="gp-file"
        :class="{ selected: selectedPath === e.path }"
        @click="selectFile(e.path)"
      >
        <span class="gp-xy">{{ e.worktree }}{{ e.index }}</span>
        <span class="gp-path">{{ e.path }}</span>
      </div>

      <div v-if="selectedPath && diff" class="gp-diff">
        <pre>{{ diff }}</pre>
      </div>

      <div class="gp-commit">
        <n-input
          v-model:value="message"
          size="small"
          :placeholder="t('git.messagePlaceholder')"
          :disabled="committing || status.entries.length === 0"
        />
        <n-button
          size="small"
          type="primary"
          :loading="committing"
          :disabled="!message.trim() || status.entries.length === 0"
          @click="doCommit"
        >
          {{ t('git.commit') }}
        </n-button>
      </div>
    </div>
    <div v-if="error" class="gp-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NInput } from 'naive-ui';
import { createGitService, type GitStatusResult } from '../../services/gitService';

const props = defineProps<{
  root?: string;
}>();

const emit = defineEmits<{
  committed: [];
}>();

const { t } = useI18n();
const git = createGitService();
const status = ref<GitStatusResult | null>(null);
const loading = ref(false);
const committing = ref(false);
const message = ref('');
const selectedPath = ref<string | null>(null);
const diff = ref('');
const error = ref('');

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    status.value = await git.status(props.root);
    if (status.value?.error) error.value = status.value.error;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function selectFile(p: string) {
  selectedPath.value = p;
  diff.value = await git.diff(props.root, p);
}

async function doCommit() {
  if (!message.value.trim()) return;
  committing.value = true;
  error.value = '';
  try {
    const r = await git.commit(props.root, message.value.trim());
    if (!r.ok) {
      error.value = r.error || 'commit failed';
    } else {
      message.value = '';
      selectedPath.value = null;
      diff.value = '';
      await refresh();
      emit('committed');
    }
  } catch (e: any) {
    error.value = e.message;
  } finally {
    committing.value = false;
  }
}

onMounted(() => {
  void refresh();
});

defineExpose({ refresh });
</script>

<style scoped>
.git-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  font-size: 12px;
  max-height: 280px;
  overflow: auto;
}
.gp-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.gp-branch {
  font-weight: 600;
}
.gp-muted {
  color: var(--text-muted, #888);
}
.gp-file {
  display: flex;
  gap: 6px;
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 4px;
}
.gp-file:hover,
.gp-file.selected {
  background: var(--bg-hover, rgba(255, 255, 255, 0.06));
}
.gp-xy {
  font-family: monospace;
  min-width: 24px;
}
.gp-path {
  word-break: break-all;
}
.gp-diff {
  max-height: 240px;
  overflow: auto;
  background: var(--bg-secondary, #1e1e1e);
  border-radius: 4px;
  padding: 6px;
}
.gp-diff pre {
  margin: 0;
  font-size: 11px;
  white-space: pre-wrap;
}
.gp-commit {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.gp-error {
  color: var(--error-color, #e88080);
}
</style>
