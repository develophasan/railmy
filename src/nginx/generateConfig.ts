import fs from 'fs-extra';
import path from 'path';
import { execa } from 'execa';
import { logger } from '../logger/logger.js';
import { ProjectType, ProjectAnalysis } from '../types/index.js';
import { getNginxConfigPath } from '../utils/paths.js';
import { sanitizeProjectName } from '../utils/security.js';

export interface NginxConfigOptions {
  projectName: string;
  projectPath: string;
  projectType: ProjectType;
  analysis: ProjectAnalysis;
  port?: number;
  basePath?: string; // Örn: /api
  domain?: string; // Opsiyonel domain
}

/**
 * Nginx config dosyası oluştur
 */
export async function generateNginxConfig(
  options: NginxConfigOptions
): Promise<string> {
  const {
    projectName,
    projectPath,
    projectType,
    analysis,
    port,
    basePath,
    domain
  } = options;

  logger.info('Nginx config oluşturuluyor...', 'nginx');

  const configPath = getNginxConfigPath(projectName);
  const safeName = sanitizeProjectName(projectName);
  const serverName = domain || `${safeName}.local`;

  let configContent: string;

  if (projectType === ProjectType.FRONTEND && !analysis.isSSR) {
    // Static frontend (Nginx serve)
    const staticDir = path.join(
      projectPath,
      analysis.frontendPath || '',
      analysis.staticOutputDir || 'dist'
    );

    configContent = generateStaticConfig({
      serverName,
      staticDir,
      basePath: basePath || '/'
    });
  } else if (projectType === ProjectType.BACKEND || analysis.isSSR) {
    // Backend veya SSR frontend (proxy)
    if (!port) {
      throw new Error('Backend için port gerekli');
    }

    configContent = generateProxyConfig({
      serverName,
      port,
      basePath: basePath || '/'
    });
  } else if (projectType === ProjectType.MONOREPO) {
    // Monorepo: hem frontend hem backend
    if (!port) {
      throw new Error('Monorepo için backend port gerekli');
    }

    const frontendStaticDir = analysis.frontendPath
      ? path.join(
          projectPath,
          analysis.frontendPath,
          analysis.staticOutputDir || 'dist'
        )
      : null;

    configContent = generateMonorepoConfig({
      serverName,
      port,
      frontendStaticDir,
      backendBasePath: basePath || '/api',
      frontendBasePath: '/'
    });
  } else {
    throw new Error(`Desteklenmeyen proje tipi: ${projectType}`);
  }

  // Config dosyasını geçici olarak yaz, sonra sudo ile kopyala
  const tempConfigPath = path.join('/tmp', `${safeName}.nginx.conf`);
  await fs.writeFile(tempConfigPath, configContent);
  
  try {
    // Sudo ile kopyala
    await execa('sudo', ['cp', tempConfigPath, configPath], {
      stdio: 'pipe'
    });
    await fs.remove(tempConfigPath);
    logger.success(`Nginx config oluşturuldu: ${configPath}`, 'nginx');
  } catch (error: any) {
    // Sudo başarısız olursa, geçici dosyayı bırak ve kullanıcıya bildir
    logger.warn(
      `Nginx config sudo ile kopyalanamadı. Manuel kopyalama gerekebilir: ${tempConfigPath} -> ${configPath}`,
      'nginx'
    );
    throw new Error(`Nginx config write failed: ${error.message}`);
  }

  // Nginx syntax kontrolü
  try {
    // Nginx'in tam yolunu bul
    let nginxPath = 'nginx';
    try {
      const whichResult = await execa('which', ['nginx'], { stdio: 'pipe' });
      nginxPath = whichResult.stdout.trim() || 'nginx';
    } catch {
      // which başarısız olursa, yaygın yolları dene
      const commonPaths = ['/usr/sbin/nginx', '/usr/bin/nginx', '/sbin/nginx'];
      for (const path of commonPaths) {
        try {
          await execa('test', ['-f', path], { stdio: 'pipe' });
          nginxPath = path;
          break;
        } catch {
          // Devam et
        }
      }
    }

    // Sudo ile nginx -t çalıştır
    await execa('sudo', [nginxPath, '-t'], {
      stdio: 'pipe'
    });
    logger.success('Nginx config syntax kontrolü başarılı', 'nginx');
  } catch (error: any) {
    logger.warn(
      `Nginx syntax kontrolü başarısız: ${error.message}. Config dosyası oluşturuldu ama manuel kontrol önerilir.`,
      'nginx'
    );
    // Syntax hatası olsa bile devam et (kullanıcı düzeltebilir)
    // throw new Error(`Nginx config invalid: ${error.stderr || error.message}`);
  }

  return configPath;
}

/**
 * Nginx'i reload et
 */
export async function reloadNginx(): Promise<void> {
  logger.info('Nginx reload ediliyor...', 'nginx');

  // Nginx'in tam yolunu bul
  let nginxPath = 'nginx';
  try {
    const whichResult = await execa('which', ['nginx'], { stdio: 'pipe' });
    nginxPath = whichResult.stdout.trim() || 'nginx';
  } catch {
    // which başarısız olursa, yaygın yolları dene
    const commonPaths = ['/usr/sbin/nginx', '/usr/bin/nginx', '/sbin/nginx'];
    for (const path of commonPaths) {
      try {
        await execa('test', ['-f', path], { stdio: 'pipe' });
        nginxPath = path;
        break;
      } catch {
        // Devam et
      }
    }
  }

  try {
    // Sudo ile reload (production'da gerekli)
    const result = await execa('sudo', [nginxPath, '-s', 'reload'], {
      stdio: 'pipe'
    });

    logger.success('Nginx başarıyla reload edildi', 'nginx');
    await logger.logCommandOutput(
      `sudo ${nginxPath} -s reload`,
      result.stdout,
      result.stderr,
      result.exitCode
    );
  } catch (error: any) {
    // Sudo yoksa normal reload dene
    try {
      await execa(nginxPath, ['-s', 'reload'], {
        stdio: 'pipe'
      });
      logger.success('Nginx başarıyla reload edildi', 'nginx');
    } catch (error2: any) {
      logger.warn(
        `Nginx reload hatası (manuel reload gerekebilir): sudo ${nginxPath} -s reload`,
        'nginx'
      );
      // Hata fırlatma, sadece uyarı ver
    }
  }
}

/**
 * Static frontend config
 */
function generateStaticConfig(options: {
  serverName: string;
  staticDir: string;
  basePath: string;
}): string {
  const { serverName, staticDir, basePath } = options;

  return `server {
    listen 80;
    server_name ${serverName};

    root ${staticDir};
    index index.html;

    location ${basePath} {
        try_files $uri $uri/ /index.html;
    }

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json;

    # Cache static assets
    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
`;
}

/**
 * Backend proxy config
 */
function generateProxyConfig(options: {
  serverName: string;
  port: number;
  basePath: string;
}): string {
  const { serverName, port, basePath } = options;

  return `server {
    listen 80;
    server_name ${serverName};

    # Exact match for base path - redirect to trailing slash
    location = ${basePath} {
        return 301 ${basePath}/;
    }
    
    # All paths under base path (with or without trailing slash)
    location ${basePath}/ {
        # Strip the base path before proxying (trailing slash in proxy_pass does the stripping)
        proxy_pass http://localhost:${port}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
`;
}

/**
 * Monorepo config (frontend + backend)
 */
function generateMonorepoConfig(options: {
  serverName: string;
  port: number;
  frontendStaticDir: string | null;
  backendBasePath: string;
  frontendBasePath: string;
}): string {
  const { serverName, port, frontendStaticDir, backendBasePath, frontendBasePath } = options;

  let config = `server {
    listen 80;
    server_name ${serverName};

    # Backend proxy - exact match for base path
    location = ${backendBasePath} {
        return 301 ${backendBasePath}/;
    }
    
    # Backend proxy - all paths under base path (with or without trailing slash)
    location ${backendBasePath}/ {
        # Strip the base path before proxying (trailing slash in proxy_pass does the stripping)
        proxy_pass http://localhost:${port}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
`;

  if (frontendStaticDir) {
    config += `
    # Frontend static files
    root ${frontendStaticDir};
    index index.html;

    location ${frontendBasePath} {
        try_files $uri $uri/ /index.html;
    }

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json;

    # Cache static assets
    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
`;
  }

  config += `}
`;

  return config;
}

