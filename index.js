import express from 'express';
import http from 'node:http';
import { createBareServer } from '@tomphttp/bare-server-node';
import cors from 'cors';
import path from 'node:path';
import { hostname } from 'node:os';

const server = http.createServer();
const app = express();
const rootDir = process.cwd();
const bareServer = createBareServer('/bare/');
const PORT = Number(process.env.PORT || 8080);

const SEARCH_ENGINES = [
  'https://duckduckgo.com/?q=%s',
];
const FETCH_TIMEOUT_MS = 2000;
let shuttingDown = false;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(rootDir, 'public')));
app.use('/uv', express.static(path.join(rootDir, 'uv')));


app.get('/', (req, res) => {
  res.sendFile(path.join(rootDir, 'public/index.html'));
});

app.get('/proxy', (req, res) => {
  res.sendFile(path.join(rootDir, 'public/proxy.html'));
});

app.get('/video-url-1', (req, res) => {
  res.sendFile(path.join(rootDir, 'public/video-url-1.html'));
});

app.get('/api/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'missing q' });

    const query = encodeURIComponent(q);

    for (const tpl of SEARCH_ENGINES) {
      const url = tpl.replace('%s', query);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
        });

        if (response.ok) {
          clearTimeout(timeoutId);
          return res.json({ url });
        }
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.warn(`Search engine check failed: ${url}`, err);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }
    return res.status(502).json({ error: 'no search engine available' });
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.use((err, _req, res, _next) => {
  console.error('Express error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'internal error' });
});


server.on('request', (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on('upgrade', (req, socket, head) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.on('listening', () => {
  const address = server.address();
  console.log(`Server Listening on:`);
  console.log(`  http://localhost:${address.port}`);
  console.log(`  http://${hostname()}:${address.port}`);
});

server.on('error', (err) => {
  console.error('HTTP server error:', err);
});


process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
  shutdown(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
  shutdown(1);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\nShutting down gracefully...');

  const forceExitTimer = setTimeout(() => {
    console.error('Forced exit after shutdown timeout');
    process.exit(1);
  }, 5000);
  forceExitTimer.unref();

  server.close(() => {
    try {
      bareServer.close();
      console.log('Bare server closed.');
    } catch (err) {
      console.error('Error closing bare server:', err);
    }
    clearTimeout(forceExitTimer);
    console.log('HTTP server closed.');
    process.exit(exitCode);
  });
}

server.listen(PORT);
