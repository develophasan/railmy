import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../logger/logger.js';
import { validateRepoUrl } from '../utils/security.js';
import { getProjectPath } from '../utils/paths.js';

export interface CloneOptions {
  repoUrl: string;
  branch: string;
  projectName: string;
  force?: boolean; // Mevcut dizini sil ve yeniden klonla
}

/**
 * GitHub repo'yu klonla
 */
export async function cloneRepo(options: CloneOptions): Promise<string> {
  const { repoUrl, branch, projectName, force = false } = options;

  // URL validasyonu
  if (!validateRepoUrl(repoUrl)) {
    throw new Error(`Geçersiz repo URL: ${repoUrl}`);
  }

  const projectPath = getProjectPath(projectName);
  logger.info(`Proje dizini: ${projectPath}`, 'github');

  // Dizin zaten varsa
  if (await fs.pathExists(projectPath)) {
    if (force) {
      logger.warn(`Mevcut dizin siliniyor: ${projectPath}`, 'github');
      await fs.remove(projectPath);
    } else {
      logger.info(`Dizin zaten mevcut, güncelleniyor: ${projectPath}`, 'github');
      return updateRepo(projectPath, branch);
    }
  }

  // Dizin oluştur
  await fs.ensureDir(path.dirname(projectPath));

  logger.info(`Repo klonlanıyor: ${repoUrl} (branch: ${branch})`, 'github');

  try {
    // Git clone komutu
    const cloneArgs = [
      'clone',
      '--branch',
      branch,
      '--depth',
      '1', // Shallow clone (daha hızlı)
      repoUrl,
      projectPath
    ];

    const result = await execa('git', cloneArgs, {
      cwd: path.dirname(projectPath),
      stdio: 'pipe'
    });

    logger.success(`Repo başarıyla klonlandı: ${projectPath}`, 'github');
    await logger.logCommandOutput(
      `git clone ${repoUrl}`,
      result.stdout,
      result.stderr,
      result.exitCode
    );

    return projectPath;
  } catch (error: any) {
    const errorMessage = error.stderr || error.message;
    logger.error(
      `Repo klonlama hatası: ${errorMessage}`,
      'github',
      error
    );
    throw new Error(`Git clone failed: ${errorMessage}`);
  }
}

/**
 * Mevcut repo'yu güncelle (pull)
 */
async function updateRepo(projectPath: string, branch: string): Promise<string> {
  logger.info(`Repo güncelleniyor: ${projectPath}`, 'github');

  try {
    // Branch'i kontrol et
    const currentBranchResult = await execa('git', ['branch', '--show-current'], {
      cwd: projectPath,
      stdio: 'pipe'
    });

    const currentBranch = currentBranchResult.stdout.trim();

    // Branch değişikliği gerekirse
    if (currentBranch !== branch) {
      logger.info(`Branch değiştiriliyor: ${currentBranch} -> ${branch}`, 'github');
      await execa('git', ['checkout', branch], {
        cwd: projectPath,
        stdio: 'pipe'
      });
    }

    // Pull yap
    const pullResult = await execa('git', ['pull', 'origin', branch], {
      cwd: projectPath,
      stdio: 'pipe'
    });

    logger.success(`Repo güncellendi: ${projectPath}`, 'github');
    await logger.logCommandOutput(
      `git pull origin ${branch}`,
      pullResult.stdout,
      pullResult.stderr,
      pullResult.exitCode
    );

    return projectPath;
  } catch (error: any) {
    const errorMessage = error.stderr || error.message;
    logger.error(
      `Repo güncelleme hatası: ${errorMessage}`,
      'github',
      error
    );
    throw new Error(`Git pull failed: ${errorMessage}`);
  }
}

