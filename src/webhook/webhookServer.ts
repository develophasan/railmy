import http from 'http';
import crypto from 'crypto';
import { logger } from '../logger/logger.js';
import { listAllProjects } from '../utils/metadata.js';
import { execa } from 'execa';
import path from 'path';

export interface WebhookConfig {
  port: number;
  secret?: string;
  path?: string;
}

/**
 * GitHub webhook payload interface
 */
interface GitHubWebhookPayload {
  ref?: string;
  repository?: {
    clone_url?: string;
    html_url?: string;
    name?: string;
  };
  commits?: Array<{
    id: string;
    message: string;
  }>;
}

/**
 * Webhook server başlat
 */
export async function startWebhookServer(config: WebhookConfig): Promise<void> {
  const { port = 3003, secret, path: webhookPath = '/webhook' } = config;

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Signature-256');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== 'POST' || req.url !== webhookPath) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    try {
      // Request body'yi oku
      const body = await readRequestBody(req);
      
      // Signature doğrulama
      if (secret) {
        const signature = req.headers['x-hub-signature-256'] as string;
        if (!signature || !verifySignature(body, signature, secret)) {
          logger.warn('Webhook signature doğrulama başarısız', 'webhook');
          res.writeHead(401);
          res.end('Unauthorized');
          return;
        }
      }

      // GitHub event tipini kontrol et
      const event = req.headers['x-github-event'] as string;
      if (event !== 'push') {
        res.writeHead(200);
        res.end('Event ignored');
        return;
      }

      // Payload'ı parse et
      const payload: GitHubWebhookPayload = JSON.parse(body);
      
      // Repo URL'ini bul
      const repoUrl = payload.repository?.clone_url || payload.repository?.html_url;
      if (!repoUrl) {
        res.writeHead(400);
        res.end('Invalid payload');
        return;
      }

      // Branch'i al
      const ref = payload.ref || 'refs/heads/main';
      const branch = ref.replace('refs/heads/', '');

      logger.info(`Webhook alındı: ${repoUrl} (branch: ${branch})`, 'webhook');

      // Projeyi bul
      const projects = await listAllProjects();
      const project = projects.find(p => 
        p.repoUrl === repoUrl || 
        p.repoUrl === repoUrl.replace('.git', '') ||
        p.repoUrl.replace('.git', '') === repoUrl
      );

      if (!project) {
        logger.warn(`Webhook için proje bulunamadı: ${repoUrl}`, 'webhook');
        res.writeHead(404);
        res.end('Project not found');
        return;
      }

      // Eğer branch eşleşiyorsa, projeyi güncelle
      if (project.branch === branch) {
        logger.info(`Proje güncelleniyor: ${project.name}`, 'webhook');
        
        // Update komutunu çalıştır
        try {
          await execa('node', [
            path.join(process.cwd(), 'dist/index.js'),
            'update',
            '--name',
            project.name,
            '--branch',
            branch
          ], {
            stdio: 'inherit'
          });
          
          logger.success(`Proje başarıyla güncellendi: ${project.name}`, 'webhook');
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'Project updated' }));
        } catch (error: any) {
          logger.error(`Proje güncelleme hatası: ${error.message}`, 'webhook', error);
          res.writeHead(500);
          res.end(JSON.stringify({ success: false, error: error.message }));
        }
      } else {
        logger.info(`Branch eşleşmedi: ${project.branch} !== ${branch}`, 'webhook');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Branch mismatch, ignored' }));
      }
    } catch (error: any) {
      logger.error(`Webhook işleme hatası: ${error.message}`, 'webhook', error);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
  });

  server.listen(port, () => {
    logger.info(`Webhook server başlatıldı: http://localhost:${port}${webhookPath}`, 'webhook');
  });

  return new Promise((resolve) => {
    server.on('listening', () => {
      resolve();
    });
  });
}

/**
 * Request body'yi oku
 */
function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

/**
 * GitHub webhook signature'ını doğrula
 */
function verifySignature(body: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

