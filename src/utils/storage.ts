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
  isDemoShiftCode,
  isDemoUser,
  isDemoEmployee,
  cleanDocId,
  sanitizeEmployeeDepartment,
  subscribeToCloudChanges 
} from '../firebase';
import { mergeAndDeduplicateOTRecords, sanitizeOTRecords } from './otManager';
import { normalizeShiftTimeString } from './timeCalc';

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

export const HISTORY_CUTOFF_DATE = '2025-01-01';
export const HISTORY_CUTOFF_MONTH = '2025-01';

const CURRENT_SCHEMA_VERSION = 'v2026_09_prune_pre_aug2026_v5';

// Self-healing migration for all connected clients upon opening the app
try {
  // Purge any demo users immediately from local storage cache
  const userRaw = localStorage.getItem(STORAGE_KEYS.USERS);
  if (userRaw) {
    const parsed = JSON.parse(userRaw);
    if (Array.isArray(parsed)) {
      const cleaned = parsed.filter(u => !isDemoUser(u));
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cleaned));
    }
  }

  // Purge any demo employees immediately from local storage cache
  const empRaw = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
  if (empRaw) {
    try {
      const parsed = JSON.parse(empRaw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(e => e && e.empNo && !isDemoEmployee(e));
        localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(cleaned));
      }
    } catch {}
  }

  const currentVer = localStorage.getItem(STORAGE_KEYS.SCHEMA_VERSION);
  if (currentVer !== CURRENT_SCHEMA_VERSION) {
    // 1. Prune punches before Aug 2026 and deduplicate
    const punchesRaw = localStorage.getItem(STORAGE_KEYS.RAW_PUNCHES);
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
          localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(Array.from(punchMap.values())));
        }
      } catch {}
    }

    // 2. Prune shift plans before Aug 2026 and deduplicate
    const plansRaw = localStorage.getItem(STORAGE_KEYS.SHIFT_PLANS);
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
          localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(Array.from(planMap.values())));
        }
      } catch {}
    }

    // 3. Prune OT records before Aug 2026
    const otRaw = localStorage.getItem(STORAGE_KEYS.OT_RECORDS);
    if (otRaw) {
      try {
        const parsed = JSON.parse(otRaw);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter((o: any) => !o.date || o.date >= HISTORY_CUTOFF_DATE);
          localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(cleaned));
        }
      } catch {}
    }

    // 4. Prune other allowances before Aug 2026
    const allowRaw = localStorage.getItem(STORAGE_KEYS.OTHER_ALLOWANCES);
    if (allowRaw) {
      try {
        const parsed = JSON.parse(allowRaw);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter((a: any) => !a.monthYear || a.monthYear >= HISTORY_CUTOFF_MONTH);
          localStorage.setItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(cleaned));
        }
      } catch {}
    }

    // 5. Prune manual overrides before Aug 2026
    const overridesRaw = localStorage.getItem(STORAGE_KEYS.MANUAL_OVERRIDES);
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
          localStorage.setItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(cleaned));
        }
      } catch {}
    }

    // 6. Clean distorted department names
    const deptRaw = localStorage.getItem(STORAGE_KEYS.DEPARTMENTS);
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
        localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(cleaned));
      }
    }
    localStorage.setItem(STORAGE_KEYS.SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
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
  }, 50);
};

export const notifyDataChangedImmediate = () => {
  if (notifyTimer) clearTimeout(notifyTimer);
  window.dispatchEvent(new Event('siemens-data-updated'));
  window.dispatchEvent(new Event('storage-changed'));
  window.dispatchEvent(new Event('firestore-sync-completed'));
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
      const data = localStorage.getItem(STORAGE_KEYS.DELETED_USERS);
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
        localStorage.setItem(STORAGE_KEYS.DELETED_USERS, JSON.stringify(current));
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
        localStorage.setItem(STORAGE_KEYS.DELETED_USERS, JSON.stringify(updated));
      }
    } catch {}
  },

  getUsers(): UserAccount[] {
    const deletedKeys = new Set(this.getDeletedUserKeys());
    const data = localStorage.getItem(STORAGE_KEYS.USERS);
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
      if (deletedKeys.has(cleanEmail)) return;
      if (idLower && deletedKeys.has(idLower)) return;

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

        uMap.set(cleanEmail, {
          ...base,
          ...top,
          role: cleanEmail === 'smo.cs.th.bts@gmail.com' ? 'Admin' : (top.role || base.role),
          department: top.department || base.department,
          status: cleanEmail === 'smo.cs.th.bts@gmail.com' ? 'Active' : (top.status || base.status || 'Active'),
          photoURL: top.photoURL || base.photoURL,
        });
      }
    });

    const deduplicated = Array.from(uMap.values()).filter(u => !isDemoUser(u));
    // Self-heal localStorage if duplicates or demo users were present
    if (deduplicated.length !== list.length) {
      try {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(deduplicated));
      } catch {}
    }
    return deduplicated;
  },

  updateUsersFromCloud(cloudUsers: UserAccount[]) {
    if (!Array.isArray(cloudUsers)) return;
    const deletedKeys = new Set(this.getDeletedUserKeys());
    const uMap = new Map<string, UserAccount>();

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

      uMap.set(cleanEmail, { ...u, email: cleanEmail, status });
    });

    const cleanList = Array.from(uMap.values()).filter(u => !isDemoUser(u));
    try {
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cleanList));
      notifyDataChanged();
    } catch (e) {
      console.warn('updateUsersFromCloud cache warning:', e);
    }
  },

  setUsers(users: UserAccount[]) {
    const deletedKeys = new Set(this.getDeletedUserKeys());
    const now = new Date().toISOString();
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

      let status = u.status;
      if (status) {
        const s = status.toLowerCase();
        if (s === 'active') status = 'Active';
        else if (s.includes('pending')) status = 'Pending_Approval';
        else if (s === 'deactivated') status = 'Deactivated';
      } else {
        status = 'Active';
      }

      uMap.set(cleanEmail, { ...u, email: cleanEmail, status, updatedAt: u.updatedAt || now });
    });
    const cleanUsers = Array.from(uMap.values()).filter(u => !isDemoUser(u));
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cleanUsers));
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
    let status = user.status;
    if (status) {
      const s = status.toLowerCase();
      if (s === 'active') status = 'Active';
      else if (s.includes('pending')) status = 'Pending_Approval';
      else if (s === 'deactivated') status = 'Deactivated';
    } else {
      status = 'Active';
    }
    const normalizedUser: UserAccount = {
      ...user,
      email: cleanEmail,
      status,
      updatedAt: now,
    };

    const uMap = new Map<string, UserAccount>();
    current.forEach(u => {
      if (u && u.email && !isDemoUser(u)) {
        uMap.set(u.email.trim().toLowerCase(), u);
      }
    });
    uMap.set(cleanEmail, { ...(uMap.get(cleanEmail) || {}), ...normalizedUser });

    const cleanUsers = Array.from(uMap.values()).filter(u => !isDemoUser(u));
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cleanUsers));
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
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(updated));
    notifyDataChanged();
    return await firestoreSync.deleteUser(userId, email, updated);
  },

  getCurrentUser(): UserAccount | null {
    const data = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
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
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    }
    notifyDataChanged();
  },
  clearCurrentUser() {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    notifyDataChanged();
  },

  getDeletedDepartmentCodes(): string[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.DELETED_DEPARTMENTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  recordDeletedDepartment(code: string) {
    try {
      const clean = code.trim().toUpperCase();
      const current = this.getDeletedDepartmentCodes();
      if (!current.includes(clean)) {
        current.push(clean);
        localStorage.setItem(STORAGE_KEYS.DELETED_DEPARTMENTS, JSON.stringify(current));
      }
    } catch (e) {
      console.warn('recordDeletedDepartment warning:', e);
    }
  },

  getDepartments(): Department[] {
    const deletedCodes = this.getDeletedDepartmentCodes();
    const deletedSet = new Set(deletedCodes);

    const data = localStorage.getItem(STORAGE_KEYS.DEPARTMENTS);
    let list: Department[] = [];
    if (data) {
      try {
        list = JSON.parse(data);
      } catch {
        list = [];
      }
    }

    const deptMap = new Map<string, Department>();

    // If local storage has never been initialized, load INITIAL_DEPARTMENTS
    if (!data) {
      INITIAL_DEPARTMENTS.forEach(d => {
        if (d && d.code) {
          const upper = d.code.trim().toUpperCase();
          if (!deletedSet.has(upper)) {
            deptMap.set(upper, { code: d.code.trim(), name: d.name.trim() });
          }
        }
      });
    } else {
      list.forEach(d => {
        const code = (d.code || '').trim().toUpperCase();
        if (code && !deletedSet.has(code)) {
          let cleanName = (d.name || '').trim();
          if (!cleanName) cleanName = code;
          deptMap.set(code, { code, name: cleanName });
        }
      });
    }

    const sorted = Array.from(deptMap.values()).sort((a, b) => a.code.localeCompare(b.code));
    return sorted;
  },

  async setDepartments(departments: Department[]): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const clean = departments.map(d => ({
      code: d.code.trim().toUpperCase(),
      name: (d.name || d.code).trim(),
      updatedAt: d.updatedAt || nowIso,
    }));
    // Also un-record from deleted if explicitly added/updated
    const deletedCodes = this.getDeletedDepartmentCodes();
    const cleanCodesSet = new Set(clean.map(d => d.code));
    const newDeleted = deletedCodes.filter(c => !cleanCodesSet.has(c));
    if (newDeleted.length !== deletedCodes.length) {
      localStorage.setItem(STORAGE_KEYS.DELETED_DEPARTMENTS, JSON.stringify(newDeleted));
    }

    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(clean));
    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS_MODIFIED, String(Date.now()));
    notifyDataChanged();
    return await firestoreSync.syncDepartments(clean);
  },

  async deleteDepartment(code: string): Promise<boolean> {
    const clean = code.trim().toUpperCase();
    this.recordDeletedDepartment(clean);
    const list = this.getDepartments();
    const filtered = list.filter(d => (d.code || '').trim().toUpperCase() !== clean);
    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(filtered));
    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS_MODIFIED, String(Date.now()));

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

  getEmployees(): Employee[] {
    const data = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
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
        return parsed.filter(e => Boolean(e && e.empNo && !isDemoEmployee(e)));
      }
      return [];
    } catch {
      return [];
    }
  },

  async setEmployees(employees: Employee[]): Promise<boolean> {
    const now = new Date().toISOString();
    const cleanEmployees = (employees || [])
      .filter(emp => emp && emp.empNo && !isDemoEmployee(emp))
      .map(emp => {
        const cleanItem: any = {
          ...emp,
          empNo: String(emp.empNo || '').trim(),
          gid: String(emp.gid || '').trim(),
          firstName: String(emp.firstName || '').trim(),
          familyName: String(emp.familyName || '').trim(),
          department: String(emp.department || 'GM').trim().toUpperCase(),
          division: String(emp.division || 'MO CS BTS').trim(),
          functionTitle: String(emp.functionTitle || '').trim(),
          costCenter: String(emp.costCenter || 'C93056').trim(),
          isShiftWorker: Boolean(emp.isShiftWorker),
          isActive: emp.isActive !== false,
          updatedAt: emp.updatedAt || now,
        };
        if (emp.empCode && String(emp.empCode).trim()) {
          cleanItem.empCode = String(emp.empCode).trim();
        } else {
          delete cleanItem.empCode;
        }
        return cleanItem as Employee;
      });

    // Enforce uniqueness by employee number without cross-merging separate employee records
    const empMap = new Map<string, Employee>();
    for (const emp of cleanEmployees) {
      const upperNo = emp.empNo.trim().toUpperCase();
      empMap.set(upperNo, emp);
    }

    const uniqueEmployees = Array.from(empMap.values());

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

    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(uniqueEmployees));
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));
    notifyDataChanged();
    return await firestoreSync.syncEmployees(uniqueEmployees);
  },

  getDeletedEmployeeNos(): string[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.DELETED_EMPLOYEES);
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
        localStorage.setItem(STORAGE_KEYS.DELETED_EMPLOYEES, JSON.stringify(filtered));
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
        localStorage.setItem(STORAGE_KEYS.DELETED_EMPLOYEES, JSON.stringify(current));
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

    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(filtered));
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));
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
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(emps));
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));

    if (plansChanged) {
      localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(updatedPlans));
      localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS_MODIFIED, String(Date.now()));
    }

    if (punchesChanged) {
      memoryPunchesCache = updatedPunches;
      try {
        localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(updatedPunches));
        localStorage.setItem(STORAGE_KEYS.PUNCHES_MODIFIED, String(Date.now()));
      } catch (err) {
        console.warn('LocalStorage quota warning saving punches:', err);
      }
    }

    if (otChanged) {
      localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(updatedOT));
    }

    if (allowChanged) {
      localStorage.setItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(updatedAllow));
    }

    if (overridesChanged) {
      localStorage.setItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(newOverrides));
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
    const data = localStorage.getItem(STORAGE_KEYS.SHIFT_CODES);
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
    localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(stamped));
    localStorage.setItem(STORAGE_KEYS.SHIFT_CODES_MODIFIED, String(Date.now()));
    notifyDataChanged();
    // Targeted sync in bundled collection (1 write)
    const res = await firestoreSync.syncShiftCodes(stamped);
    // Also sync departments if any newly discovered departments were added
    const depts = this.getDepartments();
    firestoreSync.syncDepartments(depts).catch(console.warn);
    return res;
  },

  getShiftPlans(): DailyShiftPlan[] {
    const data = localStorage.getItem(STORAGE_KEYS.SHIFT_PLANS);
    if (!data) {
      return [];
    }
    try {
      const parsed: DailyShiftPlan[] = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.filter(p => !p.date || p.date >= HISTORY_CUTOFF_DATE);
      }
      return [];
    } catch {
      return [];
    }
  },
  async setShiftPlans(plans: DailyShiftPlan[]): Promise<boolean> {
    const cleanPlans = (plans || []).filter(p => !p.date || p.date >= HISTORY_CUTOFF_DATE);
    localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(cleanPlans));
    localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS_MODIFIED, String(Date.now()));
    notifyDataChangedImmediate();
    return await firestoreSync.syncShiftPlans(cleanPlans);
  },

  getBiometricPunches(): BiometricRawPunch[] {
    if (memoryPunchesCache !== null) {
      return memoryPunchesCache;
    }
    const data = localStorage.getItem(STORAGE_KEYS.RAW_PUNCHES);
    if (!data) {
      memoryPunchesCache = [];
      return memoryPunchesCache;
    }
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        memoryPunchesCache = parsed.filter(
          (p): p is BiometricRawPunch =>
            Boolean(p && typeof p === 'object' && typeof p.time === 'string' && p.time.trim() !== '' && (!p.date || p.date >= HISTORY_CUTOFF_DATE))
        );
        return memoryPunchesCache;
      }
      memoryPunchesCache = [];
      return memoryPunchesCache;
    } catch {
      memoryPunchesCache = [];
      return memoryPunchesCache;
    }
  },
  async setBiometricPunches(punches: BiometricRawPunch[]): Promise<boolean> {
    const cleanPunches = (punches || []).filter(
      (p): p is BiometricRawPunch =>
        Boolean(p && typeof p === 'object' && typeof p.time === 'string' && p.time.trim() !== '' && (!p.date || p.date >= HISTORY_CUTOFF_DATE))
    );
    
    // 1. Immediately update fast memory cache so UI components receive data synchronously with zero blocking
    memoryPunchesCache = cleanPunches;
    isLocalSavingPunches = true;

    // 2. Persist to LocalStorage with quota exhaustion safety
    try {
      localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(cleanPunches));
      localStorage.setItem(STORAGE_KEYS.PUNCHES_MODIFIED, String(Date.now()));
    } catch (storageErr) {
      console.warn('LocalStorage quota limit reached for full biometric dataset; falling back to memory & Firestore persistence:', storageErr);
      // Try keeping the most recent 15,000 punches in localStorage if quota exceeded
      try {
        const trimmedForLocalStorage = cleanPunches.slice(-15000);
        localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(trimmedForLocalStorage));
        localStorage.setItem(STORAGE_KEYS.PUNCHES_MODIFIED, String(Date.now()));
      } catch {}
    }

    notifyDataChanged();

    // 3. Background Sync full bundle to Cloud Firestore (non-blocking for UI)
    firestoreSync.syncBiometricPunches(cleanPunches)
      .then(() => {
        setTimeout(() => { isLocalSavingPunches = false; }, 1000);
      })
      .catch((e) => {
        console.warn('Background syncBiometricPunches caught error:', e);
        isLocalSavingPunches = false;
      });

    return true;
  },

  getOTRecords(): OTRecord[] {
    const data = localStorage.getItem(STORAGE_KEYS.OT_RECORDS);
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
    localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(cleanRecords));
    notifyDataChanged();
    return await firestoreSync.syncOTRecords(cleanRecords);
  },

  getOtherAllowances(): OtherAllowance[] {
    const data = localStorage.getItem(STORAGE_KEYS.OTHER_ALLOWANCES);
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
    localStorage.setItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(cleanAllowances));
    notifyDataChanged();
    return await firestoreSync.syncOtherAllowances(cleanAllowances);
  },

  getManualOverrides(): Record<string, Partial<TimeSheetRow>> {
    const data = localStorage.getItem(STORAGE_KEYS.MANUAL_OVERRIDES);
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
    localStorage.setItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(cleanOverrides));
    notifyDataChanged();
    return await firestoreSync.syncManualOverrides(cleanOverrides);
  },

  async syncAllToCloud(): Promise<boolean> {
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
    if (firestoreSync.isQuotaExceeded()) {
      return { connected: false, source: 'local' };
    }
    try {
      const isConnected = await testFirestoreConnection();
      if (!isConnected || firestoreSync.isQuotaExceeded()) {
        return { connected: false, source: 'local' };
      }

      const cloudData = await firestoreSync.fetchAllFromCloud();
      if (cloudData && cloudData.hasData) {
        // 1. SHIFT CODES (Cloud is authoritative master)
        if (cloudData.shiftCodes && cloudData.shiftCodes.length > 0) {
          const cleanCodes = cloudData.shiftCodes.map(c => ({
            ...c,
            code: (c.code || '').trim().toUpperCase(),
            department: (c.department || 'ALL').trim(),
            name: (c.name || c.code).trim(),
          }));
          localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(cleanCodes));
          localStorage.setItem(STORAGE_KEYS.SHIFT_CODES_MODIFIED, String(Date.now()));
        }

        // 2. BIOMETRIC PUNCHES (Cloud is authoritative master)
        if (cloudData.punches && cloudData.punches.length > 0) {
          const cleanPunches = cloudData.punches.filter(
            (p): p is BiometricRawPunch =>
              Boolean(p && typeof p === 'object' && typeof p.time === 'string' && p.time.trim() !== '' && (!p.date || p.date >= HISTORY_CUTOFF_DATE))
          );
          memoryPunchesCache = cleanPunches;
          try {
            localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(cleanPunches));
            localStorage.setItem(STORAGE_KEYS.PUNCHES_MODIFIED, String(Date.now()));
          } catch {
            try {
              localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(cleanPunches.slice(-15000)));
            } catch {}
          }
        }

        // 3. EMPLOYEES (Cloud is authoritative master)
        if (cloudData.employees && cloudData.employees.length > 0) {
          const cleanCloudEmps = cloudData.employees.filter(e => e && e.empNo && !isDemoEmployee(e));
          if (cleanCloudEmps.length > 0) {
            localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(cleanCloudEmps));
            localStorage.setItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));
          }
        }

        // 4. SHIFT PLANS (Cloud is authoritative master)
        if ((cloudData as any).hasShiftPlansBundle || (cloudData.shiftPlans && cloudData.shiftPlans.length > 0)) {
          const cleanPlans = (cloudData.shiftPlans || []).filter(p => p && (!p.date || p.date >= HISTORY_CUTOFF_DATE) && (p.empNo || p.gid));
          localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(cleanPlans));
          localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS_MODIFIED, String(Date.now()));
        }

        // 5. DEPARTMENTS & DELETED DEPARTMENTS (Cloud is authoritative master)
        if (cloudData.deletedDepartments && Array.isArray(cloudData.deletedDepartments) && cloudData.deletedDepartments.length > 0) {
          const currentDeleted = new Set(this.getDeletedDepartmentCodes());
          cloudData.deletedDepartments.forEach(d => currentDeleted.add(d.trim().toUpperCase()));
          localStorage.setItem(STORAGE_KEYS.DELETED_DEPARTMENTS, JSON.stringify(Array.from(currentDeleted)));
        }

        if (cloudData.departments && cloudData.departments.length > 0) {
          const deletedDeptSet = new Set(this.getDeletedDepartmentCodes());
          const cleanDepts = cloudData.departments
            .filter(d => d && d.code && !deletedDeptSet.has(d.code.trim().toUpperCase()))
            .map(d => ({ ...d, code: d.code.trim().toUpperCase(), name: (d.name || d.code).trim() }))
            .sort((a, b) => a.code.localeCompare(b.code));
          if (cleanDepts.length > 0) {
            localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(cleanDepts));
            localStorage.setItem(STORAGE_KEYS.DEPARTMENTS_MODIFIED, String(Date.now()));
          }
        }

        // 6. OT RECORDS (Cloud is authoritative master)
        if ((cloudData as any).hasOTBundle || (cloudData.otRecords && cloudData.otRecords.length > 0)) {
          const cleanOT = (cloudData.otRecords || []).filter(o => !o.date || o.date >= HISTORY_CUTOFF_DATE);
          localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(cleanOT));
        }

        // 7. OTHER ALLOWANCES (Cloud is authoritative master)
        if (cloudData.otherAllowances && cloudData.otherAllowances.length > 0) {
          const cleanAllw = cloudData.otherAllowances.filter(a => !a.monthYear || a.monthYear >= HISTORY_CUTOFF_MONTH);
          localStorage.setItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(cleanAllw));
        }

        // 8. USERS (Cloud is authoritative master)
        if (cloudData.users && cloudData.users.length > 0) {
          const deletedKeys = new Set(this.getDeletedUserKeys());
          const cleanCloudUsers = cloudData.users.filter(u => {
            if (!u) return false;
            if (isDemoUser(u)) return false;
            const cleanEmail = (u.email || '').trim().toLowerCase();
            const isProtected = u.isGoogleAccount || u.status === 'Active' || u.status === 'Pending_Approval' || cleanEmail.endsWith('@siemens.com') || cleanEmail.endsWith('@gmail.com');
            if (!isProtected) {
              if (u.id && deletedKeys.has(u.id)) return false;
              if (u.email && deletedKeys.has(cleanEmail)) return false;
            }
            return true;
          });
          localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cleanCloudUsers));
        }

        // 9. MANUAL OVERRIDES (Cloud is authoritative master)
        if (cloudData.manualOverrides && Object.keys(cloudData.manualOverrides).length > 0) {
          localStorage.setItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(cloudData.manualOverrides));
        }

        // Asynchronously purge any cloud demo user records in the background
        firestoreSync.purgeDemoUsersFromCloud().catch(() => null);

        notifyDataChanged();

        // Setup real-time listener
        if (!cloudListenerAttached) {
          cloudListenerAttached = true;
          subscribeToCloudChanges(async () => {
            try {
              const fresh = await firestoreSync.fetchAllFromCloud();
              if (fresh && fresh.hasData) {
                if (fresh.shiftCodes && fresh.shiftCodes.length > 0) {
                  localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(fresh.shiftCodes));
                }
                if (fresh.employees && fresh.employees.length > 0) {
                  const cleanFreshEmps = fresh.employees.filter(e => e && e.empNo && !isDemoEmployee(e));
                  if (cleanFreshEmps.length > 0) {
                    const localEmps = this.getEmployees();
                    const localMod = parseInt(localStorage.getItem(STORAGE_KEYS.EMPLOYEES_MODIFIED) || '0', 10);
                    const isFreshLocalEdit = localEmps.length > 0 && (Date.now() - localMod < 6000);
                    
                    if (!isFreshLocalEdit) {
                      localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(cleanFreshEmps));
                      localStorage.setItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));
                    }
                  }
                }
                if (fresh.deletedDepartments && Array.isArray(fresh.deletedDepartments) && fresh.deletedDepartments.length > 0) {
                  const currentDeleted = new Set(this.getDeletedDepartmentCodes());
                  fresh.deletedDepartments.forEach(d => currentDeleted.add(d.trim().toUpperCase()));
                  localStorage.setItem(STORAGE_KEYS.DELETED_DEPARTMENTS, JSON.stringify(Array.from(currentDeleted)));
                }
                if (fresh.departments && fresh.departments.length > 0) {
                  const deletedCodes = new Set(this.getDeletedDepartmentCodes());
                  const cleanFreshDepts = fresh.departments
                    .filter(d => d && d.code && !deletedCodes.has(d.code.trim().toUpperCase()))
                    .map(d => ({ ...d, code: d.code.trim().toUpperCase(), name: (d.name || d.code).trim() }))
                    .sort((a, b) => a.code.localeCompare(b.code));
                  if (cleanFreshDepts.length > 0) {
                    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(cleanFreshDepts));
                    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS_MODIFIED, String(Date.now()));
                  }
                }
                if (fresh.shiftPlans && fresh.shiftPlans.length > 0) {
                  localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(fresh.shiftPlans));
                }
                if (fresh.users && fresh.users.length > 0) {
                  const deletedKeys = new Set(this.getDeletedUserKeys());
                  const cleanFreshUsers = fresh.users.filter(u => {
                    if (!u) return false;
                    if (isDemoUser(u)) return false;
                    const cleanEmail = (u.email || '').trim().toLowerCase();
                    const isProtected = u.isGoogleAccount || u.status === 'Active' || u.status === 'Pending_Approval' || cleanEmail.endsWith('@siemens.com') || cleanEmail.endsWith('@gmail.com');
                    if (!isProtected) {
                      if (u.id && deletedKeys.has(u.id)) return false;
                      if (u.email && deletedKeys.has(cleanEmail)) return false;
                    }
                    return true;
                  });
                  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cleanFreshUsers));
                }
                if (fresh.punches && fresh.punches.length > 0 && !isLocalSavingPunches) {
                  const cleanFreshPunches = fresh.punches.filter(
                    (p): p is BiometricRawPunch =>
                      Boolean(p && typeof p === 'object' && typeof p.time === 'string' && p.time.trim() !== '')
                  );
                  memoryPunchesCache = cleanFreshPunches;
                  localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(cleanFreshPunches));
                }
                if ((fresh as any).hasShiftPlansBundle || (fresh.shiftPlans && fresh.shiftPlans.length > 0)) {
                  const cleanFreshPlans = (fresh.shiftPlans || []).filter(p => p && (!p.date || p.date >= HISTORY_CUTOFF_DATE) && (p.empNo || p.gid));
                  localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(cleanFreshPlans));
                  localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS_MODIFIED, String(Date.now()));
                }
                if ((fresh as any).hasOTBundle || (fresh.otRecords && fresh.otRecords.length > 0)) {
                  const cleanFreshOT = (fresh.otRecords || []).filter(o => !o.date || o.date >= HISTORY_CUTOFF_DATE);
                  localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(cleanFreshOT));
                }
                if (fresh.manualOverrides && Object.keys(fresh.manualOverrides).length > 0) {
                  const currentLocal = this.getManualOverrides();
                  localStorage.setItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify({ ...fresh.manualOverrides, ...currentLocal }));
                }
                notifyDataChanged();
              }
            } catch (err) {
              console.warn('Real-time sync refresh error:', err);
            }
          });
        }

        return { connected: true, source: 'cloud' };
      } else {
        // Cloud is empty on first setup, seed initial dataset to Firestore
        await this.syncAllToCloud();
        return { connected: true, source: 'local' };
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
    localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(cleanCodes));
    localStorage.setItem(STORAGE_KEYS.SHIFT_CODES_MODIFIED, String(Date.now()));

    // 2. Clean Departments: remove RS, SIG, STN, IT
    const currentDepts = this.getDepartments();
    const cleanDepts = currentDepts.filter(d => !isDemoDepartment(d.code));
    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(cleanDepts));

    // 3. Clean Employees: remove any demo employees & sanitize departments
    const currentEmps = this.getEmployees();
    const cleanEmps = currentEmps.filter(e => e && e.empNo && !isDemoEmployee(e)).map(sanitizeEmployeeDepartment);
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(cleanEmps));
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));

    // 4. Clean Users: remove any demo user accounts
    const users = this.getUsers();
    const cleanUsers = users.filter(u => !isDemoUser(u)).map(u => {
      const d = (u.department || '').trim().toUpperCase();
      if (isDemoDepartment(d)) {
        return { ...u, department: d === 'SIG' ? 'TEL' : 'RST' };
      }
      return u;
    });
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cleanUsers));

    // 5. Clean Shift Plans: remove any plans that use demo shift codes
    const plans = this.getShiftPlans();
    const cleanPlans = plans.filter(p => !isDemoShiftCode(p.shiftCode, p.department));
    localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(cleanPlans));
    localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS_MODIFIED, String(Date.now()));

    // 6. Clear operational transaction records
    localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify({}));

    notifyDataChanged();

    // 7. Sync clean state to Cloud Firestore
    const cloudRes = await firestoreSync.purgeAllDemoDataset();
    return cloudRes;
  },

  purgeLocalDemoData() {
    this.purgeAllDemoDataset();
  },

  getTheme(): 'dark' | 'light' {
    const data = localStorage.getItem(STORAGE_KEYS.THEME);
    return data === 'light' ? 'light' : 'dark'; // Default is Dark Mode
  },
  setTheme(theme: 'dark' | 'light') {
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
    notifyDataChanged();
  },

  resetAllToInitial() {
    localStorage.removeItem(STORAGE_KEYS.USERS);
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    localStorage.removeItem(STORAGE_KEYS.EMPLOYEES);
    localStorage.removeItem(STORAGE_KEYS.SHIFT_CODES);
    localStorage.removeItem(STORAGE_KEYS.SHIFT_PLANS);
    localStorage.removeItem(STORAGE_KEYS.RAW_PUNCHES);
    localStorage.removeItem(STORAGE_KEYS.OT_RECORDS);
    localStorage.removeItem(STORAGE_KEYS.OTHER_ALLOWANCES);
    localStorage.removeItem(STORAGE_KEYS.MANUAL_OVERRIDES);
    localStorage.removeItem(STORAGE_KEYS.THEME);
    notifyDataChanged();
  },
  resetToDefaults() {
    this.resetAllToInitial();
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
    localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify({}));
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify([]));
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
