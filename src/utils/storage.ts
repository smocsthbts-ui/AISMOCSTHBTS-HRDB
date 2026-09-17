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
  sanitizeEmployeeDepartment,
  subscribeToCloudChanges 
} from '../firebase';
import { mergeAndDeduplicateOTRecords } from './otManager';

const STORAGE_KEYS = {
  USERS: 'siemens_ix_users',
  CURRENT_USER: 'siemens_ix_current_user',
  DEPARTMENTS: 'siemens_ix_departments',
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

const CURRENT_SCHEMA_VERSION = 'v2026_09_master_shifts_v4';

// Self-healing migration for all connected clients upon opening the app
try {
  const currentVer = localStorage.getItem(STORAGE_KEYS.SCHEMA_VERSION);
  if (currentVer !== CURRENT_SCHEMA_VERSION) {
    // 2. Clean distorted department names
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

// Event emitter helper for cross-component re-renders
export const notifyDataChanged = () => {
  window.dispatchEvent(new Event('siemens-data-updated'));
  window.dispatchEvent(new Event('storage-changed'));
  window.dispatchEvent(new Event('firestore-sync-completed'));
};

let cloudListenerAttached = false;

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

    // Strictly deduplicate by email, normalizing status and properties
    const uMap = new Map<string, UserAccount>();
    list.forEach(u => {
      if (!u || !u.email) return;
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
        const existingTime = existing.updatedAt || existing.lastLogin || existing.createdAt || '';
        const incomingTime = normalized.updatedAt || normalized.lastLogin || normalized.createdAt || '';
        const isIncomingNewer = incomingTime >= existingTime;

        const primary = isIncomingNewer ? normalized : existing;
        const secondary = isIncomingNewer ? existing : normalized;

        uMap.set(cleanEmail, {
          ...secondary,
          ...primary,
          role: cleanEmail === 'smo.cs.th.bts@gmail.com' ? 'Admin' : (primary.role || secondary.role),
          department: (primary.department && primary.department !== 'PENDING') ? primary.department : (secondary.department || primary.department),
          status: cleanEmail === 'smo.cs.th.bts@gmail.com' ? 'Active' : (primary.status || secondary.status || 'Active'),
          photoURL: primary.photoURL || secondary.photoURL,
        });
      }
    });

    const deduplicated = Array.from(uMap.values());
    // Self-heal localStorage if duplicates were present
    if (deduplicated.length !== list.length) {
      try {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(deduplicated));
      } catch {}
    }
    return deduplicated;
  },

  setUsers(users: UserAccount[]) {
    const deletedKeys = new Set(this.getDeletedUserKeys());
    const uMap = new Map<string, UserAccount>();
    users.forEach(u => {
      if (!u || !u.email) return;
      const cleanEmail = u.email.trim().toLowerCase();
      const idLower = (u.id || '').toLowerCase();
      if (deletedKeys.has(cleanEmail)) return;
      if (idLower && deletedKeys.has(idLower)) return;

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
    const cleanUsers = Array.from(uMap.values());
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cleanUsers));
    notifyDataChanged();
    // Targeted cloud sync for users
    firestoreSync.syncUsers(cleanUsers).catch(console.warn);
  },

  async saveUser(user: UserAccount): Promise<boolean> {
    this.unrecordDeletedUser(user.id, user.email);
    const current = this.getUsers();
    const cleanEmail = (user.email || '').trim().toLowerCase();
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
    };

    const uMap = new Map<string, UserAccount>();
    current.forEach(u => {
      if (u && u.email) {
        uMap.set(u.email.trim().toLowerCase(), u);
      }
    });
    uMap.set(cleanEmail, { ...(uMap.get(cleanEmail) || {}), ...normalizedUser });

    const cleanUsers = Array.from(uMap.values());
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

    // Auto-discover departments from active Shift Codes (only if NOT in deletedSet)
    try {
      const scData = localStorage.getItem(STORAGE_KEYS.SHIFT_CODES);
      if (scData) {
        const scs: ShiftCode[] = JSON.parse(scData);
        scs.forEach(sc => {
          const dept = (sc.department || '').trim().toUpperCase();
          if (dept && dept !== 'ALL' && !deptMap.has(dept) && !deletedSet.has(dept)) {
            deptMap.set(dept, { code: dept, name: dept });
          }
        });
      }
    } catch {}

    // Auto-discover departments from active Employees (only if NOT in deletedSet)
    try {
      const empData = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
      if (empData) {
        const emps: Employee[] = JSON.parse(empData);
        emps.forEach(emp => {
          const dept = (emp.department || '').trim().toUpperCase();
          if (dept && dept !== 'ALL' && !deptMap.has(dept) && !deletedSet.has(dept)) {
            deptMap.set(dept, { code: dept, name: dept });
          }
        });
      }
    } catch {}

    const sorted = Array.from(deptMap.values()).sort((a, b) => a.code.localeCompare(b.code));
    return sorted;
  },

  async setDepartments(departments: Department[]): Promise<boolean> {
    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(departments));
    notifyDataChanged();
    return await firestoreSync.syncDepartments(departments);
  },

  async deleteDepartment(code: string): Promise<boolean> {
    const clean = code.trim().toUpperCase();
    this.recordDeletedDepartment(clean);
    const list = this.getDepartments();
    const filtered = list.filter(d => (d.code || '').trim().toUpperCase() !== clean);
    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(filtered));
    notifyDataChanged();
    return await firestoreSync.deleteDepartment(clean, filtered);
  },

  getEmployees(): Employee[] {
    const data = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
    if (!data) {
      return INITIAL_EMPLOYEES;
    }
    try {
      const parsed: Employee[] = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
      return INITIAL_EMPLOYEES;
    } catch {
      return INITIAL_EMPLOYEES;
    }
  },

  async setEmployees(employees: Employee[]): Promise<boolean> {
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(employees));
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));
    notifyDataChanged();
    return await firestoreSync.syncEmployees(employees);
  },

  getDeletedEmployeeNos(): string[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.DELETED_EMPLOYEES);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  recordDeletedEmployee(empNo: string) {
    try {
      const clean = empNo.trim().toUpperCase();
      const current = this.getDeletedEmployeeNos();
      if (!current.includes(clean)) {
        current.push(clean);
        localStorage.setItem(STORAGE_KEYS.DELETED_EMPLOYEES, JSON.stringify(current));
      }
    } catch (e) {
      console.warn('recordDeletedEmployee warning:', e);
    }
  },

  async deleteEmployee(empNo: string): Promise<boolean> {
    const clean = empNo.trim().toUpperCase();
    this.recordDeletedEmployee(clean);
    const list = this.getEmployees();
    const filtered = list.filter(e => e.empNo.trim().toUpperCase() !== clean);
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(filtered));
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));
    notifyDataChanged();
    return await firestoreSync.deleteEmployee(empNo, filtered);
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

      // Preserve all custom and master shift codes cleanly without trimming
      const cleaned: ShiftCode[] = parsed.map(sc => {
        const base = INITIAL_SHIFT_CODES.find(m => m.code.toUpperCase() === sc.code.toUpperCase());
        return {
          ...sc,
          name: base ? base.name : (sc.name || sc.code).replace(/\s*\([A-Z0-9_\/]+\)$/, '').trim(),
          description: sc.description || '',
        };
      });

      return cleaned;
    } catch {
      return INITIAL_SHIFT_CODES;
    }
  },

  async setShiftCodes(codes: ShiftCode[]): Promise<boolean> {
    localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(codes));
    localStorage.setItem(STORAGE_KEYS.SHIFT_CODES_MODIFIED, String(Date.now()));
    notifyDataChanged();
    // Targeted sync in bundled collection (1 write)
    const res = await firestoreSync.syncShiftCodes(codes);
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
        return parsed;
      }
      return [];
    } catch {
      return [];
    }
  },
  async setShiftPlans(plans: DailyShiftPlan[]): Promise<boolean> {
    localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(plans));
    localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS_MODIFIED, String(Date.now()));
    notifyDataChanged();
    return await firestoreSync.syncShiftPlans(plans);
  },

  getBiometricPunches(): BiometricRawPunch[] {
    const data = localStorage.getItem(STORAGE_KEYS.RAW_PUNCHES);
    if (!data) {
      return [];
    }
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  },
  async setBiometricPunches(punches: BiometricRawPunch[]): Promise<boolean> {
    localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(punches));
    localStorage.setItem(STORAGE_KEYS.PUNCHES_MODIFIED, String(Date.now()));
    notifyDataChanged();
    return await firestoreSync.syncBiometricPunches(punches);
  },

  getOTRecords(): OTRecord[] {
    const data = localStorage.getItem(STORAGE_KEYS.OT_RECORDS);
    if (!data) {
      return [];
    }
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  },
  async setOTRecords(records: OTRecord[]): Promise<boolean> {
    localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(records));
    notifyDataChanged();
    return await firestoreSync.syncOTRecords(records);
  },

  getOtherAllowances(): OtherAllowance[] {
    const data = localStorage.getItem(STORAGE_KEYS.OTHER_ALLOWANCES);
    if (!data) {
      return [];
    }
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  },
  async setOtherAllowances(allw: OtherAllowance[]): Promise<boolean> {
    localStorage.setItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(allw));
    notifyDataChanged();
    return await firestoreSync.syncOtherAllowances(allw);
  },

  getManualOverrides(): Record<string, Partial<TimeSheetRow>> {
    const data = localStorage.getItem(STORAGE_KEYS.MANUAL_OVERRIDES);
    if (!data) return {};
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  },
  async setManualOverrides(overrides: Record<string, Partial<TimeSheetRow>>): Promise<boolean> {
    localStorage.setItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(overrides));
    notifyDataChanged();
    return await firestoreSync.syncManualOverrides(overrides);
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
    try {
      const isConnected = await testFirestoreConnection();
      if (!isConnected) {
        return { connected: false, source: 'local' };
      }

      const cloudData = await firestoreSync.fetchAllFromCloud();
      if (cloudData && cloudData.hasData) {
        // 1. SAFE MERGE SHIFT CODES (Preserve Cloud + Local + Master without trimming)
        const codeMap = new Map<string, ShiftCode>();
        INITIAL_SHIFT_CODES.forEach(c => {
          const key = `${c.code.toUpperCase()}_${(c.department || 'ALL').toUpperCase()}`;
          codeMap.set(key, { ...c });
        });

        // Overlay cloud codes
        if (cloudData.shiftCodes && cloudData.shiftCodes.length > 0) {
          cloudData.shiftCodes.forEach(c => {
            if (c && c.code) {
              const key = `${c.code.toUpperCase()}_${(c.department || 'ALL').toUpperCase()}`;
              codeMap.set(key, {
                ...c,
                name: c.name ? c.name.replace(/\s*\([A-Z0-9_\/]+\)$/, '').trim() : c.code,
              });
            }
          });
        }

        // Overlay local codes (if local machine has newly uploaded/custom shift codes)
        const localCodes = this.getShiftCodes();
        localCodes.forEach(c => {
          if (c && c.code) {
            const key = `${c.code.toUpperCase()}_${(c.department || 'ALL').toUpperCase()}`;
            if (!codeMap.has(key)) {
              codeMap.set(key, c);
            }
          }
        });

        const mergedCodes = Array.from(codeMap.values());
        localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(mergedCodes));

        // If local merged set contains codes not yet in Cloud, or Cloud was empty, sync to Cloud
        if (!cloudData.shiftCodes || mergedCodes.length > cloudData.shiftCodes.length) {
          firestoreSync.syncShiftCodes(mergedCodes).catch(console.warn);
        }

        // 2. SAFE MERGE BIOMETRIC PUNCHES (Deduplicate and preserve records)
        const localPunches = this.getBiometricPunches();
        if (cloudData.punches && cloudData.punches.length > 0) {
          const punchMap = new Map<string, BiometricRawPunch>();
          cloudData.punches.forEach(p => {
            punchMap.set(`${p.empIdentifier}_${p.date}_${p.time}_${p.type}`, p);
          });
          localPunches.forEach(p => {
            punchMap.set(`${p.empIdentifier}_${p.date}_${p.time}_${p.type}`, p);
          });
          const mergedPunches = Array.from(punchMap.values());
          localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(mergedPunches));
          if (mergedPunches.length > cloudData.punches.length) {
            firestoreSync.syncBiometricPunches(mergedPunches).catch(console.warn);
          }
        } else if (localPunches.length > 0) {
          firestoreSync.syncBiometricPunches(localPunches).catch(console.warn);
        }

        // 3. EMPLOYEES (Cloud is source of truth)
        const localEmps = this.getEmployees();
        const deletedNos = new Set(this.getDeletedEmployeeNos());
        if (cloudData.employees && cloudData.employees.length > 0) {
          const empMap = new Map<string, Employee>();
          cloudData.employees.forEach(e => {
            if (e && e.empNo) {
              const key = e.empNo.trim().toUpperCase();
              if (!deletedNos.has(key)) {
                empMap.set(key, e);
              }
            }
          });
          const mergedEmps = Array.from(empMap.values());
          localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(mergedEmps));
        } else if (localEmps.length > 0) {
          const cleanLocal = localEmps.filter(e => !deletedNos.has(e.empNo.trim().toUpperCase()));
          firestoreSync.syncEmployees(cleanLocal).catch(console.warn);
        }

        // 4. SAFE MERGE SHIFT PLANS (Cloud takes priority unless local updatedAt is strictly newer)
        const localPlans = this.getShiftPlans();
        if (cloudData.shiftPlans && cloudData.shiftPlans.length > 0) {
          const planMap = new Map<string, DailyShiftPlan>();
          cloudData.shiftPlans.forEach(p => {
            if (p && p.date && (p.empNo || p.gid)) {
              planMap.set(`${(p.empNo || p.gid).trim().toUpperCase()}_${p.date}`, p);
            }
          });
          localPlans.forEach(p => {
            if (p && p.date && (p.empNo || p.gid)) {
              const key = `${(p.empNo || p.gid).trim().toUpperCase()}_${p.date}`;
              const existing = planMap.get(key);
              if (!existing) {
                planMap.set(key, p);
              } else {
                const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
                const localTime = p.updatedAt ? new Date(p.updatedAt).getTime() : 0;
                if (localTime > existingTime) {
                  planMap.set(key, p);
                }
              }
            }
          });
          const mergedPlans = Array.from(planMap.values());
          localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(mergedPlans));
          if (mergedPlans.length > cloudData.shiftPlans.length) {
            firestoreSync.syncShiftPlans(mergedPlans).catch(console.warn);
          }
        } else if (localPlans.length > 0) {
          firestoreSync.syncShiftPlans(localPlans).catch(console.warn);
        }

        // 5. DEPARTMENTS
        if (cloudData.departments && cloudData.departments.length > 0) {
          const deletedSet = new Set(this.getDeletedDepartmentCodes());
          const cleanDepts = cloudData.departments.filter(d => d && d.code && !deletedSet.has(d.code.trim().toUpperCase()));
          if (cleanDepts.length > 0) {
            localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(cleanDepts));
          }
        }

        // 6. OT, Allowances, Users, Manual Overrides
        if (cloudData.otRecords && cloudData.otRecords.length > 0) {
          const localOT = this.getOTRecords();
          if (localOT.length === 0) {
            localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(cloudData.otRecords));
          } else {
            const mergedOT = mergeAndDeduplicateOTRecords(
              cloudData.otRecords,
              localOT,
              'ALL',
              'ALL',
              'smart_merge',
              this.getEmployees()
            ).merged;
            localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(mergedOT));
          }
        }
        if (cloudData.otherAllowances && cloudData.otherAllowances.length > 0) {
          localStorage.setItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(cloudData.otherAllowances));
        }
        if (cloudData.users && cloudData.users.length > 0) {
          const deletedKeys = new Set(this.getDeletedUserKeys());
          const cleanCloudUsers = cloudData.users.filter(u => {
            if (!u) return false;
            if (u.id && deletedKeys.has(u.id)) return false;
            if (u.email && deletedKeys.has(u.email.trim().toLowerCase())) return false;
            return true;
          });
          localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cleanCloudUsers));
        }
        if (cloudData.manualOverrides && Object.keys(cloudData.manualOverrides).length > 0) {
          const localOv = this.getManualOverrides();
          localStorage.setItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify({ ...cloudData.manualOverrides, ...localOv }));
        }

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
                  const deletedNos = new Set(this.getDeletedEmployeeNos());
                  const cleanFreshEmps = fresh.employees.filter(e => !deletedNos.has(e.empNo.trim().toUpperCase()));
                  localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(cleanFreshEmps));
                }
                if (fresh.departments && fresh.departments.length > 0) {
                  const deletedCodes = new Set(this.getDeletedDepartmentCodes());
                  const cleanFreshDepts = fresh.departments.filter(d => d && d.code && !deletedCodes.has(d.code.trim().toUpperCase()));
                  localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(cleanFreshDepts));
                }
                if (fresh.shiftPlans && fresh.shiftPlans.length > 0) {
                  localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(fresh.shiftPlans));
                }
                if (fresh.users && fresh.users.length > 0) {
                  const deletedKeys = new Set(this.getDeletedUserKeys());
                  const cleanFreshUsers = fresh.users.filter(u => {
                    if (!u) return false;
                    if (u.id && deletedKeys.has(u.id)) return false;
                    if (u.email && deletedKeys.has(u.email.trim().toLowerCase())) return false;
                    return true;
                  });
                  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cleanFreshUsers));
                }
                if (fresh.punches && fresh.punches.length > 0) {
                  localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(fresh.punches));
                }
                if (fresh.otRecords && fresh.otRecords.length > 0) {
                  localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(fresh.otRecords));
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

    // 3. Clean Employees: reassign any employees having demo departments to authentic railway depts
    const currentEmps = this.getEmployees();
    const cleanEmps = currentEmps.map(sanitizeEmployeeDepartment);
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(cleanEmps));
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));

    // 4. Clean Users: reassign any user account having RS/SIG/STN
    const users = this.getUsers();
    const cleanUsers = users.map(u => {
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
