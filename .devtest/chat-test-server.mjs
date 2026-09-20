// Isolated production build for offline browser regression tests. No generated
// repository surface is changed; build.mjs runs against its own /tmp snapshot.
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

export async function createChatTestServer() {
  const buildRoot = await mkdtemp(join(tmpdir(), 'ember-chat-regression-'));
  let server;
  try {
    await mkdir(join(buildRoot, 'src'));
    await copyFile(join(root, 'build.mjs'), join(buildRoot, 'build.mjs'));
    await copyFile(join(root, 'src/baxstar-ember.jsx'), join(buildRoot, 'src/baxstar-ember.jsx'));
    await symlink(join(root, 'node_modules'), join(buildRoot, 'node_modules'), 'dir');
    const built = await execFileAsync(process.execPath, [join(buildRoot, 'build.mjs')], {
      cwd: buildRoot,
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH || ''}` },
      maxBuffer: 1024 * 1024,
    });
    console.log(built.stdout.trim());
    // The isolated tree deliberately has no standalone generator, which only
    // owns production preview/voice output and is unrelated to this test build.
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const base = relative === 'index.html' ? buildRoot : root;
        const file = resolve(base, relative);
        if (!file.startsWith(base + sep) || !(await stat(file)).isFile()) throw new Error('not found');
        response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(await readFile(file));
      } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Not found');
      }
    });
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
    return {
      url: `http://127.0.0.1:${server.address().port}/index.html`,
      buildRoot,
      close: async () => {
        await new Promise((resolveClose) => server.close(resolveClose));
        await rm(buildRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (server?.listening) await new Promise((resolveClose) => server.close(resolveClose));
    await rm(buildRoot, { recursive: true, force: true });
    throw error;
  }
}
