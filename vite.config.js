import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: "public",
  resolve: {
    // Photo-Sphere-Viewer requires a single shared instance of three.
    dedupe: ["three"],
  },
  server: {
    host: "0.0.0.0",
    port: 8084,
  },
  build: {
    outDir: "build",
    emptyOutDir: true,
    target: ["chrome87", "firefox78", "safari13.1", "edge88"],
  },
});
