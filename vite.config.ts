import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // monaco-editor/esm/vs/basic-languages/* and vs/language/* are
          // already lazily code-split by Monaco's own internal dynamic
          // imports (one small chunk per language) - leave those alone.
          // Only vs/base, vs/platform, and vs/editor/{common,browser,
          // contrib,standalone} are pulled in eagerly by
          // `import * as monaco from "monaco-editor"` and collapse into
          // one monolithic chunk by default, so split just those further.
          // vs/base/browser/ui and vs/editor/browser/widget are large
          // enough on their own to need one extra level of splitting.
          const deep = id.match(
            /\/monaco-editor\/esm\/(vs\/base\/browser\/ui\/[^/]+\/|vs\/editor\/browser\/widget\/[^/]+\/)/,
          );
          if (deep) {
            return `monaco-${deep[1].split("/").filter(Boolean).join("-")}`;
          }
          const match = id.match(
            /\/monaco-editor\/esm\/(vs\/(?:base|platform|editor\/(?:common|browser|contrib|standalone))\/[^/]+\/)/,
          );
          if (match) {
            const segments = match[1].split("/").filter(Boolean);
            return `monaco-${segments.join("-")}`;
          }

          // MarkdownEditor.vue's Crepe editor pulls in several large,
          // independent vendor trees (KaTeX for math, CodeMirror for code
          // blocks, ProseMirror + Milkdown for the document model). They
          // are all reachable only from that one async component boundary,
          // so by default Rollup folds them into a single chunk. Splitting
          // by vendor package name doesn't change what is loaded - it's
          // still the same code, just organized into more files.
          // @milkdown/components alone bundles several independent block
          // components (code-block, table-block, image-block, ...) into
          // one package; split it one level further too.
          const components = id.match(
            /\/node_modules\/@milkdown\/components\/lib\/([a-z0-9-]+)\//,
          );
          if (components) return `vendor-milkdown-components-${components[1]}`;

          const vendor = id.match(
            /\/node_modules\/(fuzzysort|katex|codemirror|prosemirror-[a-z-]+|@codemirror\/[a-z0-9-]+|@milkdown\/[a-z0-9-]+|@ark-ui\/[a-z0-9-]+|@zag-js\/[a-z0-9-]+|@internationalized\/[a-z0-9-]+)\//,
          );
          if (vendor) {
            return `vendor-${vendor[1].replace(/^@/, "").replace(/\//g, "-")}`;
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    // @ark-ui/vue must share the app's Vue instance; externalized it loads
    // a second @vue/runtime-core copy and renderSlot crashes.
    server: {
      deps: {
        inline: [/@ark-ui\//, /@zag-js\//, /@internationalized\//],
      },
    },
  },
});
