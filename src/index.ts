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
import path from 'path';

const program = new Command();

/**
 * Ana deploy fonksiyonu
 */
async function deploy(config: DeployConfig): Promise<DeployResult> {
  const startTime = Date.now();
  logger.setProject(config.projectName);
  logger.info(`🚀 Deploy başlatılıyor: ${config.projectName}`, 'deploy');

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
          port: config.port,
          envVars: config.envVars,
          subPath: analysis.backendPath
        });
      } else {
        pm2ProcessName = await runWithPM2({
          projectPath,
          packageManager: analysis.packageManager,
          analysis,
          projectName: config.projectName,
          port: config.port,
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
      port: config.port,
      basePath: config.basePath
    });

    // 7. Nginx reload
    logger.info('🔄 Adım 7/7: Nginx reload ediliyor...', 'deploy');
    await reloadNginx();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.success(`✅ Deploy başarıyla tamamlandı! (${duration}s)`, 'deploy');

    return {
      success: true,
      projectPath,
      port: config.port,
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
  .action(async (options) => {
    try {
      // Repo URL'den proje adı çıkar
      const repoUrl = options.repo;
      let projectName = options.name;
      
      if (!projectName) {
        const urlParts = repoUrl.split('/');
        projectName = urlParts[urlParts.length - 1].replace('.git', '');
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
        basePath: options.basePath
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
  .command('status')
  .description('Check deployment status')
  .option('--name <name>', 'Project name')
  .action(async () => {
    try {
      const { execa } = await import('execa');
      const result = await execa('pm2', ['list'], { stdio: 'inherit' });
      process.exit(result.exitCode);
    } catch (error: any) {
      console.error(`PM2 status hatası: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('logs')
  .description('View project logs')
  .requiredOption('--name <name>', 'Project name')
  .option('--lines <number>', 'Number of lines', '100')
  .action(async (options) => {
    try {
      const { execa } = await import('execa');
      const processName = sanitizeProjectName(options.name);
      const result = await execa(
        'pm2',
        ['logs', processName, '--lines', options.lines],
        { stdio: 'inherit' }
      );
      process.exit(result.exitCode);
    } catch (error: any) {
      console.error(`Log görüntüleme hatası: ${error.message}`);
      process.exit(1);
    }
  });

// CLI'yi çalıştır
program.parse();

