import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: { entry: { experiment: './src/experiment.ts', train: './src/train.ts' } },
  output: { distPath: { root: 'dist' }, cleanDistPath: true, target: 'node', filename: { js: '[name].cjs' } },
  tools: { rspack: { target: 'node20' } }
});
