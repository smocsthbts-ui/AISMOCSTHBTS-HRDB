import { Employee, ShiftCode, UserAccount, BiometricRawPunch, OTRecord, OtherAllowance } from '../types';

export const OFFICIAL_DEPARTMENT_FULL_NAMES: Record<string, string> = {
  'ADM/CMM': 'Administration / Commercial',
  'ADM': 'Administration / Commercial',
  'CMM': 'Administration / Commercial',
  'BES/PSY': 'Building and Power Supply',
  'BES': 'Building and Power Supply',
  'PSY': 'Building and Power Supply',
  'BES/PSY2': 'Building and Power Supply2',
  'BES2': 'Building and Power Supply2',
  'PSY2': 'Building and Power Supply2',
  'DWE': 'Depot Workshop & Equipment',
  'GM': 'General Management',
  'MCC': 'Maintenance Control Center',
  'MLR': 'Midlife and Refurbishment',
  'MRL': 'Midlife and Refurbishment',
  'OHL': 'Overhaul',
  'OVH': 'Overhaul',
  'OVERHAUL': 'Overhaul',
  'OVERHEAD': 'Overhaul',
  'RST': 'Rolling Stock',
  'RS': 'Rolling Stock',
  'RST2': 'Rolling Stock 2',
  'RS2': 'Rolling Stock 2',
  'STR': 'Stores & Warehouse',
  'TEL': 'Telecom and SCADA',
  'SIG': 'Telecom and SCADA',
  'SIGNAL': 'Telecom and SCADA',
  'SIGNALLING': 'Telecom and SCADA',
  'TRW/TRL': 'Trackwork and Third Rail',
  'TRW/TRD': 'Trackwork and Third Rail',
  'TRD': 'Trackwork and Third Rail',
  'TRL': 'Trackwork and Third Rail',
  'TRW': 'Trackwork and Third Rail',
};

export const DEPARTMENTS = [
  { code: 'ADM/CMM', name: 'Administration / Commercial' },
  { code: 'BES/PSY', name: 'Building and Power Supply' },
  { code: 'BES/PSY2', name: 'Building and Power Supply2' },
  { code: 'DWE', name: 'Depot Workshop & Equipment' },
  { code: 'GM', name: 'General Management' },
  { code: 'MCC', name: 'Maintenance Control Center' },
  { code: 'MLR', name: 'Midlife and Refurbishment' },
  { code: 'OHL', name: 'Overhaul' },
  { code: 'RST', name: 'Rolling Stock' },
  { code: 'RST2', name: 'Rolling Stock 2' },
  { code: 'STR', name: 'Stores & Warehouse' },
  { code: 'TEL', name: 'Telecom and SCADA' },
  { code: 'TRW/TRL', name: 'Trackwork and Third Rail' },
];

/**
 * Standardize numeric Employee Numbers:
 * Ensures pure numeric IDs (1 to 4 digits) are consistently padded with leading zeros (e.g. "139" -> "0139", "77" -> "0077")
 * Also converts 8-digit Payroll codes (starting with 1000) to their core 4-digit EmpNo.
 */
export function canonicalEmpNo(empNo?: string | number | null): string {
  if (empNo === undefined || empNo === null) return '';
  const clean = String(empNo).trim().replace(/\.0+$/, '');
  if (!clean) return '';
  const digits = clean.replace(/\D/g, '');
  if (digits && digits.length <= 4) {
    return digits.padStart(4, '0');
  }
  if (digits && digits.length === 8 && digits.startsWith('1000')) {
    return digits.slice(-4);
  }
  return clean.toUpperCase();
}

/**
 * Maps any department code or legacy variation to its authoritative Canonical BTS Department Code.
 * Critical Rule: "TRW/TRD", "TRD", "TRW" ALWAYS map to canonical "TRW/TRL" (Trackwork and Third Rail)
 */
export function toCanonicalDepartment(dept?: string | null): string {
  if (!dept) return 'GM';
  const clean = dept.trim().toUpperCase();
  if (clean === 'ALL' || clean === 'PENDING') return clean;

  const noSep = clean.replace(/[\s\-_&/]/g, '');
  if (noSep === 'BES' || noSep === 'PSY' || noSep === 'BESPSY' || noSep === 'BES1') return 'BES/PSY';
  if (noSep === 'BES2' || noSep === 'PSY2' || noSep === 'BESPSY2') return 'BES/PSY2';
  if (noSep === 'ADM' || noSep === 'CMM' || noSep === 'ADMCMM') return 'ADM/CMM';
  if (noSep === 'TRW' || noSep === 'TRD' || noSep === 'TRWTRD' || noSep === 'TRL' || noSep === 'TRWTRL') return 'TRW/TRL';
  if (noSep === 'RS' || noSep === 'RST' || noSep === 'ROLLINGSTOCK') return 'RST';
  if (noSep === 'RS2' || noSep === 'RST2') return 'RST2';
  if (noSep === 'SIG' || noSep === 'SIGNAL' || noSep === 'SIGNALLING' || noSep === 'TEL' || noSep === 'TELECOM') return 'TEL';
  if (noSep === 'OVH' || noSep === 'OHL' || noSep === 'OVERHAUL' || noSep === 'OVERHEAD') return 'OHL';
  if (noSep === 'GM' || noSep === 'QST') return 'GM';
  if (noSep === 'DWE') return 'DWE';
  if (noSep === 'MCC') return 'MCC';
  if (noSep === 'MLR' || noSep === 'MRL') return 'MLR';
  if (noSep === 'STR') return 'STR';

  return clean;
}

/**
 * Strict Abbreviation Detector:
 * Determines if a given string is a short acronym, abbreviation, or code variation
 * rather than a genuine descriptive full name.
 */
export function isDepartmentAbbreviation(val?: string | null, code?: string): boolean {
  if (!val) return true;
  const v = val.trim();
  if (!v) return true;

  const vUpper = v.toUpperCase();
  const cUpper = (code || '').trim().toUpperCase();

  // If it matches the official full name (e.g. "Overhaul" for OHL), it is NEVER an abbreviation!
  const officialForCode = OFFICIAL_DEPARTMENT_FULL_NAMES[cUpper];
  if (officialForCode && (vUpper === officialForCode.toUpperCase() || v === officialForCode)) {
    return false;
  }

  // 1. Exact match to code
  if (vUpper === cUpper) return true;

  // 2. Strip all whitespace, slashes, dashes, hyphens, ampersands, dots, commas
  const cleanV = vUpper.replace(/[\s\-_&/.,\\()]/g, '');
  const cleanC = cUpper.replace(/[\s\-_&/.,\\()]/g, '');

  // If stripped version is identical to stripped code (e.g. "BES / PSY" vs "BES/PSY", "TRW - TRD" vs "TRW/TRD")
  if (cleanV === cleanC) return true;

  // 3. Known department abbreviations dictionary (short acronyms only)
  const KNOWN_ABBREVIATIONS = new Set([
    'ADM', 'CMM', 'ADMCMM', 'ADM/CMM',
    'BES', 'PSY', 'BESPSY', 'BES/PSY',
    'BES2', 'PSY2', 'BESPSY2', 'BES/PSY2',
    'DWE', 'GM', 'MCC',
    'MLR', 'MRL',
    'OHL', 'OVH', 'OHLOVH', 'OVHOHL',
    'RST', 'RS',
    'RST2', 'RS2',
    'STR',
    'TEL', 'SIG',
    'TRW', 'TRD', 'TRL', 'TRWTRD', 'TRWTRL', 'TRW/TRD', 'TRW/TRL',
  ]);

  if (KNOWN_ABBREVIATIONS.has(cleanV)) return true;

  // 4. Sub-code match (e.g. "TRD" for "TRW/TRL", "PSY" for "BES/PSY")
  if (cleanC && cleanV.length <= cleanC.length && (cleanC.includes(cleanV) || cleanV.includes(cleanC))) {
    return true;
  }

  // 5. Short all-caps string (<= 5 characters) without spaces is almost always an acronym
  if (v.length <= 5 && v === vUpper && !v.includes(' ')) return true;

  return false;
}

/**
 * Smart Department Full Name Resolver:
 * Resolves conflicts between abbreviations and full names across multi-user sync.
 * Rules:
 * 1. NEVER downgrade a meaningful full name to a short abbreviation!
 * 2. Official BTS standard departments ALWAYS default to their canonical full English names.
 * 3. Prevents multi-user race conditions from overwriting full names with short codes.
 */
export function resolveDepartmentFullName(code: string, incomingName?: string, existingName?: string): string {
  const upperCode = (code || '').trim().toUpperCase();
  const inc = (incomingName || '').trim();
  const ex = (existingName || '').trim();

  // Find canonical full name for this department code from official dictionary
  const canonicalCode = upperCode.replace(/[\s\-_&/.,\\()]/g, '');
  let officialName = OFFICIAL_DEPARTMENT_FULL_NAMES[upperCode];
  if (!officialName) {
    for (const [k, v] of Object.entries(OFFICIAL_DEPARTMENT_FULL_NAMES)) {
      if (k.replace(/[\s\-_&/.,\\()]/g, '') === canonicalCode) {
        officialName = v;
        break;
      }
    }
  }

  const isIncAbbrev = isDepartmentAbbreviation(inc, upperCode);
  const isExAbbrev = isDepartmentAbbreviation(ex, upperCode);

  // 1. If existing has a rich full name and incoming is an abbreviation, KEEP existing!
  if (!isExAbbrev && isIncAbbrev) {
    return ex;
  }

  // 2. If incoming has a rich full name and existing is an abbreviation, ADOPT incoming!
  if (!isIncAbbrev && isExAbbrev) {
    return inc;
  }

  // 3. If both have non-abbreviation names: prefer official if one matches it, otherwise keep incoming
  if (!isIncAbbrev && !isExAbbrev) {
    if (officialName && inc === officialName) return inc;
    if (officialName && ex === officialName) return ex;
    return inc || ex;
  }

  // 4. Both are abbreviations or empty: Enforce official canonical full name!
  if (officialName) {
    return officialName;
  }

  return inc || ex || upperCode;
}

export function getCanonicalDepartmentFullName(code: string, currentName?: string): string {
  return resolveDepartmentFullName(code, currentName, undefined);
}

export const INITIAL_USERS: UserAccount[] = [
  {
    id: 'usr-admin-google',
    email: 'smo.cs.th.bts@gmail.com',
    name: 'SMO CS TH BTS (System Admin)',
    role: 'Admin',
    department: 'ALL',
    status: 'Active',
    createdAt: '2026-09-07',
    lastLogin: '2026-09-07 22:30',
  }
];

export const INITIAL_EMPLOYEES: Employee[] = [];

export const ALL_SECTIONS = [
  'ALL',
  'ADM/CMM',
  'BES/PSY',
  'BES/PSY2',
  'DWE',
  'GM',
  'MCC',
  'MLR',
  'OHL',
  'RST',
  'RST2',
  'STR',
  'TEL',
  'TRW/TRL',
];

export const INITIAL_SHIFT_CODES: ShiftCode[] = [
  {
    code: "D",
    department: "ALL",
    name: "Day Shift (08:00-17:00)",
    startTime: "08:00",
    endTime: "17:00",
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: "#008b99",
    description: ""
  },
  {
    code: "D1",
    department: "ALL",
    name: "Day Shift 1 (07:00-16:00)",
    startTime: "07:00",
    endTime: "16:00",
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: "#0891b2",
    description: ""
  },
  {
    code: "D2",
    department: "ALL",
    name: "Day Shift 2 (09:00-18:00)",
    startTime: "09:00",
    endTime: "18:00",
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: "#0284c7",
    description: ""
  },
  {
    code: "D2",
    department: "BES/PSY",
    name: "Day Shift 2 BES/PSY (08:30-17:30)",
    startTime: "08:30",
    endTime: "17:30",
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: "#0284c7",
    description: "BES/PSY Standard Day Shift 2"
  },
  {
    code: "D3",
    department: "ALL",
    name: "Day Shift 3 (08:30-17:30)",
    startTime: "08:30",
    endTime: "17:30",
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: "#0369a1",
    description: ""
  },
  {
    code: "E",
    department: "ALL",
    name: "Early Shift (06:00-15:30)",
    startTime: "06:00",
    endTime: "15:30",
    breakMinutes: 60,
    workingHours: 8.5,
    isWorkingDay: true,
    color: "#0d9488",
    description: ""
  },
  {
    code: "E1",
    department: "ALL",
    name: "Early Shift 1 (05:30-14:00)",
    startTime: "05:30",
    endTime: "14:00",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#0f766e",
    description: ""
  },
  {
    code: "E2",
    department: "ALL",
    name: "Early Shift 2 (06:30-15:00)",
    startTime: "06:30",
    endTime: "15:00",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#115e59",
    description: ""
  },
  {
    code: "M",
    department: "ALL",
    name: "Morning Shift (06:00-14:30)",
    startTime: "06:00",
    endTime: "14:30",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#06b6d4",
    description: ""
  },
  {
    code: "M1",
    department: "ALL",
    name: "Morning Shift 1 (05:30-14:00)",
    startTime: "05:30",
    endTime: "14:00",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#3b82f6",
    description: ""
  },
  {
    code: "M2",
    department: "ALL",
    name: "Morning Shift 2 (06:30-15:00)",
    startTime: "06:30",
    endTime: "15:00",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#2563eb",
    description: ""
  },
  {
    code: "A",
    department: "ALL",
    name: "Afternoon Shift (14:00-22:30)",
    startTime: "14:00",
    endTime: "22:30",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#f59e0b",
    description: ""
  },
  {
    code: "A1",
    department: "ALL",
    name: "Afternoon Shift 1 (13:30-22:00)",
    startTime: "13:30",
    endTime: "22:00",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#d97706",
    description: ""
  },
  {
    code: "A2",
    department: "ALL",
    name: "Afternoon Shift 2 (14:30-23:00)",
    startTime: "14:30",
    endTime: "23:00",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#b45309",
    description: ""
  },
  {
    code: "N",
    department: "ALL",
    name: "Night Shift (20:00-05:00)",
    startTime: "20:00",
    endTime: "05:00",
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: "#6366f1",
    description: ""
  },
  {
    code: "N1",
    department: "ALL",
    name: "Night Shift 1 (22:00-06:30)",
    startTime: "22:00",
    endTime: "06:30",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#7c3aed",
    description: ""
  },
  {
    code: "N2",
    department: "ALL",
    name: "Night Shift 2 (23:00-07:30)",
    startTime: "23:00",
    endTime: "07:30",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#4f46e5",
    description: ""
  },
  {
    code: "S",
    department: "ALL",
    name: "Special Shift (08:00-16:30)",
    startTime: "08:00",
    endTime: "16:30",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#10b981",
    description: ""
  },
  {
    code: "S1",
    department: "ALL",
    name: "Special Shift 1 (07:30-16:30)",
    startTime: "07:30",
    endTime: "16:30",
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: "#059669",
    description: ""
  },
  {
    code: "S2",
    department: "ALL",
    name: "Special Shift 2 (08:30-17:30)",
    startTime: "08:30",
    endTime: "17:30",
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: "#047857",
    description: ""
  },
  {
    code: "ST1",
    department: "ALL",
    name: "Shift ST1 (05:45-14:15)",
    startTime: "05:45",
    endTime: "14:15",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#0284c7",
    description: ""
  },
  {
    code: "ST2",
    department: "ALL",
    name: "Shift ST2 (13:45-22:15)",
    startTime: "13:45",
    endTime: "22:15",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#0369a1",
    description: ""
  },
  {
    code: "ST3",
    department: "ALL",
    name: "Shift ST3 (21:45-06:15)",
    startTime: "21:45",
    endTime: "06:15",
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: "#1d4ed8",
    description: ""
  },
  {
    code: "SBY",
    department: "ALL",
    name: "Standby 24 Hrs",
    startTime: "00:00",
    endTime: "24:00",
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: true,
    color: "#eab308",
    description: ""
  },
  {
    code: "SBY1",
    department: "ALL",
    name: "Standby 12 Hrs (08:00-20:00)",
    startTime: "08:00",
    endTime: "20:00",
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: true,
    color: "#ca8a04",
    description: ""
  },
  {
    code: "OFF",
    department: "ALL",
    name: "Day Off",
    startTime: "00:00",
    endTime: "00:00",
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: false,
    color: "#64748b",
    description: ""
  },
  {
    code: "H",
    department: "ALL",
    name: "Public Holiday",
    startTime: "00:00",
    endTime: "00:00",
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: false,
    color: "#475569",
    description: ""
  },
  {
    code: "T",
    department: "ALL",
    name: "Training (08:00-17:00)",
    startTime: "08:00",
    endTime: "17:00",
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: "#8b5cf6",
    description: ""
  },
  {
    code: "TR",
    department: "ALL",
    name: "Training (08:00-17:00)",
    startTime: "08:00",
    endTime: "17:00",
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: "#8b5cf6",
    description: ""
  },
  {
    code: "W",
    department: "ALL",
    name: "Working (08:00-17:00)",
    startTime: "08:00",
    endTime: "17:00",
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: "#0284c7",
    description: ""
  },
  {
    code: "AL",
    department: "ALL",
    name: "Annual Leave",
    startTime: "00:00",
    endTime: "00:00",
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: false,
    color: "#ec4899",
    description: ""
  },
  {
    code: "AL2",
    department: "ALL",
    name: "Annual Leave (Half-day)",
    startTime: "00:00",
    endTime: "00:00",
    breakMinutes: 0,
    workingHours: 4,
    isWorkingDay: false,
    color: "#db2777",
    description: ""
  },
  {
    code: "ALU",
    department: "ALL",
    name: "Annual Leave (Unpaid)",
    startTime: "00:00",
    endTime: "00:00",
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: false,
    color: "#be185d",
    description: ""
  },
  {
    code: "AL2U",
    department: "ALL",
    name: "Annual Leave (Half-day Unpaid)",
    startTime: "00:00",
    endTime: "00:00",
    breakMinutes: 0,
    workingHours: 4,
    isWorkingDay: false,
    color: "#9d174d",
    description: ""
  },
  {
    code: "CL",
    department: "ALL",
    name: "Casual Leave",
    startTime: "00:00",
    endTime: "00:00",
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: false,
    color: "#f97316",
    description: ""
  },
  {
    code: "SL",
    department: "ALL",
    name: "Sick Leave",
    startTime: "00:00",
    endTime: "00:00",
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: false,
    color: "#f43f5e",
    description: ""
  },
  {
    code: "SL2",
    department: "ALL",
    name: "Sick Leave (Half-day)",
    startTime: "00:00",
    endTime: "00:00",
    breakMinutes: 0,
    workingHours: 4,
    isWorkingDay: false,
    color: "#dc2626",
    description: ""
  },
  {
    code: "SLO",
    department: "ALL",
    name: "Sick Leave (No Medical Cert)",
    startTime: "00:00",
    endTime: "00:00",
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: false,
    color: "#991b1b",
    description: ""
  }
];

export const INITIAL_RAW_PUNCHES_TEXT = ``;

export const INITIAL_OT_RECORDS: OTRecord[] = [];

export const INITIAL_OTHER_ALLOWANCES: OtherAllowance[] = [];
