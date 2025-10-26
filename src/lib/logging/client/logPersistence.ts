// src/lib/logging/client/logPersistence.ts

interface ClientLogEntry {
  timestamp: string;
  level: string;
  message: string;
  data: any;
  requestId: string;
}

// Global recursion prevention for persistence (MANDATORY)
const LOGGING_IN_PROGRESS = new Set<string>();
let currentRecursionDepth = 0;

class ClientLogPersistence {
  private logBuffer: ClientLogEntry[] = [];
  private fileHandle: FileSystemFileHandle | null = null;
  private dbName = 'ClientLogs';
  private storeName = 'logs';

  async initialize() {
    if (typeof window === 'undefined') return; // Server-side safety

    // Try File System Access API first (optional)
    if ('showSaveFilePicker' in window && process.env.NODE_ENV === 'development') {
      await this.initFileSystemAPI();
    }

    // Always initialize IndexedDB as fallback
    await this.initIndexedDB();
  }

  private async initFileSystemAPI() {
    try {
      // Only request file handle in development
      if (process.env.NODE_ENV === 'development') {
        this.fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: `client-logs-${Date.now()}.log`,
          types: [{
            description: 'Log files',
            accept: { 'text/plain': ['.log'] }
          }]
        });
      }
    } catch (error) {
      console.warn('File System Access API not available, falling back to IndexedDB');
      await this.initIndexedDB();
    }
  }

  private async initIndexedDB() {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('requestId', 'requestId', { unique: false });
        }
      };
    });
  }

  async persistClientLogSafely(entry: ClientLogEntry) {
    // MANDATORY: Prevent infinite recursion in log persistence
    if (LOGGING_IN_PROGRESS.has('persist') || currentRecursionDepth > 0) {
      return; // Silent abort - do not log the logging
    }

    LOGGING_IN_PROGRESS.add('persist');

    try {
      // 1. Always store in IndexedDB (reliable backup)
      await this.indexedDBStoreSafely(entry);

      // 2. Try development server streaming (CAREFULLY - avoid recursion)
      if (process.env.NODE_ENV === 'development') {
        // Use native fetch directly (bypass any wrapping)
        try {
          await window.fetch('/api/client-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry)
          });
        } catch {
          // Silently fallback to IndexedDB only
          // NEVER log this error - would cause recursion
        }
      }

      // 3. File System API (if user opted in) - with error guards
      if (this.fileHandle) {
        try {
          await this.writeToUserFileSafely(entry);
        } catch {
          // Silent fail - never log persistence errors
        }
      }
    } catch {
      // Silent fail - persistence should never crash the app
    } finally {
      LOGGING_IN_PROGRESS.delete('persist');
    }
  }

  private async writeToUserFileSafely(entry: ClientLogEntry) {
    try {
      const writable = await this.fileHandle!.createWritable({ keepExistingData: true });
      await writable.seek(await this.getFileSize());
      await writable.write(JSON.stringify(entry) + '\n');
      await writable.close();
    } catch (error) {
      console.warn('Failed to write to file:', error);
    }
  }

  private async indexedDBStoreSafely(entry: ClientLogEntry) {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);

        store.add({
          ...entry,
          id: Date.now() + Math.random() // Simple ID generation
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };

      request.onerror = () => reject(request.error);
    });
  }

  private async getFileSize(): Promise<number> {
    try {
      const file = await this.fileHandle!.getFile();
      return file.size;
    } catch {
      return 0;
    }
  }

  async exportLogs(): Promise<void> {
    // Export logs from IndexedDB as downloadable file
    const logs = await this.getAllLogsFromIndexedDB();
    const content = logs.map(log => JSON.stringify(log)).join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `client-logs-export-${Date.now()}.log`;
    a.click();

    URL.revokeObjectURL(url);
  }

  private async getAllLogsFromIndexedDB(): Promise<ClientLogEntry[]> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const getAllRequest = store.getAll();

        getAllRequest.onsuccess = () => resolve(getAllRequest.result);
        getAllRequest.onerror = () => reject(getAllRequest.error);
      };

      request.onerror = () => reject(request.error);
    });
  }
}

export const clientLogPersistence = new ClientLogPersistence();