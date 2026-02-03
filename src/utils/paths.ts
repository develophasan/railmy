import path from 'path';
import os from 'os';
import { sanitizeProjectName } from './security.js';

/**
 * Uygulama kök dizini
 */
export const APPS_DIR = process.env.APPS_DIR || (os.platform() === 'win32' 
  ? path.join(os.tmpdir(), 'raillmy-apps')
  : '/var/apps');

/**
 * Proje dizin yolu oluştur
 */
export function getProjectPath(projectName: string): string {
  const safeName = sanitizeProjectName(projectName);
  return path.join(APPS_DIR, safeName);
}

/**
 * Build log dosyası yolu
 */
export function getBuildLogPath(projectName: string): string {
  const safeName = sanitizeProjectName(projectName);
  return path.join(APPS_DIR, safeName, 'build.log');
}

/**
 * Runtime log dosyası yolu
 */
export function getRuntimeLogPath(projectName: string): string {
  const safeName = sanitizeProjectName(projectName);
  return path.join(APPS_DIR, safeName, 'runtime.log');
}

/**
 * Nginx config dosyası yolu
 */
export function getNginxConfigPath(projectName: string): string {
  const safeName = sanitizeProjectName(projectName);
  return path.join('/etc/nginx/conf.d', `${safeName}.conf`);
}

/**
 * Environment file yolu
 */
export function getEnvFilePath(projectPath: string): string {
  return path.join(projectPath, '.env');
}

/**
 * Geçici dizin oluştur (test için)
 */
export function getTempDir(): string {
  if (process.env.NODE_ENV === 'test' || os.platform() === 'win32') {
    return path.join(os.tmpdir(), 'raillmy-apps');
  }
  return APPS_DIR;
}

