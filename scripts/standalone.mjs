import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Inline the production bundle so the lab can be opened directly without a server.
const directory = resolve('dist');
if (!existsSync(resolve(directory, 'index.html'))) throw new Error('Run the Vite build first.');
let html = readFileSync(resolve(directory, 'index.html'), 'utf8');
html = html.replace(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g, (_, path) => {
  const js = readFileSync(resolve(directory, path), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link[^>]+href="([^"]+\.css)"[^>]*>/g, (_, path) => {
  const css = readFileSync(resolve(directory, path), 'utf8');
  return `<style>${css}</style>`;
});
writeFileSync(resolve(directory, 'wifi-qa-lab.html'), html, 'utf8');
