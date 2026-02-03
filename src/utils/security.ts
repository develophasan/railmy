import { logger } from '../logger/logger.js';

/**
 * Shell injection koruması
 * Sadece güvenli karakterlere izin ver
 */
export function sanitizeInput(input: string): string {
  // Tehlikeli karakterleri temizle
  const dangerous = /[;&|`$(){}[\]<>]/g;
  return input.replace(dangerous, '');
}

/**
 * URL whitelist kontrolü
 * Sadece GitHub URL'lerine izin ver
 */
export function validateRepoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Sadece GitHub'a izin ver
    const allowedHosts = [
      'github.com',
      'www.github.com'
    ];
    
    if (!allowedHosts.includes(parsed.hostname.toLowerCase())) {
      logger.warn(`İzin verilmeyen host: ${parsed.hostname}`);
      return false;
    }
    
    // HTTPS veya SSH protokolü
    if (!['https:', 'http:'].includes(parsed.protocol) && !url.startsWith('git@')) {
      logger.warn(`İzin verilmeyen protokol: ${parsed.protocol}`);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error('Geçersiz URL formatı', 'security', error as Error);
    return false;
  }
}

/**
 * Path traversal koruması
 */
export function sanitizePath(path: string): string {
  // Path traversal saldırılarını önle
  return path
    .replace(/\.\./g, '')
    .replace(/\/\//g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/**
 * Proje adından güvenli dosya adı oluştur
 */
export function sanitizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Environment variable key validation
 */
export function validateEnvKey(key: string): boolean {
  // Sadece alfanumerik ve underscore
  return /^[A-Z_][A-Z0-9_]*$/.test(key);
}

