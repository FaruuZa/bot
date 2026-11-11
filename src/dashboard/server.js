import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { createApiRouter } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DashboardServer {
  static server = null;
  static app = null;

  static start(client) {
    if (this.server) {
      logger.warn('[Dashboard] Server sudah berjalan sebelumnya.');
      return;
    }

    const app = express();
    this.app = app;

    // Body Parsers
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Security & Cache Headers
    app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      next();
    });

    // Mount API routes
    app.use('/api', createApiRouter(client));

    // Serve static files from dashboard/public with optimized cache headers
    const publicPath = path.join(__dirname, 'public');
    app.use(express.static(publicPath, {
      maxAge: '1h',
      etag: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.match(/\.(css|js|woff2|png|svg|jpg)$/)) {
          res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
        }
      }
    }));

    // Fallback to index.html for SPA (compatible with Express 4 and Express 5)
    app.use((req, res) => {
      res.sendFile(path.join(publicPath, 'index.html'));
    });

    // Start listening
    const port = env.PORT || 8080;
    try {
      this.server = app.listen(port, '0.0.0.0', () => {
        logger.success(`=================================================`);
        logger.success(`[Web Dashboard] Aktif dan dapat diakses di:`);
        logger.success(`>> http://localhost:${port}`);
        logger.success(`Portainer Port Mapping: 8080:8080`);
        logger.success(`=================================================`);
      });

      this.server.on('error', (err) => {
        logger.error(`[Web Dashboard Error] Gagal menjalankan server web: ${err.message}`);
      });
    } catch (err) {
      logger.error(`[Web Dashboard Startup Error] ${err.message}`);
    }
  }

  static stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      logger.info('[Web Dashboard] Server web dihentikan.');
    }
  }
}
