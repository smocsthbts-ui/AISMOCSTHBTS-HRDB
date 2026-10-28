import { BiometricRawPunch, DailyShiftPlan, OTRecord } from '../types';

const DB_NAME = 'siemens_attendance_db';
const DB_VERSION = 1;
const STORE_NAME = 'app_cache';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function getDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = (event) => {
          resolve((event.target as IDBOpenDBRequest).result);
        };
        request.onerror = (err) => {
          console.warn('IndexedDB open error:', err);
          resolve(null);
        };
      } catch (err) {
        console.warn('IndexedDB initialize failed:', err);
        resolve(null);
      }
    });
  }
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await getDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result !== undefined ? (req.result as T) : null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

export async function idbSet<T>(key: string, value: T): Promise<boolean> {
  try {
    const db = await getDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(value, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

export async function idbDelete(key: string): Promise<boolean> {
  try {
    const db = await getDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

export const IDB_KEYS = {
  BIOMETRIC_PUNCHES: 'all_biometric_punches',
  SHIFT_PLANS: 'all_shift_plans',
  OT_RECORDS: 'all_ot_records',
};
