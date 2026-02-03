import { execa } from 'execa';
import { logger } from '../logger/logger.js';
import { loadMetadata } from '../utils/metadata.js';

export interface HealthStatus {
  healthy: boolean;
  projectName: string;
  pm2Status?: 'online' | 'stopped' | 'errored' | 'unknown';
  port?: number;
  lastCheck: string;
  uptime?: number;
  restarts?: number;
  memory?: number;
  cpu?: number;
}

/**
 * Projenin health durumunu kontrol et
 */
export async function checkHealth(projectName: string): Promise<HealthStatus> {
  const metadata = await loadMetadata(projectName);
  
  if (!metadata) {
    return {
      healthy: false,
      projectName,
      lastCheck: new Date().toISOString()
    };
  }

  const status: HealthStatus = {
    healthy: false,
    projectName,
    port: metadata.port,
    lastCheck: new Date().toISOString()
  };

  // PM2 process durumunu kontrol et
  if (metadata.pm2ProcessName) {
    try {
      const { stdout } = await execa('pm2', ['jlist']);
      const processes = JSON.parse(stdout);
      const process = processes.find((p: any) => p.name === metadata.pm2ProcessName);

      if (process) {
        status.pm2Status = process.pm2_env?.status as any || 'unknown';
        status.uptime = process.pm2_env?.pm_uptime;
        status.restarts = process.pm2_env?.restart_time || 0;
        status.memory = process.monit?.memory;
        status.cpu = process.monit?.cpu;
        status.healthy = status.pm2Status === 'online';
      } else {
        status.pm2Status = 'stopped';
      }
    } catch (error: any) {
      logger.error(`Health check hatası: ${error.message}`, 'health-check', error);
      status.pm2Status = 'unknown';
    }
  }

  return status;
}

/**
 * Tüm projelerin health durumunu kontrol et
 */
export async function checkAllHealth(): Promise<HealthStatus[]> {
  const { listAllProjects } = await import('../utils/metadata.js');
  const projects = await listAllProjects();
  
  const statuses = await Promise.all(
    projects.map(project => checkHealth(project.name))
  );

  return statuses;
}

/**
 * Health check endpoint'i için basit HTTP server (opsiyonel)
 */
export async function startHealthCheckServer(port: number = 3002): Promise<void> {
  // Bu özellik daha sonra eklenebilir
  // Şimdilik sadece fonksiyonlar hazır
  logger.info(`Health check server başlatılacak: port ${port}`, 'health-check');
}

