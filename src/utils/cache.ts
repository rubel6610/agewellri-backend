import crypto from "crypto";

interface CacheEntry<T = any> {
  data: T;
  expiresAt: number;
  etag: string;
  tags: string[];
}

/**
 * High-performance in-memory TTL & ETag cache for AgeWellRI backend.
 */
export class MemoryCache {
  private static store = new Map<string, CacheEntry>();
  private static cleanupTimer: NodeJS.Timeout | null = null;

  static init() {
    if (!this.cleanupTimer) {
      this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 1000);
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
  }

  static get<T = any>(key: string): { data: T; etag: string } | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return { data: entry.data, etag: entry.etag };
  }

  static set<T = any>(key: string, data: T, ttlSeconds: number = 300, tags: string[] = []): string {
    const jsonStr = typeof data === "string" ? data : JSON.stringify(data);
    const etag = `W/"${crypto.createHash("md5").update(jsonStr).digest("hex").slice(0, 16)}"`;
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
      etag,
      tags,
    });
    return etag;
  }

  static invalidateByTag(tag: string): number {
    let count = 0;
    const keysToDelete: string[] = [];
    this.store.forEach((entry, key) => {
      if (entry.tags.indexOf(tag) !== -1 || key.indexOf(tag) !== -1) {
        keysToDelete.push(key);
      }
    });
    for (let i = 0; i < keysToDelete.length; i++) {
      this.store.delete(keysToDelete[i]);
      count++;
    }
    return count;
  }

  static invalidateByPrefix(prefix: string): number {
    let count = 0;
    const keysToDelete: string[] = [];
    this.store.forEach((_entry, key) => {
      if (key.indexOf(prefix) === 0) {
        keysToDelete.push(key);
      }
    });
    for (let i = 0; i < keysToDelete.length; i++) {
      this.store.delete(keysToDelete[i]);
      count++;
    }
    return count;
  }

  static clear(): void {
    this.store.clear();
  }

  private static cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    this.store.forEach((entry, key) => {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    });
    for (let i = 0; i < keysToDelete.length; i++) {
      this.store.delete(keysToDelete[i]);
    }
  }
}

MemoryCache.init();
