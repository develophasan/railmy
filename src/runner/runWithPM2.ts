import { execa } from 'execa';
import path from 'path';
import { logger } from '../logger/logger.js';
import { PackageManager, ProjectAnalysis } from '../types/index.js';
import { getRuntimeLogPath, getEnvFilePath } from '../utils/paths.js';
import fs from 'fs-extra';

export interface RunOptions {
  projectPath: string;
  packageManager: PackageManager;
  analysis: ProjectAnalysis;
  projectName: string;
  port?: number;
  envVars?: Record<string, string>;
  subPath?: string; // Monorepo için
}

/**
 * PM2 ile servisi başlat
 */
export async function runWithPM2(options: RunOptions): Promise<string> {
  const {
    projectPath,
    packageManager,
    analysis,
    projectName,
    port,
    envVars,
    subPath
  } = options;

  const workDir = subPath ? path.join(projectPath, subPath) : projectPath;
  const processName = `${projectName}${subPath ? `-${path.basename(subPath)}` : ''}`;

  logger.info(`PM2 ile başlatılıyor: ${processName}`, 'runner');

  // Start script kontrolü
  if (!analysis.hasStartScript) {
    throw new Error('Start script bulunamadı');
  }

  // Environment variables dosyası oluştur
  const envFilePath = getEnvFilePath(workDir);
  if (envVars || port) {
    let envContent = '';
    
    if (port) {
      envContent += `PORT=${port}\n`;
    }
    
    if (envVars) {
      for (const [key, value] of Object.entries(envVars)) {
        envContent += `${key}=${value}\n`;
      }
    }
    
    await fs.writeFile(envFilePath, envContent);
    logger.info(`Environment variables dosyası oluşturuldu: ${envFilePath}`, 'runner');
  }

  // PM2 ecosystem dosyası oluştur
  const ecosystemPath = path.join(workDir, 'ecosystem.config.js');
  const { script: startScript, envVars: scriptEnvVars } = await getStartScript(packageManager, analysis, workDir);
  
  // Script'ten gelen env var'ları birleştir
  const allEnvVars = { ...envVars, ...scriptEnvVars };
  
  const ecosystemConfig = generateEcosystemConfig({
    name: processName,
    script: startScript,
    cwd: workDir,
    envFile: envFilePath,
    port,
    envVars: allEnvVars,
    logPath: getRuntimeLogPath(projectName)
  });

  await fs.writeFile(ecosystemPath, ecosystemConfig);
  logger.info(`PM2 ecosystem config oluşturuldu: ${ecosystemPath}`, 'runner');

  try {
    // Mevcut process'i durdur (varsa)
    try {
      await execa('pm2', ['delete', processName], {
        stdio: 'pipe'
      });
      logger.info(`Mevcut process durduruldu: ${processName}`, 'runner');
    } catch {
      // Process yoksa hata verme
    }

    // PM2 ile başlat
    const result = await execa('pm2', ['start', ecosystemPath], {
      stdio: 'pipe'
    });

    logger.success(`PM2 process başlatıldı: ${processName}`, 'runner');
    await logger.logCommandOutput(
      `pm2 start ${ecosystemPath}`,
      result.stdout,
      result.stderr,
      result.exitCode
    );

    // Process bilgilerini göster
    const statusResult = await execa('pm2', ['show', processName], {
      stdio: 'pipe'
    });
    
    logger.info(`Process durumu:\n${statusResult.stdout}`, 'runner');

    return processName;
  } catch (error: any) {
    const errorMessage = error.stderr || error.message;
    logger.error(
      `PM2 başlatma hatası: ${errorMessage}`,
      'runner',
      error
    );
    throw new Error(`PM2 start failed: ${errorMessage}`);
  }
}

/**
 * Start script komutunu oluştur ve environment variable'ları ayır
 */
async function getStartScript(
  packageManager: PackageManager,
  analysis: ProjectAnalysis,
  workDir: string
): Promise<{ script: string; envVars: Record<string, string> }> {
  const envVars: Record<string, string> = {};
  
  // package.json'dan start script'ini oku
  try {
    const packageJsonPath = path.join(workDir, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      const startScript = packageJson.scripts?.start || analysis.startCommand;
      
      if (startScript) {
        // Environment variable'ları ayır (NODE_ENV=prod node src/app.js gibi)
        let cleanScript = startScript;
        const envRegex = /^([A-Z_][A-Z0-9_]*)=([^\s]+)\s+/;
        
        while (envRegex.test(cleanScript)) {
          const match = cleanScript.match(envRegex);
          if (match) {
            const [, key, value] = match;
            envVars[key] = value;
            cleanScript = cleanScript.replace(envRegex, '');
          }
        }
        
        // Eğer temizlenmiş script direkt node komutu ise
        if (cleanScript.trim().startsWith('node ') || cleanScript.trim().includes('node ')) {
          return { script: cleanScript.trim(), envVars };
        }
        
        // npm/pnpm/yarn komutu ise
        switch (packageManager) {
          case PackageManager.PNPM:
            return { script: 'pnpm run start', envVars };
          case PackageManager.YARN:
            return { script: 'yarn start', envVars };
          case PackageManager.NPM:
          default:
            return { script: 'npm run start', envVars };
        }
      }
    }
  } catch (error) {
    // Hata durumunda varsayılan kullan
  }

  // Varsayılan: npm run start
  const script = analysis.startCommand || 'start';
  switch (packageManager) {
    case PackageManager.PNPM:
      return { script: `pnpm run ${script}`, envVars };
    case PackageManager.YARN:
      return { script: `yarn ${script}`, envVars };
    case PackageManager.NPM:
    default:
      return { script: `npm run ${script}`, envVars };
  }
}

/**
 * PM2 ecosystem config oluştur
 */
function generateEcosystemConfig(options: {
  name: string;
  script: string;
  cwd: string;
  envFile: string;
  port?: number;
  envVars?: Record<string, string>;
  logPath: string;
}): string {
  const { name, script, cwd, envFile, port, envVars, logPath } = options;

  // PM2 shell komutları için interpreter kullan
  const isShellCommand = script.includes('npm') || script.includes('pnpm') || script.includes('yarn');
  
  // Environment variables objesi oluştur
  const envObj: Record<string, string | number> = {};
  if (port) {
    envObj.PORT = port;
  }
  if (envVars) {
    for (const [key, value] of Object.entries(envVars)) {
      envObj[key] = value;
    }
  }
  
  const envStr = Object.keys(envObj).length > 0 
    ? `env: ${JSON.stringify(envObj, null, 2).split('\n').map((line, i) => i === 0 ? line : '      ' + line).join('\n')},`
    : '';
  
  return `module.exports = {
  apps: [{
    name: '${name}',
    script: '${script}',
    ${isShellCommand ? `interpreter: 'bash',` : ''}
    cwd: '${cwd}',
    env_file: '${envFile}',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    error_file: '${logPath}',
    out_file: '${logPath}',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    ${envStr}
  }]
};
`;
}

