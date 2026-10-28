import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const getAppDir = () => {
  try {
    if (typeof __dirname !== 'undefined') return __dirname;
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
};

async function startServer() {
  const app = express();
  // Cloud Run passes PORT environment variable (e.g. 8080)
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Cloud Run / Health checks
  app.get(['/api/health', '/healthz', '/_health', '/health'], (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Determine if we should serve static production assets or run Vite dev middleware
  const appDir = getAppDir();
  const candidateDistPaths = [
    path.join(appDir, 'dist'),
    path.join(process.cwd(), 'dist'),
    path.join(appDir),
    path.join(process.cwd()),
  ];

  const distPath = candidateDistPaths.find(p => fs.existsSync(path.join(p, 'index.html'))) || path.join(appDir, 'dist');
  const indexPath = path.join(distPath, 'index.html');
  const hasDist = fs.existsSync(indexPath);
  const isExplicitDev = process.env.npm_lifecycle_event === 'dev' || process.argv.includes('--dev');
  const shouldServeStatic = hasDist && !isExplicitDev;

  if (shouldServeStatic) {
    console.log(`[Production] Serving static files from: ${distPath}`);
    app.use(express.static(distPath, {
      maxAge: '1h',
      index: false,
    }));
    app.get('*', (_req, res) => {
      res.sendFile(indexPath);
    });
  } else {
    console.log('[Development] Initializing Vite development middleware...');
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} (PORT=${process.env.PORT || '3000'})`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
