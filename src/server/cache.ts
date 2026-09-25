import { CacheStats } from '../types/pharmacy.ts';

interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
  hits: number;
  source: string;
  sizeBytes: number;
}

export class PharmacyDataCache {
  private cache = new Map<string, CacheEntry<any>>();
  private hitCount = 0;
  private missCount = 0;
  private totalSavedTimeMs = 0;
  private maxEntries = 500;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  public get<T>(key: string): { data: T; hits: number; ageMs: number } | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.missCount++;
      return null;
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }

    entry.hits++;
    this.hitCount++;
    // Estimate simulated savings: typically external or heavy AJAX table lookups take 180-450ms
    const estimatedSavedMs = 240;
    this.totalSavedTimeMs += estimatedSavedMs;

    return {
      data: entry.value as T,
      hits: entry.hits,
      ageMs: now - entry.createdAt,
    };
  }

  public set<T>(key: string, value: T, ttlSeconds = 300, source = 'DDInter/PubChem'): void {
    if (this.cache.size >= this.maxEntries) {
      // Evict oldest or least-hit entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    const now = Date.now();
    const str = JSON.stringify(value);
    const sizeBytes = str.length * 2; // rough byte calculation

    this.cache.set(key, {
      value,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
      hits: 0,
      source,
      sizeBytes,
    });
  }

  public invalidate(key: string): boolean {
    return this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
    this.totalSavedTimeMs = 0;
  }

  public getStats(): CacheStats {
    const totalRequests = this.hitCount + this.missCount;
    const hitRatePercent = totalRequests > 0 ? (this.hitCount / totalRequests) * 100 : 0;
    let totalSizeBytes = 0;

    const recentKeys: CacheStats['recentKeys'] = [];
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      totalSizeBytes += entry.sizeBytes;
      const ttlRemainingSec = Math.max(0, Math.round((entry.expiresAt - now) / 1000));
      recentKeys.push({
        key,
        hits: entry.hits,
        ttlRemainingSec,
        source: entry.source,
        sizeBytes: entry.sizeBytes,
      });
    }

    // Sort recent keys by highest hits
    recentKeys.sort((a, b) => b.hits - a.hits);

    return {
      totalEntries: this.cache.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRatePercent: parseFloat(hitRatePercent.toFixed(1)),
      memoryUsageKb: parseFloat((totalSizeBytes / 1024).toFixed(2)),
      averageLatencySavedMs: this.hitCount > 0 ? Math.round(this.totalSavedTimeMs / this.hitCount) : 0,
      recentKeys: recentKeys.slice(0, 15),
    };
  }
}

export const globalCache = new PharmacyDataCache(1000);
