import fs from 'fs-extra';
import path from 'path';
import { logger } from '../logger/logger.js';
import {
  ProjectType,
  PackageManager,
  ProjectAnalysis
} from '../types/index.js';

/**
 * package.json dosyasını oku ve analiz et
 */
async function readPackageJson(projectPath: string): Promise<any | null> {
  const packageJsonPath = path.join(projectPath, 'package.json');
  
  if (!(await fs.pathExists(packageJsonPath))) {
    return null;
  }

  return await fs.readJson(packageJsonPath);
}

/**
 * Package manager tespit et
 */
async function detectPackageManager(projectPath: string): Promise<PackageManager> {
  // lock file'lara bak
  if (await fs.pathExists(path.join(projectPath, 'pnpm-lock.yaml'))) {
    return PackageManager.PNPM;
  }
  if (await fs.pathExists(path.join(projectPath, 'yarn.lock'))) {
    return PackageManager.YARN;
  }
  return PackageManager.NPM;
}

/**
 * Monorepo kontrolü (turborepo, lerna, nx, workspaces)
 */
async function isMonorepo(packageJson: any, projectPath: string): Promise<boolean> {
  // Workspaces kontrolü
  if (packageJson.workspaces || packageJson.workspaces?.packages) {
    return true;
  }

  // Turborepo kontrolü
  if (packageJson.dependencies?.turbo || packageJson.devDependencies?.turbo) {
    return true;
  }

  // Lerna kontrolü
  if (packageJson.dependencies?.lerna || packageJson.devDependencies?.lerna) {
    return true;
  }

  // Nx kontrolü
  const nxJsonPath = path.join(projectPath, 'nx.json');
  if (await fs.pathExists(nxJsonPath)) {
    return true;
  }

  return false;
}

/**
 * Monorepo yapısını analiz et
 */
async function analyzeMonorepo(projectPath: string): Promise<{
  frontendPath?: string;
  backendPath?: string;
}> {
  const commonFrontendPaths = [
    'apps/frontend',
    'apps/web',
    'packages/frontend',
    'packages/web',
    'frontend',
    'web'
  ];

  const commonBackendPaths = [
    'apps/backend',
    'apps/api',
    'apps/server',
    'packages/backend',
    'packages/api',
    'packages/server',
    'backend',
    'api',
    'server',
    'customer', // Microservices için
    'products',
    'shopping',
    'orders',
    'payment'
  ];

  let frontendPath: string | undefined;
  let backendPath: string | undefined;

  // Frontend ara
  for (const frontendDir of commonFrontendPaths) {
    const fullPath = path.join(projectPath, frontendDir);
    if (await fs.pathExists(fullPath)) {
      const packageJsonPath = path.join(fullPath, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        frontendPath = frontendDir;
        break;
      }
    }
  }

  // Backend ara
  for (const backendDir of commonBackendPaths) {
    const fullPath = path.join(projectPath, backendDir);
    if (await fs.pathExists(fullPath)) {
      const packageJsonPath = path.join(fullPath, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        backendPath = backendDir;
        break;
      }
    }
  }

  // Eğer hiçbir standart path bulunamadıysa, tüm alt dizinleri tara
  if (!frontendPath && !backendPath) {
    try {
      const entries = await fs.readdir(projectPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const subPath = path.join(projectPath, entry.name);
          const packageJsonPath = path.join(subPath, 'package.json');
          
          if (await fs.pathExists(packageJsonPath)) {
            // package.json içeriğine bakarak frontend/backend tespit et
            try {
              const pkg = await fs.readJson(packageJsonPath);
              const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
              
              // Frontend framework kontrolü
              const isFrontend = ['react', 'vue', 'angular', 'next', 'nuxt', 'svelte'].some(fw => deps[fw]);
              // Backend framework kontrolü
              const isBackend = ['express', 'fastify', 'koa', 'nest', '@nestjs/core'].some(fw => deps[fw]);
              
              if (isFrontend && !frontendPath) {
                frontendPath = entry.name;
              }
              if (isBackend && !backendPath) {
                backendPath = entry.name;
              }
            } catch {
              // package.json okunamazsa atla
            }
          }
        }
      }
    } catch (error) {
      // Dizin okuma hatası
      logger.warn(`Monorepo analizi hatası: ${error}`, 'analyzer');
    }
  }

  return { frontendPath, backendPath };
}

/**
 * Frontend tipi tespit et (SSR mi, static mi?)
 */
function detectFrontendType(packageJson: any): {
  isSSR: boolean;
  staticOutputDir?: string;
} {
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  };

  // Next.js (SSR)
  if (dependencies.next) {
    return {
      isSSR: true,
      staticOutputDir: '.next'
    };
  }

  // Nuxt (SSR)
  if (dependencies.nuxt || dependencies['nuxt3']) {
    return {
      isSSR: true,
      staticOutputDir: '.output'
    };
  }

  // Remix (SSR)
  if (dependencies['@remix-run/node']) {
    return {
      isSSR: true
    };
  }

  // Vite/React/Vue (Static)
  if (dependencies.vite) {
    return {
      isSSR: false,
      staticOutputDir: 'dist'
    };
  }

  // Create React App
  if (dependencies.react && dependencies['react-scripts']) {
    return {
      isSSR: false,
      staticOutputDir: 'build'
    };
  }

  // Varsayılan: static
  return {
    isSSR: false,
    staticOutputDir: 'dist'
  };
}

/**
 * Proje tipini tespit et ve analiz et
 */
export async function detectProjectType(
  projectPath: string,
  userSpecifiedType?: ProjectType
): Promise<ProjectAnalysis> {
  logger.info('Proje tipi analiz ediliyor...', 'analyzer');

  try {
    // Önce root'ta package.json var mı kontrol et
    let packageJson = await readPackageJson(projectPath);
    
    // Root'ta package.json yoksa, monorepo olabilir - alt dizinleri kontrol et
    if (!packageJson) {
      logger.info('Root\'ta package.json bulunamadı, monorepo yapısı kontrol ediliyor...', 'analyzer');
      const { frontendPath, backendPath } = await analyzeMonorepo(projectPath);
      
      if (frontendPath || backendPath) {
        // Monorepo tespit edildi
        logger.info('Monorepo yapısı tespit edildi', 'analyzer');
        
        // Alt dizinlerden package manager tespit et
        let packageManager = PackageManager.NPM;
        if (backendPath) {
          packageManager = await detectPackageManager(path.join(projectPath, backendPath));
        } else if (frontendPath) {
          packageManager = await detectPackageManager(path.join(projectPath, frontendPath));
        }
        
        return {
          type: ProjectType.MONOREPO,
          packageManager,
          hasBuildScript: false, // Alt dizinlerde kontrol edilecek
          hasStartScript: false,
          frontendPath,
          backendPath,
          isSSR: false
        };
      } else {
        throw new Error('package.json bulunamadı ve monorepo yapısı tespit edilemedi');
      }
    }
    
    const packageManager = await detectPackageManager(projectPath);

    logger.info(`Package manager: ${packageManager}`, 'analyzer');

    // Kullanıcı tipi belirtmişse, onu kullan
    if (userSpecifiedType && userSpecifiedType !== ProjectType.UNKNOWN) {
      logger.info(`Kullanıcı belirtilen tip: ${userSpecifiedType}`, 'analyzer');
      
      const analysis: ProjectAnalysis = {
        type: userSpecifiedType,
        packageManager,
        hasBuildScript: !!(packageJson?.scripts?.build),
        hasStartScript: !!(packageJson?.scripts?.start),
        buildCommand: packageJson?.scripts?.build,
        startCommand: packageJson?.scripts?.start,
        isSSR: false
      };

      // Monorepo ise alt dizinleri bul
      if (userSpecifiedType === ProjectType.MONOREPO || (packageJson && await isMonorepo(packageJson, projectPath))) {
        const { frontendPath, backendPath } = await analyzeMonorepo(projectPath);
        analysis.frontendPath = frontendPath;
        analysis.backendPath = backendPath;
        analysis.type = ProjectType.MONOREPO;
      }

      // Frontend ise tipi tespit et
      if (userSpecifiedType === ProjectType.FRONTEND && packageJson) {
        const frontendInfo = detectFrontendType(packageJson);
        analysis.isSSR = frontendInfo.isSSR;
        analysis.staticOutputDir = frontendInfo.staticOutputDir;
      }

      return analysis;
    }

    // Otomatik tespit
    if (!packageJson) {
      throw new Error('package.json bulunamadı');
    }
    
    const isMono = await isMonorepo(packageJson, projectPath);
    
    if (isMono) {
      logger.info('Monorepo tespit edildi', 'analyzer');
      const { frontendPath, backendPath } = await analyzeMonorepo(projectPath);
      
      return {
        type: ProjectType.MONOREPO,
        packageManager,
        hasBuildScript: !!(packageJson?.scripts?.build),
        hasStartScript: !!(packageJson?.scripts?.start),
        buildCommand: packageJson?.scripts?.build,
        startCommand: packageJson?.scripts?.start,
        frontendPath,
        backendPath,
        isSSR: false
      };
    }

    // Backend mi frontend mi?
    const dependencies = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {})
    };

    // Backend framework'leri
    const backendFrameworks = [
      'express',
      'fastify',
      'koa',
      'nest',
      '@nestjs/core',
      'hapi',
      'restify'
    ];

    const isBackend = backendFrameworks.some(fw => dependencies[fw]);

    if (isBackend) {
      logger.info('Backend projesi tespit edildi', 'analyzer');
      return {
        type: ProjectType.BACKEND,
        packageManager,
        hasBuildScript: !!packageJson.scripts?.build,
        hasStartScript: !!packageJson.scripts?.start,
        buildCommand: packageJson.scripts?.build,
        startCommand: packageJson.scripts?.start,
        isSSR: false
      };
    }

    // Frontend framework'leri
    const frontendFrameworks = [
      'react',
      'vue',
      'angular',
      'svelte',
      'next',
      'nuxt',
      'remix'
    ];

    const isFrontend = frontendFrameworks.some(fw => dependencies[fw]);

    if (isFrontend) {
      logger.info('Frontend projesi tespit edildi', 'analyzer');
      const frontendInfo = detectFrontendType(packageJson);
      
      return {
        type: ProjectType.FRONTEND,
        packageManager,
        hasBuildScript: !!packageJson.scripts?.build,
        hasStartScript: !!packageJson.scripts?.start,
        buildCommand: packageJson.scripts?.build,
        startCommand: packageJson.scripts?.start,
        isSSR: frontendInfo.isSSR,
        staticOutputDir: frontendInfo.staticOutputDir
      };
    }

    // Bilinmeyen tip
    logger.warn('Proje tipi otomatik tespit edilemedi', 'analyzer');
    return {
      type: ProjectType.UNKNOWN,
      packageManager,
      hasBuildScript: !!packageJson.scripts?.build,
      hasStartScript: !!packageJson.scripts?.start,
      buildCommand: packageJson.scripts?.build,
      startCommand: packageJson.scripts?.start,
      isSSR: false
    };
  } catch (error) {
    logger.error('Proje analizi hatası', 'analyzer', error as Error);
    throw error;
  }
}

