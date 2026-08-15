<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as monaco from "monaco-editor";
import { monacoLanguageForPath } from "../editor_language.ts";

const props = defineProps<{
  path: string;
  content: string;
}>();
const emit = defineEmits<{
  change: [content: string];
}>();

const host = ref<HTMLElement>();
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let changeSubscription: monaco.IDisposable | null = null;
let applyingExternalChange = false;

onMounted(() => {
  if (host.value === undefined) return;
  editor = monaco.editor.create(host.value, {
    value: props.content,
    language: monacoLanguageForPath(props.path),
    automaticLayout: true,
    fontFamily: "JetBrains Mono, ui-monospace, monospace",
    fontSize: 14,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: "on",
  });
  changeSubscription = editor.onDidChangeModelContent(() => {
    if (!applyingExternalChange) emit("change", editor!.getValue());
  });
  // Monaco measures character width on create, before the webfont has
  // swapped in - without this the cursor sits off the glyphs.
  document.fonts?.ready.then(() => {
    if (editor !== null) monaco.editor.remeasureFonts();
  });
});

watch(() => props.content, (content) => {
  if (editor === null || editor.getValue() === content) return;
  applyingExternalChange = true;
  editor.setValue(content);
  applyingExternalChange = false;
});

watch(() => props.path, (path) => {
  const model = editor?.getModel();
  if (model !== null && model !== undefined) {
    monaco.editor.setModelLanguage(model, monacoLanguageForPath(path));
  }
});

onBeforeUnmount(() => {
  changeSubscription?.dispose();
  editor?.dispose();
});
</script>

<template>
  <div
    ref="host"
    class="code-editor"
    :aria-label="`Editing ${path}`"
  />
</template>
