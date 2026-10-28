import { 
  Employee, 
  ShiftCode, 
  UserAccount, 
  DailyShiftPlan, 
  BiometricRawPunch, 
  OTRecord, 
  OtherAllowance, 
  TimeSheetRow,
  Department
} from '../types';
import { 
  DEPARTMENTS as INITIAL_DEPARTMENTS,
  OFFICIAL_DEPARTMENT_FULL_NAMES,
  resolveDepartmentFullName,
  getCanonicalDepartmentFullName,
  toCanonicalDepartment,
  canonicalEmpNo,
  INITIAL_EMPLOYEES, 
  INITIAL_SHIFT_CODES, 
  INITIAL_USERS, 
  INITIAL_OT_RECORDS, 
  INITIAL_OTHER_ALLOWANCES, 
  INITIAL_RAW_PUNCHES_TEXT 
} from '../data/initialData';
import { 
  firestoreSync, 
  testFirestoreConnection, 
  isDemoDepartment, 
  DEMO_DEPARTMENT_CODES,
  isDemoShiftCode,
  isDemoUser,
  isDemoEmployee,
  cleanDocId,
  sanitizeEmployeeDepartment,
  deduplicateAndCanonicalizeEmployees,
  deduplicateAndCanonicalizeShiftPlans,
  subscribeToCloudChanges 
} from '../firebase';
import { mergeAndDeduplicateOTRecords, sanitizeOTRecords } from './otManager';
import { normalizeShiftTimeString } from './timeCalc';
import { idbGet, idbSet, IDB_KEYS } from './indexedDBStorage';

const STORAGE_KEYS = {
  USERS: 'siemens_ix_users',
  CURRENT_USER: 'siemens_ix_current_user',
  DEPARTMENTS: 'siemens_ix_departments',
  DEPARTMENTS_MODIFIED: 'siemens_ix_departments_modified',
  EMPLOYEES: 'siemens_ix_employees',
  EMPLOYEES_MODIFIED: 'siemens_ix_employees_modified',
  SHIFT_CODES: 'siemens_ix_shift_codes',
  SHIFT_CODES_MODIFIED: 'siemens_ix_sc_modified',
  SHIFT_PLANS: 'siemens_ix_shift_plans',
  SHIFT_PLANS_MODIFIED: 'siemens_ix_plans_modified',
  RAW_PUNCHES: 'siemens_ix_raw_punches',
  PUNCHES_MODIFIED: 'siemens_ix_punches_modified',
  OT_RECORDS: 'siemens_ix_ot_records',
  OTHER_ALLOWANCES: 'siemens_ix_other_allowances',
  MANUAL_OVERRIDES: 'siemens_ix_manual_timesheet_overrides',
  THEME: 'siemens_ix_theme',
  SCHEMA_VERSION: 'siemens_ix_schema_version',
  DELETED_EMPLOYEES: 'siemens_ix_deleted_employees',
  DELETED_USERS: 'siemens_ix_deleted_users',
  DELETED_DEPARTMENTS: 'siemens_ix_deleted_departments',
};

// Resilient in-memory storage cache to completely eliminate browser localStorage QuotaExceededError crashes
const inMemoryCache = new Map<string, string>();

// Initialize inMemoryCache from localStorage on startup
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('siemens_ix_') || k.startsWith('siemens_'))) {
        inMemoryCache.set(k, localStorage.getItem(k) || '');
      }
    }
  }
} catch {}

export function safeGetItem(key: string): string | null {
  if (inMemoryCache.has(key)) {
    const val = inMemoryCache.get(key);
    return val !== undefined ? val : null;
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = localStorage.getItem(key);
      if (val !== null) {
        inMemoryCache.set(key, val);
        return val;
      }
    }
  } catch {}
  return null;
}

export function safeSetItem(key: string, value: string): void {
  // 1. Immediately store into in-memory cache to guarantee synchronous state updates and zero crashes
  inMemoryCache.set(key, value);

  // If storing raw biometric punches, also asynchronously persist to IndexedDB (unlimited storage, never sliced)
  if (key === STORAGE_KEYS.RAW_PUNCHES) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        idbSet(IDB_KEYS.BIOMETRIC_PUNCHES, parsed).catch(() => {});
      }
    } catch {}
  }

  // 2. Persist to localStorage safely if within size limits without slicing
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      // If payload is excessively large for localStorage (>2.5MB), avoid pushing to localStorage to prevent quota crash
      // Data is already preserved 100% in inMemoryCache and IndexedDB
      if (value.length < 2500000) {
        localStorage.setItem(key, value);
      }
    }
  } catch (_err: any) {
    // If quota exceeded, do NOT slice or truncate punches!
    // IndexedDB and in-memory cache maintain the complete, untruncated records.
  }
}

export function safeRemoveItem(key: string): void {
  inMemoryCache.delete(key);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(key);
    }
  } catch {}
}

export const HISTORY_CUTOFF_DATE = '2024-01-01';
export const HISTORY_CUTOFF_MONTH = '2024-01';

const CURRENT_SCHEMA_VERSION = 'v2026_09_free_tier_compact_v9';

// Self-healing migration for all connected clients upon opening the app
try {
  // Purge any demo users immediately from local storage cache
  const userRaw = safeGetItem(STORAGE_KEYS.USERS);
  if (userRaw) {
    const parsed = JSON.parse(userRaw);
    if (Array.isArray(parsed)) {
      const cleaned = parsed.filter(u => !isDemoUser(u));
      safeSetItem(STORAGE_KEYS.USERS, JSON.stringify(cleaned));
    }
  }

  // Purge any demo employees immediately from local storage cache, auto-heal departments & eliminate duplicates
  const empRaw = safeGetItem(STORAGE_KEYS.EMPLOYEES);
  let activeEmpsList: Employee[] = [];
  let hasSanitizedOnBoot = false;
  if (empRaw) {
    try {
      const parsed = JSON.parse(empRaw);
      if (Array.isArray(parsed)) {
        activeEmpsList = deduplicateAndCanonicalizeEmployees(parsed);
        if (activeEmpsList.length !== parsed.length || JSON.stringify(activeEmpsList) !== empRaw) {
          hasSanitizedOnBoot = true;
        }
        safeSetItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(activeEmpsList));
        if (hasSanitizedOnBoot) {
          firestoreSync.syncEmployees(activeEmpsList).catch(() => null);
        }
      }
    } catch {}
  }

  // Deduplicate and canonicalize shift plans on boot
  const plansBootRaw = safeGetItem(STORAGE_KEYS.SHIFT_PLANS);
  if (plansBootRaw) {
    try {
      const parsedPlans = JSON.parse(plansBootRaw);
      if (Array.isArray(parsedPlans)) {
        const cleanedPlans = deduplicateAndCanonicalizeShiftPlans(parsedPlans, activeEmpsList);
        if (cleanedPlans.length !== parsedPlans.length) {
          safeSetItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(cleanedPlans));
          firestoreSync.writeShiftPlansBundle(cleanedPlans).catch(() => null);
        }
      }
    } catch {}
  }

  // The 14 authentic real departments used by the system
  const REAL_SYSTEM_DEPTS = new Set(INITIAL_DEPARTMENTS.map(d => d.code.toUpperCase()));
  const activeEmpDeptCodes = new Set(activeEmpsList.map(e => (e.department || '').trim().toUpperCase()).filter(Boolean));

  // Purge any demo or 0-people departments that are NOT in the 14 real departments
  const deptRaw = safeGetItem(STORAGE_KEYS.DEPARTMENTS);
  const delRaw = safeGetItem(STORAGE_KEYS.DELETED_DEPARTMENTS);
  const delList: string[] = delRaw ? JSON.parse(delRaw) : [];
  const delSet = new Set(delList.map(c => String(c).trim().toUpperCase()));

  // Always mark known demo department codes as deleted so they cannot re-emerge
  DEMO_DEPARTMENT_CODES.forEach(code => delSet.add(code.toUpperCase()));

  const currentList: Department[] = deptRaw ? JSON.parse(deptRaw) : [];
  const deptMap = new Map<string, Department>();
  const purgedCodes: string[] = [];

  // 1. Seed with authentic real departments if not deleted by user
  INITIAL_DEPARTMENTS.forEach(d => {
    const upper = d.code.toUpperCase();
    if (!delSet.has(upper) && !isDemoDepartment(upper)) {
      deptMap.set(upper, { code: upper, name: resolveDepartmentFullName(upper, d.name) });
    }
  });

  // 2. Filter existing departments: only keep authentic departments or ones with active employees (strictly non-demo)
  if (Array.isArray(currentList)) {
    currentList.forEach(d => {
      if (!d || !d.code) return;
      const upper = d.code.trim().toUpperCase();
      if (delSet.has(upper) || isDemoDepartment(upper)) {
        purgedCodes.push(upper);
        delSet.add(upper);
        return;
      }
      const isReal = REAL_SYSTEM_DEPTS.has(upper);
      const hasEmps = activeEmpDeptCodes.has(upper);
      if (isReal || hasEmps) {
        const existing = deptMap.get(upper);
        const resolvedName = resolveDepartmentFullName(upper, d.name, existing?.name);
        deptMap.set(upper, { code: upper, name: resolvedName });
      } else {
        // 0-person unused department: banish and mark as deleted
        purgedCodes.push(upper);
        delSet.add(upper);
      }
    });
  }

  if (!delSet.has('OHL') && !deptMap.has('OHL')) {
    deptMap.set('OHL', { code: 'OHL', name: 'Overhaul' });
  }

  deptMap.delete('TRW/TRD');
  deptMap.delete('TRD');
  deptMap.delete('OVH');
  deptMap.delete('MRL');

  const cleanDepts = Array.from(deptMap.values())
    .filter(d => !isDemoDepartment(d.code) && d.code !== 'TRW/TRD' && d.code !== 'TRD' && d.code !== 'OVH' && d.code !== 'MRL')
    .map(d => ({
      code: d.code,
      name: resolveDepartmentFullName(d.code, d.name),
      updatedAt: d.updatedAt || new Date().toISOString(),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  safeSetItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(cleanDepts));
  safeSetItem(STORAGE_KEYS.DELETED_DEPARTMENTS, JSON.stringify(Array.from(delSet)));

  // Delete purged codes only. Do NOT blindly push unverified local departments to cloud on boot!
  if (purgedCodes.length > 0) {
    purgedCodes.forEach(code => {
      firestoreSync.deleteDepartment(code, cleanDepts).catch(() => null);
    });
  }
} catch {}

try {
  const currentVer = safeGetItem(STORAGE_KEYS.SCHEMA_VERSION);
  if (currentVer !== CURRENT_SCHEMA_VERSION) {
    // 1. Prune punches before Aug 2026 and deduplicate
    const punchesRaw = safeGetItem(STORAGE_KEYS.RAW_PUNCHES);
    if (punchesRaw) {
      try {
        const parsed = JSON.parse(punchesRaw);
        if (Array.isArray(parsed)) {
          const punchMap = new Map<string, any>();
          parsed.forEach((p: any) => {
            if (!p || !p.date || !p.time) return;
            if (p.date < HISTORY_CUTOFF_DATE) return;
            const key = `${(p.empIdentifier || '').trim().toLowerCase()}_${p.date}_${p.time}_${p.type || ''}`;
            if (!punchMap.has(key)) punchMap.set(key, p);
          });
          safeSetItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(Array.from(punchMap.values())));
        }
      } catch {}
    }

    // 2. Prune shift plans before Aug 2026 and deduplicate
    const plansRaw = safeGetItem(STORAGE_KEYS.SHIFT_PLANS);
    if (plansRaw) {
      try {
        const parsed = JSON.parse(plansRaw);
        if (Array.isArray(parsed)) {
          const planMap = new Map<string, any>();
          parsed.forEach((p: any) => {
            if (!p || !p.date) return;
            if (p.date < HISTORY_CUTOFF_DATE) return;
            const key = `${(p.empNo || '').trim()}_${(p.gid || '').trim().toLowerCase()}_${p.date}`;
            if (!planMap.has(key)) planMap.set(key, p);
          });
          safeSetItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(Array.from(planMap.values())));
        }
      } catch {}
    }

    // 3. Prune OT records before Aug 2026
    const otRaw = safeGetItem(STORAGE_KEYS.OT_RECORDS);
    if (otRaw) {
      try {
        const parsed = JSON.parse(otRaw);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter((o: any) => !o.date || o.date >= HISTORY_CUTOFF_DATE);
          safeSetItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(cleaned));
        }
      } catch {}
    }

    // 4. Prune other allowances before Aug 2026
    const allowRaw = safeGetItem(STORAGE_KEYS.OTHER_ALLOWANCES);
    if (allowRaw) {
      try {
        const parsed = JSON.parse(allowRaw);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter((a: any) => !a.monthYear || a.monthYear >= HISTORY_CUTOFF_MONTH);
          safeSetItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(cleaned));
        }
      } catch {}
    }

    // 5. Prune manual overrides before Aug 2026
    const overridesRaw = safeGetItem(STORAGE_KEYS.MANUAL_OVERRIDES);
    if (overridesRaw) {
      try {
        const parsed = JSON.parse(overridesRaw);
        if (parsed && typeof parsed === 'object') {
          const cleaned: Record<string, any> = {};
          Object.entries(parsed).forEach(([k, v]) => {
            const parts = k.split('_');
            const dateStr = parts[parts.length - 1];
            if (!dateStr || dateStr >= HISTORY_CUTOFF_DATE) {
              cleaned[k] = v;
            }
          });
          safeSetItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(cleaned));
        }
      } catch {}
    }

    // 6. Clean distorted department names
    const deptRaw = safeGetItem(STORAGE_KEYS.DEPARTMENTS);
    if (deptRaw) {
      const parsedDepts = JSON.parse(deptRaw);
      if (Array.isArray(parsedDepts)) {
        const cleaned = parsedDepts.map((d: any) => {
          const code = (d.code || '').trim().toUpperCase();
          let name = (d.name || '').trim();
          if (!name || name.includes('(') || name.toLowerCase().includes('administration') || name.toLowerCase().includes('maintenance') || name.toLowerCase().includes('workshop') || name.toLowerCase().includes('safety')) {
            name = code;
          }
          return { code, name };
        });
        safeSetItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(cleaned));
      }
    }
    safeSetItem(STORAGE_KEYS.SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
  }
} catch {}

// Event emitter helper for cross-component re-renders with debounce protection
let notifyTimer: any = null;
export const notifyDataChanged = () => {
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    window.dispatchEvent(new Event('siemens-data-updated'));
    window.dispatchEvent(new Event('storage-changed'));
    window.dispatchEvent(new Event('firestore-sync-completed'));
    window.dispatchEvent(new Event('siemens_ix_data_changed'));
  }, 50);
};

export const notifyDataChangedImmediate = () => {
  if (notifyTimer) clearTimeout(notifyTimer);
  window.dispatchEvent(new Event('siemens-data-updated'));
  window.dispatchEvent(new Event('storage-changed'));
  window.dispatchEvent(new Event('firestore-sync-completed'));
  window.dispatchEvent(new Event('siemens_ix_data_changed'));
};

// In-memory cache for high-volume biometric punches to eliminate synchronous JSON stringify overhead
let memoryPunchesCache: BiometricRawPunch[] | null = null;
let cloudListenerAttached = false;
let isLocalSavingPunches = false;

// Parse raw punches text to punch objects
export function parseBiometricText(text: string): BiometricRawPunch[] {
  const lines = text.split('\n');
  const punches: BiometricRawPunch[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Pattern 1: "0149   I 260128 0442 01" or "0950   O 260505 1729 01"
    // Pattern 2: "Z0057PUI 260128 0757 01" or "Z0057PUO 260128 1701 01"
    const standardMatch = trimmed.match(/^([A-Za-z0-9]+)\s+([IO])\s+(\d{6})\s+(\d{4})\s*(\d*)/i);
    const compactMatch = trimmed.match(/^([A-Za-z0-9]+)([IO])\s+(\d{6})\s+(\d{4})\s*(\d*)/i);

    let emp = '';
    let type: 'I' | 'O' = 'I';
    let yymmdd = '';
    let hhmm = '';
    let dev = '01';

    if (standardMatch) {
      emp = standardMatch[1];
      type = standardMatch[2].toUpperCase() as 'I' | 'O';
      yymmdd = standardMatch[3];
      hhmm = standardMatch[4];
      dev = standardMatch[5] || '01';
    } else if (compactMatch) {
      emp = compactMatch[1];
      type = compactMatch[2].toUpperCase() as 'I' | 'O';
      yymmdd = compactMatch[3];
      hhmm = compactMatch[4];
      dev = compactMatch[5] || '01';
    } else {
      // General split
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 4) {
        emp = parts[0];
        type = parts[1].toUpperCase() === 'O' ? 'O' : 'I';
        yymmdd = parts[2];
        hhmm = parts[3];
        dev = parts[4] || '01';
      }
    }

    if (emp && yymmdd && hhmm) {
      // 260128 -> 2026-01-28
      const year = `20${yymmdd.substring(0, 2)}`;
      const month = yymmdd.substring(2, 4);
      const day = yymmdd.substring(4, 6);
      const dateStr = `${year}-${month}-${day}`;
      const timeStr = `${hhmm.substring(0, 2)}:${hhmm.substring(2, 4)}`;

      punches.push({
        id: `punch-${index}-${Date.now()}`,
        empIdentifier: emp,
        type,
        timestamp: `${dateStr} ${timeStr}`,
        date: dateStr,
        time: timeStr,
        deviceId: dev,
        rawLine: trimmed,
      });
    }
  });

  return punches;
}

// LocalStorage helpers
export const storage = {
  getDeletedUserKeys(): string[] {
    try {
      const data = safeGetItem(STORAGE_KEYS.DELETED_USERS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  recordDeletedUser(userId: string, email?: string) {
    try {
      const current = this.getDeletedUserKeys();
      const keysToAdd = [userId, email?.trim().toLowerCase()].filter(Boolean) as string[];
      let changed = false;
      keysToAdd.forEach(k => {
        if (!current.includes(k)) {
          current.push(k);
          changed = true;
        }
      });
      if (changed) {
        safeSetItem(STORAGE_KEYS.DELETED_USERS, JSON.stringify(current));
      }
    } catch (e) {
      console.warn('recordDeletedUser warning:', e);
    }
  },

  unrecordDeletedUser(userId?: string, email?: string) {
    try {
      const current = this.getDeletedUserKeys();
      const keysToRemove = new Set([
        userId,
        userId?.toLowerCase(),
        email?.trim().toLowerCase(),
      ].filter(Boolean) as string[]);
      const updated = current.filter(k => !keysToRemove.has(k) && !keysToRemove.has(k.toLowerCase()));
      if (updated.length !== current.length) {
        safeSetItem(STORAGE_KEYS.DELETED_USERS, JSON.stringify(updated));
      }
    } catch {}
  },

  getUsers(): UserAccount[] {
    const deletedKeys = new Set(this.getDeletedUserKeys());
    const data = safeGetItem(STORAGE_KEYS.USERS);
    let list: UserAccount[] = [];
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          list = parsed;
        } else {
          list = INITIAL_USERS;
        }
      } catch {
        list = INITIAL_USERS;
      }
    } else {
      list = INITIAL_USERS;
    }

    // Strictly deduplicate by email, normalizing status, and filtering out demo accounts
    const uMap = new Map<string, UserAccount>();
    list.forEach(u => {
      if (!u || !u.email) return;
      if (isDemoUser(u)) return;
      const cleanEmail = u.email.trim().toLowerCase();
      const idLower = (u.id || '').toLowerCase();
      const isProtected = u.isGoogleAccount || u.status === 'Active' || u.status === 'Pending_Approval' || cleanEmail.endsWith('@siemens.com') || cleanEmail.endsWith('@gmail.com');
      if (!isProtected) {
        if (deletedKeys.has(cleanEmail)) return;
        if (idLower && deletedKeys.has(idLower)) return;
      }

      // Normalize status
      let status = u.status;
      if (status) {
        const s = status.toLowerCase();
        if (s === 'active') status = 'Active';
        else if (s.includes('pending')) status = 'Pending_Approval';
        else if (s === 'deactivated') status = 'Deactivated';
      } else {
        status = 'Active';
      }

      const normalized: UserAccount = {
        ...u,
        email: cleanEmail,
        status,
      };

      const existing = uMap.get(cleanEmail);
      if (!existing) {
        uMap.set(cleanEmail, normalized);
      } else {
        // When merging duplicate entries, merge with normalized taking precedence for updated fields
        const existingTime = existing.updatedAt || existing.lastLogin || existing.createdAt || '';
        const incomingTime = normalized.updatedAt || normalized.lastLogin || normalized.createdAt || '';
        const isIncomingNewer = incomingTime >= existingTime;

        const base = isIncomingNewer ? existing : normalized;
        const top = isIncomingNewer ? normalized : existing;

        const isAlreadyActive = existing.status === 'Active' || normalized.status === 'Active';
        const resolvedStatus = cleanEmail === 'smo.cs.th.bts@gmail.com' 
          ? 'Active' 
          : (isAlreadyActive ? 'Active' : (top.status || base.status || 'Active'));

        uMap.set(cleanEmail, {
          ...base,
          ...top,
          role: cleanEmail === 'smo.cs.th.bts@gmail.com' ? 'Admin' : (top.role || base.role),
          department: top.department || base.department,
          status: resolvedStatus,
          photoURL: top.photoURL || base.photoURL,
        });
      }
    });

    const deduplicated = Array.from(uMap.values()).filter(u => !isDemoUser(u));
    // Self-heal localStorage if duplicates or demo users were present
    if (deduplicated.length !== list.length) {
      try {
        safeSetItem(STORAGE_KEYS.USERS, JSON.stringify(deduplicated));
      } catch {}
    }
    return deduplicated;
  },

  updateUsersFromCloud(cloudUsers: UserAccount[]) {
    if (!Array.isArray(cloudUsers)) return;
    const deletedKeys = new Set(this.getDeletedUserKeys());
    const uMap = new Map<string, UserAccount>();

    // 1. Seed with existing local users to prevent accidental wipeouts
    const currentUsers = this.getUsers();
    currentUsers.forEach(u => {
      if (u && u.email && !isDemoUser(u)) {
        uMap.set(u.email.trim().toLowerCase(), u);
      }
    });

    // 2. Merge cloud users with timestamp comparison
    cloudUsers.forEach(u => {
      if (!u || !u.email) return;
      if (isDemoUser(u)) return;
      const cleanEmail = u.email.trim().toLowerCase();
      const idLower = (u.id || '').toLowerCase();
      
      const isProtected = u.isGoogleAccount || u.status === 'Active' || u.status === 'Pending_Approval' || cleanEmail.endsWith('@siemens.com') || cleanEmail.endsWith('@gmail.com');
      if (!isProtected) {
        if (deletedKeys.has(cleanEmail)) return;
        if (idLower && deletedKeys.has(idLower)) return;
      }

      let status = u.status;
      if (status) {
        const s = status.toLowerCase();
        if (s === 'active') status = 'Active';
        else if (s.includes('pending')) status = 'Pending_Approval';
        else if (s === 'deactivated') status = 'Deactivated';
      } else {
        status = 'Active';
      }

      const existing = uMap.get(cleanEmail);
      if (!existing) {
        uMap.set(cleanEmail, { ...u, email: cleanEmail, status });
      } else {
        const existingTime = existing.updatedAt || existing.lastLogin || existing.createdAt || '';
        const incomingTime = u.updatedAt || u.lastLogin || u.createdAt || '';
        const isIncomingNewer = incomingTime >= existingTime;
        const base = isIncomingNewer ? existing : u;
        const top = isIncomingNewer ? u : existing;

        const currentStored = this.getCurrentUser();
        const isCurrentActive = currentStored && currentStored.email?.trim().toLowerCase() === cleanEmail && currentStored.status === 'Active';
        const isAlreadyActive = existing.status === 'Active' || u.status === 'Active' || isCurrentActive;
        const resolvedStatus = cleanEmail === 'smo.cs.th.bts@gmail.com' 
          ? 'Active' 
          : (isAlreadyActive ? 'Active' : (top.status || base.status || status));

        const resolvedDept = (top.department && top.department !== 'PENDING')
          ? top.department
          : ((base.department && base.department !== 'PENDING') ? base.department : (isCurrentActive && currentStored?.department !== 'PENDING' ? currentStored?.department : top.department));
        const resolvedRole = cleanEmail === 'smo.cs.th.bts@gmail.com' ? 'Admin' : (top.role || base.role || currentStored?.role || 'User');

        const updatedMerged: UserAccount = {
          ...base,
          ...top,
          email: cleanEmail,
          status: resolvedStatus,
          department: resolvedDept,
          role: resolvedRole,
        };
        uMap.set(cleanEmail, updatedMerged);

        if (isCurrentActive && resolvedStatus === 'Active') {
          safeSetItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify({ ...currentStored, ...updatedMerged }));
        }
      }
    });

    const cleanList = Array.from(uMap.values()).filter(u => !isDemoUser(u));
    try {
      safeSetItem(STORAGE_KEYS.USERS, JSON.stringify(cleanList));
      notifyDataChanged();
    } catch (e) {
      console.warn('updateUsersFromCloud cache warning:', e);
    }
  },

  setUsers(users: UserAccount[]) {
    const deletedKeys = new Set(this.getDeletedUserKeys());
    const now = new Date().toISOString();
    const currentStored = this.getCurrentUser();
    const uMap = new Map<string, UserAccount>();
    users.forEach(u => {
      if (!u || !u.email) return;
      if (isDemoUser(u)) return;
      const cleanEmail = u.email.trim().toLowerCase();
      const idLower = (u.id || '').toLowerCase();
      
      const isProtected = u.isGoogleAccount || u.status === 'Active' || u.status === 'Pending_Approval' || cleanEmail.endsWith('@siemens.com') || cleanEmail.endsWith('@gmail.com');
      if (!isProtected) {
        if (deletedKeys.has(cleanEmail)) return;
        if (idLower && deletedKeys.has(idLower)) return;
      }

      const isCurrentActive = currentStored && currentStored.email?.trim().toLowerCase() === cleanEmail && currentStored.status === 'Active';
      let status = u.status;
      if (status) {
        const s = status.toLowerCase();
        if (s === 'active') status = 'Active';
        else if (s.includes('pending')) status = isCurrentActive ? 'Active' : 'Pending_Approval';
        else if (s === 'deactivated') status = 'Deactivated';
      } else {
        status = 'Active';
      }

      uMap.set(cleanEmail, { ...u, email: cleanEmail, status, updatedAt: u.updatedAt || now });
    });
    const cleanUsers = Array.from(uMap.values()).filter(u => !isDemoUser(u));
    safeSetItem(STORAGE_KEYS.USERS, JSON.stringify(cleanUsers));
    notifyDataChanged();
    // Targeted cloud sync for users
    firestoreSync.syncUsers(cleanUsers).catch(console.warn);
  },

  async saveUser(user: UserAccount): Promise<boolean> {
    if (isDemoUser(user)) {
      console.warn('Cannot save demo user:', user.email);
      return false;
    }
    this.unrecordDeletedUser(user.id, user.email);
    const current = this.getUsers();
    const cleanEmail = (user.email || '').trim().toLowerCase();
    const now = new Date().toISOString();
    const currentStored = this.getCurrentUser();
    const isCurrentActive = currentStored && currentStored.email?.trim().toLowerCase() === cleanEmail && currentStored.status === 'Active';
    const isLocalActive = current.some(u => u && u.email?.trim().toLowerCase() === cleanEmail && u.status === 'Active');

    let status = user.status;
    if (status) {
      const s = status.toLowerCase();
      if (s === 'active') status = 'Active';
      else if (s.includes('pending')) {
        status = (isCurrentActive || isLocalActive) ? 'Active' : 'Pending_Approval';
      }
      else if (s === 'deactivated') status = 'Deactivated';
    } else {
      status = 'Active';
    }
    const normalizedUser: UserAccount = {
      ...user,
      email: cleanEmail,
      status,
      updatedAt: user.updatedAt || now,
    };

    const uMap = new Map<string, UserAccount>();
    current.forEach(u => {
      if (u && u.email && !isDemoUser(u)) {
        uMap.set(u.email.trim().toLowerCase(), u);
      }
    });
    uMap.set(cleanEmail, { ...(uMap.get(cleanEmail) || {}), ...normalizedUser });

    const cleanUsers = Array.from(uMap.values()).filter(u => !isDemoUser(u));
    safeSetItem(STORAGE_KEYS.USERS, JSON.stringify(cleanUsers));

    // If current logged-in user, ensure CURRENT_USER in storage is also updated!
    if (currentStored && currentStored.email?.trim().toLowerCase() === cleanEmail) {
      safeSetItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify({ ...currentStored, ...normalizedUser }));
    }

    notifyDataChanged();
    return await firestoreSync.saveUserDirect(normalizedUser);
  },

  async deleteUser(userId: string, email?: string): Promise<boolean> {
    this.recordDeletedUser(userId, email);
    const current = this.getUsers();
    const cleanEmail = (email || '').trim().toLowerCase();
    const updated = current.filter(u => {
      if (u.id === userId) return false;
      if (cleanEmail && u.email?.trim().toLowerCase() === cleanEmail) return false;
      return true;
    });
    safeSetItem(STORAGE_KEYS.USERS, JSON.stringify(updated));
    notifyDataChanged();
    return await firestoreSync.deleteUser(userId, email, updated);
  },

  getCurrentUser(): UserAccount | null {
    const data = safeGetItem(STORAGE_KEYS.CURRENT_USER);
    if (!data) {
      return null;
    }
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  },
  setCurrentUser(user: UserAccount | null) {
    if (user) {
      safeSetItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
    } else {
      safeRemoveItem(STORAGE_KEYS.CURRENT_USER);
    }
    notifyDataChanged();
  },
  clearCurrentUser() {
    safeRemoveItem(STORAGE_KEYS.CURRENT_USER);
    notifyDataChanged();
  },

  getDeletedDepartmentCodes(): string[] {
    try {
      const data = safeGetItem(STORAGE_KEYS.DELETED_DEPARTMENTS);
      const list: string[] = data ? JSON.parse(data) : [];
      return list.map(c => String(c).trim().toUpperCase()).filter(Boolean);
    } catch {
      return [];
    }
  },

  recordDeletedDepartment(code: string) {
    try {
      const clean = (code || '').trim().toUpperCase();
      if (!clean) return;

      const current = this.getDeletedDepartmentCodes();
      if (!current.includes(clean)) {
        current.push(clean);
        safeSetItem(STORAGE_KEYS.DELETED_DEPARTMENTS, JSON.stringify(current));
      }
    } catch (e) {
      console.warn('recordDeletedDepartment warning:', e);
    }
  },

  getDepartments(): Department[] {
    const deletedCodes = this.getDeletedDepartmentCodes();
    const deletedSet = new Set(deletedCodes);

    const deptMap = new Map<string, Department>();

    // 1. Seed with authentic real BTS departments (only if not marked deleted by user)
    INITIAL_DEPARTMENTS.forEach(d => {
      if (d && d.code) {
        const upper = d.code.trim().toUpperCase();
        if (!deletedSet.has(upper)) {
          deptMap.set(upper, { code: upper, name: resolveDepartmentFullName(upper, d.name) });
        }
      }
    });

    // 2. Overlay any stored/custom departments from local storage (smart-merge: never downgrade full names)
    const data = safeGetItem(STORAGE_KEYS.DEPARTMENTS);
    if (data) {
      try {
        const list: Department[] = JSON.parse(data);
        if (Array.isArray(list)) {
          list.forEach(d => {
            if (d && d.code) {
              const code = d.code.trim().toUpperCase();
              if (!deletedSet.has(code)) {
                const existing = deptMap.get(code);
                const resolvedName = resolveDepartmentFullName(code, d.name, existing?.name);
                deptMap.set(code, { code, name: resolvedName, updatedAt: d.updatedAt || existing?.updatedAt });
              }
            }
          });
        }
      } catch {}
    }

    // 3. Harvest departments ONLY from active employees that are not in deletedSet
    try {
      const empRaw = safeGetItem(STORAGE_KEYS.EMPLOYEES);
      if (empRaw) {
        const emps = JSON.parse(empRaw);
        if (Array.isArray(emps)) {
          emps.forEach((e: any) => {
            if (e && e.department && e.department.trim() !== 'ALL') {
              const upper = e.department.trim().toUpperCase();
              if (!isDemoDepartment(upper) && !deptMap.has(upper) && !deletedSet.has(upper)) {
                deptMap.set(upper, { code: upper, name: getCanonicalDepartmentFullName(upper) });
              }
            }
          });
        }
      }
    } catch {}

    // Guarantee OHL (Overhaul) is present if not deleted
    if (!deletedSet.has('OHL') && !deptMap.has('OHL')) {
      deptMap.set('OHL', { code: 'OHL', name: 'Overhaul' });
    }

    // Explicitly exclude TRW/TRD, TRD, OVH, and MRL from displayed departments
    deptMap.delete('TRW/TRD');
    deptMap.delete('TRD');
    deptMap.delete('OVH');
    deptMap.delete('MRL');

    const sorted = Array.from(deptMap.values())
      .filter(d => d && d.code && !isDemoDepartment(d.code) && d.code !== 'TRW/TRD' && d.code !== 'TRD' && d.code !== 'OVH' && d.code !== 'MRL')
      .map(d => {
        const code = d.code.trim().toUpperCase();
        return {
          code,
          name: resolveDepartmentFullName(code, d.name) || code,
          updatedAt: d.updatedAt || new Date().toISOString(),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
    return sorted;
  },

  async setDepartments(departments: Department[]): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const clean = (departments || [])
      .filter(d => d && d.code)
      .map(d => {
        const code = d.code.trim().toUpperCase();
        return {
          code,
          name: resolveDepartmentFullName(code, d.name) || code,
          updatedAt: d.updatedAt || nowIso,
        };
      });
    // Also un-record from deleted if explicitly added/updated
    const deletedCodes = this.getDeletedDepartmentCodes();
    const cleanCodesSet = new Set(clean.map(d => d.code));
    const newDeleted = deletedCodes.filter(c => !cleanCodesSet.has(c));
    if (newDeleted.length !== deletedCodes.length) {
      safeSetItem(STORAGE_KEYS.DELETED_DEPARTMENTS, JSON.stringify(newDeleted));
    }

    safeSetItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(clean));
    safeSetItem(STORAGE_KEYS.DEPARTMENTS_MODIFIED, String(Date.now()));
    notifyDataChanged();
    return await firestoreSync.syncDepartments(clean);
  },

  async deleteDepartment(code: string): Promise<boolean> {
    const clean = code.trim().toUpperCase();
    this.recordDeletedDepartment(clean);
    const list = this.getDepartments();
    const filtered = list.filter(d => (d.code || '').trim().toUpperCase() !== clean);
    safeSetItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(filtered));
    safeSetItem(STORAGE_KEYS.DEPARTMENTS_MODIFIED, String(Date.now()));

    const fallbackDept = filtered.find(d => d.code === 'RST')?.code || filtered[0]?.code || 'GM';

    // Cascade clean any Employees associated with this deleted department
    try {
      const emps = this.getEmployees();
      const hasMatchingEmps = emps.some(e => (e.department || '').trim().toUpperCase() === clean);
      if (hasMatchingEmps) {
        const cleanedEmps = emps.map(e =>
          (e.department || '').trim().toUpperCase() === clean
            ? { ...e, department: fallbackDept, updatedAt: new Date().toISOString() }
            : e
        );
        this.setEmployees(cleanedEmps).catch(() => null);
      }
    } catch {}

    // Cascade clean any ShiftCodes associated with this deleted department
    try {
      const shiftCodes = this.getShiftCodes();
      const hasMatchingCodes = shiftCodes.some(sc => (sc.department || '').trim().toUpperCase() === clean);
      if (hasMatchingCodes) {
        const cleanedCodes = shiftCodes.map(sc => 
          (sc.department || '').trim().toUpperCase() === clean
            ? { ...sc, department: 'ALL', updatedAt: new Date().toISOString() }
            : sc
        );
        this.setShiftCodes(cleanedCodes).catch(() => null);
      }
    } catch {}

    // Cascade clean any Users assigned to this deleted department
    try {
      const users = this.getUsers();
      const hasMatchingUsers = users.some(u => (u.department || '').trim().toUpperCase() === clean);
      if (hasMatchingUsers) {
        const cleanedUsers = users.map(u =>
          (u.department || '').trim().toUpperCase() === clean
            ? { ...u, department: fallbackDept, updatedAt: new Date().toISOString() }
            : u
        );
        this.setUsers(cleanedUsers).catch(() => null);
      }
    } catch {}

    notifyDataChanged();
    return await firestoreSync.deleteDepartment(clean, filtered);
  },

  async purgeUnusedZeroPersonDepartments(): Promise<{ purgedCount: number; purgedCodes: string[] }> {
    const REAL_ACTIVE_CODES = new Set(INITIAL_DEPARTMENTS.map(d => d.code.toUpperCase()));
    const emps = this.getEmployees();
    const activeDeptCounts = new Map<string, number>();
    emps.forEach(e => {
      if (e && e.department) {
        const d = e.department.trim().toUpperCase();
        activeDeptCounts.set(d, (activeDeptCounts.get(d) || 0) + 1);
      }
    });

    const currentDepts = this.getDepartments();
    const purgedCodes: string[] = [];
    const retainedDepts: Department[] = [];

    currentDepts.forEach(d => {
      const code = (d.code || '').trim().toUpperCase();
      const count = activeDeptCounts.get(code) || 0;
      const isReal = REAL_ACTIVE_CODES.has(code);
      const isDemo = isDemoDepartment(code);
      if (isDemo || (!isReal && count === 0)) {
        purgedCodes.push(code);
        this.recordDeletedDepartment(code);
      } else {
        retainedDepts.push(d);
      }
    });

    if (purgedCodes.length > 0) {
      safeSetItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(retainedDepts));
      safeSetItem(STORAGE_KEYS.DEPARTMENTS_MODIFIED, String(Date.now()));
      for (const code of purgedCodes) {
        await firestoreSync.deleteDepartment(code, retainedDepts);
      }
      await firestoreSync.syncDepartments(retainedDepts);
      notifyDataChanged();
    }

    return { purgedCount: purgedCodes.length, purgedCodes };
  },

  getEmployees(): Employee[] {
    const data = safeGetItem(STORAGE_KEYS.EMPLOYEES);
    if (!data) {
      const deletedNos = new Set(this.getDeletedEmployeeNos().map(x => x.trim().toUpperCase()));
      return INITIAL_EMPLOYEES.filter(e => {
        if (!e || !e.empNo || isDemoEmployee(e)) return false;
        const no = e.empNo.trim().toUpperCase();
        const gid = (e.gid || '').trim().toUpperCase();
        const id = cleanDocId(e.empNo).toUpperCase();
        return !deletedNos.has(no) && !deletedNos.has(gid) && !deletedNos.has(id);
      });
    }
    try {
      const parsed: Employee[] = JSON.parse(data);
      if (Array.isArray(parsed)) {
        const deduped = deduplicateAndCanonicalizeEmployees(parsed);
        if (deduped.length !== parsed.length) {
          safeSetItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(deduped));
        }
        return deduped;
      }
      return [];
    } catch {
      return [];
    }
  },

  async setEmployees(employees: Employee[], timeoutMs?: number): Promise<boolean> {
    const uniqueEmployees = deduplicateAndCanonicalizeEmployees(employees || []);

    // Un-blacklist any active employees so getEmployees() won't filter them out
    const identifiersToUnrecord: string[] = [];
    uniqueEmployees.forEach(emp => {
      if (emp.empNo) identifiersToUnrecord.push(emp.empNo);
      if (emp.gid) identifiersToUnrecord.push(emp.gid);
      if (emp.empCode) identifiersToUnrecord.push(emp.empCode);
      const cleanId = cleanDocId(emp.empNo);
      if (cleanId) identifiersToUnrecord.push(cleanId);
    });
    this.unrecordDeletedEmployees(identifiersToUnrecord);

    safeSetItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(uniqueEmployees));
    safeSetItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));
    notifyDataChanged();
    return await firestoreSync.syncEmployees(uniqueEmployees, timeoutMs);
  },

  getDeletedEmployeeNos(): string[] {
    try {
      const data = safeGetItem(STORAGE_KEYS.DELETED_EMPLOYEES);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  unrecordDeletedEmployees(identifiers: string[]) {
    try {
      const current = this.getDeletedEmployeeNos();
      if (!current || current.length === 0) return;
      const toRemove = new Set(identifiers.map(x => String(x || '').trim().toUpperCase()).filter(Boolean));
      const filtered = current.filter(x => !toRemove.has(x.trim().toUpperCase()));
      if (filtered.length !== current.length) {
        safeSetItem(STORAGE_KEYS.DELETED_EMPLOYEES, JSON.stringify(filtered));
      }
    } catch (e) {
      console.warn('unrecordDeletedEmployees warning:', e);
    }
  },

  recordDeletedEmployee(empNo: string, gid?: string, empCode?: string) {
    try {
      const current = this.getDeletedEmployeeNos();
      const toAdd = [empNo.trim().toUpperCase()];
      if (gid && gid.trim()) toAdd.push(gid.trim().toUpperCase());
      if (empCode && empCode.trim()) toAdd.push(empCode.trim().toUpperCase());
      const cleanId = cleanDocId(empNo).toUpperCase();
      if (cleanId) toAdd.push(cleanId);

      let changed = false;
      toAdd.forEach(item => {
        if (!current.includes(item)) {
          current.push(item);
          changed = true;
        }
      });
      if (changed) {
        safeSetItem(STORAGE_KEYS.DELETED_EMPLOYEES, JSON.stringify(current));
      }
    } catch (e) {
      console.warn('recordDeletedEmployee warning:', e);
    }
  },

  async saveEmployee(emp: Employee): Promise<boolean> {
    const list = this.getEmployees();
    const cleanNo = (emp.empNo || '').trim().toUpperCase();
    const cleanGid = (emp.gid || '').trim().toUpperCase();
    const nowIso = new Date().toISOString();

    const idx = list.findIndex(e => 
      (e.empNo && e.empNo.trim().toUpperCase() === cleanNo) ||
      (e.gid && e.gid.trim().toUpperCase() === cleanGid)
    );

    const updatedEmp: Employee = {
      ...emp,
      empNo: emp.empNo?.trim() || (idx >= 0 ? list[idx].empNo : cleanNo),
      gid: emp.gid?.trim() || (idx >= 0 ? list[idx].gid : cleanGid),
      department: (emp.department || (idx >= 0 ? list[idx].department : 'GM')).trim().toUpperCase(),
      updatedAt: nowIso,
    };

    if (idx >= 0) {
      list[idx] = { ...list[idx], ...updatedEmp };
    } else {
      list.push(updatedEmp);
    }

    return await this.setEmployees(list);
  },

  async deleteEmployee(empNo: string): Promise<boolean> {
    const cleanNo = empNo.trim().toUpperCase();
    const list = this.getEmployees();
    const targetEmp = list.find(e => 
      (e.empNo || '').trim().toUpperCase() === cleanNo || 
      (e.gid || '').trim().toUpperCase() === cleanNo ||
      (e.empCode && e.empCode.trim().toUpperCase() === cleanNo)
    );
    this.recordDeletedEmployee(empNo, targetEmp?.gid, targetEmp?.empCode);

    const filtered = list.filter(e => {
      const eNo = (e.empNo || '').trim().toUpperCase();
      const eGid = (e.gid || '').trim().toUpperCase();
      const eCode = (e.empCode || '').trim().toUpperCase();
      const matchEmpNo = eNo === cleanNo;
      const matchGid = Boolean(targetEmp?.gid && eGid === targetEmp.gid.trim().toUpperCase());
      const matchCode = Boolean(targetEmp?.empCode && eCode === targetEmp.empCode.trim().toUpperCase());
      return !matchEmpNo && !matchGid && !matchCode && !isDemoEmployee(e);
    });

    safeSetItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(filtered));
    safeSetItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));
    notifyDataChanged();
    
    // Non-blocking background sync so UI never hangs or freezes
    firestoreSync.deleteEmployee(empNo, filtered).catch(e => {
      console.warn('firestoreSync.deleteEmployee background notice:', e);
    });
    return true;
  },

  /**
   * Safely rename an employee's Primary Key (Employee No.) and cascade-update
   * all related Shift Plans, Biometric Punches, OT Records, Allowances, and Manual Overrides
   */
  async changeEmployeeNo(oldEmpNo: string, newEmpNo: string): Promise<{
    success: boolean;
    error?: string;
    updatedPlansCount: number;
    updatedPunchesCount: number;
    updatedOTCount: number;
    updatedAllowancesCount: number;
  }> {
    const cleanOld = (oldEmpNo || '').trim();
    const cleanNew = (newEmpNo || '').trim();

    if (!cleanOld || !cleanNew) {
      return {
        success: false,
        error: 'รหัสพนักงานเดิมและรหัสใหม่ต้องไม่เป็นค่าว่าง',
        updatedPlansCount: 0,
        updatedPunchesCount: 0,
        updatedOTCount: 0,
        updatedAllowancesCount: 0
      };
    }

    if (cleanOld.toUpperCase() === cleanNew.toUpperCase()) {
      return {
        success: true,
        updatedPlansCount: 0,
        updatedPunchesCount: 0,
        updatedOTCount: 0,
        updatedAllowancesCount: 0
      };
    }

    const emps = this.getEmployees();
    const oldNum = /^\d+$/.test(cleanOld) ? parseInt(cleanOld, 10) : null;
    const newNum = /^\d+$/.test(cleanNew) ? parseInt(cleanNew, 10) : null;

    let targetIdx = emps.findIndex(e => (e.empNo || '').trim().toUpperCase() === cleanOld.toUpperCase());
    if (targetIdx === -1 && oldNum !== null) {
      targetIdx = emps.findIndex(e => {
        const eNo = (e.empNo || '').trim();
        return /^\d+$/.test(eNo) && parseInt(eNo, 10) === oldNum;
      });
    }

    if (targetIdx === -1) {
      return {
        success: false,
        error: `ไม่พบพนักงานรหัส ${cleanOld} ในระบบ`,
        updatedPlansCount: 0,
        updatedPunchesCount: 0,
        updatedOTCount: 0,
        updatedAllowancesCount: 0
      };
    }

    // Check if newEmpNo is already taken by another employee
    const collision = emps.find((e, idx) => {
      if (idx === targetIdx) return false;
      const eNo = (e.empNo || '').trim().toUpperCase();
      if (eNo === cleanNew.toUpperCase()) return true;
      if (newNum !== null && /^\d+$/.test(eNo) && parseInt(eNo, 10) === newNum) return true;
      return false;
    });

    if (collision) {
      return {
        success: false,
        error: `รหัสพนักงานใหม่ "${cleanNew}" ซ้ำกับพนักงานที่มีอยู่แล้ว (${collision.firstName} ${collision.familyName} แผนก ${collision.department})`,
        updatedPlansCount: 0,
        updatedPunchesCount: 0,
        updatedOTCount: 0,
        updatedAllowancesCount: 0
      };
    }

    // Un-record cleanNew from deleted employees
    this.unrecordDeletedEmployees([cleanNew, cleanDocId(cleanNew)]);

    // 1. Update Employee Record
    const targetEmp = emps[targetIdx];
    const actualOldEmpNo = targetEmp.empNo || cleanOld;
    const updatedEmp: Employee = {
      ...targetEmp,
      empNo: cleanNew,
      id: `emp-${cleanNew}`,
      updatedAt: new Date().toISOString()
    };
    emps[targetIdx] = updatedEmp;

    // 2. Cascade Update Shift Plans
    let updatedPlansCount = 0;
    const plans = this.getShiftPlans();
    let plansChanged = false;
    const updatedPlans = plans.map(p => {
      const pEmpNo = (p.empNo || '').trim().toUpperCase();
      const matchOld = pEmpNo === cleanOld.toUpperCase() || pEmpNo === actualOldEmpNo.toUpperCase() ||
        (oldNum !== null && /^\d+$/.test(pEmpNo) && parseInt(pEmpNo, 10) === oldNum);
      if (matchOld) {
        updatedPlansCount++;
        plansChanged = true;
        return {
          ...p,
          empNo: cleanNew,
          id: p.id ? p.id.replace(actualOldEmpNo, cleanNew).replace(cleanOld, cleanNew) : `${cleanNew}_${p.date}`
        };
      }
      return p;
    });

    // 3. Cascade Update Biometric Punches
    let updatedPunchesCount = 0;
    const punches = this.getBiometricPunches();
    let punchesChanged = false;
    const updatedPunches = punches.map(p => {
      const pId = (p.empIdentifier || '').trim().toUpperCase();
      const matchOld = pId === cleanOld.toUpperCase() || pId === actualOldEmpNo.toUpperCase() ||
        (oldNum !== null && /^\d+$/.test(pId) && parseInt(pId, 10) === oldNum);
      if (matchOld) {
        updatedPunchesCount++;
        punchesChanged = true;
        return {
          ...p,
          empIdentifier: cleanNew
        };
      }
      return p;
    });

    // 4. Cascade Update OT Records
    let updatedOTCount = 0;
    const ot = this.getOTRecords();
    let otChanged = false;
    const updatedOT = ot.map(o => {
      const oEmpNo = (o.empNo || '').trim().toUpperCase();
      const matchOld = oEmpNo === cleanOld.toUpperCase() || oEmpNo === actualOldEmpNo.toUpperCase() ||
        (oldNum !== null && /^\d+$/.test(oEmpNo) && parseInt(oEmpNo, 10) === oldNum);
      if (matchOld) {
        updatedOTCount++;
        otChanged = true;
        return {
          ...o,
          empNo: cleanNew
        };
      }
      return o;
    });

    // 5. Cascade Update Other Allowances
    let updatedAllowancesCount = 0;
    const allow = this.getOtherAllowances();
    let allowChanged = false;
    const updatedAllow = allow.map(a => {
      const aEmpNo = (a.empNo || '').trim().toUpperCase();
      const matchOld = aEmpNo === cleanOld.toUpperCase() || aEmpNo === actualOldEmpNo.toUpperCase() ||
        (oldNum !== null && /^\d+$/.test(aEmpNo) && parseInt(aEmpNo, 10) === oldNum);
      if (matchOld) {
        updatedAllowancesCount++;
        allowChanged = true;
        return {
          ...a,
          empNo: cleanNew
        };
      }
      return a;
    });

    // 6. Cascade Update Manual Overrides
    const overrides = this.getManualOverrides();
    let overridesChanged = false;
    const newOverrides: Record<string, Partial<TimeSheetRow>> = {};
    Object.entries(overrides).forEach(([key, val]) => {
      if (key.startsWith(`${cleanOld}_`)) {
        overridesChanged = true;
        const newKey = `${cleanNew}_${key.substring(cleanOld.length + 1)}`;
        newOverrides[newKey] = val;
      } else if (key.startsWith(`${actualOldEmpNo}_`)) {
        overridesChanged = true;
        const newKey = `${cleanNew}_${key.substring(actualOldEmpNo.length + 1)}`;
        newOverrides[newKey] = val;
      } else {
        newOverrides[key] = val;
      }
    });

    // 7. Synchronously persist all changes immediately so UI updates instantaneously
    safeSetItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(emps));
    safeSetItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));

    if (plansChanged) {
      safeSetItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(updatedPlans));
      safeSetItem(STORAGE_KEYS.SHIFT_PLANS_MODIFIED, String(Date.now()));
    }

    if (punchesChanged) {
      memoryPunchesCache = updatedPunches;
      try {
        safeSetItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(updatedPunches));
        safeSetItem(STORAGE_KEYS.PUNCHES_MODIFIED, String(Date.now()));
      } catch (err) {
        console.warn('LocalStorage quota warning saving punches:', err);
      }
    }

    if (otChanged) {
      safeSetItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(updatedOT));
    }

    if (allowChanged) {
      safeSetItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(updatedAllow));
    }

    if (overridesChanged) {
      safeSetItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(newOverrides));
    }

    notifyDataChanged();

    // 8. Fire non-blocking Cloud Firestore background sync
    (async () => {
      try {
        // Clean up old legacy doc in Firestore
        firestoreSync.deleteEmployee(cleanOld).catch(() => null);
        if (actualOldEmpNo !== cleanOld) {
          firestoreSync.deleteEmployee(actualOldEmpNo).catch(() => null);
        }

        const cloudTasks: Promise<any>[] = [
          firestoreSync.syncEmployees(emps)
        ];
        if (plansChanged) cloudTasks.push(firestoreSync.syncShiftPlans(updatedPlans));
        if (punchesChanged) cloudTasks.push(firestoreSync.syncBiometricPunches(updatedPunches));
        if (otChanged) cloudTasks.push(firestoreSync.syncOTRecords(updatedOT));
        if (allowChanged) cloudTasks.push(firestoreSync.syncOtherAllowances(updatedAllow));
        if (overridesChanged) cloudTasks.push(firestoreSync.syncManualOverrides(newOverrides));

        await Promise.allSettled(cloudTasks);
      } catch (err) {
        console.warn('Background Firestore sync for changeEmployeeNo caught warning:', err);
      }
    })();

    return {
      success: true,
      updatedPlansCount,
      updatedPunchesCount,
      updatedOTCount,
      updatedAllowancesCount
    };
  },

  getShiftCodes(): ShiftCode[] {
    const data = safeGetItem(STORAGE_KEYS.SHIFT_CODES);
    if (!data) {
      return INITIAL_SHIFT_CODES;
    }
    try {
      const parsed: ShiftCode[] = JSON.parse(data);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return INITIAL_SHIFT_CODES;
      }

      // Preserve all custom and master shift codes cleanly and ensure normalized HH:mm times
      const cleaned: ShiftCode[] = parsed.map(sc => {
        const isWorking = sc.isWorkingDay !== undefined ? sc.isWorkingDay : true;
        const normStart = !isWorking 
          ? (normalizeShiftTimeString(sc.startTime) || '00:00')
          : (normalizeShiftTimeString(sc.startTime) || '08:00');
        const normEnd = !isWorking 
          ? (normalizeShiftTimeString(sc.endTime) || '00:00')
          : (normalizeShiftTimeString(sc.endTime) || '17:00');

        return {
          ...sc,
          department: (sc.department || 'ALL').trim(),
          name: (sc.name || sc.code).trim(),
          startTime: normStart,
          endTime: normEnd,
          description: sc.description || '',
        };
      });

      // Ensure essential initial shift codes (such as D2 for BES/PSY) are always present
      const existingKeySet = new Set(cleaned.map(c => `${c.code.trim().toUpperCase()}_${(c.department || 'ALL').trim().toUpperCase()}`));
      for (const initCode of INITIAL_SHIFT_CODES) {
        const initKey = `${initCode.code.trim().toUpperCase()}_${(initCode.department || 'ALL').trim().toUpperCase()}`;
        if (!existingKeySet.has(initKey)) {
          cleaned.push({ ...initCode, department: (initCode.department || 'ALL').trim() });
          existingKeySet.add(initKey);
        }
      }

      return cleaned;
    } catch {
      return INITIAL_SHIFT_CODES;
    }
  },

  async setShiftCodes(codes: ShiftCode[]): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const stamped = codes.map(c => ({
      ...c,
      code: (c.code || '').trim().toUpperCase(),
      department: (c.department || 'ALL').trim(),
      updatedAt: c.updatedAt || nowIso,
    }));
    safeSetItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(stamped));
    safeSetItem(STORAGE_KEYS.SHIFT_CODES_MODIFIED, String(Date.now()));
    notifyDataChanged();
    // Targeted sync in bundled collection (1 write)
    const res = await firestoreSync.syncShiftCodes(stamped);
    // Also sync departments if any newly discovered departments were added
    const depts = this.getDepartments();
    firestoreSync.syncDepartments(depts).catch(console.warn);
    return res;
  },

  getShiftPlans(): DailyShiftPlan[] {
    const data = safeGetItem(STORAGE_KEYS.SHIFT_PLANS);
    if (!data) {
      return [];
    }
    try {
      const parsed: DailyShiftPlan[] = JSON.parse(data);
      if (Array.isArray(parsed)) {
        const cleaned = deduplicateAndCanonicalizeShiftPlans(parsed);
        if (cleaned.length !== parsed.length) {
          safeSetItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(cleaned));
        }
        return cleaned;
      }
      return [];
    } catch {
      return [];
    }
  },

  async setShiftPlans(plans: DailyShiftPlan[], newlyChangedPlans?: DailyShiftPlan[]): Promise<boolean> {
    const cleanPlans = deduplicateAndCanonicalizeShiftPlans(plans || []);

    // Synchronize manualOverrides so no stale override shift code conflicts with the new shift plan
    const overrides = this.getManualOverrides();
    let overridesChanged = false;

    cleanPlans.forEach(p => {
      if (!p.date || !p.shiftCode) return;
      const cleanEmp = (p.empNo || '').trim().toUpperCase();
      const cleanGid = (p.gid || '').trim().toUpperCase();
      const cleanDigits = cleanEmp.replace(/\D/g, '').replace(/^0+/, '');

      const empKeys = new Set<string>();
      if (cleanEmp) empKeys.add(`${cleanEmp}_${p.date}`);
      if (cleanGid) empKeys.add(`${cleanGid}_${p.date}`);
      if (cleanDigits) {
        empKeys.add(`${cleanDigits}_${p.date}`);
        empKeys.add(`${cleanDigits.padStart(4, '0')}_${p.date}`);
      }

      empKeys.forEach(k => {
        if (overrides[k] && overrides[k].shiftCode && overrides[k].shiftCode !== p.shiftCode) {
          overrides[k] = { ...overrides[k], shiftCode: p.shiftCode };
          overridesChanged = true;
        }
      });
    });

    safeSetItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(cleanPlans));
    safeSetItem(STORAGE_KEYS.SHIFT_PLANS_MODIFIED, String(Date.now()));

    if (overridesChanged) {
      safeSetItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(overrides));
      firestoreSync.syncManualOverrides(overrides).catch(console.warn);
    }

    notifyDataChangedImmediate();
    return await firestoreSync.syncShiftPlans(cleanPlans, newlyChangedPlans);
  },

  async saveShiftPlan(plan: DailyShiftPlan): Promise<boolean> {
    const current = this.getShiftPlans();
    const canonNo = canonicalEmpNo(plan.empNo);
    const canonDept = toCanonicalDepartment(plan.department);
    const cleanGid = (plan.gid || '').trim().toUpperCase();
    const nowIso = new Date().toISOString();

    const stampedPlan: DailyShiftPlan = {
      ...plan,
      empNo: canonNo || (plan.empNo ? plan.empNo.trim() : ''),
      gid: cleanGid,
      department: canonDept,
      updatedAt: nowIso,
    };

    const targetEmpKey = canonNo || cleanGid;
    const filtered = current.filter(p => {
      if (p.date !== plan.date) return true;
      const pCanonNo = canonicalEmpNo(p.empNo);
      const pGid = (p.gid || '').trim().toUpperCase();
      const isMatch = Boolean(
        (canonNo && pCanonNo && canonNo === pCanonNo) ||
        (cleanGid && pGid && cleanGid === pGid) ||
        (canonNo && pGid && canonNo === pGid) ||
        (cleanGid && pCanonNo && cleanGid === pCanonNo)
      );
      return !isMatch;
    });

    filtered.push(stampedPlan);
    const dedupedAll = deduplicateAndCanonicalizeShiftPlans(filtered);

    // Synchronize manualOverrides so no stale override shift code conflicts with the new shift plan
    const overrides = this.getManualOverrides();
    let overridesChanged = false;
    const empKeys = [
      targetEmpKey ? `${targetEmpKey}_${plan.date}` : '',
      cleanGid ? `${cleanGid}_${plan.date}` : '',
      canonNo ? `${canonNo}_${plan.date}` : '',
    ].filter(Boolean);

    empKeys.forEach(k => {
      if (overrides[k] && overrides[k].shiftCode && overrides[k].shiftCode !== plan.shiftCode) {
        overrides[k] = { ...overrides[k], shiftCode: plan.shiftCode };
        overridesChanged = true;
      }
    });

    safeSetItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(dedupedAll));
    safeSetItem(STORAGE_KEYS.SHIFT_PLANS_MODIFIED, String(Date.now()));

    if (overridesChanged) {
      safeSetItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(overrides));
      firestoreSync.syncManualOverrides(overrides).catch(console.warn);
    }

    notifyDataChangedImmediate();
    return await firestoreSync.saveShiftPlanDirect(stampedPlan, dedupedAll);
  },

  getCanonicalEmpIdMap(): Map<string, string> {
    const map = new Map<string, string>();
    const employees = this.getEmployees();
    employees.forEach(e => {
      if (!e) return;
      const cleanNo = (e.empNo || '').trim().toUpperCase();
      const cleanGid = (e.gid || '').trim().toUpperCase();
      const cleanCode = (e.empCode || '').trim().toUpperCase();
      const targetId = cleanNo || cleanGid;

      if (cleanNo) map.set(cleanNo, targetId);
      if (cleanGid) {
        map.set(cleanGid, targetId);
        const gidClean = cleanGid.replace(/[^A-Z0-9]/g, '');
        if (gidClean) map.set(gidClean, targetId);
      }
      if (cleanCode) map.set(cleanCode, targetId);
      const digits = cleanNo.replace(/\D/g, '').replace(/^0+/, '');
      if (digits) {
        if (!map.has(digits)) map.set(digits, targetId);
        if (!map.has(digits.padStart(4, '0'))) map.set(digits.padStart(4, '0'), targetId);
        if (!map.has(`1000${digits.padStart(4, '0')}`)) map.set(`1000${digits.padStart(4, '0')}`, targetId);
      }
    });
    return map;
  },

  mergeCloudShiftPlans(incomingPlans: DailyShiftPlan[]) {
    if (!Array.isArray(incomingPlans) || incomingPlans.length === 0) return;
    const currentPlans = this.getShiftPlans();
    const overrides = this.getManualOverrides();
    let overridesChanged = false;
    const empCanonicalMap = this.getCanonicalEmpIdMap();

    const planMap = new Map<string, DailyShiftPlan>();

    // 1. Populate planMap with current local plans
    currentPlans.forEach(p => {
      if (!p || !p.date || !p.shiftCode) return;
      const cleanEmp = (p.empNo || '').trim().toUpperCase();
      const cleanGid = (p.gid || '').trim().toUpperCase();
      const cleanDigits = cleanEmp.replace(/\D/g, '').replace(/^0+/, '');

      const canonicalId = (
        empCanonicalMap.get(cleanEmp) ||
        empCanonicalMap.get(cleanGid) ||
        empCanonicalMap.get(cleanDigits) ||
        cleanEmp ||
        cleanGid ||
        cleanDigits
      );
      const key = `${canonicalId}_${p.date}`;

      const existing = planMap.get(key);
      if (!existing) {
        planMap.set(key, p);
      } else {
        const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const newTime = p.updatedAt ? new Date(p.updatedAt).getTime() : 0;
        if (isNaN(existingTime) || (newTime >= (isNaN(existingTime) ? 0 : existingTime))) {
          planMap.set(key, p);
        }
      }
    });

    // 2. Merge incoming cloud plans cleanly based on timestamp
    incomingPlans.forEach(p => {
      if (!p || !p.date || !p.shiftCode) return;
      const cleanEmp = (p.empNo || '').trim().toUpperCase();
      const cleanGid = (p.gid || '').trim().toUpperCase();
      const cleanDigits = cleanEmp.replace(/\D/g, '').replace(/^0+/, '');

      const canonicalId = (
        empCanonicalMap.get(cleanEmp) ||
        empCanonicalMap.get(cleanGid) ||
        empCanonicalMap.get(cleanDigits) ||
        cleanEmp ||
        cleanGid ||
        cleanDigits
      );
      const key = `${canonicalId}_${p.date}`;

      const existing = planMap.get(key);
      const existingTime = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const newTime = p.updatedAt ? new Date(p.updatedAt).getTime() : 0;

      const validExisting = isNaN(existingTime) ? 0 : existingTime;
      const validNew = isNaN(newTime) ? 0 : newTime;

      if (!existing || validNew >= validExisting) {
        planMap.set(key, {
          ...(existing || {}),
          ...p,
          empNo: p.empNo || existing?.empNo || '',
          gid: p.gid || existing?.gid || '',
          department: p.department || existing?.department,
          shiftCode: p.shiftCode,
          updatedAt: p.updatedAt || existing?.updatedAt,
        });

        // Keep manualOverrides in sync if present
        const empKeys = new Set<string>();
        if (cleanEmp) empKeys.add(`${cleanEmp}_${p.date}`);
        if (cleanGid) empKeys.add(`${cleanGid}_${p.date}`);
        if (cleanDigits) {
          empKeys.add(`${cleanDigits}_${p.date}`);
          empKeys.add(`${cleanDigits.padStart(4, '0')}_${p.date}`);
        }
        if (canonicalId) empKeys.add(`${canonicalId}_${p.date}`);

        empKeys.forEach(k => {
          if (overrides[k] && overrides[k].shiftCode && overrides[k].shiftCode !== p.shiftCode) {
            overrides[k] = { ...overrides[k], shiftCode: p.shiftCode };
            overridesChanged = true;
          }
        });
      }
    });

    const merged = Array.from(planMap.values());
    safeSetItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(merged));
    safeSetItem(STORAGE_KEYS.SHIFT_PLANS_MODIFIED, String(Date.now()));

    if (overridesChanged) {
      safeSetItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(overrides));
    }

    notifyDataChangedImmediate();
  },

  getBiometricPunches(): BiometricRawPunch[] {
    if (memoryPunchesCache !== null) {
      return memoryPunchesCache;
    }
    const data = safeGetItem(STORAGE_KEYS.RAW_PUNCHES);
    if (!data) {
      memoryPunchesCache = [];
      // Trigger async hydration from IndexedDB in background
      this.hydrateFromIndexedDB().catch(() => {});
      return memoryPunchesCache;
    }
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        memoryPunchesCache = parsed.filter(
          (p): p is BiometricRawPunch =>
            Boolean(p && typeof p === 'object' && typeof p.time === 'string' && p.time.trim() !== '' && (!p.date || p.date >= HISTORY_CUTOFF_DATE))
        );
        // Trigger async hydration from IndexedDB to ensure complete records
        this.hydrateFromIndexedDB().catch(() => {});
        return memoryPunchesCache;
      }
      memoryPunchesCache = [];
      this.hydrateFromIndexedDB().catch(() => {});
      return memoryPunchesCache;
    } catch {
      memoryPunchesCache = [];
      this.hydrateFromIndexedDB().catch(() => {});
      return memoryPunchesCache;
    }
  },

  async hydrateFromIndexedDB(): Promise<{ count: number }> {
    try {
      const idbPunches = await idbGet<BiometricRawPunch[]>(IDB_KEYS.BIOMETRIC_PUNCHES);
      if (Array.isArray(idbPunches) && idbPunches.length > 0) {
        const punchMap = new Map<string, BiometricRawPunch>();
        idbPunches.forEach(p => {
          if (!p || !p.date || !p.time || p.date < HISTORY_CUTOFF_DATE) return;
          const k = `${(p.empIdentifier || '').trim().toLowerCase()}_${p.date}_${p.time}_${p.type || ''}`;
          punchMap.set(k, p);
        });
        if (memoryPunchesCache && memoryPunchesCache.length > 0) {
          memoryPunchesCache.forEach(p => {
            if (!p || !p.date || !p.time || p.date < HISTORY_CUTOFF_DATE) return;
            const k = `${(p.empIdentifier || '').trim().toLowerCase()}_${p.date}_${p.time}_${p.type || ''}`;
            if (!punchMap.has(k)) punchMap.set(k, p);
          });
        }
        const merged = Array.from(punchMap.values());
        if (!memoryPunchesCache || merged.length !== memoryPunchesCache.length) {
          memoryPunchesCache = merged;
          notifyDataChanged();
        }
        return { count: merged.length };
      }
    } catch (err) {
      console.warn('Hydrate punches from IndexedDB warning:', err);
    }
    return { count: memoryPunchesCache ? memoryPunchesCache.length : 0 };
  },

  async setBiometricPunches(punches: BiometricRawPunch[]): Promise<boolean> {
    const cleanPunches = (punches || []).filter(
      (p): p is BiometricRawPunch =>
        Boolean(p && typeof p === 'object' && typeof p.time === 'string' && p.time.trim() !== '' && (!p.date || p.date >= HISTORY_CUTOFF_DATE))
    );
    
    // 1. Deduplicate punches and update synchronous fast in-memory cache
    const punchMap = new Map<string, BiometricRawPunch>();
    cleanPunches.forEach(p => {
      const k = `${(p.empIdentifier || '').trim().toLowerCase()}_${p.date}_${p.time}_${p.type || ''}`;
      if (!punchMap.has(k)) punchMap.set(k, p);
    });
    const dedupedPunches = Array.from(punchMap.values());
    memoryPunchesCache = dedupedPunches;
    isLocalSavingPunches = true;

    // 2. Persist 100% of punches to IndexedDB (zero quota limits, unlimited capacity, never sliced)
    idbSet(IDB_KEYS.BIOMETRIC_PUNCHES, dedupedPunches).catch(err => {
      console.warn('IndexedDB setBiometricPunches error:', err);
    });

    // 3. Persist safely to inMemoryCache and LocalStorage without any truncation
    try {
      safeSetItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(dedupedPunches));
      safeSetItem(STORAGE_KEYS.PUNCHES_MODIFIED, String(Date.now()));
    } catch {}

    notifyDataChanged();

    // 4. Background Sync compact bundle to Cloud Firestore (non-blocking for UI)
    firestoreSync.syncBiometricPunches(dedupedPunches)
      .then(() => {
        setTimeout(() => { isLocalSavingPunches = false; }, 1000);
      })
      .catch(() => {
        isLocalSavingPunches = false;
      });

    return true;
  },

  getOTRecords(): OTRecord[] {
    const data = safeGetItem(STORAGE_KEYS.OT_RECORDS);
    if (!data) {
      return [];
    }
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return sanitizeOTRecords(parsed).filter(o => !o.date || o.date >= HISTORY_CUTOFF_DATE);
      }
      return [];
    } catch {
      return [];
    }
  },
  async setOTRecords(records: OTRecord[]): Promise<boolean> {
    const sanitized = sanitizeOTRecords(records || []);
    const cleanRecords = sanitized.filter(o => !o.date || o.date >= HISTORY_CUTOFF_DATE);
    safeSetItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(cleanRecords));
    notifyDataChanged();
    return await firestoreSync.syncOTRecords(cleanRecords);
  },

  getOtherAllowances(): OtherAllowance[] {
    const data = safeGetItem(STORAGE_KEYS.OTHER_ALLOWANCES);
    if (!data) {
      return [];
    }
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.filter(a => !a.monthYear || a.monthYear >= HISTORY_CUTOFF_MONTH);
      }
      return [];
    } catch {
      return [];
    }
  },
  async setOtherAllowances(allw: OtherAllowance[]): Promise<boolean> {
    const cleanAllowances = (allw || []).filter(a => !a.monthYear || a.monthYear >= HISTORY_CUTOFF_MONTH);
    safeSetItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(cleanAllowances));
    notifyDataChanged();
    return await firestoreSync.syncOtherAllowances(cleanAllowances);
  },

  getManualOverrides(): Record<string, Partial<TimeSheetRow>> {
    const data = safeGetItem(STORAGE_KEYS.MANUAL_OVERRIDES);
    if (!data) return {};
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') {
        const filtered: Record<string, Partial<TimeSheetRow>> = {};
        Object.entries(parsed).forEach(([k, v]) => {
          const parts = k.split('_');
          const dateStr = parts[parts.length - 1];
          if (!dateStr || dateStr >= HISTORY_CUTOFF_DATE) {
            filtered[k] = v as Partial<TimeSheetRow>;
          }
        });
        return filtered;
      }
      return {};
    } catch {
      return {};
    }
  },
  async setManualOverrides(overrides: Record<string, Partial<TimeSheetRow>>): Promise<boolean> {
    const cleanOverrides: Record<string, Partial<TimeSheetRow>> = {};
    if (overrides && typeof overrides === 'object') {
      Object.entries(overrides).forEach(([k, v]) => {
        const parts = k.split('_');
        const dateStr = parts[parts.length - 1];
        if (!dateStr || dateStr >= HISTORY_CUTOFF_DATE) {
          cleanOverrides[k] = v;
        }
      });
    }
    safeSetItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(cleanOverrides));
    notifyDataChanged();
    return await firestoreSync.syncManualOverrides(cleanOverrides);
  },

  async syncAllToCloud(): Promise<boolean> {
    // 1. Ensure memory is 100% hydrated from IndexedDB before pushing to Cloud
    await this.hydrateFromIndexedDB().catch(() => {});
    return await firestoreSync.syncAllToCloud({
      employees: this.getEmployees(),
      shiftCodes: this.getShiftCodes(),
      shiftPlans: this.getShiftPlans(),
      punches: this.getBiometricPunches(),
      otRecords: this.getOTRecords(),
      otherAllowances: this.getOtherAllowances(),
      users: this.getUsers(),
      manualOverrides: this.getManualOverrides(),
      departments: this.getDepartments(),
    });
  },

  async initCloudSync(): Promise<{ connected: boolean; source: 'cloud' | 'local' }> {
    try {
      // Connect and fetch data directly from Cloud Firestore
      const cloudData = await firestoreSync.fetchAllFromCloud();
      const isCloudReady = Boolean(cloudData && (cloudData.hasData || (cloudData.departments && cloudData.departments.length > 0) || (cloudData.users && cloudData.users.length > 0)));

      if (cloudData && cloudData.hasData) {
        // 1. SHIFT CODES (Cloud is authoritative master)
        if (cloudData.shiftCodes && cloudData.shiftCodes.length > 0) {
          const cleanCodes = cloudData.shiftCodes.map(c => ({
            ...c,
            code: (c.code || '').trim().toUpperCase(),
            department: (c.department || 'ALL').trim(),
            name: (c.name || c.code).trim(),
          }));
          safeSetItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(cleanCodes));
          safeSetItem(STORAGE_KEYS.SHIFT_CODES_MODIFIED, String(Date.now()));
        }

        // 2. BIOMETRIC PUNCHES (Cloud is authoritative master with deduplication)
        if (cloudData.punches && cloudData.punches.length > 0) {
          const punchMap = new Map<string, BiometricRawPunch>();
          cloudData.punches.forEach(p => {
            if (!p || !p.date || !p.time || p.date < HISTORY_CUTOFF_DATE) return;
            const k = `${(p.empIdentifier || '').trim().toLowerCase()}_${p.date}_${p.time}_${p.type || ''}`;
            if (!punchMap.has(k)) punchMap.set(k, p);
          });
          // Also merge any existing punches currently in memory cache
          if (memoryPunchesCache && memoryPunchesCache.length > 0) {
            memoryPunchesCache.forEach(p => {
              if (!p || !p.date || !p.time || p.date < HISTORY_CUTOFF_DATE) return;
              const k = `${(p.empIdentifier || '').trim().toLowerCase()}_${p.date}_${p.time}_${p.type || ''}`;
              if (!punchMap.has(k)) punchMap.set(k, p);
            });
          }
          const cleanPunches = Array.from(punchMap.values());
          memoryPunchesCache = cleanPunches;
          idbSet(IDB_KEYS.BIOMETRIC_PUNCHES, cleanPunches).catch(() => {});
          try {
            safeSetItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(cleanPunches));
            safeSetItem(STORAGE_KEYS.PUNCHES_MODIFIED, String(Date.now()));
          } catch {}
          notifyDataChangedImmediate();
        }

        // 3. EMPLOYEES (Two-Way Smart Merge with Conflict-Free Timestamp Resolution)
        if (cloudData.employees && cloudData.employees.length > 0) {
          let hasSanitizedDemo = false;
          let hasHealedEmpCode = false;
          let needsPushToCloud = false;

          const currentLocalEmps = this.getEmployees();
          const localEmpMap = new Map<string, Employee>();
          currentLocalEmps.forEach(le => {
            if (le && le.empNo) localEmpMap.set(le.empNo.trim().toUpperCase(), le);
          });

          const deletedNosSet = new Set(this.getDeletedEmployeeNos().map(n => n.trim().toUpperCase()));
          const mergedEmpMap = new Map<string, Employee>();

          // Process all cloud employees
          cloudData.employees
            .filter(e => e && e.empNo && !isDemoEmployee(e))
            .forEach(e => {
              const upperNo = e.empNo.trim().toUpperCase();
              if (deletedNosSet.has(upperNo)) return;

              const sanitized = sanitizeEmployeeDepartment(e);
              if (sanitized.department !== e.department) {
                hasSanitizedDemo = true;
              }

              const localMatch = localEmpMap.get(upperNo);
              if (!localMatch) {
                // Not in local yet: adopt cloud employee
                const empNoDigits = (sanitized.empNo || '').replace(/\D/g, '');
                if (!sanitized.empCode && empNoDigits && empNoDigits.length <= 4) {
                  sanitized.empCode = `1000${empNoDigits.padStart(4, '0')}`;
                  hasHealedEmpCode = true;
                }
                mergedEmpMap.set(upperNo, sanitized);
              } else {
                // Both local and cloud have this employee: compare timestamps!
                const localTime = localMatch.updatedAt || '1970-01-01T00:00:00.000Z';
                const cloudTime = sanitized.updatedAt || '1970-01-01T00:00:00.000Z';

                if (localTime > cloudTime) {
                  // LOCAL is newer (e.g. user just updated via template or toggled De-activate):
                  // KEEP localMatch as authoritative and mark for push to cloud!
                  needsPushToCloud = true;
                  mergedEmpMap.set(upperNo, localMatch);
                } else {
                  // CLOUD is newer or equal: adopt cloud employee, but preserve local empCode if cloud has none
                  const empNoDigits = (sanitized.empNo || '').replace(/\D/g, '');
                  if (!sanitized.empCode) {
                    if (localMatch.empCode) {
                      sanitized.empCode = localMatch.empCode;
                      hasHealedEmpCode = true;
                    } else if (empNoDigits && empNoDigits.length <= 4) {
                      sanitized.empCode = `1000${empNoDigits.padStart(4, '0')}`;
                      hasHealedEmpCode = true;
                    }
                  }
                  mergedEmpMap.set(upperNo, sanitized);
                }
              }
            });

          // Also retain any local employees not present in cloud (e.g. newly created locally that haven't pushed yet)
          currentLocalEmps.forEach(le => {
            if (le && le.empNo && !isDemoEmployee(le)) {
              const upperNo = le.empNo.trim().toUpperCase();
              if (!deletedNosSet.has(upperNo) && !mergedEmpMap.has(upperNo)) {
                mergedEmpMap.set(upperNo, le);
                needsPushToCloud = true;
              }
            }
          });

          const finalMergedEmps = Array.from(mergedEmpMap.values());
          if (finalMergedEmps.length > 0) {
            safeSetItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(finalMergedEmps));
            safeSetItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));
            if (hasSanitizedDemo || hasHealedEmpCode || needsPushToCloud) {
              firestoreSync.syncEmployees(finalMergedEmps).catch(() => null);
            }
          }
        }

        // 4. SHIFT PLANS (Cloud is authoritative master with conflict-free timestamp merge)
        if ((cloudData as any).hasShiftPlansBundle || (cloudData.shiftPlans && cloudData.shiftPlans.length > 0)) {
          const cleanPlans = (cloudData.shiftPlans || []).filter(p => p && (!p.date || p.date >= HISTORY_CUTOFF_DATE) && (p.empNo || p.gid));
          this.mergeCloudShiftPlans(cleanPlans);
        }

        // 5. DEPARTMENTS & DELETED DEPARTMENTS
        const REAL_SYSTEM_DEPTS = new Set(INITIAL_DEPARTMENTS.map(d => d.code.toUpperCase()));
        if (cloudData.deletedDepartments && Array.isArray(cloudData.deletedDepartments) && cloudData.deletedDepartments.length > 0) {
          const currentDeleted = new Set(this.getDeletedDepartmentCodes());
          cloudData.deletedDepartments.forEach(d => currentDeleted.add(d.trim().toUpperCase()));
          safeSetItem(STORAGE_KEYS.DELETED_DEPARTMENTS, JSON.stringify(Array.from(currentDeleted)));
        }

        const activeDeletedSet = new Set(this.getDeletedDepartmentCodes());
        const deptMap = new Map<string, Department>();

        // Seed with authentic real departments if not deleted
        INITIAL_DEPARTMENTS.forEach(d => {
          const upper = d.code.toUpperCase();
          if (!activeDeletedSet.has(upper)) {
            deptMap.set(upper, { code: upper, name: resolveDepartmentFullName(upper, d.name) });
          }
        });

        if (cloudData.departments && cloudData.departments.length > 0) {
          const activeEmps = cloudData.employees || this.getEmployees();
          const empsWithDept = new Set(activeEmps.map(e => (e.department || '').trim().toUpperCase()).filter(Boolean));

          cloudData.departments.forEach(d => {
            if (d && d.code) {
              const upper = d.code.trim().toUpperCase();
              if (activeDeletedSet.has(upper)) return;
              const isReal = REAL_SYSTEM_DEPTS.has(upper);
              const hasEmps = empsWithDept.has(upper);
              if (isReal || hasEmps) {
                const existing = deptMap.get(upper);
                const resolvedName = resolveDepartmentFullName(upper, d.name, existing?.name);
                deptMap.set(upper, {
                  code: upper,
                  name: resolvedName,
                  updatedAt: d.updatedAt || existing?.updatedAt,
                });
              } else {
                activeDeletedSet.add(upper);
                this.recordDeletedDepartment(upper);
              }
            }
          });
        }

        if (!activeDeletedSet.has('OHL') && !deptMap.has('OHL')) {
          deptMap.set('OHL', { code: 'OHL', name: 'Overhaul' });
        }

        // Exclude TRW/TRD, TRD, OVH, and MRL from displayed departments
        deptMap.delete('TRW/TRD');
        deptMap.delete('TRD');
        deptMap.delete('OVH');
        deptMap.delete('MRL');

        const cleanDepts = Array.from(deptMap.values())
          .filter(d => d.code !== 'TRW/TRD' && d.code !== 'TRD' && d.code !== 'OVH' && d.code !== 'MRL')
          .map(d => ({
            code: d.code,
            name: resolveDepartmentFullName(d.code, d.name),
            updatedAt: d.updatedAt || new Date().toISOString(),
          }))
          .sort((a, b) => a.code.localeCompare(b.code));
        safeSetItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(cleanDepts));
        safeSetItem(STORAGE_KEYS.DEPARTMENTS_MODIFIED, String(Date.now()));

        // 6. OT RECORDS (Cloud is authoritative master)
        if ((cloudData as any).hasOTBundle || (cloudData.otRecords && cloudData.otRecords.length > 0)) {
          const cleanOT = (cloudData.otRecords || []).filter(o => !o.date || o.date >= HISTORY_CUTOFF_DATE);
          safeSetItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(cleanOT));
        }

        // 7. OTHER ALLOWANCES (Cloud is authoritative master)
        if (cloudData.otherAllowances && cloudData.otherAllowances.length > 0) {
          const cleanAllw = cloudData.otherAllowances.filter(a => !a.monthYear || a.monthYear >= HISTORY_CUTOFF_MONTH);
          safeSetItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(cleanAllw));
        }

        // 8. USERS (Cloud is authoritative master with safe merge)
        if (cloudData.users && cloudData.users.length > 0) {
          this.updateUsersFromCloud(cloudData.users);
        }

        // 9. MANUAL OVERRIDES (Cloud is authoritative master)
        if (cloudData.manualOverrides && Object.keys(cloudData.manualOverrides).length > 0) {
          safeSetItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(cloudData.manualOverrides));
        }

        // Asynchronously purge any cloud demo user records in the background
        firestoreSync.purgeDemoUsersFromCloud().catch(() => null);

        notifyDataChanged();

        return { connected: true, source: 'cloud' };
      } else {
        // Cloud returned no bundled data. If local has initial data, seed once safely
        const localEmps = this.getEmployees();
        if (localEmps.length > 0 && isCloudReady) {
          await this.syncAllToCloud().catch(console.warn);
        }
        return { connected: isCloudReady, source: 'local' };
      }
    } catch (e) {
      console.error('initCloudSync error:', e);
      return { connected: false, source: 'local' };
    }
  },

  // Purge demo shift codes, demo departments, demo plans, and reassign demo employees completely
  async purgeAllDemoDataset(): Promise<{ success: boolean; message: string }> {
    // 1. Clean Shift Codes: remove all codes belonging to RS, SIG, STN, IT or demo codes
    const currentCodes = this.getShiftCodes();
    const cleanCodes = currentCodes.filter(sc => !isDemoShiftCode(sc.code, sc.department));
    safeSetItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(cleanCodes));
    safeSetItem(STORAGE_KEYS.SHIFT_CODES_MODIFIED, String(Date.now()));

    // 2. Clean Departments: ensure all authentic standard BTS departments are preserved
    const cleanDepts = this.getDepartments();
    safeSetItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(cleanDepts));

    // 3. Clean Employees: remove any demo employees & sanitize departments
    const currentEmps = this.getEmployees();
    const cleanEmps = currentEmps.filter(e => e && e.empNo && !isDemoEmployee(e)).map(sanitizeEmployeeDepartment);
    safeSetItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(cleanEmps));
    safeSetItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));

    // 4. Clean Users: remove any demo user accounts
    const users = this.getUsers();
    const cleanUsers = users.filter(u => !isDemoUser(u)).map(u => {
      const d = (u.department || '').trim().toUpperCase();
      if (isDemoDepartment(d)) {
        return { ...u, department: d === 'SIG' ? 'TEL' : 'RST' };
      }
      return u;
    });
    safeSetItem(STORAGE_KEYS.USERS, JSON.stringify(cleanUsers));

    // 5. Clean Shift Plans: remove any plans that use demo shift codes
    const plans = this.getShiftPlans();
    const cleanPlans = plans.filter(p => !isDemoShiftCode(p.shiftCode, p.department));
    safeSetItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(cleanPlans));
    safeSetItem(STORAGE_KEYS.SHIFT_PLANS_MODIFIED, String(Date.now()));

    // 6. Clear operational transaction records
    safeSetItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify([]));
    safeSetItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify([]));
    safeSetItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify([]));
    safeSetItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify({}));

    notifyDataChanged();

    // 7. Sync clean state to Cloud Firestore
    const cloudRes = await firestoreSync.purgeAllDemoDataset();
    return cloudRes;
  },

  purgeLocalDemoData() {
    this.purgeAllDemoDataset();
  },

  getTheme(): 'dark' | 'light' {
    const data = safeGetItem(STORAGE_KEYS.THEME);
    return data === 'light' ? 'light' : 'dark'; // Default is Dark Mode
  },
  setTheme(theme: 'dark' | 'light') {
    safeSetItem(STORAGE_KEYS.THEME, theme);
    notifyDataChanged();
  },

  resetAllToInitial() {
    safeRemoveItem(STORAGE_KEYS.USERS);
    safeRemoveItem(STORAGE_KEYS.CURRENT_USER);
    safeRemoveItem(STORAGE_KEYS.EMPLOYEES);
    safeRemoveItem(STORAGE_KEYS.SHIFT_CODES);
    safeRemoveItem(STORAGE_KEYS.SHIFT_PLANS);
    safeRemoveItem(STORAGE_KEYS.RAW_PUNCHES);
    safeRemoveItem(STORAGE_KEYS.OT_RECORDS);
    safeRemoveItem(STORAGE_KEYS.OTHER_ALLOWANCES);
    safeRemoveItem(STORAGE_KEYS.MANUAL_OVERRIDES);
    safeRemoveItem(STORAGE_KEYS.THEME);
    notifyDataChanged();
  },
  resetToDefaults() {
    this.resetAllToInitial();
  },

  // Optimize active data & in-memory cache to guarantee optimal application speed and stability
  async optimizeActiveData(cutoffDate = '2026-09-01'): Promise<{
    originalPunches: number;
    optimizedPunches: number;
    prunedPunches: number;
    dedupedPunches: number;
    originalPlans: number;
    optimizedPlans: number;
  }> {
    const punches = this.getBiometricPunches();
    const origPunchCount = punches.length;
    const punchMap = new Map<string, BiometricRawPunch>();
    let deduped = 0;
    let pruned = 0;

    punches.forEach(p => {
      if (!p || !p.date || !p.time) {
        pruned++;
        return;
      }
      if (p.date < cutoffDate) {
        pruned++;
        return;
      }
      const k = `${(p.empIdentifier || '').trim().toLowerCase()}_${p.date}_${p.time}_${p.type || ''}`;
      if (punchMap.has(k)) {
        deduped++;
      } else {
        punchMap.set(k, {
          ...p,
          id: p.id || k,
          empIdentifier: (p.empIdentifier || '').trim(),
          type: p.type || 'I',
          date: p.date,
          time: p.time,
          deviceId: p.deviceId || '01',
        });
      }
    });

    const cleanPunches = Array.from(punchMap.values()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    await this.setBiometricPunches(cleanPunches);

    // Deduplicate shift plans
    const plans = this.getShiftPlans();
    const origPlansCount = plans.length;
    const planMap = new Map<string, DailyShiftPlan>();
    plans.forEach(p => {
      if (!p || !p.date || (!p.empNo && !p.gid)) return;
      if (p.date < cutoffDate) return;
      const k = `${(p.empNo || p.gid || '').trim().toUpperCase()}_${p.date}`;
      if (!planMap.has(k) || (p.updatedAt && (!planMap.get(k)?.updatedAt || p.updatedAt > (planMap.get(k)?.updatedAt || '')))) {
        planMap.set(k, p);
      }
    });
    const cleanPlans = Array.from(planMap.values());
    if (cleanPlans.length !== origPlansCount) {
      await this.setShiftPlans(cleanPlans);
    }

    notifyDataChanged();

    return {
      originalPunches: origPunchCount,
      optimizedPunches: cleanPunches.length,
      prunedPunches: pruned,
      dedupedPunches: deduped,
      originalPlans: origPlansCount,
      optimizedPlans: cleanPlans.length,
    };
  },

  // Prune all historical data prior to August 2026 (Aug 1, 2026) to reduce payload and eliminate lag
  async prunePreAugust2026Data(): Promise<{ prunedPunches: number; prunedPlans: number; prunedOT: number; prunedAllowances: number }> {
    const punches = this.getBiometricPunches();
    const cleanPunches = punches.filter(p => !p.date || p.date >= HISTORY_CUTOFF_DATE);
    const prunedPunches = punches.length - cleanPunches.length;
    await this.setBiometricPunches(cleanPunches);

    const plans = this.getShiftPlans();
    const cleanPlans = plans.filter(p => !p.date || p.date >= HISTORY_CUTOFF_DATE);
    const prunedPlans = plans.length - cleanPlans.length;
    await this.setShiftPlans(cleanPlans);

    const ot = this.getOTRecords();
    const cleanOT = ot.filter(o => !o.date || o.date >= HISTORY_CUTOFF_DATE);
    const prunedOT = ot.length - cleanOT.length;
    await this.setOTRecords(cleanOT);

    const allow = this.getOtherAllowances();
    const cleanAllow = allow.filter(a => !a.monthYear || a.monthYear >= HISTORY_CUTOFF_MONTH);
    const prunedAllowances = allow.length - cleanAllow.length;
    await this.setOtherAllowances(cleanAllow);

    const overrides = this.getManualOverrides();
    const cleanOverrides: Record<string, Partial<TimeSheetRow>> = {};
    Object.entries(overrides).forEach(([k, v]) => {
      const parts = k.split('_');
      const dateStr = parts[parts.length - 1];
      if (!dateStr || dateStr >= HISTORY_CUTOFF_DATE) {
        cleanOverrides[k] = v;
      }
    });
    await this.setManualOverrides(cleanOverrides);

    notifyDataChanged();
    return { prunedPunches, prunedPlans, prunedOT, prunedAllowances };
  },

  // Clear all operational / demo transaction records and purge demo items
  async clearAllDemoData(): Promise<boolean> {
    await this.purgeAllDemoDataset();
    return true;
  },

  // Clear entire data including employee directory if needed
  async clearAllData(): Promise<boolean> {
    safeSetItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify([]));
    safeSetItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify([]));
    safeSetItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify([]));
    safeSetItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify([]));
    safeSetItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify({}));
    safeSetItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify([]));
    notifyDataChanged();

    try {
      await firestoreSync.clearCloudCollections([
        'employees',
        'shift_plans',
        'raw_punches',
        'ot_records',
        'other_allowances',
        'manual_overrides'
      ]);
    } catch (e) {
      console.error('Failed to clear cloud collections:', e);
    }
    return true;
  }
};
