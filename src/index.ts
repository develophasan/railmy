#!/usr/bin/env node

import { Command } from 'commander';
import { logger } from './logger/logger.js';
import { cloneRepo } from './github/cloneRepo.js';
import { detectProjectType } from './analyzer/detectProjectType.js';
import { installDependencies } from './installer/installDeps.js';
import { buildProject } from './builder/buildProject.js';
import { runWithPM2 } from './runner/runWithPM2.js';
import { generateNginxConfig, reloadNginx } from './nginx/generateConfig.js';
import { ProjectType, DeployConfig, DeployResult } from './types/index.js';
import { sanitizeProjectName } from './utils/security.js';
import { getBuildLogPath, getRuntimeLogPath } from './utils/paths.js';
import { findAvailablePort } from './utils/portFinder.js';
import { saveMetadata, loadMetadata, listAllProjects, deleteMetadata, updateMetadata } from './utils/metadata.js';
import { APPS_DIR } from './utils/paths.js';
import fs from 'fs-extra';
import path from 'path';

const program = new Command();

/**
 * Ana deploy fonksiyonu
 */
async function deploy(config: DeployConfig): Promise<DeployResult> {
  const startTime = Date.now();
  logger.setProject(config.projectName);
  logger.info(`🚀 Deploy başlatılıyor: ${config.projectName}`, 'deploy');

  // Port kontrolü ve otomatik port bulma
  let finalPort = config.port;
  if (finalPort) {
    const availablePort = await findAvailablePort(finalPort);
    if (availablePort !== finalPort) {
      logger.warn(`Port ${finalPort} kullanımda, ${availablePort} portu kullanılıyor`, 'deploy');
      finalPort = availablePort;
    }
  }

  let projectPath: string = '';
  let pm2ProcessName: string | undefined;
  let nginxConfigPath: string | undefined;

  try {
    // 1. Repo klonla
    logger.info('📥 Adım 1/7: Repo klonlanıyor...', 'deploy');
    projectPath = await cloneRepo({
      repoUrl: config.repoUrl,
      branch: config.branch,
      projectName: config.projectName,
      force: false
    });

    // 2. Proje tipini tespit et
    logger.info('🔍 Adım 2/7: Proje tipi analiz ediliyor...', 'deploy');
    const analysis = await detectProjectType(projectPath, config.projectType);

    if (analysis.type === ProjectType.UNKNOWN) {
      throw new Error('Proje tipi tespit edilemedi. Lütfen --type parametresi ile belirtin.');
    }

    logger.success(`Proje tipi: ${analysis.type}`, 'deploy');
    logger.info(`Package manager: ${analysis.packageManager}`, 'deploy');

    // 3. Bağımlılıkları kur
    logger.info('📦 Adım 3/7: Bağımlılıklar kuruluyor...', 'deploy');
    
    if (analysis.type === ProjectType.MONOREPO) {
      // Monorepo: hem frontend hem backend için kur
      if (analysis.frontendPath) {
        logger.info(`Frontend bağımlılıkları kuruluyor: ${analysis.frontendPath}`, 'deploy');
        await installDependencies({
          projectPath,
          packageManager: analysis.packageManager,
          subPath: analysis.frontendPath
        });
      }
      if (analysis.backendPath) {
        logger.info(`Backend bağımlılıkları kuruluyor: ${analysis.backendPath}`, 'deploy');
        await installDependencies({
          projectPath,
          packageManager: analysis.packageManager,
          subPath: analysis.backendPath
        });
      }
    } else {
      await installDependencies({
        projectPath,
        packageManager: analysis.packageManager
      });
    }

    // 4. Build
    logger.info('🔨 Adım 4/7: Build yapılıyor...', 'deploy');
    
    if (analysis.type === ProjectType.MONOREPO) {
      if (analysis.frontendPath) {
        logger.info(`Frontend build: ${analysis.frontendPath}`, 'deploy');
        const frontendAnalysis = await detectProjectType(
          path.join(projectPath, analysis.frontendPath),
          ProjectType.FRONTEND
        );
        await buildProject({
          projectPath,
          packageManager: analysis.packageManager,
          analysis: frontendAnalysis,
          subPath: analysis.frontendPath
        });
      }
      if (analysis.backendPath) {
        logger.info(`Backend build: ${analysis.backendPath}`, 'deploy');
        const backendAnalysis = await detectProjectType(
          path.join(projectPath, analysis.backendPath),
          ProjectType.BACKEND
        );
        await buildProject({
          projectPath,
          packageManager: analysis.packageManager,
          analysis: backendAnalysis,
          subPath: analysis.backendPath
        });
      }
    } else {
      await buildProject({
        projectPath,
        packageManager: analysis.packageManager,
        analysis
      });
    }

    // 5. PM2 ile çalıştır
    logger.info('▶️  Adım 5/7: Servis başlatılıyor...', 'deploy');
    
    if (analysis.type === ProjectType.FRONTEND && !analysis.isSSR) {
      // Static frontend, PM2 gerekmez (Nginx serve edecek)
      logger.info('Static frontend tespit edildi, PM2 atlanıyor', 'deploy');
    } else {
      // Backend veya SSR frontend
      if (analysis.type === ProjectType.MONOREPO && analysis.backendPath) {
        const backendAnalysis = await detectProjectType(
          path.join(projectPath, analysis.backendPath),
          ProjectType.BACKEND
        );
        pm2ProcessName = await runWithPM2({
          projectPath,
          packageManager: analysis.packageManager,
          analysis: backendAnalysis,
          projectName: config.projectName,
          port: finalPort,
          envVars: config.envVars,
          subPath: analysis.backendPath
        });
      } else {
        pm2ProcessName = await runWithPM2({
          projectPath,
          packageManager: analysis.packageManager,
          analysis,
          projectName: config.projectName,
          port: finalPort,
          envVars: config.envVars
        });
      }
    }

    // 6. Nginx config oluştur
    logger.info('🌐 Adım 6/7: Nginx config oluşturuluyor...', 'deploy');
    nginxConfigPath = await generateNginxConfig({
      projectName: config.projectName,
      projectPath,
      projectType: analysis.type,
      analysis,
      port: finalPort,
      basePath: config.basePath
    });

    // 7. Nginx reload
    logger.info('🔄 Adım 7/7: Nginx reload ediliyor...', 'deploy');
    await reloadNginx();

    // 8. Metadata kaydet
    const now = new Date().toISOString();
    await saveMetadata({
      name: config.projectName,
      repoUrl: config.repoUrl,
      branch: config.branch,
      type: analysis.type,
      port: finalPort,
      basePath: config.basePath || '/',
      createdAt: now,
      updatedAt: now,
      pm2ProcessName,
      nginxConfigPath,
      environment: config.environment || 'production',
      webhookEnabled: config.webhookEnabled || false
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.success(`✅ Deploy başarıyla tamamlandı! (${duration}s)`, 'deploy');

    return {
      success: true,
      projectPath,
      port: finalPort,
      nginxConfigPath,
      pm2ProcessName,
      logs: {
        build: getBuildLogPath(config.projectName),
        runtime: getRuntimeLogPath(config.projectName)
      }
    };
  } catch (error: any) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.error(
      `❌ Deploy başarısız! (${duration}s)`,
      'deploy',
      error
    );

    return {
      success: false,
      projectPath: projectPath || '',
      error: error.message || 'Bilinmeyen hata',
      logs: {
        build: projectPath ? getBuildLogPath(config.projectName) : undefined,
        runtime: projectPath ? getRuntimeLogPath(config.projectName) : undefined
      }
    };
  }
}

/**
 * CLI komutları
 */
program
  .name('raillmy')
  .description('Self-hosted deployment system')
  .version('1.0.0');

program
  .command('deploy')
  .description('Deploy a project from GitHub')
  .requiredOption('--repo <url>', 'GitHub repository URL')
  .option('--branch <branch>', 'Git branch', 'main')
  .option('--type <type>', 'Project type (backend|frontend|monorepo)', 'auto')
  .option('--port <port>', 'Port number (for backend)', parseInt)
  .option('--name <name>', 'Project name (auto-generated from repo if not provided)')
  .option('--base-path <path>', 'Nginx base path', '/')
  .option('--env <vars>', 'Environment variables (key=value,key2=value2)')
  .option('--environment <env>', 'Environment name (production|staging|development)', 'production')
  .option('--webhook', 'Enable GitHub webhook for auto-deploy', false)
  .action(async (options) => {
    try {
      // Repo URL'den proje adı çıkar
      const repoUrl = options.repo;
      let projectName = options.name;
      
      if (!projectName) {
        const urlParts = repoUrl.split('/');
        const repoName = urlParts[urlParts.length - 1].replace('.git', '');
        const branch = options.branch || 'main';
        
        // Multi-branch desteği: branch adını proje adına ekle (eğer main değilse)
        if (branch !== 'main' && branch !== 'master') {
          projectName = `${repoName}-${branch}`;
        } else {
          projectName = repoName;
        }
      }

      projectName = sanitizeProjectName(projectName);

      // Environment variables parse et
      let envVars: Record<string, string> | undefined;
      if (options.env) {
        envVars = {};
        const pairs = options.env.split(',');
        for (const pair of pairs) {
          const [key, value] = pair.split('=');
          if (key && value) {
            envVars[key.trim()] = value.trim();
          }
        }
      }

      // Project type parse et
      let projectType: ProjectType = ProjectType.UNKNOWN;
      if (options.type !== 'auto') {
        switch (options.type.toLowerCase()) {
          case 'backend':
            projectType = ProjectType.BACKEND;
            break;
          case 'frontend':
            projectType = ProjectType.FRONTEND;
            break;
          case 'monorepo':
            projectType = ProjectType.MONOREPO;
            break;
        }
      }

      const config: DeployConfig = {
        repoUrl,
        branch: options.branch,
        projectType,
        port: options.port,
        envVars,
        projectName,
        basePath: options.basePath,
        environment: options.environment,
        webhookEnabled: options.webhook
      };

      const result = await deploy(config);

      if (result.success) {
        console.log('\n✅ Deploy başarılı!');
        console.log(`📁 Proje dizini: ${result.projectPath}`);
        if (result.port) {
          console.log(`🔌 Port: ${result.port}`);
        }
        if (result.nginxConfigPath) {
          console.log(`🌐 Nginx config: ${result.nginxConfigPath}`);
        }
        if (result.pm2ProcessName) {
          console.log(`⚙️  PM2 process: ${result.pm2ProcessName}`);
        }
        if (result.logs) {
          console.log(`📝 Logs:`);
          if (result.logs.build) {
            console.log(`   Build: ${result.logs.build}`);
          }
          if (result.logs.runtime) {
            console.log(`   Runtime: ${result.logs.runtime}`);
          }
        }
        process.exit(0);
      } else {
        console.error('\n❌ Deploy başarısız!');
        console.error(`Hata: ${result.error}`);
        if (result.logs) {
          console.error(`\nLog dosyalarına bakın:`);
          if (result.logs.build) {
            console.error(`   Build: ${result.logs.build}`);
          }
          if (result.logs.runtime) {
            console.error(`   Runtime: ${result.logs.runtime}`);
          }
        }
        process.exit(1);
      }
    } catch (error: any) {
      logger.error('CLI hatası', 'cli', error);
      console.error(`\n❌ Hata: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all deployed projects')
  .option('--migrate', 'Migrate existing projects to metadata system', false)
  .action(async (options) => {
    try {
      // Eğer migrate flag'i varsa, eski projeler için metadata oluştur
      if (options.migrate) {
        const { migrateExistingProjects } = await import('./utils/migrateMetadata.js');
        await migrateExistingProjects();
      }
      
      const projects = await listAllProjects();
      
      if (projects.length === 0) {
        console.log('📭 Deploy edilmiş proje bulunamadı.');
        return;
      }
      
      console.log(`\n📦 Deploy Edilmiş Projeler (${projects.length}):\n`);
      console.log('┌─────────────────────┬──────────────────────────────────────┬──────────┬───────┬─────────────┬─────────────────────┐');
      console.log('│ İsim                │ Repo                                │ Tip      │ Port  │ Base Path   │ Güncellenme         │');
      console.log('├─────────────────────┼──────────────────────────────────────┼──────────┼───────┼─────────────┼─────────────────────┤');
      
      for (const project of projects) {
        const name = project.name.padEnd(19);
        const repo = (project.repoUrl.length > 38 ? project.repoUrl.substring(0, 35) + '...' : project.repoUrl).padEnd(36);
        const type = project.type.padEnd(8);
        const port = (project.port?.toString() || '-').padEnd(5);
        const basePath = project.basePath.padEnd(11);
        const updated = new Date(project.updatedAt).toLocaleDateString('tr-TR').padEnd(19);
        
        console.log(`│ ${name} │ ${repo} │ ${type} │ ${port} │ ${basePath} │ ${updated} │`);
      }
      
      console.log('└─────────────────────┴──────────────────────────────────────┴──────────┴──────────┴───────┴─────────────┴─────────────────────┘');
    } catch (error: any) {
      logger.error('List hatası', 'cli', error);
      console.error(`\n❌ Hata: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check deployment status')
  .option('--name <name>', 'Project name (shows all if not specified)')
  .action(async (options) => {
    try {
      if (options.name) {
        // Belirli bir projenin durumunu göster
        const metadata = await loadMetadata(options.name);
        if (!metadata) {
          console.error(`❌ Proje bulunamadı: ${options.name}`);
          process.exit(1);
        }
        
        const { execa } = await import('execa');
        
        console.log(`\n📊 Proje Durumu: ${metadata.name}\n`);
        console.log(`📁 Repo: ${metadata.repoUrl}`);
        console.log(`🌿 Branch: ${metadata.branch}`);
        console.log(`🔌 Port: ${metadata.port || 'N/A'}`);
        console.log(`🌐 Base Path: ${metadata.basePath}`);
        console.log(`📅 Oluşturulma: ${new Date(metadata.createdAt).toLocaleString('tr-TR')}`);
        console.log(`🔄 Güncellenme: ${new Date(metadata.updatedAt).toLocaleString('tr-TR')}\n`);
        
        if (metadata.pm2ProcessName) {
          console.log('⚙️  PM2 Durumu:');
          await execa('pm2', ['describe', metadata.pm2ProcessName], { stdio: 'inherit' });
        }
      } else {
        // Tüm PM2 process'lerini göster
        const { execa } = await import('execa');
        const result = await execa('pm2', ['list'], { stdio: 'inherit' });
        process.exit(result.exitCode);
      }
    } catch (error: any) {
      logger.error('Status hatası', 'cli', error);
      console.error(`\n❌ Hata: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('logs')
  .description('View project logs')
  .requiredOption('--name <name>', 'Project name')
  .option('--lines <number>', 'Number of lines', '100')
  .option('--type <type>', 'Log type (build|runtime|pm2)', 'runtime')
  .action(async (options) => {
    try {
      const metadata = await loadMetadata(options.name);
      if (!metadata) {
        console.error(`❌ Proje bulunamadı: ${options.name}`);
        process.exit(1);
      }
      
      const { execa } = await import('execa');
      
      if (options.type === 'pm2' && metadata.pm2ProcessName) {
        await execa('pm2', ['logs', metadata.pm2ProcessName, '--lines', options.lines], { stdio: 'inherit' });
      } else if (options.type === 'build') {
        const buildLog = getBuildLogPath(options.name);
        await execa('tail', ['-n', options.lines, buildLog], { stdio: 'inherit' });
      } else {
        const runtimeLog = getRuntimeLogPath(options.name);
        await execa('tail', ['-n', options.lines, runtimeLog], { stdio: 'inherit' });
      }
    } catch (error: any) {
      logger.error('Logs hatası', 'cli', error);
      console.error(`\n❌ Hata: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('remove')
  .alias('delete')
  .description('Remove a deployed project')
  .requiredOption('--name <name>', 'Project name')
  .option('--force', 'Force removal without confirmation', false)
  .action(async (options) => {
    try {
      const metadata = await loadMetadata(options.name);
      if (!metadata) {
        console.error(`❌ Proje bulunamadı: ${options.name}`);
        process.exit(1);
      }
      
      if (!options.force) {
        console.log(`\n⚠️  Bu işlem şunları silecek:`);
        console.log(`   - PM2 process: ${metadata.pm2ProcessName || 'N/A'}`);
        console.log(`   - Nginx config: ${metadata.nginxConfigPath || 'N/A'}`);
        console.log(`   - Proje dosyaları: ${path.join(APPS_DIR, options.name)}`);
        console.log(`\nDevam etmek istiyor musunuz? (y/N)`);
        
        // Basit confirmation (gerçek uygulamada readline kullanılabilir)
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise<string>((resolve) => {
          rl.question('', resolve);
        });
        rl.close();
        
        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          console.log('❌ İşlem iptal edildi.');
          return;
        }
      }
      
      console.log(`\n🗑️  Proje kaldırılıyor: ${options.name}...\n`);
      
      // 1. PM2 process'i durdur ve sil
      if (metadata.pm2ProcessName) {
        try {
          const { execa } = await import('execa');
          await execa('pm2', ['delete', metadata.pm2ProcessName]);
          console.log(`✅ PM2 process silindi: ${metadata.pm2ProcessName}`);
        } catch (error: any) {
          logger.warn(`PM2 process silinemedi: ${error.message}`, 'remove');
        }
      }
      
      // 2. Nginx config'i sil
      if (metadata.nginxConfigPath) {
        try {
          const { execa } = await import('execa');
          await execa('sudo', ['rm', '-f', metadata.nginxConfigPath]);
          await execa('sudo', ['nginx', '-s', 'reload']);
          console.log(`✅ Nginx config silindi: ${metadata.nginxConfigPath}`);
        } catch (error: any) {
          logger.warn(`Nginx config silinemedi: ${error.message}`, 'remove');
        }
      }
      
      // 3. Proje dizinini sil
      const projectPath = path.join(APPS_DIR, options.name);
      try {
        await fs.remove(projectPath);
        console.log(`✅ Proje dizini silindi: ${projectPath}`);
      } catch (error: any) {
        logger.warn(`Proje dizini silinemedi: ${error.message}`, 'remove');
      }
      
      // 4. Metadata'yı sil
      await deleteMetadata(options.name);
      
      console.log(`\n✅ Proje başarıyla kaldırıldı: ${options.name}`);
    } catch (error: any) {
      logger.error('Remove hatası', 'cli', error);
      console.error(`\n❌ Hata: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('update')
  .description('Update a deployed project (pull latest changes and restart)')
  .requiredOption('--name <name>', 'Project name')
  .option('--branch <branch>', 'Git branch to pull', 'main')
  .action(async (options) => {
    try {
      const metadata = await loadMetadata(options.name);
      if (!metadata) {
        console.error(`❌ Proje bulunamadı: ${options.name}`);
        process.exit(1);
      }
      
      console.log(`\n🔄 Proje güncelleniyor: ${options.name}...\n`);
      
      const { execa } = await import('execa');
      
      // 1. Repo'yu güncelle
      console.log('📥 Repo güncelleniyor...');
      await cloneRepo({
        repoUrl: metadata.repoUrl,
        branch: options.branch || metadata.branch,
        projectName: options.name,
        force: false
      });
      console.log('✅ Repo güncellendi');
      
      // 2. Bağımlılıkları yeniden kur (opsiyonel - hızlı update için atlanabilir)
      // Burada basit bir update yapıyoruz, full rebuild için deploy komutunu kullanın
      
      // 3. PM2 process'i restart et
      if (metadata.pm2ProcessName) {
        console.log('🔄 PM2 process yeniden başlatılıyor...');
        await execa('pm2', ['restart', metadata.pm2ProcessName]);
        console.log('✅ PM2 process yeniden başlatıldı');
      }
      
      // 4. Metadata'yı güncelle
      await updateMetadata(options.name, {
        branch: options.branch || metadata.branch,
        updatedAt: new Date().toISOString()
      });
      
      console.log(`\n✅ Proje başarıyla güncellendi: ${options.name}`);
    } catch (error: any) {
      logger.error('Update hatası', 'cli', error);
      console.error(`\n❌ Hata: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('env')
  .description('Manage environment variables for a project')
  .requiredOption('--name <name>', 'Project name')
  .option('--get <key>', 'Get environment variable value')
  .option('--set <key=value>', 'Set environment variable')
  .option('--unset <key>', 'Remove environment variable')
  .option('--list', 'List all environment variables')
  .option('--backup', 'Backup environment file')
  .option('--restore <path>', 'Restore from backup')
  .action(async (options) => {
    try {
      const metadata = await loadMetadata(options.name);
      if (!metadata) {
        console.error(`❌ Proje bulunamadı: ${options.name}`);
        process.exit(1);
      }

      const { EnvManager } = await import('./utils/envManager.js');
      const projectPath = path.join(APPS_DIR, options.name);
      const envManager = new EnvManager(projectPath);

      if (options.get) {
        const vars = await envManager.getAll();
        const value = vars[options.get];
        if (value !== undefined) {
          console.log(value);
        } else {
          console.error(`❌ Environment variable bulunamadı: ${options.get}`);
          process.exit(1);
        }
      } else if (options.set) {
        const [key, ...valueParts] = options.set.split('=');
        const value = valueParts.join('='); // = içeren değerler için
        if (!key || !value) {
          console.error('❌ Geçersiz format. Kullanım: --set KEY=value');
          process.exit(1);
        }
        await envManager.set(key, value);
        console.log(`✅ Environment variable ayarlandı: ${key}`);
        
        // PM2 process'i restart et
        if (metadata.pm2ProcessName) {
          const { execa } = await import('execa');
          await execa('pm2', ['restart', metadata.pm2ProcessName]);
          console.log(`✅ PM2 process yeniden başlatıldı`);
        }
      } else if (options.unset) {
        await envManager.unset(options.unset);
        console.log(`✅ Environment variable silindi: ${options.unset}`);
        
        // PM2 process'i restart et
        if (metadata.pm2ProcessName) {
          const { execa } = await import('execa');
          await execa('pm2', ['restart', metadata.pm2ProcessName]);
          console.log(`✅ PM2 process yeniden başlatıldı`);
        }
      } else if (options.list) {
        const vars = await envManager.getAll();
        if (Object.keys(vars).length === 0) {
          console.log('📭 Environment variable bulunamadı.');
        } else {
          console.log('\n📋 Environment Variables:\n');
          for (const [key, value] of Object.entries(vars)) {
            // Hassas bilgileri gizle
            const displayValue = key.toLowerCase().includes('secret') || 
                                key.toLowerCase().includes('password') || 
                                key.toLowerCase().includes('key')
              ? '***' : value;
            console.log(`  ${key}=${displayValue}`);
          }
        }
      } else if (options.backup) {
        const backupPath = await envManager.backup();
        console.log(`✅ Backup oluşturuldu: ${backupPath}`);
      } else if (options.restore) {
        await envManager.restore(options.restore);
        console.log(`✅ Backup geri yüklendi: ${options.restore}`);
        
        // PM2 process'i restart et
        if (metadata.pm2ProcessName) {
          const { execa } = await import('execa');
          await execa('pm2', ['restart', metadata.pm2ProcessName]);
          console.log(`✅ PM2 process yeniden başlatıldı`);
        }
      } else {
        console.error('❌ Bir işlem belirtmelisiniz (--get, --set, --unset, --list, --backup, --restore)');
        process.exit(1);
      }
    } catch (error: any) {
      logger.error('Env komutu hatası', 'cli', error);
      console.error(`\n❌ Hata: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('health')
  .description('Check project health status')
  .option('--name <name>', 'Project name (checks all if not specified)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const { checkHealth, checkAllHealth } = await import('./health/healthCheck.js');
      
      if (options.name) {
        const status = await checkHealth(options.name);
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          console.log(`\n🏥 Health Status: ${status.projectName}\n`);
          console.log(`Status: ${status.healthy ? '✅ Healthy' : '❌ Unhealthy'}`);
          console.log(`PM2: ${status.pm2Status || 'N/A'}`);
          if (status.port) console.log(`Port: ${status.port}`);
          if (status.uptime) console.log(`Uptime: ${Math.floor(status.uptime / 1000 / 60)} minutes`);
          if (status.restarts) console.log(`Restarts: ${status.restarts}`);
          if (status.memory) console.log(`Memory: ${(status.memory / 1024 / 1024).toFixed(2)} MB`);
          if (status.cpu) console.log(`CPU: ${status.cpu}%`);
        }
      } else {
        const statuses = await checkAllHealth();
        if (options.json) {
          console.log(JSON.stringify(statuses, null, 2));
        } else {
          console.log(`\n🏥 Health Status (${statuses.length} projects)\n`);
          for (const status of statuses) {
            const icon = status.healthy ? '✅' : '❌';
            console.log(`${icon} ${status.projectName}: ${status.pm2Status || 'N/A'}`);
          }
        }
      }
    } catch (error: any) {
      logger.error('Health komutu hatası', 'cli', error);
      console.error(`\n❌ Hata: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('webhook')
  .description('Start GitHub webhook server for auto-deploy')
  .option('--port <port>', 'Webhook server port', '3003')
  .option('--secret <secret>', 'Webhook secret (for signature verification)')
  .option('--path <path>', 'Webhook path', '/webhook')
  .action(async (options) => {
    try {
      const { startWebhookServer } = await import('./webhook/webhookServer.js');
      
      await startWebhookServer({
        port: parseInt(options.port),
        secret: options.secret,
        path: options.path
      });
      
      console.log(`\n✅ Webhook server başlatıldı`);
      console.log(`   Port: ${options.port}`);
      console.log(`   Path: ${options.path}`);
      console.log(`   Secret: ${options.secret ? '***' : 'Not set (insecure)'}`);
      console.log(`\n📝 GitHub webhook URL: http://your-server:${options.port}${options.path}`);
      console.log(`   Content type: application/json`);
      console.log(`   Events: push`);
      
      // Process'i canlı tut
      process.on('SIGINT', () => {
        console.log('\n\n🛑 Webhook server durduruluyor...');
        process.exit(0);
      });
    } catch (error: any) {
      logger.error('Webhook server hatası', 'cli', error);
      console.error(`\n❌ Hata: ${error.message}`);
      process.exit(1);
    }
  });

// CLI'yi çalıştır
program.parse();

