import { execa } from 'execa';
import path from 'path';
import { logger } from '../logger/logger.js';
import { PackageManager, ProjectType, ProjectAnalysis } from '../types/index.js';
import { getBuildLogPath } from '../utils/paths.js';
import fs from 'fs-extra';

export interface BuildOptions {
  projectPath: string;
  packageManager: PackageManager;
  analysis: ProjectAnalysis;
  subPath?: string; // Monorepo için
}

/**
 * Projeyi build et
 */
export async function buildProject(options: BuildOptions): Promise<void> {
  const { projectPath, packageManager, analysis, subPath } = options;
  const workDir = subPath ? path.join(projectPath, subPath) : projectPath;

  // Build script yoksa atla
  if (!analysis.hasBuildScript) {
    logger.warn('Build script bulunamadı, build atlanıyor', 'builder');
    return;
  }

  logger.info(`Build başlatılıyor: ${workDir}`, 'builder');

  const buildLogPath = getBuildLogPath(path.basename(projectPath));
  await fs.ensureFile(buildLogPath);

  try {
    let buildCommand: string;
    let buildArgs: string[];

    switch (packageManager) {
      case PackageManager.PNPM:
        buildCommand = 'pnpm';
        buildArgs = ['run', 'build'];
        break;
      case PackageManager.YARN:
        buildCommand = 'yarn';
        buildArgs = ['build'];
        break;
      case PackageManager.NPM:
      default:
        buildCommand = 'npm';
        buildArgs = ['run', 'build'];
        break;
    }

    logger.info(`Komut: ${buildCommand} ${buildArgs.join(' ')}`, 'builder');

    const result = await execa(buildCommand, buildArgs, {
      cwd: workDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        // Windows'ta node_modules/.bin'i PATH'e ekle
        PATH: `${path.join(workDir, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}`
      }
    });

    // Log dosyasına yaz
    const logEntry = `[${new Date().toISOString()}] Build Output:\n${result.stdout}\n${result.stderr}\n\n`;
    await fs.appendFile(buildLogPath, logEntry);

    logger.success(`Build tamamlandı`, 'builder');
    await logger.logCommandOutput(
      `${buildCommand} ${buildArgs.join(' ')}`,
      result.stdout,
      result.stderr,
      result.exitCode
    );

    // Build çıktısını kontrol et (frontend için)
    if (analysis.type === ProjectType.FRONTEND && !analysis.isSSR && analysis.staticOutputDir) {
      const outputDir = path.join(workDir, analysis.staticOutputDir);
      if (await fs.pathExists(outputDir)) {
        logger.success(`Build çıktısı: ${outputDir}`, 'builder');
      } else {
        logger.warn(`Build çıktı dizini bulunamadı: ${outputDir}`, 'builder');
      }
    }
  } catch (error: any) {
    const errorMessage = error.stderr || error.message;
    
    // Log dosyasına hata yaz
    const logEntry = `[${new Date().toISOString()}] Build Error:\n${errorMessage}\n${error.stack || ''}\n\n`;
    await fs.appendFile(buildLogPath, logEntry);

    logger.error(
      `Build hatası: ${errorMessage}`,
      'builder',
      error
    );
    throw new Error(`Build failed: ${errorMessage}`);
  }
}

