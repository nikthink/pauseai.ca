#!/usr/bin/env node
import { chromium } from 'playwright';
import { createServer } from 'http';
import { createReadStream, existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_OPACITIES = [0.6, 0.7, 0.75, 0.8, 0.85];
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

function parseArgs(argv) {
  const args = {
    path: '/en/montreal.html',
    opacities: DEFAULT_OPACITIES,
    outDir: '/tmp/pauseai-visual-ocr',
    port: 4173,
    skipBuild: false,
    width: DEFAULT_VIEWPORT.width,
    height: DEFAULT_VIEWPORT.height,
    deviceScaleFactor: 2,
    paragraphCount: 0,
    selector: 'main p',
    lang: 'eng',
    psm: 6,
    minScore: 0,
    lightOpacity: null,
    darkOpacity: null,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--path') {
      args.path = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--opacities') {
      args.opacities = argv[i + 1]
        .split(',')
        .map((value) => Number.parseFloat(value.trim()))
        .filter((value) => Number.isFinite(value));
      i += 1;
      continue;
    }
    if (arg === '--out') {
      args.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--port') {
      args.port = Number.parseInt(argv[i + 1], 10);
      i += 1;
      continue;
    }
    if (arg === '--skip-build') {
      args.skipBuild = true;
      continue;
    }
    if (arg === '--viewport') {
      const [width, height] = argv[i + 1].split('x').map((value) => Number.parseInt(value, 10));
      if (Number.isFinite(width) && Number.isFinite(height)) {
        args.width = width;
        args.height = height;
      }
      i += 1;
      continue;
    }
    if (arg === '--device-scale-factor') {
      const value = Number.parseFloat(argv[i + 1]);
      if (Number.isFinite(value)) {
        args.deviceScaleFactor = value;
      }
      i += 1;
      continue;
    }
    if (arg === '--paragraphs') {
      args.paragraphCount = Number.parseInt(argv[i + 1], 10);
      i += 1;
      continue;
    }
    if (arg === '--selector') {
      args.selector = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--lang') {
      args.lang = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--psm') {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value)) {
        args.psm = value;
      }
      i += 1;
      continue;
    }
    if (arg === '--min-score') {
      const value = Number.parseFloat(argv[i + 1]);
      if (Number.isFinite(value)) {
        args.minScore = value;
      }
      i += 1;
      continue;
    }
    if (arg === '--light-opacity') {
      args.lightOpacity = Number.parseFloat(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--dark-opacity') {
      args.darkOpacity = Number.parseFloat(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--verbose') {
      args.verbose = true;
      continue;
    }
  }

  if (!args.path.startsWith('/')) {
    args.path = `/${args.path}`;
  }

  return args;
}

function contentTypeForPath(filePath) {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    default:
      return 'application/octet-stream';
  }
}

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function startStaticServer(rootDir, port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = req.url ?? '/';
      const cleanPath = decodeURIComponent(requestUrl.split('?')[0]);
      let filePath = join(rootDir, cleanPath);

      if (!filePath.startsWith(rootDir)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }

      if (existsSync(filePath) && filePath.endsWith('/')) {
        filePath = join(filePath, 'index.html');
      }

      if (existsSync(filePath) && !filePath.endsWith('/')) {
        res.statusCode = 200;
        res.setHeader('Content-Type', contentTypeForPath(filePath));
        createReadStream(filePath).pipe(res);
        return;
      }

      const indexCandidate = join(filePath, 'index.html');
      if (existsSync(indexCandidate)) {
        res.statusCode = 200;
        res.setHeader('Content-Type', contentTypeForPath(indexCandidate));
        createReadStream(indexCandidate).pipe(res);
        return;
      }

      res.statusCode = 404;
      res.end('Not found');
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function normalizeText(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(text) {
  if (!text) {
    return [];
  }
  return text.split(' ').filter(Boolean);
}

function tokenRecallApprox(expectedTokens, ocrTokens) {
  if (expectedTokens.length === 0) {
    return 0;
  }
  const used = new Set();
  let matches = 0;

  for (const expected of expectedTokens) {
    let matchIndex = -1;
    for (let i = 0; i < ocrTokens.length; i += 1) {
      if (used.has(i)) {
        continue;
      }
      const actual = ocrTokens[i];
      if (expected === actual) {
        matchIndex = i;
        break;
      }
      const distance = levenshteinDistance(expected, actual);
      const tolerance = Math.max(1, Math.floor(expected.length * 0.2));
      if (distance <= tolerance) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex >= 0) {
      used.add(matchIndex);
      matches += 1;
    }
  }

  return matches / expectedTokens.length;
}

function levenshteinDistance(a, b) {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  const v0 = new Array(b.length + 1).fill(0);
  const v1 = new Array(b.length + 1).fill(0);

  for (let i = 0; i <= b.length; i += 1) {
    v0[i] = i;
  }

  for (let i = 0; i < a.length; i += 1) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(
        v1[j] + 1,
        v0[j + 1] + 1,
        v0[j] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      v0[j] = v1[j];
    }
  }

  return v1[b.length];
}

async function runTesseract(imagePath, lang, psm) {
  const { stdout } = await execFileAsync('tesseract', [
    imagePath,
    'stdout',
    '-l',
    lang,
    '--psm',
    String(psm),
  ]);
  return stdout;
}

function formatScore(score) {
  return score.toFixed(3);
}

function summarizeScores(scores) {
  if (scores.length === 0) {
    return { min: 0, avg: 0 };
  }
  const total = scores.reduce((sum, value) => sum + value, 0);
  const min = Math.min(...scores);
  return { min, avg: total / scores.length };
}

function getOpacitiesForMode(mode, args) {
  if (mode === 'light' && Number.isFinite(args.lightOpacity)) {
    return [args.lightOpacity];
  }
  if (mode === 'dark' && Number.isFinite(args.darkOpacity)) {
    return [args.darkOpacity];
  }
  return args.opacities;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.skipBuild) {
    await runCommand('hugo', []);
  }

  await mkdir(args.outDir, { recursive: true });

  const server = await startStaticServer(resolve('public'), args.port);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: args.width, height: args.height },
      deviceScaleFactor: args.deviceScaleFactor,
    });

    const targetUrl = `http://127.0.0.1:${args.port}${args.path}`;
    const results = [];
    let failures = 0;

    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.goto(targetUrl, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);

      const paragraphs = page.locator(args.selector);
      const totalParagraphs = await paragraphs.count();
      const paragraphLimit = args.paragraphCount > 0
        ? Math.min(totalParagraphs, args.paragraphCount)
        : totalParagraphs;

      if (paragraphLimit === 0) {
        throw new Error(`No paragraphs found for selector: ${args.selector}`);
      }

      const opacities = getOpacitiesForMode(mode, args);

      for (const opacity of opacities) {
        const overlayValue = mode === 'dark'
          ? `rgba(0, 0, 0, ${opacity})`
          : `rgba(255, 255, 255, ${opacity})`;

        await page.evaluate((value) => {
          document.documentElement.style.setProperty('--hero-overlay', value);
        }, overlayValue);

        await page.waitForTimeout(100);

        for (let i = 0; i < paragraphLimit; i += 1) {
          const locator = paragraphs.nth(i);
          const expectedText = await locator.innerText();
          const normalizedExpected = normalizeText(expectedText);
          if (!normalizedExpected) {
            continue;
          }

          const shotPath = join(
            args.outDir,
            `ocr-${mode}-${String(opacity).replace('.', '_')}-p${i + 1}.png`,
          );

          await locator.screenshot({ path: shotPath });

          const ocrText = await runTesseract(shotPath, args.lang, args.psm);
          const normalizedOcr = normalizeText(ocrText);

          const distance = levenshteinDistance(normalizedExpected, normalizedOcr);
          const maxLen = Math.max(normalizedExpected.length, normalizedOcr.length, 1);
          const charScore = (maxLen - distance) / maxLen;
          const expectedTokens = tokenize(normalizedExpected);
          const ocrTokens = tokenize(normalizedOcr);
          const tokenRecall = tokenRecallApprox(expectedTokens, ocrTokens);
          const score = (charScore + tokenRecall) / 2;

          if (args.minScore > 0 && score < args.minScore) {
            failures += 1;
          }

          results.push({
            mode,
            opacity,
            score,
            shotPath,
            index: i + 1,
            expectedText,
          });
        }
      }
    }

    const grouped = results.reduce((acc, item) => {
      const key = `${item.mode}:${item.opacity}`;
      acc[key] = acc[key] ?? [];
      acc[key].push(item);
      return acc;
    }, {});

    console.log('\nOCR legibility scores:');
    for (const mode of ['light', 'dark']) {
      const opacities = getOpacitiesForMode(mode, args);
      console.log(`\n${mode.toUpperCase()}`);
      for (const opacity of opacities) {
        const entries = grouped[`${mode}:${opacity}`] ?? [];
        if (entries.length === 0) {
          console.log(`- opacity ${opacity}: no samples`);
          continue;
        }
        const scores = entries.map((entry) => entry.score);
        const summary = summarizeScores(scores);
        console.log(`- opacity ${opacity}: min ${formatScore(summary.min)} avg ${formatScore(summary.avg)} (${entries.length} paragraphs)`);
        if (args.verbose) {
          entries.forEach((entry) => {
            const snippet = entry.expectedText.replace(/\s+/g, ' ').slice(0, 80);
            console.log(`  p${entry.index}: ${formatScore(entry.score)} "${snippet}${entry.expectedText.length > 80 ? '…' : ''}"`);
          });
        }
      }
    }

    if (args.minScore > 0 && failures > 0) {
      throw new Error(`OCR score below threshold for ${failures} paragraph(s).`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
