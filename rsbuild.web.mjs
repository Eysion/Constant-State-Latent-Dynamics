import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: "./src/web/main.tsx" } },
  html: {
    template: "./src/web/index.html",
    title: "Constant-State Latent Dynamics",
  },
  output: { distPath: { root: "dist-web" }, cleanDistPath: true },
});
