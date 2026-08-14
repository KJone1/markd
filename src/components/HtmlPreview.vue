<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

const props = defineProps<{
  path: string;
  reloadKey: number;
}>();

const frame = ref<HTMLIFrameElement>();
const previewUrl = ref("");
const frameVersion = ref(0);
const error = ref<string | null>(null);
let previewOrigin = "";
let expectedRuntimeToken: string | null = null;
let loadGeneration = 0;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let documentLoadTimer: ReturnType<typeof setTimeout> | null = null;
let awaitingScroll = false;
let restorePending = false;
let assignedLoadPending = false;
let runtimeDocumentLoaded = false;
let documentLoadFailure = false;
let pendingNavigationUrl: string | null = null;
let navigationInFlight = false;
let previewPort: MessagePort | null = null;
let savedScroll = { x: 0, y: 0 };

async function loadSelectedPath(): Promise<void> {
  const generation = ++loadGeneration;
  error.value = null;
  previewUrl.value = "";
  restorePending = false;
  assignedLoadPending = false;
  runtimeDocumentLoaded = false;
  documentLoadFailure = false;
  pendingNavigationUrl = null;
  closePreviewPort();
  savedScroll = { x: 0, y: 0 };
  clearDocumentLoadTimer();
  try {
    const document = await bindings.getHtmlPreviewUrl(props.path);
    if (generation !== loadGeneration) return;
    expectedRuntimeToken = document.runtimeToken;
    previewOrigin = new URL(document.url).origin;
    previewUrl.value = document.url;
    assignedLoadPending = true;
    frameVersion.value += 1;
  } catch {
    if (generation !== loadGeneration) return;
    previewOrigin = "";
    expectedRuntimeToken = null;
    error.value = `Markd could not load ${props.path}.`;
  }
}

function beginReload(): void {
  if (previewUrl.value === "") return;
  awaitingScroll = true;
  previewPort?.postMessage({
    markdHost: true,
    type: "capture-scroll",
  });
  clearReloadTimer();
  reloadTimer = setTimeout(finishReload, 50);
}

function finishReload(): void {
  clearReloadTimer();
  awaitingScroll = false;
  restorePending = true;
  void loadReloadedPath();
}

async function loadReloadedPath(): Promise<void> {
  const generation = ++loadGeneration;
  try {
    const document = await bindings.getHtmlPreviewUrl(props.path);
    if (generation !== loadGeneration) return;
    expectedRuntimeToken = document.runtimeToken;
    previewOrigin = new URL(document.url).origin;
    previewUrl.value = document.url;
    assignedLoadPending = true;
    runtimeDocumentLoaded = false;
    documentLoadFailure = false;
    frameVersion.value += 1;
  } catch {
    if (generation !== loadGeneration) return;
    restorePending = false;
    error.value = `Markd could not load ${props.path}.`;
  }
}

function handleFrameLoad(): void {
  clearDocumentLoadTimer();
  if (assignedLoadPending) {
    assignedLoadPending = false;
    if (runtimeDocumentLoaded) return;
  } else {
    runtimeDocumentLoaded = false;
    closePreviewPort();
  }
  documentLoadTimer = setTimeout(() => {
    closePreviewPort();
    documentLoadFailure = true;
    error.value = `Markd could not load ${props.path}.`;
  }, 500);
}

function handlePreviewConnect(event: MessageEvent): void {
  if (
    event.source !== frame.value?.contentWindow || event.origin !== previewOrigin ||
    event.data?.markdPreview !== true
  ) {
    return;
  }
  if (
    event.data.type === "workspace-navigation" &&
    typeof event.data.url === "string"
  ) {
    queuePreviewNavigation(event.data.url);
    return;
  }
  if (
    event.data.type !== "connect" ||
    expectedRuntimeToken === null || event.data.token !== expectedRuntimeToken ||
    event.ports.length !== 1
  ) {
    return;
  }
  expectedRuntimeToken = null;
  closePreviewPort();
  previewPort = event.ports[0];
  previewPort.onmessage = handleRuntimeMessage;
  previewPort.start();
}

function handleFrameError(): void {
  documentLoadFailure = true;
  error.value = `Markd could not load ${props.path}.`;
}

function handleRuntimeMessage(event: MessageEvent): void {
  if (event.data?.type === "document-loaded") {
    runtimeDocumentLoaded = true;
    clearDocumentLoadTimer();
    if (documentLoadFailure) {
      documentLoadFailure = false;
      error.value = null;
    }
    return;
  }
  if (event.data?.type === "runtime-ready") {
    error.value = null;
    if (restorePending) {
      restorePending = false;
      previewPort?.postMessage({
        markdHost: true,
        type: "restore-scroll",
        ...savedScroll,
      });
    }
    return;
  }
  if (event.data.type === "scroll" && awaitingScroll) {
    savedScroll = {
      x: Number(event.data.x) || 0,
      y: Number(event.data.y) || 0,
    };
    finishReload();
    return;
  }
  if (event.data.type === "error") {
    error.value = typeof event.data.message === "string" && event.data.message
      ? event.data.message
      : "The preview reported an error.";
    return;
  }
  if (
    event.data.type === "external-link" &&
    typeof event.data.url === "string"
  ) {
    void bindings.openExternalUrl(event.data.url).catch(() => {
      error.value = "Markd could not open the external link.";
    });
    return;
  }
  if (event.data.type === "workspace-link" && typeof event.data.url === "string") {
    queuePreviewNavigation(event.data.url);
  }
}

function queuePreviewNavigation(url: string): void {
  pendingNavigationUrl = url;
  if (!navigationInFlight) void drainPreviewNavigation();
}

async function drainPreviewNavigation(): Promise<void> {
  navigationInFlight = true;
  try {
    while (pendingNavigationUrl !== null) {
      const url = pendingNavigationUrl;
      pendingNavigationUrl = null;
      await navigateWithinPreview(url);
    }
  } finally {
    navigationInFlight = false;
    if (pendingNavigationUrl !== null) void drainPreviewNavigation();
  }
}

async function navigateWithinPreview(url: string): Promise<void> {
  let target: URL;
  let path: string;
  try {
    target = new URL(url);
    if (target.origin !== previewOrigin) return;
    const segments = target.pathname.slice(1).split("/");
    if (!target.pathname.startsWith("/") || segments.some((part) => !part)) {
      return;
    }
    path = segments.map((segment) =>
      decodeURIComponent(segment)
    ).join("/");
  } catch {
    return;
  }
  const generation = ++loadGeneration;
  try {
    const document = await bindings.getHtmlPreviewUrl(path, target.search);
    if (generation !== loadGeneration) return;
    if (pendingNavigationUrl !== null) return;
    expectedRuntimeToken = document.runtimeToken;
    previewOrigin = new URL(document.url).origin;
    previewUrl.value = `${document.url}${target.hash}`;
    assignedLoadPending = true;
    runtimeDocumentLoaded = false;
    documentLoadFailure = false;
    restorePending = false;
    frameVersion.value += 1;
  } catch {
    if (generation !== loadGeneration) return;
    error.value = "Markd could not open that preview link.";
  }
}

function closePreviewPort(): void {
  previewPort?.close();
  previewPort = null;
}

function clearReloadTimer(): void {
  if (reloadTimer === null) return;
  clearTimeout(reloadTimer);
  reloadTimer = null;
}

function clearDocumentLoadTimer(): void {
  if (documentLoadTimer === null) return;
  clearTimeout(documentLoadTimer);
  documentLoadTimer = null;
}

watch(() => props.path, () => void loadSelectedPath());
watch(() => props.reloadKey, beginReload);

onMounted(async () => {
  window.addEventListener("message", handlePreviewConnect);
  await nextTick();
  await loadSelectedPath();
});

onBeforeUnmount(() => {
  loadGeneration += 1;
  clearReloadTimer();
  clearDocumentLoadTimer();
  closePreviewPort();
  window.removeEventListener("message", handlePreviewConnect);
});
</script>

<template>
  <section class="html-preview" aria-label="HTML preview">
    <iframe
      v-if="previewUrl"
      :key="frameVersion"
      ref="frame"
      class="html-preview-frame"
      :src="previewUrl"
      :title="`Previewing ${path}`"
      sandbox="allow-forms allow-modals allow-same-origin allow-scripts"
      referrerpolicy="no-referrer"
      @load="handleFrameLoad"
      @error="handleFrameError"
    />
    <div v-else class="html-preview-loading" role="status">
      Loading preview
    </div>
    <div v-if="error" class="html-preview-error" role="alert">
      <span class="html-preview-error-icon" aria-hidden="true">!</span>
      <span>{{ error }}</span>
    </div>
  </section>
</template>
