import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const functionsMetadataPath = resolve(import.meta.dirname, "src/functions/functions.json");

export default defineConfig({
  root: resolve(import.meta.dirname, "src/taskpane"),
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "sheetdot-custom-functions-metadata",
      configureServer(server) {
        server.middlewares.use("/functions.json", (_req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.end(readFileSync(functionsMetadataPath, "utf8"));
        });
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "functions.json",
          source: readFileSync(functionsMetadataPath, "utf8"),
        });
      },
    },
  ],
  server: {
    port: 3000,
    cors: true,
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        taskpane: resolve(import.meta.dirname, "src/taskpane/index.html"),
        functions: resolve(import.meta.dirname, "src/functions/functions.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "functions" ? "functions.js" : "assets/[name]-[hash].js",
      },
    },
  },
  test: {
    root: import.meta.dirname,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
