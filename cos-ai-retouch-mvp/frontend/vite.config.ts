/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

type RuntimeProcess = { env: Record<string, string | undefined> };

const runtime = globalThis as typeof globalThis & { process?: RuntimeProcess };
const env = runtime.process?.env ?? {};
const repositoryName = env.GITHUB_REPOSITORY?.split("/").filter(Boolean).pop();
const base = env.GITHUB_ACTIONS === "true" && repositoryName ? `/${repositoryName}/` : "/";

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
});
