import fs from 'fs-extra';
import path from 'path';
import { APPS_DIR } from './paths.js';
import { logger } from '../logger/logger.js';

export interface ProjectMetadata {
  name: string;
  repoUrl: string;
  branch: string;
  type: string;
  port?: number;
  basePath: string;
  createdAt: string;
  updatedAt: string;
  pm2ProcessName?: string;
  nginxConfigPath?: string;
  environment?: string; // 'production', 'staging', 'development'
  webhookEnabled?: boolean;
}

const METADATA_FILE = 'metadata.json';

/**
 * Proje metadata dosyasının path'ini döndür
 */
export function getMetadataPath(projectName: string): string {
  return path.join(APPS_DIR, projectName, METADATA_FILE);
}

/**
 * Proje metadata'sını kaydet
 */
export async function saveMetadata(metadata: ProjectMetadata): Promise<void> {
  const metadataPath = getMetadataPath(metadata.name);
  const projectDir = path.dirname(metadataPath);
  
  await fs.ensureDir(projectDir);
  await fs.writeJSON(metadataPath, metadata, { spaces: 2 });
  
  logger.info(`Metadata kaydedildi: ${metadataPath}`, 'metadata');
}

/**
 * Proje metadata'sını oku
 */
export async function loadMetadata(projectName: string): Promise<ProjectMetadata | null> {
  const metadataPath = getMetadataPath(projectName);
  
  if (!(await fs.pathExists(metadataPath))) {
    return null;
  }
  
  try {
    const metadata = await fs.readJSON(metadataPath);
    return metadata as ProjectMetadata;
  } catch (error: any) {
    logger.error(`Metadata okuma hatası: ${error.message}`, 'metadata', error);
    return null;
  }
}

/**
 * Proje metadata'sını güncelle
 */
export async function updateMetadata(projectName: string, updates: Partial<ProjectMetadata>): Promise<void> {
  const existing = await loadMetadata(projectName);
  
  if (!existing) {
    throw new Error(`Metadata bulunamadı: ${projectName}`);
  }
  
  const updated: ProjectMetadata = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString()
  };
  
  await saveMetadata(updated);
}

/**
 * Tüm projelerin metadata'larını listele
 */
export async function listAllProjects(): Promise<ProjectMetadata[]> {
  const projects: ProjectMetadata[] = [];
  
  if (!(await fs.pathExists(APPS_DIR))) {
    return projects;
  }
  
  const entries = await fs.readdir(APPS_DIR);
  
  for (const entry of entries) {
    const projectPath = path.join(APPS_DIR, entry);
    const stat = await fs.stat(projectPath);
    
    if (stat.isDirectory()) {
      const metadata = await loadMetadata(entry);
      if (metadata) {
        projects.push(metadata);
      }
    }
  }
  
  return projects.sort((a, b) => 
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Metadata'yı sil
 */
export async function deleteMetadata(projectName: string): Promise<void> {
  const metadataPath = getMetadataPath(projectName);
  
  if (await fs.pathExists(metadataPath)) {
    await fs.remove(metadataPath);
    logger.info(`Metadata silindi: ${metadataPath}`, 'metadata');
  }
}

