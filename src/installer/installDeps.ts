import { execa } from 'execa';
import path from 'path';
import { logger } from '../logger/logger.js';
import { PackageManager } from '../types/index.js';
import { getBuildLogPath } from '../utils/paths.js';
import fs from 'fs-extra';

export interface InstallOptions {
  projectPath: string;
  packageManager: PackageManager;
  subPath?: string; // Monorepo için alt dizin
}

/**
 * Bağımlılıkları kur
 */
export async function installDependencies(
  options: InstallOptions
): Promise<void> {
  const { projectPath, packageManager, subPath } = options;
  const workDir = subPath ? path.join(projectPath, subPath) : projectPath;

  logger.info(`Bağımlılıklar kuruluyor: ${workDir} (${packageManager})`, 'installer');

  const buildLogPath = getBuildLogPath(path.basename(projectPath));
  await fs.ensureFile(buildLogPath);

  try {
    let installCommand: string;
    let installArgs: string[];

    // Lock file kontrolü
    const hasLockFile = 
      (packageManager === PackageManager.NPM && await fs.pathExists(path.join(workDir, 'package-lock.json'))) ||
      (packageManager === PackageManager.YARN && await fs.pathExists(path.join(workDir, 'yarn.lock'))) ||
      (packageManager === PackageManager.PNPM && await fs.pathExists(path.join(workDir, 'pnpm-lock.yaml')));

    switch (packageManager) {
      case PackageManager.PNPM:
        installCommand = 'pnpm';
        installArgs = hasLockFile ? ['install', '--frozen-lockfile'] : ['install'];
        break;
      case PackageManager.YARN:
        installCommand = 'yarn';
        installArgs = hasLockFile ? ['install', '--frozen-lockfile'] : ['install'];
        break;
      case PackageManager.NPM:
      default:
        installCommand = 'npm';
        // npm ci --legacy-peer-deps desteklemiyor, bu yüzden her zaman install kullan
        // Dependency conflict'leri için legacy-peer-deps kullan
        installArgs = ['install', '--legacy-peer-deps'];
        break;
    }

    logger.info(`Komut: ${installCommand} ${installArgs.join(' ')}`, 'installer');

    const result = await execa(installCommand, installArgs, {
      cwd: workDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'production'
      }
    });

    // Log dosyasına yaz
    const logEntry = `[${new Date().toISOString()}] Install Output:\n${result.stdout}\n${result.stderr}\n\n`;
    await fs.appendFile(buildLogPath, logEntry);

    logger.success(`Bağımlılıklar başarıyla kuruldu`, 'installer');
    await logger.logCommandOutput(
      `${installCommand} ${installArgs.join(' ')}`,
      result.stdout,
      result.stderr,
      result.exitCode
    );
  } catch (error: any) {
    const errorMessage = error.stderr || error.message;
    
    // Log dosyasına hata yaz
    const logEntry = `[${new Date().toISOString()}] Install Error:\n${errorMessage}\n${error.stack || ''}\n\n`;
    await fs.appendFile(buildLogPath, logEntry);

    logger.error(
      `Bağımlılık kurulum hatası: ${errorMessage}`,
      'installer',
      error
    );
    throw new Error(`Dependency installation failed: ${errorMessage}`);
  }
}

