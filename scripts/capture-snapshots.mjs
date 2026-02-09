#!/usr/bin/env node
import { chromium, devices } from 'playwright';
import { createServer } from 'http';
import { createReadStream, existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { spawn } from 'child_process';

const DEFAULT_PORT = 4173;
const DEFAULT_OUT_DIR = 'build/snapshots';
const DEFAULT_PATHS = ['/en/montreal.html', '/fr/montreal.html'];
const DEFAULT_DEVICES = ['desktop', 'iphone-13', 'pixel-5'];
const DEFAULT_MODES = ['light', 'dark'];

const DEVICE_MAP = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  'iphone-13': devices['iPhone 13'],
  'pixel-5': devices['Pixel 5'],
};

function parseList(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = {
    port: DEFAULT_PORT,
    outDir: DEFAULT_OUT_DIR,
    paths: DEFAULT_PATHS,
    devices: DEFAULT_DEVICES,
    modes: DEFAULT_MODES,
    skipBuild: false,
    fullPage: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') {
      args.port = Number.parseInt(argv[i + 1], 10);
      i += 1;
      continue;
    }
    if (arg === '--out') {
      args.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--paths') {
      args.paths = parseList(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--devices') {
      args.devices = parseList(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--modes') {
      args.modes = parseList(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--skip-build') {
      args.skipBuild = true;
      continue;
    }
    if (arg === '--no-full-page') {
      args.fullPage = false;
      continue;
    }
  }

  args.paths = args.paths.map((entry) => (entry.startsWith('/') ? entry : `/${entry}`));
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

function labelForPath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) {
    return 'home';
  }
  return parts[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.skipBuild) {
    await runCommand('hugo', []);
  }

  await mkdir(args.outDir, { recursive: true });

  const server = await startStaticServer(resolve('public'), args.port);
  const browser = await chromium.launch();

  try {
    for (const path of args.paths) {
      const label = labelForPath(path);
      for (const deviceName of args.devices) {
        const deviceOptions = DEVICE_MAP[deviceName];
        if (!deviceOptions) {
          throw new Error(`Unknown device preset: ${deviceName}`);
        }
        for (const mode of args.modes) {
          const context = await browser.newContext({
            ...deviceOptions,
            colorScheme: mode,
          });
          const page = await context.newPage();
          const url = `http://127.0.0.1:${args.port}${path}`;
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await page.evaluate(() => document.fonts.ready);
          const fileName = `${label}-${deviceName}-${mode}.png`;
          await page.screenshot({
            path: join(args.outDir, fileName),
            fullPage: args.fullPage,
          });
          await context.close();
          console.log(`Saved ${fileName}`);
        }
      }
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
