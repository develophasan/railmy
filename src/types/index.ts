/**
 * Proje tipi enum
 */
export enum ProjectType {
  BACKEND = 'backend',
  FRONTEND = 'frontend',
  MONOREPO = 'monorepo',
  UNKNOWN = 'unknown'
}

/**
 * Package manager tipi
 */
export enum PackageManager {
  NPM = 'npm',
  YARN = 'yarn',
  PNPM = 'pnpm'
}

/**
 * Deploy konfigürasyonu
 */
export interface DeployConfig {
  repoUrl: string;
  branch: string;
  projectType: ProjectType;
  port?: number;
  envVars?: Record<string, string>;
  projectName: string;
  basePath?: string; // Nginx için base path (örn: /api)
}

/**
 * Proje analiz sonucu
 */
export interface ProjectAnalysis {
  type: ProjectType;
  packageManager: PackageManager;
  hasBuildScript: boolean;
  hasStartScript: boolean;
  buildCommand?: string;
  startCommand?: string;
  frontendPath?: string; // Monorepo için
  backendPath?: string; // Monorepo için
  isSSR: boolean; // Frontend SSR mi?
  staticOutputDir?: string; // Frontend build çıktısı
}

/**
 * Deploy sonucu
 */
export interface DeployResult {
  success: boolean;
  projectPath: string;
  port?: number;
  nginxConfigPath?: string;
  pm2ProcessName?: string;
  error?: string;
  logs?: {
    build?: string;
    runtime?: string;
  };
}

