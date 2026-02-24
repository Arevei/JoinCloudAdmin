import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/** Plugins that only exist on Replit; no-op when not available (e.g. Coolify, Render). */
async function optionalReplitPlugins() {
  const plugins: import("vite").Plugin[] = [];
  try {
    const m = await import("@replit/vite-plugin-runtime-error-modal");
    plugins.push((m as { default: () => import("vite").Plugin }).default());
  } catch {
    /* not on Replit */
  }
  if (process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined) {
    try {
      const { cartographer } = await import("@replit/vite-plugin-cartographer");
      plugins.push(cartographer());
    } catch {
      /* not on Replit */
    }
    try {
      const { devBanner } = await import("@replit/vite-plugin-dev-banner");
      plugins.push(devBanner());
    } catch {
      /* not on Replit */
    }
  }
  return plugins;
}

export default defineConfig(async () => ({
  plugins: [react(), ...(await optionalReplitPlugins())],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
}));
