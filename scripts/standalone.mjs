import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';

// Inline the production bundle so the lab can be opened directly without a server.
const directory = resolve('dist');
if (!existsSync(resolve(directory, 'index.html'))) throw new Error('Run the Vite build first.');
for (const [input, output] of [
  ['index.html', 'wifi-qa-lab.html'],
  ['rvr-excel.html', 'rvr-excel-tool.html'],
]) {
  let html = readFileSync(resolve(directory, input), 'utf8');
  html = html.replace(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g, (_, path) => {
    let js = readFileSync(resolve(directory, path), 'utf8');
    // Multi-page builds share modules. Embed their complete module graph as data
    // URLs so file:// exports never fetch sibling files or use a CDN.
    const embed = (code, from) =>
      code.replace(
        /((?:from|import)\s*|import\s*\()(["'])(\.\.?\/[^"']+)\2/g,
        (_m, prefix, quote, relative) => {
          const dependency = resolve(from, '..', relative);
          const contents = embed(readFileSync(dependency, 'utf8'), dependency);
          return `${prefix}${quote}data:text/javascript;base64,${Buffer.from(contents).toString('base64')}${quote}`;
        },
      );
    js = embed(js, resolve(directory, path)).replace(/<\/script/gi, '<\\/script');
    return `<script type="module">${js}</script>`;
  });
  html = html.replace(/<link[^>]+href="([^"]+\.css)"[^>]*>/g, (_, path) => {
    const css = readFileSync(resolve(directory, path), 'utf8');
    return `<style>${css}</style>`;
  });
  html = html.replace(/<link[^>]+rel="modulepreload"[^>]*>/g, '');
  writeFileSync(resolve(directory, output), html, 'utf8');
}
