import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
        headers: { Origin: "http://127.0.0.1:3000" },
      },
    },
  },
  build: {
    outDir: "dist",
    modulePreload: {
      // WebKit can retain failed preloaded modules across document reloads
      // (https://bugs.webkit.org/show_bug.cgi?id=270357). Let dynamic imports
      // fetch their JavaScript directly; keep CSS and initial HTML preloads.
      resolveDependencies: (_url, dependencies, { hostType }) =>
        hostType === "js"
          ? dependencies.filter((path) => path.endsWith(".css"))
          : dependencies,
    },
  },
});
