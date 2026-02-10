#!/usr/bin/env node
import { chromium, devices } from 'playwright';
import { createServer } from 'http';
import { createReadStream, existsSync, statSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { extname, join, resolve, dirname, relative } from 'path';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_CONFIG = 'tests/visual/regions.json';
const DEFAULT_BASELINES = 'tests/visual/baselines.json';
const DEFAULT_ALLOWLIST = 'tests/visual/allowlist.json';
const DEFAULT_OUT_DIR = 'build/visual';
const DEFAULT_PORT = 4173;
const DEFAULT_OCR_SELECTOR = 'p';

const DEVICE_MAP = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  'iphone-13': devices['iPhone 13'],
  'pixel-5': devices['Pixel 5'],
};

let verboseEnabled = false;

function setVerbose(value) {
  verboseEnabled = value;
}

function logVerbose(message) {
  if (verboseEnabled) {
    console.log(message);
  }
}

function parseArgs(argv) {
  const args = {
    config: DEFAULT_CONFIG,
    baselines: DEFAULT_BASELINES,
    allowlist: DEFAULT_ALLOWLIST,
    outDir: DEFAULT_OUT_DIR,
    port: DEFAULT_PORT,
    skipBuild: false,
    updateBaseline: false,
    skipLinks: false,
    verbose: false,
    profile: 'full',
    report: false,
    reportPath: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') {
      args.config = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--baselines') {
      args.baselines = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--allowlist') {
      args.allowlist = argv[i + 1];
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
    if (arg === '--update-baseline') {
      args.updateBaseline = true;
      continue;
    }
    if (arg === '--skip-links') {
      args.skipLinks = true;
      continue;
    }
    if (arg === '--verbose') {
      args.verbose = true;
      continue;
    }
    if (arg === '--profile') {
      args.profile = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--report') {
      args.report = true;
      continue;
    }
    if (arg === '--report-out') {
      args.reportPath = argv[i + 1];
      i += 1;
      continue;
    }
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
  logVerbose(`visual-regression: exec ${[command, ...args].join(' ')}`);
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

async function runCommandCapture(command, args) {
  logVerbose(`visual-regression: exec ${[command, ...args].join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
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

      if (existsSync(filePath)) {
        const stat = statSync(filePath);
        if (stat.isDirectory()) {
          filePath = join(filePath, 'index.html');
        }
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

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeForComparison(text) {
  return normalizeWhitespace(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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

function similarityScore(expected, actual) {
  if (!expected && !actual) {
    return 1;
  }
  const expectedTokens = tokenize(expected);
  const actualTokens = tokenize(actual);
  const tokenRecall = tokenRecallApprox(expectedTokens, actualTokens);
  const distance = levenshteinDistance(expected, actual);
  const maxLen = Math.max(expected.length, actual.length, 1);
  const charScore = (maxLen - distance) / maxLen;
  return (charScore + tokenRecall) / 2;
}

function formatScore(score) {
  return `${(score * 100).toFixed(1)}%`;
}

async function loadJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

function slugifyPath(pathname) {
  return pathname.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'home';
}

function normalizeProfileEntry(entry) {
  return typeof entry === 'string' ? entry.trim() : '';
}

function pageMatchesProfile(pageConfig, entry) {
  if (!entry) {
    return false;
  }
  if (entry.startsWith('/')) {
    return entry === pageConfig.path;
  }
  if (pageConfig.label && entry === pageConfig.label) {
    return true;
  }
  return entry === slugifyPath(pageConfig.path);
}

function makeKey({ page, device, mode, region }) {
  return `${page}::${device}::${mode}::${region}`;
}

function matchesValue(ruleValue, actualValue) {
  if (!ruleValue || ruleValue === '*') {
    return true;
  }
  if (Array.isArray(ruleValue)) {
    return ruleValue.includes(actualValue);
  }
  return ruleValue === actualValue;
}

function isAllowed(change, allowlist) {
  return (allowlist.allow ?? []).some((entry) => {
    return (
      matchesValue(entry.page, change.page) &&
      matchesValue(entry.device, change.device) &&
      matchesValue(entry.mode, change.mode) &&
      matchesValue(entry.region, change.region) &&
      matchesValue(entry.type, change.type)
    );
  });
}

function summarizeText(text, maxLen = 160) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLen) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLen)}…`;
}

function toReportPath(pathname, reportDir) {
  if (!pathname) {
    return null;
  }
  const absolutePath = resolve(pathname);
  const rel = relative(reportDir, absolutePath);
  return rel.replace(/\\/g, '/');
}

function simplifyCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function runHugoBuild() {
  if (process.env.SKIP_HUGO === '1') {
    console.log('visual-regression: SKIP_HUGO=1 set; skipping Hugo build.');
    return;
  }

  const hugoBin = process.env.HUGO_BIN || 'hugo';
  console.log('visual-regression: running Hugo build...');
  const { code, stdout, stderr } = await runCommandCapture(hugoBin, []);

  if (code !== 0) {
    const combined = `${stdout}\n${stderr}`;
    if (combined.includes('snap-confine') || combined.includes('cap_dac_override')) {
      console.error('visual-regression: Hugo from snap cannot run under current permissions.');
      console.error('visual-regression: Install a non-snap Hugo or set HUGO_BIN to that binary.');
    } else {
      console.error(combined.trim());
    }
    process.exit(code);
  }
}

async function runLinkCheck(skipLinks) {
  if (skipLinks) {
    console.log('visual-regression: --skip-links set; skipping link checks.');
    return;
  }
  console.log('visual-regression: running link checks...');
  await runCommand('node', ['scripts/check-links.mjs', '--skip-build']);
  console.log('visual-regression: link checks complete.');
}

async function runTesseract(imagePath, lang) {
  logVerbose(`visual-regression: exec tesseract ${imagePath} stdout -l ${lang} --psm 6`);
  const { stdout } = await execFileAsync('tesseract', [
    imagePath,
    'stdout',
    '-l',
    lang,
    '--psm',
    '6',
  ]);
  return stdout;
}

async function ensureDir(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function diffImages(diffPage, baselinePath, currentPath, diffPath, threshold) {
  const baselineData = await readFile(baselinePath);
  const currentData = await readFile(currentPath);
  const baselineUrl = `data:image/png;base64,${baselineData.toString('base64')}`;
  const currentUrl = `data:image/png;base64,${currentData.toString('base64')}`;

  const result = await diffPage.evaluate(async ({ baselineUrl, currentUrl, threshold }) => {
    function loadImage(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = url;
      });
    }

    const [img1, img2] = await Promise.all([loadImage(baselineUrl), loadImage(currentUrl)]);
    if (img1.width !== img2.width || img1.height !== img2.height) {
      return { sizeMismatch: true, width: img1.width, height: img1.height, otherWidth: img2.width, otherHeight: img2.height };
    }

    const canvas = document.createElement('canvas');
    canvas.width = img1.width;
    canvas.height = img1.height;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img1, 0, 0);
    const data1 = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img2, 0, 0);
    const data2 = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const diff = ctx.createImageData(canvas.width, canvas.height);
    let diffPixels = 0;

    for (let i = 0; i < data1.data.length; i += 4) {
      const r1 = data1.data[i];
      const g1 = data1.data[i + 1];
      const b1 = data1.data[i + 2];
      const a1 = data1.data[i + 3];
      const r2 = data2.data[i];
      const g2 = data2.data[i + 1];
      const b2 = data2.data[i + 2];
      const a2 = data2.data[i + 3];

      const delta = (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) + Math.abs(a1 - a2)) / 1020;
      if (delta > threshold) {
        diffPixels += 1;
        diff.data[i] = 255;
        diff.data[i + 1] = 0;
        diff.data[i + 2] = 0;
        diff.data[i + 3] = 255;
      } else {
        diff.data[i] = 0;
        diff.data[i + 1] = 0;
        diff.data[i + 2] = 0;
        diff.data[i + 3] = 0;
      }
    }

    ctx.putImageData(diff, 0, 0);
    const diffUrl = diffPixels > 0 ? canvas.toDataURL('image/png') : null;

    return {
      sizeMismatch: false,
      width: canvas.width,
      height: canvas.height,
      diffPixels,
      totalPixels: canvas.width * canvas.height,
      diffUrl,
    };
  }, { baselineUrl, currentUrl, threshold });

  if (result.sizeMismatch) {
    return { diffPercent: 1, sizeMismatch: result };
  }

  if (result.diffUrl) {
    const base64 = result.diffUrl.split(',')[1];
    await ensureDir(diffPath);
    await writeFile(diffPath, Buffer.from(base64, 'base64'));
  }

  return { diffPercent: result.diffPixels / result.totalPixels, sizeMismatch: null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  setVerbose(args.verbose);
  const config = await loadJson(args.config);
  const allowlist = await loadJson(args.allowlist, { allow: [] });
  const baselineData = await loadJson(args.baselines, { generatedAt: null, entries: [] });

  const profileConfig = config.profiles?.[args.profile] ?? null;
  if (args.profile !== 'full' && !profileConfig) {
    console.error(`visual-regression: unknown profile "${args.profile}".`);
    process.exit(1);
  }

  const baselineMap = new Map();
  for (const entry of baselineData.entries ?? []) {
    baselineMap.set(makeKey(entry), entry);
  }

  if (!args.skipBuild) {
    await runHugoBuild();
  } else {
    console.log('visual-regression: --skip-build set; skipping Hugo build.');
  }

  await runLinkCheck(args.skipLinks);

  await mkdir(args.outDir, { recursive: true });
  const publicDir = resolve('public');
  const server = await startStaticServer(publicDir, args.port);
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const allowed = [];
  const newBaselines = [];
  const reportItems = [];

  try {
    const diffPage = await browser.newPage();

    const pageConfigs = config.pages ?? [];
    const profilePages = (profileConfig?.pages ?? []).map(normalizeProfileEntry).filter(Boolean);
    const activePages = profilePages.length > 0
      ? pageConfigs.filter((pageConfig) => profilePages.some((entry) => pageMatchesProfile(pageConfig, entry)))
      : pageConfigs;

    for (const pageConfig of activePages) {
      const pagePath = pageConfig.path;
      const pageLabel = pageConfig.label || slugifyPath(pagePath);
      const pageDevices = pageConfig.devices ?? profileConfig?.devices ?? config.devices ?? ['desktop'];
      const pageModes = pageConfig.modes ?? profileConfig?.modes ?? config.modes ?? ['light'];
      const profileRegions = profileConfig?.regions ?? null;
      const regions = (pageConfig.regions ?? []).filter((region) => {
        if (!profileRegions || profileRegions.length === 0) {
          return true;
        }
        return profileRegions.includes(region.id);
      });

      for (const deviceName of pageDevices) {
        const deviceOptions = DEVICE_MAP[deviceName];
        if (!deviceOptions) {
          failures.push({ type: 'config', page: pagePath, device: deviceName, mode: '-', region: '-', detail: `Unknown device preset: ${deviceName}` });
          continue;
        }

        for (const mode of pageModes) {
          const context = await browser.newContext({
            ...deviceOptions,
            colorScheme: mode,
          });
          const page = await context.newPage();
          const url = `http://127.0.0.1:${args.port}${pagePath}`;

          console.log(`visual-regression: ${pagePath} | ${deviceName} | ${mode}`);
          await page.goto(url, { waitUntil: 'networkidle' });
          await page.evaluate(() => document.fonts.ready);

          for (const region of regions) {
            const regionId = region.id;
            const regionKey = makeKey({ page: pagePath, device: deviceName, mode, region: regionId });
            const locator = page.locator(region.selector);
            const count = await locator.count();
            if (args.verbose) {
              console.log(`  region ${regionId} (${region.selector})`);
            }

            if (count === 0) {
              const change = { type: 'missing-region', page: pagePath, device: deviceName, mode, region: regionId, detail: `Selector not found: ${region.selector}` };
              if (isAllowed(change, allowlist)) {
                allowed.push(change);
              } else {
                failures.push(change);
              }
              reportItems.push({ ...change });
              continue;
            }

            if (count > 1) {
              const change = { type: 'ambiguous-region', page: pagePath, device: deviceName, mode, region: regionId, detail: `Selector matched ${count} elements: ${region.selector}` };
              if (isAllowed(change, allowlist)) {
                allowed.push(change);
              } else {
                failures.push(change);
              }
              reportItems.push({ ...change });
              continue;
            }

            const element = locator.first();
            const box = await element.boundingBox();
            if (!box) {
              const change = { type: 'hidden-region', page: pagePath, device: deviceName, mode, region: regionId, detail: 'Bounding box not available.' };
              if (isAllowed(change, allowlist)) {
                allowed.push(change);
              } else {
                failures.push(change);
              }
              reportItems.push({ ...change });
              continue;
            }

            const rawText = await element.innerText();
            const textNormalized = normalizeWhitespace(rawText);
            const structure = await element.evaluate((node) => {
              const counts = {};
              const all = Array.from(node.querySelectorAll('*'));
              all.forEach((child) => {
                const tag = child.tagName.toLowerCase();
                counts[tag] = (counts[tag] || 0) + 1;
              });
              const links = node.querySelectorAll('a').length;
              const images = node.querySelectorAll('img').length;
              const buttons = node.querySelectorAll('button').length;
              const headings = node.querySelectorAll('h1,h2,h3,h4,h5,h6').length;
              const listItems = node.querySelectorAll('li').length;
              return {
                tagCounts: counts,
                linkCount: links,
                imageCount: images,
                buttonCount: buttons,
                headingCount: headings,
                listItemCount: listItems,
                elementCount: all.length,
                textLength: node.innerText.replace(/\s+/g, ' ').trim().length,
              };
            });

            const roundedBox = {
              x: Number(box.x.toFixed(2)),
              y: Number(box.y.toFixed(2)),
              width: Number(box.width.toFixed(2)),
              height: Number(box.height.toFixed(2)),
            };

            const currentImagePath = join(args.outDir, 'current', pageLabel, regionId, `${deviceName}-${mode}.png`);
            await ensureDir(currentImagePath);
            await element.screenshot({ path: currentImagePath });

            const ocrEnabled = region.ocr !== false && !args.updateBaseline;
            const ocrSelector = region.ocrSelector === undefined ? DEFAULT_OCR_SELECTOR : region.ocrSelector;
            if (ocrEnabled && ocrSelector !== null) {
              let ocrTargets = [element];
              if (ocrSelector) {
                const targetLocator = element.locator(ocrSelector);
                const ocrCount = await targetLocator.count();
                if (ocrCount > 0) {
                  ocrTargets = [];
                  for (let i = 0; i < ocrCount; i += 1) {
                    ocrTargets.push(targetLocator.nth(i));
                  }
                }
              }

              const ocrLang = region.ocrLang ?? pageConfig.ocrLang ?? 'eng';
              const ocrScores = [];
              for (let i = 0; i < ocrTargets.length; i += 1) {
                const target = ocrTargets[i];
                const targetText = normalizeWhitespace(await target.innerText());
                if (!targetText) {
                  continue;
                }
                const ocrPath = join(args.outDir, 'ocr', pageLabel, regionId, `${deviceName}-${mode}-p${i + 1}.png`);
                await ensureDir(ocrPath);
                await target.screenshot({ path: ocrPath });
                const ocrText = await runTesseract(ocrPath, ocrLang);
                const expected = normalizeForComparison(targetText);
                const actual = normalizeForComparison(ocrText);
                ocrScores.push(similarityScore(expected, actual));
              }

              const minOcrScore = region.minOcrScore ?? config.defaults?.minOcrScore ?? 0.97;
              const ocrMin = ocrScores.length > 0 ? Math.min(...ocrScores) : 0;
              const ocrAvg = ocrScores.length > 0 ? ocrScores.reduce((sum, v) => sum + v, 0) / ocrScores.length : 0;

              if (ocrScores.length === 0) {
                const change = { type: 'ocr-missing', page: pagePath, device: deviceName, mode, region: regionId, detail: 'No OCR targets found.' };
                if (isAllowed(change, allowlist)) {
                  allowed.push(change);
                } else {
                  failures.push(change);
                }
                reportItems.push({ ...change, currentImagePath });
              } else if (ocrMin < minOcrScore) {
                const change = { type: 'ocr', page: pagePath, device: deviceName, mode, region: regionId, detail: `OCR min ${formatScore(ocrMin)} avg ${formatScore(ocrAvg)}` };
                if (isAllowed(change, allowlist)) {
                  allowed.push(change);
                } else {
                  failures.push(change);
                }
                reportItems.push({ ...change, currentImagePath });
              } else if (args.verbose) {
                console.log(`    OCR min ${formatScore(ocrMin)} avg ${formatScore(ocrAvg)}`);
              }
            } else if (args.verbose && region.ocr === false) {
              console.log('    OCR skipped for region');
            }

            const baselineImagePath = join('tests', 'visual', 'baselines', pageLabel, regionId, `${deviceName}-${mode}.png`);
            const baselineEntry = baselineMap.get(regionKey);
            let diffPath = null;

            const entry = {
              page: pagePath,
              device: deviceName,
              mode,
              region: regionId,
              text: textNormalized,
              structure: {
                ...structure,
                tagCounts: simplifyCounts(structure.tagCounts),
              },
              bbox: roundedBox,
              image: baselineImagePath,
            };

            if (args.updateBaseline) {
              await ensureDir(baselineImagePath);
              await writeFile(baselineImagePath, await readFile(currentImagePath));
              newBaselines.push(entry);
              continue;
            }

            if (!baselineEntry) {
              const change = { type: 'baseline-missing', page: pagePath, device: deviceName, mode, region: regionId, detail: `Missing baseline entry for ${regionKey}` };
              if (isAllowed(change, allowlist)) {
                allowed.push(change);
              } else {
                failures.push(change);
              }
              reportItems.push({ ...change, currentImagePath });
            } else {
              const expectedText = baselineEntry.text || '';
              if (expectedText !== textNormalized) {
                const score = similarityScore(normalizeForComparison(expectedText), normalizeForComparison(textNormalized));
                const change = {
                  type: 'text',
                  page: pagePath,
                  device: deviceName,
                  mode,
                  region: regionId,
                  detail: `Text changed (${formatScore(score)} match). Expected: "${summarizeText(expectedText)}" Actual: "${summarizeText(textNormalized)}"`,
                };
                if (isAllowed(change, allowlist)) {
                  allowed.push(change);
                } else {
                  failures.push(change);
                }
                reportItems.push({ ...change, baselineImagePath, currentImagePath });
              }

              const baselineStructure = baselineEntry.structure ?? {};
              const structureMismatch = JSON.stringify(baselineStructure) !== JSON.stringify(entry.structure);
              if (structureMismatch) {
                const change = { type: 'structure', page: pagePath, device: deviceName, mode, region: regionId, detail: 'Structure signature changed.' };
                if (isAllowed(change, allowlist)) {
                  allowed.push(change);
                } else {
                  failures.push(change);
                }
                reportItems.push({ ...change, baselineImagePath, currentImagePath });
              }

              const layoutMode = region.layout ?? 'position';
              if (layoutMode !== 'none') {
                const maxDelta = region.maxBBoxDelta ?? config.defaults?.maxBBoxDelta ?? 4;
                const dx = Math.abs((baselineEntry.bbox?.x ?? 0) - roundedBox.x);
                const dy = Math.abs((baselineEntry.bbox?.y ?? 0) - roundedBox.y);
                const dw = Math.abs((baselineEntry.bbox?.width ?? 0) - roundedBox.width);
                const dh = Math.abs((baselineEntry.bbox?.height ?? 0) - roundedBox.height);
                let delta = Math.max(dx, dy, dw, dh);
                let detail = `BBox delta exceeds ${maxDelta}px (baseline ${JSON.stringify(baselineEntry.bbox)} current ${JSON.stringify(roundedBox)})`;

                if (layoutMode === 'size') {
                  delta = Math.max(dw, dh);
                  detail = `BBox size delta exceeds ${maxDelta}px (baseline ${JSON.stringify(baselineEntry.bbox)} current ${JSON.stringify(roundedBox)})`;
                } else if (layoutMode !== 'position') {
                  const change = {
                    type: 'config',
                    page: pagePath,
                    device: deviceName,
                    mode,
                    region: regionId,
                    detail: `Unknown layout mode: ${layoutMode}`,
                  };
                  if (isAllowed(change, allowlist)) {
                    allowed.push(change);
                  } else {
                    failures.push(change);
                  }
                  reportItems.push({ ...change, baselineImagePath, currentImagePath });
                  delta = 0;
                }

                if (delta > maxDelta) {
                  const change = {
                    type: 'layout',
                    page: pagePath,
                    device: deviceName,
                    mode,
                    region: regionId,
                    detail,
                  };
                  if (isAllowed(change, allowlist)) {
                    allowed.push(change);
                  } else {
                    failures.push(change);
                  }
                  reportItems.push({ ...change, baselineImagePath, currentImagePath });
                }
              }

              if (!existsSync(baselineImagePath)) {
                const change = { type: 'baseline-image-missing', page: pagePath, device: deviceName, mode, region: regionId, detail: `Missing baseline image at ${baselineImagePath}` };
                if (isAllowed(change, allowlist)) {
                  allowed.push(change);
                } else {
                  failures.push(change);
                }
                reportItems.push({ ...change, currentImagePath });
              } else {
                diffPath = join(args.outDir, 'diff', pageLabel, regionId, `${deviceName}-${mode}.png`);
                const threshold = region.diffThreshold ?? 0.1;
                const { diffPercent, sizeMismatch } = await diffImages(diffPage, baselineImagePath, currentImagePath, diffPath, threshold);
                if (sizeMismatch) {
                  const change = { type: 'visual', page: pagePath, device: deviceName, mode, region: regionId, detail: 'Baseline/current image size mismatch.' };
                  if (isAllowed(change, allowlist)) {
                    allowed.push(change);
                  } else {
                    failures.push(change);
                  }
                  reportItems.push({ ...change, baselineImagePath, currentImagePath, diffPath });
                } else {
                  const maxDiff = region.maxDiffPercent ?? config.defaults?.maxDiffPercent ?? 0.02;
                  if (diffPercent > maxDiff) {
                    const change = { type: 'visual', page: pagePath, device: deviceName, mode, region: regionId, detail: `Pixel diff ${(diffPercent * 100).toFixed(2)}% exceeds ${(maxDiff * 100).toFixed(2)}%` };
                    if (isAllowed(change, allowlist)) {
                      allowed.push(change);
                    } else {
                      failures.push(change);
                    }
                    reportItems.push({ ...change, baselineImagePath, currentImagePath, diffPath });
                  } else if (args.verbose) {
                    console.log(`    Visual diff ${(diffPercent * 100).toFixed(2)}%`);
                  }
                }
              }
            }
          }

          const regionOutlineColors = ['#ff4d4f', '#faad14', '#52c41a', '#1890ff', '#722ed1', '#13c2c2'];
          await page.evaluate(({ regionsForPage, colors }) => {
            regionsForPage.forEach((region, index) => {
              const elements = Array.from(document.querySelectorAll(region.selector));
              elements.forEach((el) => {
                el.setAttribute('data-visual-region', region.id);
                el.style.outline = `2px solid ${colors[index % colors.length]}`;
                el.style.outlineOffset = '2px';
              });
            });
          }, { regionsForPage: regions, colors: regionOutlineColors });

          const annotatedPath = join(args.outDir, 'annotated', `${pageLabel}-${deviceName}-${mode}.png`);
          await ensureDir(annotatedPath);
          await page.screenshot({ path: annotatedPath, fullPage: true });

          await page.evaluate(() => {
            document.querySelectorAll('[data-visual-region]').forEach((el) => {
              el.style.outline = '';
              el.style.outlineOffset = '';
              el.removeAttribute('data-visual-region');
            });
          });

          await context.close();
        }
      }
    }

    if (args.updateBaseline) {
      const merged = new Map(baselineMap);
      newBaselines.forEach((entry) => merged.set(makeKey(entry), entry));
      baselineData.generatedAt = new Date().toISOString();
      baselineData.entries = Array.from(merged.values());
      baselineData.entries.sort((a, b) => makeKey(a).localeCompare(makeKey(b)));
      await writeFile(args.baselines, `${JSON.stringify(baselineData, null, 2)}\n`);
      console.log(`visual-regression: baseline updated (${newBaselines.length} entries).`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (allowed.length > 0) {
    console.log(`visual-regression: ${allowed.length} change(s) allowed by allowlist.`);
    allowed.forEach((change) => {
      console.log(`ALLOW ${change.type} ${change.page} ${change.device} ${change.mode} ${change.region} ${change.detail ?? ''}`.trim());
    });
  }

  if (failures.length > 0) {
    console.error(`visual-regression: ${failures.length} failure(s).`);
    failures.forEach((change) => {
      console.error(`FAIL ${change.type} ${change.page} ${change.device} ${change.mode} ${change.region} ${change.detail ?? ''}`.trim());
    });
    if (args.report && reportItems.length > 0) {
      const reportPath = args.reportPath ?? join(args.outDir, 'report.html');
      const reportDir = dirname(reportPath);
      const items = reportItems.map((item) => {
        const base = {
          ...item,
          baselineImagePath: item.baselineImagePath ? toReportPath(item.baselineImagePath, reportDir) : null,
          currentImagePath: item.currentImagePath ? toReportPath(item.currentImagePath, reportDir) : null,
          diffPath: item.diffPath ? toReportPath(item.diffPath, reportDir) : null,
        };
        return base;
      });

      const rows = items.map((item) => {
        const imgCell = (label, path) => {
          if (!path) return '<div class="img empty">n/a</div>';
          return `<div class="img"><div class="img-label">${label}</div><img src="${path}" alt="${label}"></div>`;
        };
        const details = `${item.type} ${item.page} ${item.device} ${item.mode} ${item.region}`;
        return `
          <div class="card">
            <div class="meta">
              <div class="title">${details}</div>
              <div class="detail">${item.detail ?? ''}</div>
            </div>
            <div class="imgs">
              ${imgCell('baseline', item.baselineImagePath)}
              ${imgCell('current', item.currentImagePath)}
              ${imgCell('diff', item.diffPath)}
            </div>
          </div>
        `;
      }).join('\n');

      const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Visual Regression Report</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 20px; background: #f6f6f6; color: #222; }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-bottom: 16px; }
    .title { font-weight: 600; margin-bottom: 6px; }
    .detail { color: #555; margin-bottom: 10px; }
    .imgs { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .img { border: 1px solid #eee; border-radius: 6px; padding: 6px; background: #fafafa; }
    .img-label { font-size: 12px; color: #666; margin-bottom: 4px; }
    img { width: 100%; height: auto; display: block; background: #fff; }
    .empty { color: #999; font-size: 12px; text-align: center; padding: 24px 0; }
  </style>
</head>
<body>
  <h1>Visual Regression Report</h1>
  <p>${items.length} change(s)</p>
  ${rows}
</body>
</html>`;
      await writeFile(reportPath, html);
      console.log(`visual-regression: report written to ${reportPath}`);
    }
    process.exit(1);
  }

  if (args.report) {
    console.log('visual-regression: no failures; report not written.');
  }

  console.log('visual-regression: success.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
