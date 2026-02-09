#!/usr/bin/env node
import { chromium } from 'playwright';
import { createServer } from 'http';
import { createReadStream, existsSync, statSync } from 'fs';
import { readdir } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { spawn } from 'child_process';

const DEFAULT_PORT = 4173;

function parseArgs(argv) {
  const args = {
    port: DEFAULT_PORT,
    skipBuild: false,
    publicDir: 'public',
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') {
      args.port = Number.parseInt(argv[i + 1], 10);
      i += 1;
      continue;
    }
    if (arg === '--skip-build') {
      args.skipBuild = true;
      continue;
    }
    if (arg === '--public-dir') {
      args.publicDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--verbose') {
      args.verbose = true;
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

async function walkHtmlFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'archives' || entry.name === 'page') {
        continue;
      }
      const subFiles = await walkHtmlFiles(fullPath);
      files.push(...subFiles);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

function isAliasRedirect(html) {
  return html.includes('http-equiv="refresh"');
}

function shouldSkipHref(href) {
  if (!href) {
    return true;
  }
  const trimmed = href.trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.startsWith('#')) {
    return false;
  }
  const lowered = trimmed.toLowerCase();
  return (
    lowered.startsWith('mailto:') ||
    lowered.startsWith('tel:') ||
    lowered.startsWith('javascript:') ||
    lowered.startsWith('data:')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.skipBuild) {
    await runCommand('hugo', []);
  }

  const publicDir = resolve(args.publicDir);
  const htmlFiles = await walkHtmlFiles(publicDir);
  const baseUrl = `http://127.0.0.1:${args.port}`;

  const server = await startStaticServer(publicDir, args.port);
  const browser = await chromium.launch();

  const internalUrls = new Set();
  const linkSources = new Map();
  const anchorsByUrl = new Map();
  const failures = [];

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const collectHrefs = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await page.$$eval('a[href]', (links) =>
            links.map((link) => link.getAttribute('href') || '')
          );
        } catch (error) {
          if (attempt === 0) {
            await page.waitForTimeout(100);
            continue;
          }
          throw error;
        }
      }
      return [];
    };

    const evaluateWithRetry = async (fn, args) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await page.evaluate(fn, args);
        } catch (error) {
          if (attempt === 0) {
            await page.waitForTimeout(100);
            continue;
          }
          throw error;
        }
      }
      return null;
    };

    for (const filePath of htmlFiles) {
      const relativePath = filePath.slice(publicDir.length).replace(/\\/g, '/');
      const urlPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
      const pageUrl = `${baseUrl}${urlPath}`;

      await page.goto(pageUrl, { waitUntil: 'load' });
      const hrefs = await collectHrefs();

      for (const href of hrefs) {
        if (shouldSkipHref(href)) {
          continue;
        }
        const resolvedUrl = new URL(href, pageUrl);
        if (resolvedUrl.origin !== baseUrl) {
          continue;
        }
        const canonicalUrl = `${resolvedUrl.origin}${resolvedUrl.pathname}${resolvedUrl.search}`;
        internalUrls.add(canonicalUrl);
        if (!linkSources.has(canonicalUrl)) {
          linkSources.set(canonicalUrl, []);
        }
        linkSources.get(canonicalUrl).push({ source: pageUrl, href });

        if (resolvedUrl.hash) {
          const anchor = resolvedUrl.hash.slice(1);
          if (!anchor) {
            continue;
          }
          if (!anchorsByUrl.has(canonicalUrl)) {
            anchorsByUrl.set(canonicalUrl, new Set());
          }
          anchorsByUrl.get(canonicalUrl).add(anchor);
        }
      }
    }

    for (const url of internalUrls) {
      const response = await context.request.get(url);
      if (!response) {
        failures.push(`No response for ${url}`);
        continue;
      }
      const status = response.status();
      if (status >= 400) {
        const sources = linkSources.get(url) ?? [];
        const sample = sources.slice(0, 3).map((entry) => `${entry.source} (${entry.href})`).join(' | ');
        const suffix = sample ? ` [from ${sample}]` : '';
        failures.push(`${status} for ${url}${suffix}`);
      }
    }

    for (const [url, anchors] of anchorsByUrl.entries()) {
      const response = await context.request.get(url);
      if (!response) {
        failures.push(`No response for ${url}`);
        continue;
      }
      const html = await response.text();
      if (isAliasRedirect(html)) {
        continue;
      }

      await page.goto(url, { waitUntil: 'load' });
      const missing = await evaluateWithRetry((anchorList) => {
        return anchorList.filter((anchor) => {
          const decoded = decodeURIComponent(anchor);
          return !(document.getElementById(decoded) || document.querySelector(`[name="${decoded}"]`));
        });
      }, Array.from(anchors));

      if (missing && missing.length > 0) {
        failures.push(`Missing anchors on ${url}: ${missing.join(', ')}`);
      }
    }

    if (args.verbose) {
      console.log(`Checked ${internalUrls.size} internal link(s).`);
    }

    if (failures.length > 0) {
      failures.forEach((failure) => console.error(failure));
      process.exit(1);
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
