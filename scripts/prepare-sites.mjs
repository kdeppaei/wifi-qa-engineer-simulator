import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Publish the same browser applications that are built and tested locally.
// Each Site has a separate identity; this script only updates its static files.
const outputRoot = process.argv[2];
if (!outputRoot) throw new Error('Usage: node scripts/prepare-sites.mjs <absolute-site-directory>');
const source = resolve('dist');
for (const [name, entry, title] of [
  ['excel-tools', 'rvr-excel.html', 'Excel 繪圖與表格工具'],
  ['wifi-qa-lab', 'index.html', 'Wi-Fi QA Virtual Lab'],
]) {
  const directory = join(resolve(outputRoot), name);
  const manifest = JSON.parse(await readFile(join(directory, '.openai/hosting.json'), 'utf8'));
  if (!manifest.project_id || manifest.static?.directory !== 'dist')
    throw new Error(`Register ${name} and configure its static directory before packaging.`);
  await mkdir(join(directory, 'dist'), { recursive: true });
  await cp(join(source, 'assets'), join(directory, 'dist/assets'), { recursive: true });
  await cp(join(source, entry), join(directory, 'dist/index.html'));
  await writeFile(
    join(directory, 'README.md'),
    `# ${title}\n\nPublic browser application. Source and Fork: https://github.com/kdeppaei/wifi-qa-engineer-simulator\n\nBuild the source repository with pnpm build, then run scripts/prepare-sites.mjs with this Sites parent directory. Visitors need only a browser. Input data stays in the visitor's browser.\n`,
  );
  console.log(`${name}: static assets prepared`);
}
