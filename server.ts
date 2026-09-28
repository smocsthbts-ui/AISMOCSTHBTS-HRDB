import express from 'express';
import path from 'path';
import fs from 'fs';

async function startServer() {
  const app = express();
  // Cloud Run passes PORT environment variable (e.g. 8080)
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Cloud Run / Health checks
  app.get(['/api/health', '/healthz', '/_health', '/health'], (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Vite middleware for development vs static files for production
  const distPath = path.join(process.cwd(), 'dist');
  const indexPath = path.join(distPath, 'index.html');
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction || !fs.existsSync(indexPath)) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Application dist index.html not found. Run npm run build.');
      }
    });
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
