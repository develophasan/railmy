import fs from 'fs-extra';
import path from 'path';
import { APPS_DIR } from './paths.js';
import { saveMetadata, ProjectMetadata } from './metadata.js';
import { execa } from 'execa';
import { logger } from '../logger/logger.js';

/**
 * Eski deploy'lar için metadata oluştur (migration)
 */
export async function migrateExistingProjects(): Promise<void> {
  logger.info('Eski projeler için metadata oluşturuluyor...', 'migrate');
  
  if (!(await fs.pathExists(APPS_DIR))) {
    return;
  }
  
  const entries = await fs.readdir(APPS_DIR);
  let migrated = 0;
  
  for (const entry of entries) {
    const projectPath = path.join(APPS_DIR, entry);
    const stat = await fs.stat(projectPath);
    
    if (!stat.isDirectory()) {
      continue;
    }
    
    // Metadata zaten varsa atla
    const metadataPath = path.join(projectPath, 'metadata.json');
    if (await fs.pathExists(metadataPath)) {
      continue;
    }
    
    // PM2 process adını bul
    let pm2ProcessName: string | undefined;
    try {
      const { stdout } = await execa('pm2', ['jlist']);
      const processes = JSON.parse(stdout);
      const process = processes.find((p: any) => 
        p.name.includes(entry) || p.name.startsWith(entry)
      );
      if (process) {
        pm2ProcessName = process.name;
      }
    } catch (error) {
      // PM2 yoksa veya hata varsa devam et
    }
    
    // Nginx config path'ini bul
    let nginxConfigPath: string | undefined;
    try {
      const { stdout } = await execa('sudo', ['ls', '/etc/nginx/conf.d/'], { 
        shell: true 
      });
      const configs = stdout.split('\n').filter(f => f.includes(entry));
      if (configs.length > 0) {
        nginxConfigPath = `/etc/nginx/conf.d/${configs[0]}`;
      }
    } catch (error) {
      // Hata varsa devam et
    }
    
    // Port'u PM2'den veya .env'den bul
    let port: number | undefined;
    try {
      if (pm2ProcessName) {
        const { stdout } = await execa('pm2', ['env', pm2ProcessName]);
        const portMatch = stdout.match(/PORT[=:]\s*(\d+)/);
        if (portMatch) {
          port = parseInt(portMatch[1]);
        }
      }
      
      // .env dosyasından port oku
      if (!port) {
        const envPath = path.join(projectPath, '.env');
        if (await fs.pathExists(envPath)) {
          const envContent = await fs.readFile(envPath, 'utf-8');
          const portMatch = envContent.match(/PORT=(\d+)/);
          if (portMatch) {
            port = parseInt(portMatch[1]);
          }
        }
      }
    } catch (error) {
      // Hata varsa devam et
    }
    
    // Git repo bilgilerini bul
    let repoUrl = '';
    let branch = 'main';
    try {
      const gitConfigPath = path.join(projectPath, '.git', 'config');
      if (await fs.pathExists(gitConfigPath)) {
        const gitConfig = await fs.readFile(gitConfigPath, 'utf-8');
        const urlMatch = gitConfig.match(/url\s*=\s*(.+)/);
        if (urlMatch) {
          repoUrl = urlMatch[1].trim();
        }
      }
      
      // Branch'i bul
      const headPath = path.join(projectPath, '.git', 'HEAD');
      if (await fs.pathExists(headPath)) {
        const head = await fs.readFile(headPath, 'utf-8');
        const branchMatch = head.match(/refs\/heads\/(.+)/);
        if (branchMatch) {
          branch = branchMatch[1].trim();
        }
      }
    } catch (error) {
      // Hata varsa devam et
    }
    
    // Proje tipini tespit et (basit kontrol)
    let projectType = 'unknown';
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        projectType = 'backend';
      } else {
        // Monorepo kontrolü
        const customerPath = path.join(projectPath, 'customer');
        if (await fs.pathExists(customerPath)) {
          projectType = 'monorepo';
        }
      }
    } catch (error) {
      // Hata varsa devam et
    }
    
    // Metadata oluştur
    if (repoUrl || pm2ProcessName) {
      const now = new Date().toISOString();
      const metadata: ProjectMetadata = {
        name: entry,
        repoUrl: repoUrl || `unknown-${entry}`,
        branch: branch,
        type: projectType,
        port: port,
        basePath: '/',
        createdAt: now,
        updatedAt: now,
        pm2ProcessName,
        nginxConfigPath,
        environment: 'production',
        webhookEnabled: false
      };
      
      await saveMetadata(metadata);
      migrated++;
      logger.info(`Metadata oluşturuldu: ${entry}`, 'migrate');
    }
  }
  
  logger.info(`${migrated} proje için metadata oluşturuldu`, 'migrate');
}

