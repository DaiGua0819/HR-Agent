function createTtlCache(ttlMs) {
  const cache = new Map();

  function get(key) {
    const cached = cache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt > ttlMs) {
      cache.delete(key);
      return null;
    }
    return cached.payload;
  }

  function set(key, payload) {
    cache.set(key, { cachedAt: Date.now(), payload });
  }

  function clear() {
    cache.clear();
  }

  return { get, set, clear };
}

module.exports = { createTtlCache };
