import { createWriteStream, existsSync, mkdir, readFile } from 'node:fs';
import https from 'node:https';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const inputFile = join(__dirname, 'data.txt');
const outputDir = join(__dirname, 'downloaded_icons');

// Ensure output directory exists
if (!existsSync(outputDir)) {
  mkdir(outputDir, { recursive: true }, (err) => {
    if (err) throw err;
  });
}

// Read file
readFile(inputFile, 'utf8', (err, data) => {
  if (err) throw err;

  const lines = data.split('\n').filter((line) => line.trim());

  for (const line of lines) {
    const parts = line.split('\t');
    const shape = parts[0].trim().replaceAll(/\s+/g, '_');

    for (let i = 1; i < parts.length; i++) {
      const cell = parts[i].trim();
      if (!cell.includes('|')) continue;

      const [url, name] = cell.split('|').map((s) => s.trim());
      if (!url || !name) continue;

      const cleanName = name.replaceAll(/\s+/g, '_');
      const filename = `${shape}_${cleanName}.svg`;
      const filepath = join(outputDir, filename);

      downloadSvg(url, filepath);
    }
  }
});

// Native HTTPS SVG downloader
function downloadSvg(url, dest) {
  const file = createWriteStream(dest);

  https
    .get(url, (res) => {
      if (res.statusCode !== 200) {
        // eslint-disable-next-line no-console
        console.error(`❌ Failed (${res.statusCode}): ${url}`);
        res.resume(); // Consume response to free memory
        return;
      }

      res.pipe(file);

      file.on('finish', () => {
        file.close();
        // eslint-disable-next-line no-console
        console.log(`✅ Downloaded: ${basename(dest)}`);
      });
    })
    .on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error(`❌ Error: ${url} — ${err.message}`);
    });
}
