/* =====================================================================
   data.js — STORAGE LAYER (the only file that touches localStorage)
   ---------------------------------------------------------------------
   To move to InhouzCloud / MongoDB: re-implement the methods on the
   `Database` object below with the same names, arguments and return
   values. Nothing else in the app needs to change.

   Every method is async so a remote database can be dropped in.
   Records are plain objects with a string `id`.
   ===================================================================== */

const Database = (() => {
  const PREFIX = 'sundial:';
  const META_KEY = PREFIX + 'meta';
  const SCHEMA_VERSION = 1;

  let errorHandler = null;

  /* ---------- internal helpers (localStorage-specific) ---------- */

  function report(message, error) {
    console.error('[Database] ' + message, error || '');
    if (errorHandler) errorHandler(message, error);
  }

  const keyFor = (collection) => PREFIX + collection;

  // Read a whole collection. Corrupted data is backed up, then treated as empty.
  function read(collection) {
    const key = keyFor(collection);
    let raw = null;
    try {
      raw = localStorage.getItem(key);
      if (raw === null) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Collection is not an array');
      return parsed.filter((r) => r && typeof r === 'object' && typeof r.id === 'string');
    } catch (err) {
      if (raw !== null) {
        try { localStorage.setItem(key + ':corrupt:' + Date.now(), raw); } catch (_) { /* ignore */ }
      }
      report('Saved data for "' + collection + '" was unreadable. A backup was kept and the collection was reset.', err);
      return [];
    }
  }

  function write(collection, records) {
    try {
      localStorage.setItem(keyFor(collection), JSON.stringify(records));
    } catch (err) {
      report('Could not save changes. Your browser storage may be full or disabled.', err);
      throw err;
    }
  }

  // Mongo-style simple filter matching: equality, arrays ($in), functions, and
  // operator objects { $gte, $lte, $gt, $lt, $ne, $in }.
  function matches(record, filters) {
    return Object.keys(filters).every((field) => {
      const cond = filters[field];
      const value = record[field];
      if (typeof cond === 'function') return !!cond(value, record);
      if (Array.isArray(cond)) return cond.includes(value);
      if (cond && typeof cond === 'object') {
        if ('$gte' in cond && !(value >= cond.$gte)) return false;
        if ('$lte' in cond && !(value <= cond.$lte)) return false;
        if ('$gt' in cond && !(value > cond.$gt)) return false;
        if ('$lt' in cond && !(value < cond.$lt)) return false;
        if ('$ne' in cond && value === cond.$ne) return false;
        if ('$in' in cond && !cond.$in.includes(value)) return false;
        return true;
      }
      return value === cond;
    });
  }

  function newId(collection) {
    const base = collection.replace(/s$/, '');
    return base + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- public API ---------- */

  return {
    SCHEMA_VERSION,

    onError(handler) { errorHandler = handler; },

    // Runs once on startup. Never overwrites existing data.
    async init() {
      try {
        const raw = localStorage.getItem(META_KEY);
        let meta = raw ? JSON.parse(raw) : null;
        if (!meta || typeof meta.schemaVersion !== 'number') meta = { schemaVersion: 0 };
        if (meta.schemaVersion < SCHEMA_VERSION) {
          // Future migrations go here, e.g. if (meta.schemaVersion < 2) { ... }
          meta.schemaVersion = SCHEMA_VERSION;
          localStorage.setItem(META_KEY, JSON.stringify(meta));
        }
      } catch (err) {
        report('Storage is unavailable. Changes may not be saved.', err);
      }
    },

    async getAll(collection) {
      return read(collection);
    },

    async getById(collection, id) {
      return read(collection).find((r) => r.id === id) || null;
    },

    async insert(collection, data) {
      const records = read(collection);
      const record = { ...data, id: data.id || newId(collection) };
      records.push(record);
      write(collection, records);
      return record;
    },

    async insertMany(collection, items) {
      const records = read(collection);
      const created = items.map((d) => ({ ...d, id: d.id || newId(collection) }));
      write(collection, records.concat(created));
      return created;
    },

    async update(collection, id, updates) {
      const records = read(collection);
      const index = records.findIndex((r) => r.id === id);
      if (index === -1) return null;
      records[index] = { ...records[index], ...updates, id }; // id can never change
      write(collection, records);
      return records[index];
    },

    async delete(collection, id) {
      const records = read(collection);
      const next = records.filter((r) => r.id !== id);
      if (next.length === records.length) return false;
      write(collection, next);
      return true;
    },

    // Delete every record matching the filters. Returns how many were removed.
    async deleteWhere(collection, filters) {
      const records = read(collection);
      const next = records.filter((r) => !matches(r, filters));
      write(collection, next);
      return records.length - next.length;
    },

    async query(collection, filters = {}) {
      return read(collection).filter((r) => matches(r, filters));
    },

    // Replace the entire contents of a collection (used by import / reset).
    async replaceAll(collection, records) {
      write(collection, records);
    }
  };
})();