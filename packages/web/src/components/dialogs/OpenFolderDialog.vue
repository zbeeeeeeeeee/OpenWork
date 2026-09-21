<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    class="folder-picker-modal"
    style="width: 720px; height: 540px; max-width: calc(100vw - 48px); min-width: 560px; max-height: 80vh; min-height: 0;"
    @after-leave="$emit('cancel')"
  >
    <template #header>
      <div class="picker-header">
        <div class="picker-title">{{ $t('openDialog.selectFolder') }}</div>
        <div class="picker-subtitle">{{ $t('openDialog.selectFolderSubtitle') }}</div>
      </div>
    </template>

    <div class="folder-picker">
      <div class="path-bar">
        <div v-if="!editingPath" class="path-breadcrumbs">
          <template v-for="(crumb, index) in displayBreadcrumbs" :key="crumb.path">
            <span v-if="index > 0" class="breadcrumb-sep">/</span>
            <button
              class="breadcrumb"
              :class="{ current: index === displayBreadcrumbs.length - 1 }"
              @click="navigateToPath(crumb.path)"
            >
              {{ crumb.name || crumb.path }}
            </button>
          </template>
        </div>
        <input
          v-else
          ref="pathInputRef"
          v-model="pathInput"
          class="path-editor"
          type="text"
          :placeholder="$t('openDialog.pathPlaceholder')"
          @keydown.enter.prevent="submitPath"
          @keydown.esc.prevent="cancelEditPath"
        />
        <button v-if="!editingPath" class="path-edit-btn" :title="$t('openDialog.editPath')" @click="beginEditPath">
          <n-icon size="14" :component="PencilOutline" />
        </button>
      </div>

      <div v-if="error" class="picker-error">{{ error }}</div>

      <div class="browser-surface">
        <div v-if="drives.length > 0" class="drive-sidebar">
          <div class="drive-header">{{ $t('openDialog.drives') }}</div>
          <button
            v-for="drive in drives"
            :key="drive.path"
            class="drive-row"
            :class="{ active: activeDrive === drive.path }"
            @click="selectDrive(drive.path)"
          >
            <n-icon size="16" :component="ServerOutline" />
            <span class="drive-name">{{ drive.name }}</span>
          </button>
        </div>
        <div v-if="drives.length > 0" class="column-divider"></div>
        <div class="column">
          <div class="column-header">
            <span class="column-title">{{ currentFolderName }}</span>
            <span class="column-subtitle">{{ $t('openDialog.currentDirectoryLabel') }}</span>
          </div>
          <div class="column-list">
            <n-spin v-if="currentLoading && currentEntries.length === 0" size="small" class="column-state" />
            <template v-else>
              <button
                v-for="entry in visibleCurrentEntries"
                :key="entry.path"
                class="dir-row"
                :class="{ selected: selectedPath === entry.path }"
                @click="selectCurrent(entry)"
              >
                <n-icon size="16" :component="selectedPath === entry.path ? FolderOpenOutline : FolderOutline" />
                <span class="dir-name">{{ entry.name }}</span>
                <n-icon size="14" class="dir-chevron" :component="ChevronForwardOutline" />
              </button>
              <div v-if="!currentLoading && visibleCurrentEntries.length === 0" class="column-state">
                {{ currentPath ? $t('openDialog.emptyFolder') : $t('openDialog.loading') }}
              </div>
            </template>
          </div>
          <div v-if="truncated" class="truncated-hint">{{ $t('openDialog.truncated') }}</div>
        </div>

        <div v-if="selectedPath" class="column-divider"></div>

        <div v-if="selectedPath" class="column">
          <div class="column-header">
            <span class="column-title">{{ selectedFolderName }}</span>
            <span class="column-subtitle">{{ $t('openDialog.selectedDirectoryLabel') }}</span>
          </div>
          <div class="column-list">
            <n-spin v-if="childLoading && childEntries.length === 0" size="small" class="column-state" />
            <template v-else>
              <button
                v-for="entry in visibleChildEntries"
                :key="entry.path"
                class="dir-row"
                @click="selectChild(entry)"
              >
                <n-icon size="16" :component="FolderOutline" />
                <span class="dir-name">{{ entry.name }}</span>
                <n-icon size="14" class="dir-chevron" :component="ChevronForwardOutline" />
              </button>
              <div v-if="childError" class="column-state">{{ childError }}</div>
              <div v-else-if="!childLoading && visibleChildEntries.length === 0" class="column-state">
                {{ $t('openDialog.emptyFolder') }}
              </div>
            </template>
          </div>
          <div v-if="childTruncated" class="truncated-hint">{{ $t('openDialog.truncated') }}</div>
        </div>
      </div>

      <div class="picker-footer">
        <div class="footer-actions">
          <button class="footer-btn" :disabled="!selectedPath && !currentPath" @click="openNewFolderDialog">
            <n-icon size="14" :component="CreateOutline" />
            <span>{{ $t('openDialog.newFolder') }}</span>
          </button>
          <button class="footer-btn" @click="showHidden = !showHidden">
            <n-icon size="14" :component="showHidden ? EyeOutline : EyeOffOutline" />
            <span>{{ $t('openDialog.showHidden') }}</span>
          </button>
        </div>
        <div class="footer-decisions">
          <button class="btn-cancel" @click="$emit('cancel')">{{ $t('openDialog.cancel') }}</button>
          <button class="btn-open" :disabled="!selectedPath && !currentPath" @click="confirm">
            {{ $t('openDialog.open') }}
          </button>
        </div>
      </div>
    </div>

    <n-modal
      v-model:show="newFolderVisible"
      preset="card"
      :title="$t('openDialog.newFolderTitle')"
      style="width: 400px"
    >
      <n-text depth="3">{{ newFolderParent }}</n-text>
      <n-input
        ref="newFolderInputRef"
        v-model:value="newFolderName"
        :placeholder="$t('openDialog.folderName')"
        :status="newFolderError ? 'error' : undefined"
        @keydown.enter.prevent="submitNewFolder"
        @keydown.esc.prevent="cancelNewFolder"
        @input="newFolderError = ''"
      />
      <div v-if="newFolderError" class="new-folder-error">{{ newFolderError }}</div>
      <template #footer>
        <n-button size="small" :disabled="creating" @click="cancelNewFolder">{{ $t('openDialog.cancel') }}</n-button>
        <n-button size="small" type="primary" :loading="creating" :disabled="!newFolderName.trim()" @click="submitNewFolder">
          {{ $t('openDialog.create') }}
        </n-button>
      </template>
    </n-modal>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NIcon, NInput, NModal, NSpin, NText } from 'naive-ui';
import {
  ChevronForwardOutline,
  CreateOutline,
  EyeOffOutline,
  EyeOutline,
  FolderOpenOutline,
  FolderOutline,
  PencilOutline,
  ServerOutline,
} from '@vicons/ionicons5';
import {
  createFileServiceClient,
  type DirectoryEntry,
  type FileServiceClient,
} from '../../services/fileService';
import { useEditorStore } from '../../stores/editor';

const { t } = useI18n();

const emit = defineEmits<{
  confirm: [rootPath: string];
  cancel: [];
}>();

const client: FileServiceClient = createFileServiceClient();

const showModal = ref(true);
const currentPath = ref<string | null>(null);
const selectedPath = ref<string | null>(null);
const currentEntries = ref<DirectoryEntry[]>([]);
const childEntries = ref<DirectoryEntry[]>([]);
const breadcrumbs = ref<DirectoryEntry[]>([]);
const childBreadcrumbs = ref<DirectoryEntry[]>([]);
const currentLoading = ref(false);
const childLoading = ref(false);
const error = ref('');
const childError = ref('');
const truncated = ref(false);
const childTruncated = ref(false);
const showHidden = ref(false);
const editingPath = ref(false);
const pathInput = ref('');
const pathInputRef = ref<HTMLInputElement | null>(null);

// 盘符栏
const drives = ref<DirectoryEntry[]>([]);
const activeDrive = ref<string | null>(null);

const newFolderVisible = ref(false);
const newFolderParent = ref<string | null>(null);
const newFolderName = ref('');
const newFolderError = ref('');
const newFolderInputRef = ref<{ focus: () => void } | null>(null);
const creating = ref(false);

let currentNavRequest = 0;
let childNavRequest = 0;

const visibleCurrentEntries = computed(() => filterHidden(currentEntries.value));
const visibleChildEntries = computed(() => filterHidden(childEntries.value));
const displayBreadcrumbs = computed(() => {
  if (breadcrumbs.value.length > 0) return breadcrumbs.value;
  const fallbackPath = selectedPath.value || currentPath.value;
  if (!fallbackPath) return [];
  return [{ name: fallbackPath, path: fallbackPath, isDirectory: true }];
});

const currentFolderName = computed(() => {
  if (breadcrumbs.value.length > 0) {
    const last = breadcrumbs.value[breadcrumbs.value.length - 1];
    if (last && (last.name || last.path)) return last.name || last.path;
  }
  return currentPath.value || '';
});

const selectedFolderName = computed(() => {
  if (childBreadcrumbs.value.length > 0) {
    const last = childBreadcrumbs.value[childBreadcrumbs.value.length - 1];
    if (last && (last.name || last.path)) return last.name || last.path;
  }
  const path = selectedPath.value || '';
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
});

function filterHidden(entries: DirectoryEntry[]): DirectoryEntry[] {
  if (showHidden.value) return entries;
  return entries.filter((entry) => !entry.hidden);
}

/** 从路径提取所属盘符/根 */
function getDriveOf(p: string): string {
  const norm = (p || '').replace(/\\/g, '/');
  if (!norm) return '';
  if (norm.startsWith('/')) return '/';
  return norm.split('/')[0] + '/';
}

/** 加载可用盘符列表 */
async function loadDrives() {
  try {
    const roots = await client.getWorkspaceRoots();
    drives.value = roots
      .filter((r) => r.isDirectory)
      .map((r) => ({
        name: r.path === '/' ? '/' : r.path.replace(/\/$/, ''),
        path: r.path,
        isDirectory: true as const,
      }));
  } catch {
    drives.value = [];
  }
}

function selectDrive(drivePath: string) {
  activeDrive.value = drivePath;
  void loadCurrent(drivePath);
}

async function loadCurrent(path?: string) {
  const requestId = ++currentNavRequest;
  childNavRequest++;
  currentLoading.value = true;
  error.value = '';
  try {
    const result = await client.listDirectories?.(path);
    if (!result || requestId !== currentNavRequest) return;
    currentPath.value = result.path;
    currentEntries.value = result.entries;
    breadcrumbs.value = result.breadcrumbs;
    truncated.value = result.truncated;
    selectedPath.value = null;
    childEntries.value = [];
    childBreadcrumbs.value = [];
    childTruncated.value = false;
    childError.value = '';
    editingPath.value = false;
    pathInput.value = result.path;
    activeDrive.value = getDriveOf(result.path) || activeDrive.value;
  } catch (err) {
    if (requestId !== currentNavRequest) return;
    error.value = err instanceof Error ? err.message : t('openDialog.permissionDenied');
  } finally {
    if (requestId === currentNavRequest) currentLoading.value = false;
  }
}

async function loadChild(path: string) {
  const requestId = ++childNavRequest;
  childLoading.value = true;
  childError.value = '';
  try {
    const result = await client.listDirectories?.(path);
    if (!result || requestId !== childNavRequest) return;
    if (selectedPath.value !== path) return;
    childEntries.value = result.entries;
    childBreadcrumbs.value = result.breadcrumbs;
    childTruncated.value = result.truncated;
  } catch (err) {
    if (requestId !== childNavRequest) return;
    childError.value = err instanceof Error ? err.message : t('openDialog.permissionDenied');
  } finally {
    if (requestId === childNavRequest) childLoading.value = false;
  }
}

function selectCurrent(entry: DirectoryEntry) {
  selectedPath.value = entry.path;
  void loadChild(entry.path);
}

function selectChild(entry: DirectoryEntry) {
  if (!selectedPath.value) return;
  currentPath.value = selectedPath.value;
  currentEntries.value = childEntries.value;
  breadcrumbs.value = childBreadcrumbs.value;
  truncated.value = childTruncated.value;
  selectedPath.value = entry.path;
  void loadChild(entry.path);
}

function navigateToPath(path: string) {
  if (!path) return;
  editingPath.value = false;
  void loadCurrent(path);
}

function beginEditPath() {
  pathInput.value = currentPath.value || selectedPath.value || '';
  editingPath.value = true;
  nextTick(() => pathInputRef.value?.focus());
}

function submitPath() {
  const input = pathInput.value.trim();
  if (!input) return;
  activeDrive.value = getDriveOf(input) || activeDrive.value;
  void loadCurrent(input);
}

function cancelEditPath() {
  editingPath.value = false;
  pathInput.value = currentPath.value || '';
}

function openNewFolderDialog() {
  const parent = selectedPath.value || currentPath.value;
  if (!parent) return;
  newFolderParent.value = parent;
  newFolderName.value = '';
  newFolderError.value = '';
  newFolderVisible.value = true;
  nextTick(() => newFolderInputRef.value?.focus());
}

function validateNewFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return t('openDialog.emptyFolderName');
  if (trimmed === '.' || trimmed === '..') return t('openDialog.invalidFolderName');
  if (trimmed.includes('/') || trimmed.includes('\\')) return t('openDialog.invalidFolderName');
  return null;
}

async function submitNewFolder() {
  const name = newFolderName.value.trim();
  const validationError = validateNewFolderName(name);
  if (validationError) {
    newFolderError.value = validationError;
    return;
  }
  const parent = newFolderParent.value;
  if (!parent) return;

  creating.value = true;
  newFolderError.value = '';
  try {
    const entry = await client.createDirectory?.(parent, name);
    if (!entry) throw new Error(t('openDialog.createFolderFailed'));
    newFolderVisible.value = false;

    if (parent === currentPath.value) {
      await loadCurrent(parent);
      selectedPath.value = entry.path;
      await loadChild(entry.path);
    } else if (parent === selectedPath.value) {
      const parentPath = parent;
      await loadChild(parentPath);
      currentPath.value = parentPath;
      currentEntries.value = childEntries.value;
      breadcrumbs.value = childBreadcrumbs.value;
      truncated.value = childTruncated.value;
      selectedPath.value = entry.path;
      await loadChild(entry.path);
    }
  } catch (err) {
    newFolderError.value = err instanceof Error ? err.message : t('openDialog.createFolderFailed');
  } finally {
    creating.value = false;
  }
}

function cancelNewFolder() {
  newFolderVisible.value = false;
  newFolderName.value = '';
  newFolderError.value = '';
}

function confirm() {
  const path = selectedPath.value || currentPath.value;
  if (path) emit('confirm', path);
}

onMounted(() => {
  void loadDrives();
  try {
    const store = useEditorStore();
    const lastRoot = store.workspaceRoots[0]?.path;
    void loadCurrent(lastRoot || undefined);
  } catch {
    void loadCurrent();
  }
});
</script>

<style scoped>
.folder-picker {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.picker-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.picker-title {
  font-size: 17px;
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  line-height: 1.3;
}

.picker-subtitle {
  font-size: var(--font-sm);
  color: var(--text-muted);
  line-height: 1.4;
}

.path-bar {
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 0 var(--space-1) 0 var(--space-3);
}

.path-breadcrumbs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;
}

.breadcrumb {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--font-sm);
  padding: var(--space-1) var(--space-1);
  border-radius: var(--radius-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.breadcrumb:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}

.breadcrumb.current {
  color: var(--text-primary);
  font-weight: var(--weight-medium);
}

.breadcrumb-sep {
  color: var(--text-disabled);
  font-size: var(--font-xs);
  user-select: none;
  flex-shrink: 0;
}

.path-edit-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex-shrink: 0;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.path-edit-btn:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}

.path-edit-btn:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}

.path-editor {
  flex: 1;
  min-width: 0;
  height: 100%;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: var(--font-sm);
  padding: 0 var(--space-2);
  outline: none;
}

.path-editor:focus {
  border-radius: var(--radius-md);
  box-shadow: 0 0 0 1px var(--accent);
}

.picker-error {
  font-size: var(--font-sm);
  color: var(--danger);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
}

.browser-surface {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.drive-sidebar {
  width: 80px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
  overflow-y: auto;
}

.drive-header {
  padding: var(--space-2);
  font-size: var(--font-xs);
  color: var(--text-muted);
  text-align: center;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.drive-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--space-2) var(--space-1);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-xs);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.drive-row:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.drive-row.active {
  background: var(--surface-selected);
  color: var(--text-primary);
  font-weight: var(--weight-medium);
}

.drive-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 72px;
}

.column {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.column-divider {
  width: 1px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

.column-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  min-width: 0;
}

.column-title {
  font-size: var(--font-sm);
  color: var(--text-primary);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.column-subtitle {
  font-size: var(--font-xs);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.column-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-2) var(--space-1);
}

.dir-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 36px;
  padding: 0 var(--space-3);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-base);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.dir-row:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.dir-row.selected {
  background: var(--surface-selected);
  color: var(--text-primary);
  font-weight: var(--weight-medium);
  box-shadow: inset 2px 0 0 var(--text-primary);
}

.dir-name {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dir-chevron {
  color: var(--text-muted);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.dir-row:hover .dir-chevron,
.dir-row.selected .dir-chevron {
  opacity: 0.8;
}

.column-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 120px;
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.truncated-hint {
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-xs);
  color: var(--text-muted);
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.picker-footer {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.footer-decisions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.footer-btn {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: 32px;
  padding: 0 var(--space-3);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.footer-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.footer-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.btn-cancel,
.btn-open {
  height: 32px;
  padding: 0 var(--space-3);
  border: none;
  font-size: var(--font-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast), opacity var(--transition-fast);
}

.btn-cancel {
  background: transparent;
  color: var(--text-secondary);
}

.btn-cancel:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.btn-open {
  background: var(--text-primary);
  color: var(--app-bg);
  font-weight: var(--weight-medium);
}

.btn-open:hover:not(:disabled) {
  opacity: 0.86;
}

.btn-open:disabled {
  opacity: 0.4;
  cursor: default;
}

.new-folder-error {
  color: var(--danger);
  font-size: var(--font-sm);
  margin-top: var(--space-2);
}
</style>




<style>
.folder-picker-modal.n-card {
  background: var(--surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
}

.folder-picker-modal .n-card-header {
  padding: var(--space-4) var(--space-5) var(--space-3);
  border-bottom: none;
  flex-shrink: 0;
}

.folder-picker-modal .n-card-header__main {
  font-size: 17px;
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

.folder-picker-modal .n-card-header__close {
  color: var(--text-muted);
}

.folder-picker-modal .n-card-header__close:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
  border-radius: var(--radius-sm);
}

.folder-picker-modal .n-card-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--space-2) var(--space-5) var(--space-4);
}
</style>

