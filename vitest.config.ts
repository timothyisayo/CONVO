import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 30000,
    setupFiles: ["./vitest.setup.ts"],
    css: true,
    server: {
      deps: {
        inline: ["streamdown", "katex"],
      },
    },
    include: ["server/**/*.test.ts", "server/**/*.spec.ts", "client/**/*.test.ts", "client/**/*.test.tsx", "client/**/*.spec.ts", "client/**/*.spec.tsx"],
  },
});
