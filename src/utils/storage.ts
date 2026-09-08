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
import { firestoreSync, testFirestoreConnection } from '../firebase';

const STORAGE_KEYS = {
  USERS: 'siemens_ix_users',
  CURRENT_USER: 'siemens_ix_current_user',
  DEPARTMENTS: 'siemens_ix_departments',
  EMPLOYEES: 'siemens_ix_employees',
  SHIFT_CODES: 'siemens_ix_shift_codes',
  SHIFT_PLANS: 'siemens_ix_shift_plans',
  RAW_PUNCHES: 'siemens_ix_raw_punches',
  OT_RECORDS: 'siemens_ix_ot_records',
  OTHER_ALLOWANCES: 'siemens_ix_other_allowances',
  MANUAL_OVERRIDES: 'siemens_ix_manual_timesheet_overrides',
  THEME: 'siemens_ix_theme',
};

// Event emitter helper for cross-component re-renders
export const notifyDataChanged = () => {
  window.dispatchEvent(new Event('siemens-data-updated'));
};

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

// Generate default Shift Plans for Napassawan (0950) in May 2026 to match Time Sheet.png
function generateInitialShiftPlans(): DailyShiftPlan[] {
  const plans: DailyShiftPlan[] = [];
  const daysInMay = 31;

  // Day 1 to 31 for 2026-05
  // From Time Sheet.png:
  // 01-05-26 Fri: H (Holiday)
  // 02-05-26 Sat: (weekend off)
  // 03-05-26 Sun: (weekend off)
  // 04-05-26 Mon: H (Holiday)
  // 05 to 08: D
  // 09, 10: weekend
  // 11 to 15: D
  // 16, 17: weekend
  // 18 to 22: D
  // 23, 24: weekend
  // 25 to 29: D
  // 30, 31: weekend
  for (let d = 1; d <= daysInMay; d++) {
    const dayPadded = String(d).padStart(2, '0');
    const dateStr = `2026-05-${dayPadded}`;
    const dateObj = new Date(dateStr);
    const dayOfWeek = dateObj.getDay(); // 0 is Sun, 6 is Sat

    let code = 'D';
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      code = 'OFF';
    } else if (d === 1 || d === 4) {
      code = 'H';
    }

    plans.push({
      id: `plan-0950-${dateStr}`,
      empNo: '0950',
      gid: 'Z00430UZ',
      date: dateStr,
      shiftCode: code,
      department: 'GM',
      updatedBy: 'System Setup',
      updatedAt: '2026-05-01 00:00',
    });

    // Also populate RS employee Somchai (0149) with 3 shifts
    plans.push({
      id: `plan-0149-${dateStr}`,
      empNo: '0149',
      gid: 'Z00149TH',
      date: dateStr,
      shiftCode: dayOfWeek === 0 ? 'OFF' : (d % 3 === 0 ? 'N' : (d % 2 === 0 ? 'M' : 'D')),
      department: 'RS',
      updatedBy: 'System Setup',
      updatedAt: '2026-05-01 00:00',
    });

    // SIG Kittisak (1442)
    plans.push({
      id: `plan-1442-${dateStr}`,
      empNo: '1442',
      gid: 'Z00144TH',
      date: dateStr,
      shiftCode: dayOfWeek === 0 || dayOfWeek === 6 ? 'OFF' : 'D',
      department: 'SIG',
      updatedBy: 'System Setup',
      updatedAt: '2026-05-01 00:00',
    });
  }

  return plans;
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
    if (!data) {
      this.setDepartments(INITIAL_DEPARTMENTS);
      return INITIAL_DEPARTMENTS;
    }
    try {
      return JSON.parse(data);
    } catch {
      return INITIAL_DEPARTMENTS;
    }
  },
  setDepartments(departments: Department[]) {
    localStorage.setItem(STORAGE_KEYS.DEPARTMENTS, JSON.stringify(departments));
    notifyDataChanged();
  },

  getEmployees(): Employee[] {
    const data = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
    if (!data) {
      this.setEmployees(INITIAL_EMPLOYEES);
      return INITIAL_EMPLOYEES;
    }
    try {
      return JSON.parse(data);
    } catch {
      return INITIAL_EMPLOYEES;
    }
  },
  setEmployees(employees: Employee[]) {
    localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(employees));
    notifyDataChanged();
    firestoreSync.syncAllToCloud({
      employees,
      shiftCodes: this.getShiftCodes(),
      shiftPlans: this.getShiftPlans(),
      punches: this.getBiometricPunches(),
      otRecords: this.getOTRecords(),
      otherAllowances: this.getOtherAllowances(),
      users: this.getUsers(),
      manualOverrides: this.getManualOverrides(),
    }).catch(console.error);
  },

  getShiftCodes(): ShiftCode[] {
    const data = localStorage.getItem(STORAGE_KEYS.SHIFT_CODES);
    if (!data) {
      this.setShiftCodes(INITIAL_SHIFT_CODES);
      return INITIAL_SHIFT_CODES;
    }
    try {
      const parsed: ShiftCode[] = JSON.parse(data);
      // Ensure newly added department codes are present
      const codeSet = new Set(parsed.map(s => s.code));
      let hasNew = false;
      INITIAL_SHIFT_CODES.forEach(sc => {
        if (!codeSet.has(sc.code)) {
          parsed.push(sc);
          hasNew = true;
        }
      });
      if (hasNew) {
        localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(parsed));
      }
      return parsed;
    } catch {
      return INITIAL_SHIFT_CODES;
    }
  },
  setShiftCodes(codes: ShiftCode[]) {
    localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(codes));
    notifyDataChanged();
  },

  getShiftPlans(): DailyShiftPlan[] {
    const data = localStorage.getItem(STORAGE_KEYS.SHIFT_PLANS);
    if (!data) {
      const plans = generateInitialShiftPlans();
      this.setShiftPlans(plans);
      return plans;
    }
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  },
  setShiftPlans(plans: DailyShiftPlan[]) {
    localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(plans));
    notifyDataChanged();
    firestoreSync.syncAllToCloud({
      employees: this.getEmployees(),
      shiftCodes: this.getShiftCodes(),
      shiftPlans: plans,
      punches: this.getBiometricPunches(),
      otRecords: this.getOTRecords(),
      otherAllowances: this.getOtherAllowances(),
      users: this.getUsers(),
      manualOverrides: this.getManualOverrides(),
    }).catch(console.error);
  },

  getBiometricPunches(): BiometricRawPunch[] {
    const data = localStorage.getItem(STORAGE_KEYS.RAW_PUNCHES);
    if (!data) {
      const punches = parseBiometricText(INITIAL_RAW_PUNCHES_TEXT);
      this.setBiometricPunches(punches);
      return punches;
    }
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  },
  setBiometricPunches(punches: BiometricRawPunch[]) {
    localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(punches));
    notifyDataChanged();
  },

  getOTRecords(): OTRecord[] {
    const data = localStorage.getItem(STORAGE_KEYS.OT_RECORDS);
    if (!data) {
      this.setOTRecords(INITIAL_OT_RECORDS);
      return INITIAL_OT_RECORDS;
    }
    try {
      return JSON.parse(data);
    } catch {
      return INITIAL_OT_RECORDS;
    }
  },
  setOTRecords(records: OTRecord[]) {
    localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(records));
    notifyDataChanged();
  },

  getOtherAllowances(): OtherAllowance[] {
    const data = localStorage.getItem(STORAGE_KEYS.OTHER_ALLOWANCES);
    if (!data) {
      this.setOtherAllowances(INITIAL_OTHER_ALLOWANCES);
      return INITIAL_OTHER_ALLOWANCES;
    }
    try {
      return JSON.parse(data);
    } catch {
      return INITIAL_OTHER_ALLOWANCES;
    }
  },
  setOtherAllowances(allw: OtherAllowance[]) {
    localStorage.setItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(allw));
    notifyDataChanged();
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
  setManualOverrides(overrides: Record<string, Partial<TimeSheetRow>>) {
    localStorage.setItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(overrides));
    notifyDataChanged();
    firestoreSync.syncAllToCloud({
      employees: this.getEmployees(),
      shiftCodes: this.getShiftCodes(),
      shiftPlans: this.getShiftPlans(),
      punches: this.getBiometricPunches(),
      otRecords: this.getOTRecords(),
      otherAllowances: this.getOtherAllowances(),
      users: this.getUsers(),
      manualOverrides: overrides,
    }).catch(console.error);
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
        if (cloudData.employees.length > 0) {
          localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(cloudData.employees));
        }
        if (cloudData.shiftCodes.length > 0) {
          localStorage.setItem(STORAGE_KEYS.SHIFT_CODES, JSON.stringify(cloudData.shiftCodes));
        }
        if (cloudData.shiftPlans.length > 0) {
          localStorage.setItem(STORAGE_KEYS.SHIFT_PLANS, JSON.stringify(cloudData.shiftPlans));
        }
        if (cloudData.punches.length > 0) {
          localStorage.setItem(STORAGE_KEYS.RAW_PUNCHES, JSON.stringify(cloudData.punches));
        }
        if (cloudData.otRecords.length > 0) {
          localStorage.setItem(STORAGE_KEYS.OT_RECORDS, JSON.stringify(cloudData.otRecords));
        }
        if (cloudData.otherAllowances.length > 0) {
          localStorage.setItem(STORAGE_KEYS.OTHER_ALLOWANCES, JSON.stringify(cloudData.otherAllowances));
        }
        if (cloudData.users.length > 0) {
          localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(cloudData.users));
        }
        if (cloudData.manualOverrides && Object.keys(cloudData.manualOverrides).length > 0) {
          localStorage.setItem(STORAGE_KEYS.MANUAL_OVERRIDES, JSON.stringify(cloudData.manualOverrides));
        }
        notifyDataChanged();
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
  }
};
