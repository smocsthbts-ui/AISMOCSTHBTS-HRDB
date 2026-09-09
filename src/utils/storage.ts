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
};

// Event emitter helper for cross-component re-renders
export const notifyDataChanged = () => {
  window.dispatchEvent(new Event('siemens-data-updated'));
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
  getUsers(): UserAccount[] {
    const data = localStorage.getItem(STORAGE_KEYS.USERS);
    if (!data) {
      this.setUsers(INITIAL_USERS);
      return INITIAL_USERS;
    }
    try {
      return JSON.parse(data);
    } catch {
      return INITIAL_USERS;
    }
  },
  setUsers(users: UserAccount[]) {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    notifyDataChanged();
    // Background cloud sync
    firestoreSync.syncAllToCloud({
      employees: this.getEmployees(),
      shiftCodes: this.getShiftCodes(),
      shiftPlans: this.getShiftPlans(),
      punches: this.getBiometricPunches(),
      otRecords: this.getOTRecords(),
      otherAllowances: this.getOtherAllowances(),
      users,
      manualOverrides: this.getManualOverrides(),
    }).catch(console.error);
  },

  getCurrentUser(): UserAccount {
    const data = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    if (!data) {
      const defaultUser = INITIAL_USERS[0]; // Admin
      this.setCurrentUser(defaultUser);
      return defaultUser;
    }
    try {
      return JSON.parse(data);
    } catch {
      return INITIAL_USERS[0];
    }
  },
  setCurrentUser(user: UserAccount) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
    notifyDataChanged();
  },

  getDepartments(): Department[] {
    const data = localStorage.getItem(STORAGE_KEYS.DEPARTMENTS);
    let list: Department[] = [];
    if (data) {
      try {
        list = JSON.parse(data);
      } catch {
        list = [];
      }
    }
    if (!list || list.length === 0) {
      list = [...INITIAL_DEPARTMENTS];
    }

    // Always exclude demo departments (RS, SIG, STN, IT)
    list = list.filter(d => d && d.code && !isDemoDepartment(d.code));

    // Map by code
    const deptMap = new Map<string, Department>();
    list.forEach(d => {
      const code = (d.code || '').trim().toUpperCase();
      if (code && !isDemoDepartment(code)) {
        deptMap.set(code, d);
      }
    });

    // Auto-discover departments from active Shift Codes (excluding demo departments)
    try {
      const scData = localStorage.getItem(STORAGE_KEYS.SHIFT_CODES);
      if (scData) {
        const scs: ShiftCode[] = JSON.parse(scData);
        scs.forEach(sc => {
          const dept = (sc.department || '').trim().toUpperCase();
          if (dept && dept !== 'ALL' && !isDemoDepartment(dept) && !deptMap.has(dept)) {
            deptMap.set(dept, { code: dept, name: `${dept}` });
          }
        });
      }
    } catch {}

    // Auto-discover departments from active Employees (excluding demo departments)
    try {
      const empData = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
      if (empData) {
        const emps: Employee[] = JSON.parse(empData);
        emps.forEach(emp => {
          const dept = (emp.department || '').trim().toUpperCase();
          if (dept && dept !== 'ALL' && !isDemoDepartment(dept) && !deptMap.has(dept)) {
            deptMap.set(dept, { code: dept, name: `${dept}` });
          }
        });
      }
    } catch {}

    const sorted = Array.from(deptMap.values()).sort((a, b) => a.code.localeCompare(b.code));
    return sorted;
  },

  async setDepartments(departments: Department[]): Promise<boolean> {
    const clean = departments.filter(d => d && d.code && !isDemoDepartment(d.code));
    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(clean));
    notifyDataChanged();
    return await firestoreSync.syncDepartments(clean);
  },

  getEmployees(): Employee[] {
    const data = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
    if (!data) {
      const sanitized = INITIAL_EMPLOYEES.map(sanitizeEmployeeDepartment);
      this.setEmployees(sanitized);
      return sanitized;
    }
    try {
      const parsed: Employee[] = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        let modified = false;
        const sanitized = parsed.map(emp => {
          const s = sanitizeEmployeeDepartment(emp);
          if (s.department !== emp.department) modified = true;
          return s;
        });
        if (modified) {
          localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(sanitized));
        }
        return sanitized;
      }
      return INITIAL_EMPLOYEES.map(sanitizeEmployeeDepartment);
    } catch {
      return INITIAL_EMPLOYEES.map(sanitizeEmployeeDepartment);
    }
  },

  async setEmployees(employees: Employee[]): Promise<boolean> {
    const sanitized = employees.map(sanitizeEmployeeDepartment);
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(sanitized));
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES_MODIFIED, String(Date.now()));
    notifyDataChanged();
    return await firestoreSync.syncEmployees(sanitized);
  },

  getShiftCodes(): ShiftCode[] {
    const data = localStorage.getItem(STORAGE_KEYS.SHIFT_CODES);
    if (!data) {
      const cleanInitial = INITIAL_SHIFT_CODES.filter(sc => !isDemoShiftCode(sc.code, sc.department));
      this.setShiftCodes(cleanInitial);
      return cleanInitial;
    }
    try {
      const parsed: ShiftCode[] = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const clean = parsed.filter(sc => !isDemoShiftCode(sc.code, sc.department));
        if (clean.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(clean));
        }
        return clean.length > 0 ? clean : INITIAL_SHIFT_CODES.filter(sc => !isDemoShiftCode(sc.code, sc.department));
      }
      return INITIAL_SHIFT_CODES.filter(sc => !isDemoShiftCode(sc.code, sc.department));
    } catch {
      return INITIAL_SHIFT_CODES.filter(sc => !isDemoShiftCode(sc.code, sc.department));
    }
  },

  async setShiftCodes(codes: ShiftCode[]): Promise<boolean> {
    const clean = codes.filter(sc => !isDemoShiftCode(sc.code, sc.department));
    localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(clean));
    localStorage.setItem(STORAGE_KEYS.SHIFT_CODES_MODIFIED, String(Date.now()));
    notifyDataChanged();
    // Targeted sync in bundled collection (1 write)
    const res = await firestoreSync.syncShiftCodes(clean);
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
        return parsed.filter(p => !isDemoShiftCode(p.shiftCode, p.department));
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
      const parsed = parseBiometricText(INITIAL_RAW_PUNCHES_TEXT);
      this.setBiometricPunches(parsed);
      return parsed;
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
        // 1. SAFE MERGE SHIFT CODES (NEVER overwrite 800 local items with 19 cloud items)
        const localCodes = this.getShiftCodes();
        const localCodeModified = Number(localStorage.getItem(STORAGE_KEYS.SHIFT_CODES_MODIFIED) || '0');
        
        if (localCodes.length > 0 && cloudData.shiftCodes && cloudData.shiftCodes.length > 0) {
          const codeMap = new Map<string, ShiftCode>();
          // Cloud codes loaded first
          cloudData.shiftCodes.forEach(c => {
            const key = `${c.code.toUpperCase()}_${(c.department || 'ALL').toUpperCase()}`;
            codeMap.set(key, c);
          });
          // Local codes take priority if modified or unique
          localCodes.forEach(c => {
            const key = `${c.code.toUpperCase()}_${(c.department || 'ALL').toUpperCase()}`;
            if (localCodeModified > 0 || !codeMap.has(key) || localCodes.length > cloudData.shiftCodes.length) {
              codeMap.set(key, c);
            }
          });
          const mergedCodes = Array.from(codeMap.values());
          localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(mergedCodes));
          if (mergedCodes.length > cloudData.shiftCodes.length || localCodeModified > 0) {
            firestoreSync.syncShiftCodes(mergedCodes).catch(console.warn);
          }
        } else if (cloudData.shiftCodes && cloudData.shiftCodes.length > 0) {
          localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(cloudData.shiftCodes));
        } else if (localCodes.length > 0) {
          firestoreSync.syncShiftCodes(localCodes).catch(console.warn);
        }

        // 2. SAFE MERGE BIOMETRIC PUNCHES (Deduplicate and preserve records)
        const localPunches = this.getBiometricPunches();
        if (localPunches.length > 0 && cloudData.punches && cloudData.punches.length > 0) {
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
        } else if (cloudData.punches && cloudData.punches.length > 0) {
          localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(cloudData.punches));
        } else if (localPunches.length > 0) {
          firestoreSync.syncBiometricPunches(localPunches).catch(console.warn);
        }

        // 3. SAFE MERGE EMPLOYEES
        const localEmps = this.getEmployees();
        if (localEmps.length > 0 && cloudData.employees && cloudData.employees.length > 0) {
          const empMap = new Map<string, Employee>();
          cloudData.employees.forEach(e => empMap.set(e.empNo.trim().toUpperCase(), e));
          localEmps.forEach(e => empMap.set(e.empNo.trim().toUpperCase(), e));
          const mergedEmps = Array.from(empMap.values());
          localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(mergedEmps));
          if (mergedEmps.length > cloudData.employees.length) {
            firestoreSync.syncEmployees(mergedEmps).catch(console.warn);
          }
        } else if (cloudData.employees && cloudData.employees.length > 0) {
          localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(cloudData.employees));
        } else if (localEmps.length > 0) {
          firestoreSync.syncEmployees(localEmps).catch(console.warn);
        }

        // 4. SAFE MERGE SHIFT PLANS
        const localPlans = this.getShiftPlans();
        if (localPlans.length > 0 && cloudData.shiftPlans && cloudData.shiftPlans.length > 0) {
          const planMap = new Map<string, DailyShiftPlan>();
          cloudData.shiftPlans.forEach(p => planMap.set(`${p.empNo}_${p.date}`, p));
          localPlans.forEach(p => planMap.set(`${p.empNo}_${p.date}`, p));
          const mergedPlans = Array.from(planMap.values());
          localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(mergedPlans));
          if (mergedPlans.length > cloudData.shiftPlans.length) {
            firestoreSync.syncShiftPlans(mergedPlans).catch(console.warn);
          }
        } else if (cloudData.shiftPlans && cloudData.shiftPlans.length > 0) {
          localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(cloudData.shiftPlans));
        } else if (localPlans.length > 0) {
          firestoreSync.syncShiftPlans(localPlans).catch(console.warn);
        }

        // 5. DEPARTMENTS
        if (cloudData.departments && cloudData.departments.length > 0) {
          const currentDepts = this.getDepartments();
          const deptMap = new Map<string, Department>();
          cloudData.departments.filter(d => !isDemoDepartment(d.code)).forEach(d => deptMap.set(d.code.toUpperCase(), d));
          currentDepts.filter(d => !isDemoDepartment(d.code)).forEach(d => deptMap.set(d.code.toUpperCase(), d));
          localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(Array.from(deptMap.values())));
        }

        // 6. OT, Allowances, Users, Manual Overrides
        if (cloudData.otRecords && cloudData.otRecords.length > 0) {
          localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(cloudData.otRecords));
        }
        if (cloudData.otherAllowances && cloudData.otherAllowances.length > 0) {
          localStorage.setItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(cloudData.otherAllowances));
        }
        if (cloudData.users && cloudData.users.length > 0) {
          localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cloudData.users));
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
                  const curr = storage.getShiftCodes();
                  if (fresh.shiftCodes.length >= curr.length) {
                    localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(fresh.shiftCodes));
                  }
                }
                if (fresh.employees && fresh.employees.length > 0) {
                  const curr = storage.getEmployees();
                  if (fresh.employees.length >= curr.length) {
                    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(fresh.employees));
                  }
                }
                if (fresh.departments && fresh.departments.length > 0) {
                  localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(fresh.departments));
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
