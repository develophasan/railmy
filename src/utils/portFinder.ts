import { execa } from 'execa';
import { logger } from '../logger/logger.js';

/**
 * Belirtilen port'un kullanımda olup olmadığını kontrol et
 */
export async function isPortInUse(port: number): Promise<boolean> {
  try {
    // ss veya netstat ile port kontrolü
    try {
      const result = await execa('ss', ['-tuln'], { stdio: 'pipe' });
      return result.stdout.includes(`:${port} `) || result.stdout.includes(`:${port}\n`);
    } catch {
      // ss yoksa netstat dene
      try {
        const result = await execa('netstat', ['-tuln'], { stdio: 'pipe' });
        return result.stdout.includes(`:${port} `) || result.stdout.includes(`:${port}\n`);
      } catch {
        // Her ikisi de yoksa, lsof dene
        try {
          await execa('lsof', ['-i', `:${port}`], { stdio: 'pipe' });
          return true; // lsof başarılıysa port kullanımda
        } catch {
          // lsof hata verirse port boş
          return false;
        }
      }
    }
  } catch (error) {
    logger.warn(`Port kontrolü yapılamadı: ${error}`, 'port-finder');
    return false; // Hata durumunda false dön (güvenli taraf)
  }
}

/**
 * Boş bir port bul (belirtilen port'tan başlayarak)
 */
export async function findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
  let port = startPort;
  let attempts = 0;

  while (attempts < maxAttempts) {
    const inUse = await isPortInUse(port);
    
    if (!inUse) {
      if (port !== startPort) {
        logger.info(`Port ${startPort} kullanımda, ${port} portu kullanılıyor`, 'port-finder');
      }
      return port;
    }

    port++;
    attempts++;
  }

  // Tüm portlar doluysa, başlangıç portunu dön (kullanıcı uyarılsın)
  logger.warn(`Port ${startPort}-${port} arası tüm portlar kullanımda, ${startPort} kullanılıyor`, 'port-finder');
  return startPort;
}

