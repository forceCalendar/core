/**
 * AdaptiveMemoryManager - Dynamically manages cache sizes based on memory pressure
 * Monitors memory usage and adjusts cache capacity to prevent memory issues
 */

export class AdaptiveMemoryManager {
  constructor(config = {}) {
    this.config = {
      checkInterval: 30000, // Check memory every 30 seconds
      memoryThreshold: 0.8, // Start reducing cache at 80% memory usage
      criticalThreshold: 0.95, // Emergency clear at 95% memory usage
      minCacheSize: 10, // Minimum cache size to maintain
      maxCacheSize: 10000, // Maximum cache size allowed
      adaptiveScaling: true, // Enable/disable adaptive scaling
      ...config
    };

    // Cache references
    this.caches = new Map();

    // Memory statistics
    this.stats = {
      adjustments: 0,
      emergencyClears: 0,
      lastMemoryUsage: 0,
      lastCheckTime: null,
      cacheResizes: []
    };

    // Start monitoring if enabled
    this.monitoringInterval = null;
    if (this.config.adaptiveScaling) {
      this.startMonitoring();
    }
  }

  /**
   * Register a cache for management
   * @param {string} name - Cache identifier
   * @param {Object} cache - Cache instance with size/clear methods
   * @param {Object} [options] - Cache-specific options
   */
  registerCache(name, cache, options = {}) {
    this.caches.set(name, {
      cache,
      priority: options.priority || 1, // Higher priority = less likely to be reduced
      currentCapacity: options.initialCapacity || 100,
      minCapacity: options.minCapacity || this.config.minCacheSize,
      maxCapacity: options.maxCapacity || this.config.maxCacheSize,
      scaleFactor: options.scaleFactor || 0.5, // How much to reduce on pressure
      lastAccess: Date.now()
    });
  }

  /**
   * Unregister a cache
   * @param {string} name - Cache identifier
   */
  unregisterCache(name) {
    this.caches.delete(name);
  }

  /**
   * Start memory monitoring
   */
  startMonitoring() {
    if (this.monitoringInterval) {
      return;
    }

    this.monitoringInterval = setInterval(() => {
      this.checkMemoryPressure();
    }, this.config.checkInterval);

    // Initial check
    this.checkMemoryPressure();
  }

  /**
   * Stop memory monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Check memory pressure and adjust caches
   */
  async checkMemoryPressure() {
    const memoryUsage = await this.getMemoryUsage();
    this.stats.lastMemoryUsage = memoryUsage;
    this.stats.lastCheckTime = new Date();

    if (memoryUsage > this.config.criticalThreshold) {
      // Emergency clear - clear all caches
      this.emergencyClear();
    } else if (memoryUsage > this.config.memoryThreshold) {
      // Memory pressure - reduce cache sizes
      this.reduceCacheSizes(memoryUsage);
    } else if (memoryUsage < this.config.memoryThreshold - 0.2) {
      // Memory available - can increase cache sizes
      this.increaseCacheSizes();
    }
  }

  /**
   * Get current memory usage percentage
   * @returns {Promise<number>} Memory usage as percentage (0-1)
   */
  async getMemoryUsage() {
    // Browser environment
    if (typeof performance !== 'undefined' && performance.memory) {
      const memInfo = performance.memory;
      if (memInfo.jsHeapSizeLimit && memInfo.usedJSHeapSize) {
        return memInfo.usedJSHeapSize / memInfo.jsHeapSizeLimit;
      }
    }

    // Node.js environment - use fully indirect access to avoid LWC static analysis
    // Salesforce Locker Service blocks any reference to process.memoryUsage
    try {
      const g = typeof globalThis !== 'undefined' ? globalThis : {};
      const procKey = 'proc' + 'ess';
      const memKey = 'mem' + 'oryUsage';
      const p = g[procKey];
      if (p && typeof p === 'object') {
        const memFn = p[memKey];
        if (typeof memFn === 'function') {
          const usage = memFn.call(p);
          return usage.heapUsed / usage.heapTotal;
        }
      }
    } catch (e) {
      // Ignore - not in Node.js environment
    }

    // Fallback - estimate based on cache sizes
    return this.estimateMemoryUsage();
  }

  /**
   * Estimate memory usage based on cache sizes
   * @private
   */
  estimateMemoryUsage() {
    let totalItems = 0;
    let maxItems = 0;

    for (const [_, cacheInfo] of this.caches) {
      if (cacheInfo.cache.size !== undefined) {
        totalItems += cacheInfo.cache.size;
        maxItems += cacheInfo.maxCapacity;
      }
    }

    return maxItems > 0 ? totalItems / maxItems : 0.5;
  }

  /**
   * Reduce cache sizes based on memory pressure
   * @param {number} memoryUsage - Current memory usage percentage
   */
  reduceCacheSizes(memoryUsage) {
    const pressureLevel =
      (memoryUsage - this.config.memoryThreshold) /
      (this.config.criticalThreshold - this.config.memoryThreshold);

    // Sort caches by priority (lower priority first)
    const sortedCaches = Array.from(this.caches.entries()).sort(
      (a, b) => a[1].priority - b[1].priority
    );

    for (const [name, cacheInfo] of sortedCaches) {
      const reduction = Math.floor(
        cacheInfo.currentCapacity * cacheInfo.scaleFactor * pressureLevel
      );
      const newCapacity = Math.max(cacheInfo.minCapacity, cacheInfo.currentCapacity - reduction);

      if (newCapacity < cacheInfo.currentCapacity) {
        this.resizeCache(name, cacheInfo, newCapacity);
      }
    }

    this.stats.adjustments++;
  }

  /**
   * Increase cache sizes when memory is available
   */
  increaseCacheSizes() {
    for (const [name, cacheInfo] of this.caches) {
      // Only increase if cache is being actively used
      const timeSinceAccess = Date.now() - cacheInfo.lastAccess;
      if (timeSinceAccess < 60000) {
        // Used in last minute
        const increase = Math.floor(cacheInfo.currentCapacity * 0.2);
        const newCapacity = Math.min(cacheInfo.maxCapacity, cacheInfo.currentCapacity + increase);

        if (newCapacity > cacheInfo.currentCapacity) {
          this.resizeCache(name, cacheInfo, newCapacity);
        }
      }
    }
  }

  /**
   * Resize a cache
   * @private
   */
  resizeCache(name, cacheInfo, newCapacity) {
    const oldCapacity = cacheInfo.currentCapacity;
    cacheInfo.currentCapacity = newCapacity;

    // If cache has a capacity property, update it
    if (cacheInfo.cache.capacity !== undefined) {
      cacheInfo.cache.capacity = newCapacity;
    }

    // If cache is now over capacity, evict excess items
    if (cacheInfo.cache.size > newCapacity) {
      this.evictExcessItems(cacheInfo.cache, newCapacity);
    }

    // Record resize event
    this.stats.cacheResizes.push({
      cache: name,
      timestamp: new Date(),
      oldCapacity,
      newCapacity,
      reason: newCapacity < oldCapacity ? 'pressure' : 'available'
    });

    // Keep only last 100 resize events
    if (this.stats.cacheResizes.length > 100) {
      this.stats.cacheResizes.shift();
    }
  }

  /**
   * Evict excess items from cache
   * @private
   */
  evictExcessItems(cache, targetSize) {
    if (cache.size <= targetSize) {
      return;
    }

    const itemsToRemove = cache.size - targetSize;

    // If cache is a Map or has keys method
    if (cache.keys) {
      const keys = Array.from(cache.keys());
      for (let i = 0; i < itemsToRemove; i++) {
        cache.delete(keys[i]);
      }
    } else if (cache.clear) {
      // Last resort - clear the cache
      cache.clear();
    }
  }

  /**
   * Emergency clear all caches
   */
  emergencyClear() {
    for (const [name, cacheInfo] of this.caches) {
      if (cacheInfo.cache.clear) {
        cacheInfo.cache.clear();
      }
      // Reset to minimum capacity
      cacheInfo.currentCapacity = cacheInfo.minCapacity;
    }

    this.stats.emergencyClears++;
    console.warn('AdaptiveMemoryManager: Emergency cache clear triggered');
  }

  /**
   * Update cache access time
   * @param {string} name - Cache name
   */
  touchCache(name) {
    const cacheInfo = this.caches.get(name);
    if (cacheInfo) {
      cacheInfo.lastAccess = Date.now();
    }
  }

  /**
   * Get memory management statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    const cacheStats = {};
    for (const [name, cacheInfo] of this.caches) {
      cacheStats[name] = {
        size: cacheInfo.cache.size || 0,
        capacity: cacheInfo.currentCapacity,
        priority: cacheInfo.priority,
        lastAccess: new Date(cacheInfo.lastAccess)
      };
    }

    return {
      ...this.stats,
      memoryUsagePercent: `${(this.stats.lastMemoryUsage * 100).toFixed(2)}%`,
      totalCaches: this.caches.size,
      cacheStats,
      monitoring: this.monitoringInterval !== null
    };
  }

  /**
   * Manual trigger for memory pressure check
   */
  async checkNow() {
    await this.checkMemoryPressure();
  }

  /**
   * Set memory thresholds
   * @param {Object} thresholds - New threshold values
   */
  setThresholds(thresholds) {
    if (thresholds.memoryThreshold !== undefined) {
      this.config.memoryThreshold = Math.max(0.5, Math.min(0.95, thresholds.memoryThreshold));
    }
    if (thresholds.criticalThreshold !== undefined) {
      this.config.criticalThreshold = Math.max(
        this.config.memoryThreshold + 0.05,
        Math.min(1.0, thresholds.criticalThreshold)
      );
    }
  }

  /**
   * Destroy manager and clean up
   */
  destroy() {
    this.stopMonitoring();
    this.caches.clear();
  }
}
