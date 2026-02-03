import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGS_DIR = path.join(__dirname, '../../logs');

// Logs dizinini oluştur
fs.ensureDirSync(LOGS_DIR);

export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS',
  DEBUG = 'DEBUG'
}

class Logger {
  private logFile: string | null = null;

  /**
   * Proje bazlı log dosyası ayarla
   */
  setProject(projectName: string): void {
    this.logFile = path.join(LOGS_DIR, `${projectName}.log`);
  }

  /**
   * Genel log dosyasına yaz
   */
  private async writeToFile(message: string, level: LogLevel): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} [${level}] ${message}\n`;

    try {
      // Genel log dosyası
      const generalLog = path.join(LOGS_DIR, 'general.log');
      await fs.appendFile(generalLog, logEntry);

      // Proje bazlı log dosyası (varsa)
      if (this.logFile) {
        await fs.appendFile(this.logFile, logEntry);
      }
    } catch (error) {
      console.error('Log yazma hatası:', error);
    }
  }

  /**
   * Console renklendirme
   */
  private getColorizedMessage(message: string, level: LogLevel): string {
    switch (level) {
      case LogLevel.INFO:
        return chalk.blue(`[INFO] ${message}`);
      case LogLevel.SUCCESS:
        return chalk.green(`[✓] ${message}`);
      case LogLevel.WARN:
        return chalk.yellow(`[WARN] ${message}`);
      case LogLevel.ERROR:
        return chalk.red(`[ERROR] ${message}`);
      case LogLevel.DEBUG:
        return chalk.gray(`[DEBUG] ${message}`);
      default:
        return message;
    }
  }

  /**
   * Log yazma (hem console hem dosya)
   */
  private async log(
    level: LogLevel,
    message: string,
    context?: string,
    error?: Error
  ): Promise<void> {
    const contextStr = context ? `[${context}] ` : '';
    const fullMessage = `${contextStr}${message}`;

    // Console'a yaz
    console.log(this.getColorizedMessage(fullMessage, level));

    // Hata varsa stack trace ekle
    if (error) {
      console.error(chalk.red(error.stack || error.message));
      await this.writeToFile(
        `${fullMessage}\n${error.stack || error.message}`,
        LogLevel.ERROR
      );
    } else {
      await this.writeToFile(fullMessage, level);
    }
  }

  info(message: string, context?: string): void {
    this.log(LogLevel.INFO, message, context);
  }

  success(message: string, context?: string): void {
    this.log(LogLevel.SUCCESS, message, context);
  }

  warn(message: string, context?: string): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: string, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  debug(message: string, context?: string): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Komut çıktısını logla (stdout/stderr)
   */
  async logCommandOutput(
    _command: string,
    stdout: string,
    stderr: string,
    exitCode: number
  ): Promise<void> {
    if (stdout) {
      await this.writeToFile(`STDOUT:\n${stdout}`, LogLevel.DEBUG);
    }
    
    if (stderr) {
      await this.writeToFile(`STDERR:\n${stderr}`, LogLevel.WARN);
    }
    
    if (exitCode !== 0) {
      await this.writeToFile(
        `Exit code: ${exitCode}`,
        LogLevel.ERROR
      );
    }
  }
}

// Singleton instance
export const logger = new Logger();

