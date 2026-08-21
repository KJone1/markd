import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
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
