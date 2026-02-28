const fs = require('fs').promises;
const path = require('upath');
const { app } = require('electron');

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function formatTimestamp(date) {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function safeStringify(obj) {
  try {
    if (obj instanceof Error) {
      return JSON.stringify({
        name: obj.name,
        message: obj.message,
        stack: obj.stack
      });
    }

    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
  } catch (error) {
    return '[Unserializable]';
  }
}

class ErrorLogger {
  constructor() {
    this.logDir = null;
    this.currentLogFile = null;
    this.currentDate = null;
  }

  async init() {
    try {
      const logsPath = app.getPath('logs');
      this.logDir = path.join(logsPath, 'errors');
      await fs.mkdir(this.logDir, { recursive: true });
      await this.cleanupOldLogs();
    } catch (error) {
      console.error('[ErrorLogger] Failed to initialize:', error);
    }
  }

  async cleanupOldLogs() {
    try {
      const files = await fs.readdir(this.logDir);
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        const filePath = path.join(this.logDir, file);
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs < thirtyDaysAgo) {
          await fs.unlink(filePath);
          console.log(`[ErrorLogger] Deleted old log file: ${file}`);
        }
      }
    } catch (error) {
      console.error('[ErrorLogger] Failed to cleanup old logs:', error);
    }
  }

  getCurrentLogFile() {
    const now = new Date();
    const dateStr = formatDate(now);

    if (dateStr !== this.currentDate) {
      this.currentDate = dateStr;
      this.currentLogFile = path.join(this.logDir, `${dateStr}.log`);
    }

    return this.currentLogFile;
  }

  log(level, context, message, metadata = {}) {
    this._writeLog(level, context, message, metadata).catch(error => {
      console.log(`[ERROR-LOG-FALLBACK] [${level}] [${context}] ${message}`, metadata);
    });
  }

  async _writeLog(level, context, message, metadata) {
    if (!this.logDir) {
      await this.init();
    }

    const timestamp = formatTimestamp(new Date());
    const logFile = this.getCurrentLogFile();

    let logEntry = `[${timestamp}] [${level}] [${context}] ${message}`;

    if (Object.keys(metadata).length > 0) {
      logEntry += ` | ${safeStringify(metadata)}`;
    }

    logEntry += '\n';

    await fs.appendFile(logFile, logEntry, 'utf8');
  }

  info(context, message, metadata = {}) {
    this.log('INFO', context, message, metadata);
  }

  warn(context, message, metadata = {}) {
    this.log('WARN', context, message, metadata);
  }

  error(context, message, metadata = {}) {
    this.log('ERROR', context, message, metadata);
  }

  fatal(context, message, metadata = {}) {
    this.log('FATAL', context, message, metadata);
  }
}

module.exports = new ErrorLogger();
