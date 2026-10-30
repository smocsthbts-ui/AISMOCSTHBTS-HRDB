import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDoc,
  getDocFromServer, 
  collection, 
  getDocs, 
  getDocsFromServer,
  setDoc,
  writeBatch,
  deleteDoc,
  onSnapshot,
  arrayUnion,
  setLogLevel
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { 
  DEPARTMENTS as INITIAL_DEPARTMENTS,
  resolveDepartmentFullName,
  getCanonicalDepartmentFullName,
  toCanonicalDepartment,
  canonicalEmpNo
} from './data/initialData';
import { 
  Employee, 
  ShiftCode, 
  DailyShiftPlan, 
  BiometricRawPunch, 
  OTRecord, 
  OtherAllowance, 
  UserAccount, 
  TimeSheetRow,
  Department
} from './types';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// CRITICAL: The app will break without this database id parameter
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Silence verbose internal Firestore WebChannel retry logs
try {
  setLogLevel('silent');
} catch {}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  if (!isQuotaExceededError(error)) {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  } else {
    markQuotaExceeded(error);
  }
  return errInfo;
}

// Track Firestore Quota Exceeded state (Free Daily Write Quota 20,000 writes/day)
const QUOTA_EXCEEDED_KEY = 'firestore_quota_exceeded_timestamp';
const QUOTA_LEGACY_KEY = 'firestore_quota_exceeded_date';

let isFirestoreQuotaExceeded = false;
let quotaCooldownTimer: any = null;

// Clean up any historical quota lock on start so app always connects live
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.removeItem(QUOTA_EXCEEDED_KEY);
    localStorage.removeItem(QUOTA_LEGACY_KEY);
  }
} catch {}

// Helper to check for Firestore internal assertion or watch stream errors
export function isFirestoreInternalAssertion(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || err.reason?.message || String(err)).toLowerCase();
  return (
    msg.includes('internal assertion failed') ||
    msg.includes('unexpected state (id:') ||
    msg.includes('targetstate') ||
    msg.includes('watchchangeaggregator') ||
    msg.includes('persistentlistenstream')
  );
}

// Intercept unhandled promise rejections specifically from Firestore WebChannel
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    if (isFirestoreInternalAssertion(event.reason)) {
      event.preventDefault();
      return;
    }
    if (isQuotaExceededError(event.reason)) {
      markQuotaExceeded(event.reason);
      event.preventDefault();
    }
  });

  window.addEventListener('error', (event) => {
    if (isFirestoreInternalAssertion(event.error) || isFirestoreInternalAssertion(event.message)) {
      event.preventDefault();
    }
  });
}

// Universal promise timeout helper to guarantee no Firestore RPC can ever hang the application
export function promiseWithTimeout<T>(promise: Promise<T>, ms: number, fallbackValue?: T): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      if (fallbackValue !== undefined) {
        resolve(fallbackValue);
      } else {
        reject(new Error(`Firestore operation timed out after ${ms}ms`));
      }
    }, ms);
  });
  return Promise.race([
    promise.then(val => {
      clearTimeout(timer);
      return val;
    }).catch(err => {
      clearTimeout(timer);
      throw err;
    }),
    timeoutPromise
  ]);
}

export function isQuotaExceededError(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || error.code || String(error)).toLowerCase();
  const isFirebaseRelated = 
    error?.name === 'FirebaseError' ||
    msg.includes('firestore') ||
    msg.includes('@firebase') ||
    msg.includes('webchannel') ||
    msg.includes('cloud.firestore') ||
    msg.includes('free daily write units') ||
    msg.includes('free daily read units') ||
    msg.includes('resource-exhausted');

  return Boolean(isFirebaseRelated && (
    msg.includes('resource-exhausted') ||
    msg.includes('quota limit exceeded') ||
    msg.includes('quota exceeded') ||
    msg.includes('free daily write units') ||
    msg.includes('free daily read units')
  ));
}

export function markQuotaExceeded(error?: any) {
  if (!isFirestoreQuotaExceeded) {
    isFirestoreQuotaExceeded = true;
    console.info('[Firestore Sync] Quota limit encountered. Throttling cloud writes for 60s while local persistence remains active.');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('firestore-quota-exceeded', {
          detail: { timestamp: Date.now(), message: error?.message || 'Daily free write quota reached' },
        })
      );
    }
    if (quotaCooldownTimer) clearTimeout(quotaCooldownTimer);
    quotaCooldownTimer = setTimeout(() => {
      isFirestoreQuotaExceeded = false;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.removeItem(QUOTA_EXCEEDED_KEY);
          localStorage.removeItem(QUOTA_LEGACY_KEY);
        }
      } catch {}
    }, 60000);
  }
}

export function getIsQuotaExceeded(): boolean {
  return isFirestoreQuotaExceeded;
}

export async function resetQuotaState(): Promise<boolean> {
  isFirestoreQuotaExceeded = false;
  if (quotaCooldownTimer) clearTimeout(quotaCooldownTimer);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(QUOTA_EXCEEDED_KEY);
      localStorage.removeItem(QUOTA_LEGACY_KEY);
    }
  } catch {}
  return true;
}

// Test connection on boot (with 10-second timeout so it reliably connects even during cold starts)
export async function testFirestoreConnection(): Promise<boolean> {
  // Always reset temporary quota flag on connection test to ensure live cloud connection
  if (isFirestoreQuotaExceeded) {
    isFirestoreQuotaExceeded = false;
  }
  try {
    const checkPromise = (async () => {
      // Check bundle or test doc
      const snap = await getDoc(doc(db, 'app_bundles', 'departments')).catch(err => {
        if (isQuotaExceededError(err)) markQuotaExceeded(err);
        return null;
      });
      if (snap) return true;
      await getDoc(doc(db, 'test', 'connection')).catch(err => {
        if (isQuotaExceededError(err)) markQuotaExceeded(err);
        return null;
      });
      return true;
    })();

    const result = await promiseWithTimeout(checkPromise, 10000, false);
    if (result) {
      console.log('Firebase Firestore connection verified successfully!');
      return true;
    }
    return false;
  } catch (error: any) {
    if (isQuotaExceededError(error)) {
      markQuotaExceeded(error);
      return false;
    }
    console.warn('testFirestoreConnection note:', error?.message);
    return false;
  }
}

// Google Sign In
export async function signInWithGoogle(loginHint?: string): Promise<User | null> {
  try {
    if (loginHint && loginHint.trim()) {
      googleProvider.setCustomParameters({ login_hint: loginHint.trim(), prompt: 'select_account' });
    } else {
      googleProvider.setCustomParameters({ prompt: 'select_account' });
    }
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Google Sign In Error:', error);
    throw error;
  }
}

// Sign Out
export async function logOut(): Promise<void> {
  await signOut(auth);
}

// Re-export specific Auth functions so other files don't need to import from firebase/auth
export {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  onAuthStateChanged
};

// Helper to clean document ID for Firestore
export function cleanDocId(id: string): string {
  const sanitized = String(id || '').trim().replace(/[\/\s\\#\[\]\*\?]/g, '_');
  return sanitized || 'doc_' + Math.random().toString(36).substring(2, 9);
}

// The Authentic BTS Departments (only canonical codes, TRW/TRD canonicalizes to TRW/TRL)
export const AUTHENTIC_BTS_DEPARTMENTS = new Set([
  'ADM/CMM', 'BES/PSY', 'BES/PSY2', 'DWE', 'GM', 'MCC', 'MLR', 'OHL', 'RST', 'RST2', 'STR', 'TEL', 'TRW/TRL'
]);

// Non-standard / demo department codes that should never linger in the system
export const DEMO_DEPARTMENT_CODES = [
  'RS', 'SIG', 'QST', 'STN', 'IT', 'DEMO', 'TEST', 'TESTING', 'DUMMY'
];

export function isDemoDepartment(dept?: string | null): boolean {
  if (!dept) return false;
  const clean = dept.trim().toUpperCase();
  if (clean === 'ALL' || clean === 'PENDING') return false;
  if (DEMO_DEPARTMENT_CODES.includes(clean)) return true;
  if (clean.startsWith('DEMO') || clean.startsWith('TEST')) return true;
  return !AUTHENTIC_BTS_DEPARTMENTS.has(clean);
}

// Demo employee identifiers (strictly targeting only the legacy dummy record)
export const DEMO_EMPLOYEE_GIDS = new Set([
  'Z00315TH_DEMO_LEGACY',
]);

export const DEMO_EMPLOYEE_NOS = new Set([
  '0315_DEMO_LEGACY',
]);

export function isDemoEmployee(empOrIdentifier?: string | Employee | null): boolean {
  if (!empOrIdentifier) return false;
  if (typeof empOrIdentifier === 'string') {
    const clean = empOrIdentifier.trim().toUpperCase();
    return clean === 'Z00315TH_DEMO_LEGACY';
  }
  const empNo = (empOrIdentifier.empNo || '').trim().toUpperCase();
  const gid = (empOrIdentifier.gid || '').trim().toUpperCase();
  const dept = (empOrIdentifier.department || '').trim().toUpperCase();
  const fName = (empOrIdentifier.firstName || '').trim().toLowerCase();
  const lName = (empOrIdentifier.familyName || '').trim().toLowerCase();

  // Filter out legacy dummy Pravit Chaiyasit demo employee (ID 0005, GID Z0002CRK)
  if (fName === 'pravit' && (lName === 'chaiyasit' || empNo === '0005' || empNo === '5')) return true;

  // Only filter out the specific legacy placeholder test employee if dept is ADM
  if (gid === 'Z00315TH' && empNo === '0315' && dept === 'ADM' && fName === 'thanaporn') return true;
  return false;
}

// Authentic railway shift codes
export const DEMO_SHIFT_CODES: string[] = [];

export function isDemoShiftCode(_code: string, dept?: string): boolean {
  if (dept && isDemoDepartment(dept)) return true;
  return false;
}

// Demo & legacy placeholder user accounts (only synthetic test dummies)
export const DEMO_USER_EMAILS = new Set([
  'demo@example.com',
  'test@example.com',
]);

export function isDemoUser(userOrEmail?: string | UserAccount | null): boolean {
  if (!userOrEmail) return false;
  const email = typeof userOrEmail === 'string' ? userOrEmail : userOrEmail.email;
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  if (DEMO_USER_EMAILS.has(clean)) return true;
  if (typeof userOrEmail === 'object' && userOrEmail.id) {
    const id = (userOrEmail.id || '').toLowerCase();
    if (['usr-user-1', 'usr-user-2', 'usr-rs-lead', 'usr-gm-lead', 'usr-demo'].includes(id)) {
      return true;
    }
  }
  return false;
}

// Sanitize employee department: remap any legacy demo departments and aliases (e.g. TRW/TRD -> TRW/TRL)
export function sanitizeEmployeeDepartment(emp: Employee): Employee {
  if (!emp) return emp;
  const rawDept = (emp.department || '').trim().toUpperCase();
  const canonDept = toCanonicalDepartment(rawDept);
  const canonNo = canonicalEmpNo(emp.empNo);
  const cleanEmpNo = canonNo.replace(/^0+/, '');
  const fName = (emp.firstName || '').trim().toLowerCase();
  const lName = (emp.familyName || '').trim().toLowerCase();
  let cleanDept = canonDept;

  const isKittisak = canonNo === '1442' || cleanEmpNo === '1442' || fName.includes('kittisak') || lName.includes('boonma');
  const isSarawut = canonNo === '1234' || cleanEmpNo === '1234' || fName.includes('sarawut') || lName.includes('phromdee');

  // Specific employee operational records from BES/PSY:
  if (isKittisak || isSarawut) {
    if (rawDept === 'SIG' || rawDept === 'RS' || isDemoDepartment(rawDept) || rawDept === 'TEL' || rawDept === 'RST' || !rawDept) {
      cleanDept = 'BES/PSY';
    }
  } else if (rawDept === 'RS') {
    cleanDept = 'RST';
  } else if (rawDept === 'SIG') {
    cleanDept = 'TEL';
  } else if (rawDept === 'OVH') {
    cleanDept = 'OHL';
  } else if (rawDept === 'TRW/TRD' || rawDept === 'TRD' || rawDept === 'TRW') {
    cleanDept = 'TRW/TRL';
  } else if (rawDept === 'QST') {
    cleanDept = 'GM';
  } else if (isDemoDepartment(cleanDept)) {
    cleanDept = 'GM';
  }

  const hasEmpNoChanged = Boolean(canonNo && canonNo !== emp.empNo);
  const hasDeptChanged = cleanDept !== emp.department;

  if (hasDeptChanged || hasEmpNoChanged) {
    return {
      ...emp,
      empNo: canonNo || emp.empNo,
      department: cleanDept,
      updatedAt: emp.updatedAt || new Date().toISOString()
    };
  }
  return emp;
}

// Ensure employee object has no undefined fields (which would cause Firestore writes to crash)
export function cleanEmployeeForFirestore(emp: Employee, defaultTime?: string): Employee {
  const baseTime = defaultTime || '1970-01-01T00:00:00.000Z';
  const canonNo = canonicalEmpNo(emp.empNo) || String(emp.empNo || '').trim();
  const canonDept = toCanonicalDepartment(emp.department);
  const clean: any = {
    empNo: canonNo,
    gid: String(emp.gid || '').trim().toUpperCase(),
    firstName: String(emp.firstName || '').trim(),
    familyName: String(emp.familyName || '').trim(),
    department: canonDept,
    division: String(emp.division || 'MO CS BTS').trim(),
    functionTitle: String(emp.functionTitle || '').trim(),
    costCenter: String(emp.costCenter || 'C93056').trim(),
    isShiftWorker: Boolean(emp.isShiftWorker),
    isActive: emp.isActive !== false,
    updatedAt: emp.updatedAt || baseTime,
  };
  // Ensure 8-digit Payroll EmpCode is preserved or auto-healed for numeric empNo
  const empNoDigits = clean.empNo.replace(/\D/g, '');
  if (emp.empCode && String(emp.empCode).trim()) {
    clean.empCode = String(emp.empCode).trim();
  } else if (empNoDigits && empNoDigits.length <= 4) {
    clean.empCode = `1000${empNoDigits.padStart(4, '0')}`;
  }
  clean.id = `emp-${canonNo}`;
  return removeUndefinedFields(clean) as Employee;
}

/**
 * Universal Deduplication & Canonicalization for Employee Master:
 * Unifies duplicate employee records caused by unpadded vs 4-digit padded empNo (e.g. "139" vs "0139"),
 * maps department variations (e.g. "TRW/TRD" -> "TRW/TRL"), and merges records sharing the same GID or full name.
 */
export function deduplicateAndCanonicalizeEmployees(employees: Employee[]): Employee[] {
  if (!Array.isArray(employees)) return [];
  const mergedMap = new Map<string, Employee>();
  const now = new Date().toISOString();

  for (const raw of employees) {
    if (!raw || !raw.empNo || isDemoEmployee(raw)) continue;
    const sanitized = sanitizeEmployeeDepartment(raw);
    const canonNo = canonicalEmpNo(sanitized.empNo);
    const canonDept = toCanonicalDepartment(sanitized.department);
    const gidClean = (sanitized.gid || '').trim().toUpperCase();
    const isValidGid = Boolean(gidClean && gidClean !== 'NA' && gidClean.length >= 3 && !gidClean.includes('0000'));
    const cleanFn = (sanitized.firstName || '').trim().toLowerCase();
    const cleanLn = (sanitized.familyName || '').trim().toLowerCase();
    const fullNameKey = (cleanFn && cleanLn && cleanLn !== '-') ? `name:${cleanFn}_${cleanLn}` : '';

    // Determine matching key: GID takes highest precedence, then Canonical EmpNo, then Full Name
    let matchKey = '';
    if (isValidGid && mergedMap.has(`gid:${gidClean}`)) {
      matchKey = mergedMap.get(`gid:${gidClean}`) as any;
    } else if (canonNo && mergedMap.has(`no:${canonNo}`)) {
      matchKey = mergedMap.get(`no:${canonNo}`) as any;
    } else if (fullNameKey && mergedMap.has(fullNameKey)) {
      matchKey = mergedMap.get(fullNameKey) as any;
    }

    const cleanItem: Employee = {
      ...sanitized,
      empNo: canonNo,
      id: `emp-${canonNo}`,
      department: canonDept,
      gid: gidClean || sanitized.gid,
      empCode: sanitized.empCode || (canonNo.length === 4 ? `1000${canonNo}` : undefined),
      isActive: sanitized.isActive !== false,
      updatedAt: sanitized.updatedAt || now,
    };

    if (matchKey) {
      const existing = mergedMap.get(matchKey)!;
      const existingTime = existing.updatedAt || '';
      const incomingTime = cleanItem.updatedAt || '';
      const isIncomingNewer = incomingTime >= existingTime;
      const primary = isIncomingNewer ? cleanItem : existing;
      const secondary = isIncomingNewer ? existing : cleanItem;

      // Prefer padded 4-digit empNo
      const bestEmpNo = (primary.empNo && primary.empNo.length === 4) ? primary.empNo : (secondary.empNo || primary.empNo);
      // Prefer authentic non-default empCode (e.g. 65090139 over 10000139)
      const bestEmpCode = (primary.empCode && !primary.empCode.startsWith('1000'))
        ? primary.empCode
        : ((secondary.empCode && !secondary.empCode.startsWith('1000')) ? secondary.empCode : (primary.empCode || secondary.empCode));
      // Canonical department: TRW/TRL wins over TRW/TRD
      const bestDept = (primary.department === 'TRW/TRL' || secondary.department === 'TRW/TRL')
        ? 'TRW/TRL'
        : (toCanonicalDepartment(primary.department) || toCanonicalDepartment(secondary.department));
      // Authentic GID
      const bestGid = (isValidGid ? gidClean : '') || primary.gid || secondary.gid;

      const merged: Employee = {
        ...secondary,
        ...primary,
        empNo: bestEmpNo,
        id: `emp-${bestEmpNo}`,
        department: bestDept,
        gid: bestGid,
        empCode: bestEmpCode,
        firstName: primary.firstName || secondary.firstName,
        familyName: primary.familyName || secondary.familyName,
        functionTitle: (primary.functionTitle && primary.functionTitle !== 'Service Technician') ? primary.functionTitle : (secondary.functionTitle || primary.functionTitle),
        costCenter: (primary.costCenter && primary.costCenter !== 'C93056') ? primary.costCenter : (secondary.costCenter || primary.costCenter || 'C93056'),
        division: primary.division || secondary.division || 'MO CS BTS',
        isShiftWorker: Boolean(primary.isShiftWorker || secondary.isShiftWorker),
        isActive: primary.isActive !== false && secondary.isActive !== false,
        updatedAt: primary.updatedAt || secondary.updatedAt || now,
      };

      mergedMap.set(matchKey, merged);
    } else {
      const assignedKey = `item:${isValidGid ? gidClean : canonNo}`;
      mergedMap.set(assignedKey, cleanItem);
      if (isValidGid) mergedMap.set(`gid:${gidClean}`, assignedKey as any);
      if (canonNo) mergedMap.set(`no:${canonNo}`, assignedKey as any);
      if (fullNameKey) mergedMap.set(fullNameKey, assignedKey as any);
    }
  }

  const results: Employee[] = [];
  const seenNos = new Set<string>();
  for (const [k, v] of mergedMap.entries()) {
    if (k.startsWith('item:') && typeof v === 'object' && v.empNo && !seenNos.has(v.empNo)) {
      seenNos.add(v.empNo);
      results.push(v);
    }
  }
  return results.sort((a, b) => a.empNo.localeCompare(b.empNo));
}

/**
 * Universal Deduplication & Canonicalization for Daily Shift Plans:
 * Merges plans sharing the same employee (by canonical empNo or GID) on the same date,
 * standardizes empNo to 4 digits ("0139") and maps department to canonical "TRW/TRL".
 */
export function deduplicateAndCanonicalizeShiftPlans(
  plans: DailyShiftPlan[],
  employees?: Employee[]
): DailyShiftPlan[] {
  if (!Array.isArray(plans)) return [];
  const planMap = new Map<string, DailyShiftPlan>();
  const now = new Date().toISOString();

  // Create fast lookup for employee GID and department by canonical empNo
  const empLookup = new Map<string, { gid?: string; department?: string }>();
  if (Array.isArray(employees)) {
    employees.forEach(e => {
      if (e && e.empNo) {
        const cNo = canonicalEmpNo(e.empNo);
        empLookup.set(cNo, { gid: e.gid, department: e.department });
      }
    });
  }

  plans.forEach(p => {
    if (!p || !p.date || !p.shiftCode) return;
    if (p.date < '2024-01-01') return;

    const canonNo = canonicalEmpNo(p.empNo);
    const linkedEmp = canonNo ? empLookup.get(canonNo) : undefined;
    const gidClean = ((p.gid || linkedEmp?.gid || '')).trim().toUpperCase();
    const canonDept = toCanonicalDepartment(p.department || linkedEmp?.department);

    // Primary unique key for an employee on a specific date:
    // A single employee has only ONE scheduled shift per calendar date
    const targetEmpKey = canonNo || gidClean;
    if (!targetEmpKey) return;
    const key = `${targetEmpKey}_${p.date}`;

    const cleanPlan: DailyShiftPlan = {
      ...p,
      id: p.id || `plan_${cleanDocId(targetEmpKey)}_${p.date}`,
      empNo: canonNo || p.empNo,
      gid: gidClean || p.gid,
      department: canonDept,
      updatedAt: p.updatedAt || now,
    };

    const existing = planMap.get(key);
    if (!existing) {
      planMap.set(key, cleanPlan);
    } else {
      const existingTime = existing.updatedAt || '';
      const incomingTime = cleanPlan.updatedAt || '';
      const isIncomingNewer = incomingTime >= existingTime;
      const primary = isIncomingNewer ? cleanPlan : existing;
      const secondary = isIncomingNewer ? existing : cleanPlan;

      planMap.set(key, {
        ...secondary,
        ...primary,
        empNo: canonNo || primary.empNo || secondary.empNo,
        gid: gidClean || primary.gid || secondary.gid,
        department: canonDept,
        shiftCode: primary.shiftCode || secondary.shiftCode,
        updatedAt: primary.updatedAt || secondary.updatedAt || now,
      });
    }
  });

  return Array.from(planMap.values());
}

/**
 * Recursively remove any keys that have undefined values from an object or array
 * to ensure 100% compliance with Firestore's strict no-undefined policy.
 */
export function removeUndefinedFields<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedFields(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const clean: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        clean[key] = removeUndefinedFields(value);
      }
    }
    return clean;
  }
  return obj;
}

export function cleanDepartmentForFirestore(dept: Department, defaultTime?: string): Department {
  const baseTime = defaultTime || new Date().toISOString();
  const code = String(dept?.code || '').trim().toUpperCase() || 'UNKNOWN';
  const name = String(resolveDepartmentFullName(code, dept?.name) || code || 'General').trim();
  const updatedAt = String((dept && dept.updatedAt) || baseTime).trim();
  return removeUndefinedFields({
    code,
    name,
    updatedAt,
  });
}

// Chunk helper for large arrays
function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
}

// Unified high-capacity Biometric Punches chunk writer (2,000 punches per document bundle)
async function writeBiometricPunchesChunksInternal(punches: BiometricRawPunch[], now: string): Promise<Promise<any>[]> {
  const punchMap = new Map<string, any>();
  (punches || []).forEach(p => {
    if (!p || !p.date || !p.time) return;
    if (p.date < '2024-01-01') return;
    const k = `${(p.empIdentifier || '').trim().toLowerCase()}_${p.date}_${p.time}_${p.type || ''}`;
    if (!punchMap.has(k)) {
      punchMap.set(k, {
        id: p.id || k,
        empIdentifier: (p.empIdentifier || '').trim(),
        type: p.type || 'I',
        date: p.date,
        time: p.time,
        deviceId: p.deviceId || '01',
      });
    }
  });
  const leanPunches = Array.from(punchMap.values()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const punchChunks = chunkArray(leanPunches, 2000);

  const promises: Promise<any>[] = [];
  promises.push(
    setDoc(doc(db, 'app_bundles', 'punches_manifest'), {
      chunks: punchChunks.length,
      totalPunches: leanPunches.length,
      updatedAt: now,
    }, { merge: true }).catch(err => {
      if (isQuotaExceededError(err)) markQuotaExceeded(err);
      console.warn('Cloud sync punches_manifest error:', err?.message);
    })
  );

  if (punchChunks.length === 0) {
    promises.push(
      setDoc(doc(db, 'app_bundles', 'punches_0'), {
        data: [],
        chunkIndex: 0,
        count: 0,
        updatedAt: now,
      }, { merge: true }).catch(err => {
        if (isQuotaExceededError(err)) markQuotaExceeded(err);
      })
    );
  } else {
    for (let i = 0; i < punchChunks.length; i++) {
      promises.push(
        setDoc(doc(db, 'app_bundles', `punches_${i}`), {
          data: punchChunks[i],
          chunkIndex: i,
          count: punchChunks[i].length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
          console.warn(`Cloud sync punches_${i} error:`, err?.message);
        })
      );
    }
  }

  // Manifest specifies the exact chunk count; fetchAllFromCloud strictly loads chunks 0 to punchesManifestChunks - 1
  return promises;
}

let shiftPlansBundleDebounceTimer: any = null;

// Firestore Database Sync Service using High-Efficiency Bundling
export const firestoreSync = {
  isQuotaExceeded: getIsQuotaExceeded,
  resetQuotaState,

  // Sync all entities to Cloud Firestore using bundled documents (drastically reduces writes from 10,000+ to ~8 writes)
  async syncAllToCloud(data: {
    employees: Employee[];
    shiftCodes: ShiftCode[];
    shiftPlans: DailyShiftPlan[];
    punches: BiometricRawPunch[];
    otRecords: OTRecord[];
    otherAllowances: OtherAllowance[];
    users: UserAccount[];
    manualOverrides: Record<string, Partial<TimeSheetRow>>;
    departments?: Department[];
  }): Promise<boolean> {
    if (isFirestoreQuotaExceeded) {
      console.log('Skipping syncAllToCloud: Daily Firestore write quota reached. Local persistence is active.');
      return false;
    }
    try {
      const now = new Date().toISOString();
      const promises: Promise<any>[] = [];

      // 1. Shift Codes bundle (1 write instead of 800+ writes)
      const cleanShiftCodes = (data.shiftCodes || []).map(sc => removeUndefinedFields(sc));
      promises.push(
        setDoc(doc(db, 'app_bundles', 'shift_codes'), {
          data: cleanShiftCodes,
          count: cleanShiftCodes.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
          console.warn('Cloud sync shift_codes error:', err?.message);
        })
      );

      // 2. Employees bundle (1 write instead of 400+ writes)
      const dedupedEmps = deduplicateAndCanonicalizeEmployees(data.employees || []);
      const cleanEmps = dedupedEmps.map(e => removeUndefinedFields(cleanEmployeeForFirestore(e, now)));
      const empPayload = removeUndefinedFields({
        data: cleanEmps,
        count: cleanEmps.length,
        updatedAt: now,
      });
      promises.push(
        setDoc(doc(db, 'app_bundles', 'employees'), empPayload, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
          console.warn('Cloud sync employees error:', err?.message);
        })
      );

      // 3. Departments bundle (1 write)
      if (data.departments && data.departments.length > 0) {
        const cleanDepartments = data.departments
          .filter(d => d && d.code)
          .map(d => removeUndefinedFields(cleanDepartmentForFirestore(d, now)));
        const deptPayload = removeUndefinedFields({
          data: cleanDepartments,
          count: cleanDepartments.length,
          updatedAt: now,
        });
        promises.push(
          setDoc(doc(db, 'app_bundles', 'departments'), deptPayload, { merge: true }).catch(err => {
            if (isQuotaExceededError(err)) markQuotaExceeded(err);
            console.warn('Cloud sync departments error:', err?.message);
          })
        );
      }

      // 4. Biometric Punches bundles (using unified chunks of 2,000 punches per bundle)
      const punchPromises = await writeBiometricPunchesChunksInternal(data.punches, now);
      promises.push(...punchPromises);

      // 5. Shift Plans bundles (chunked in 1,500 plans per bundle)
      const dedupedPlans = deduplicateAndCanonicalizeShiftPlans(data.shiftPlans || [], dedupedEmps);
      const cleanPlans = dedupedPlans.map(p => removeUndefinedFields(p));
      const planChunks = chunkArray(cleanPlans, 1500);
      promises.push(
        setDoc(doc(db, 'app_bundles', 'shift_plans_manifest'), {
          chunks: planChunks.length,
          totalPlans: cleanPlans.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        })
      );
      planChunks.forEach((chunk, idx) => {
        promises.push(
          setDoc(doc(db, 'app_bundles', `shift_plans_${idx}`), {
            data: chunk,
            chunkIndex: idx,
            updatedAt: now,
          }, { merge: true }).catch(err => {
            if (isQuotaExceededError(err)) markQuotaExceeded(err);
          })
        );
      });

      // 6. OT Records bundle (1 write)
      const cleanOT = (data.otRecords || []).map(o => removeUndefinedFields(o));
      promises.push(
        setDoc(doc(db, 'app_bundles', 'ot_records'), {
          data: cleanOT,
          count: cleanOT.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        })
      );

      // 7. Other Allowances bundle (1 write)
      const cleanAllw = (data.otherAllowances || []).map(a => removeUndefinedFields(a));
      promises.push(
        setDoc(doc(db, 'app_bundles', 'other_allowances'), {
          data: cleanAllw,
          count: cleanAllw.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        })
      );

      // 8. Users bundle (1 write)
      const cleanUsers = (data.users || []).map(u => removeUndefinedFields(u));
      promises.push(
        setDoc(doc(db, 'app_bundles', 'users'), {
          data: cleanUsers,
          count: cleanUsers.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        })
      );

      // 9. Manual Overrides bundle (1 write)
      const cleanOverrides = removeUndefinedFields(data.manualOverrides || {});
      promises.push(
        setDoc(doc(db, 'app_bundles', 'manual_overrides'), {
          data: cleanOverrides,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        })
      );

      await promiseWithTimeout(Promise.all(promises), 35000, []);
      console.log('Successfully synced bundled data to Cloud Firestore!');
      return true;
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('syncAllToCloud caught error (safe fallback to local persistence):', error?.message || error);
      return false;
    }
  },

  // Fast targeted sync for Shift Codes only (1 bundled write instead of 800 writes)
  async syncShiftCodes(codes: ShiftCode[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const now = new Date().toISOString();
      const codeChunks = chunkArray(codes, 1500);
      
      await setDoc(doc(db, 'app_bundles', 'shift_codes_manifest'), {
        chunks: codeChunks.length,
        total: codes.length,
        updatedAt: now,
      }, { merge: true });

      for (let i = 0; i < codeChunks.length; i++) {
        const bundleId = i === 0 ? 'shift_codes' : `shift_codes_${i}`;
        await setDoc(doc(db, 'app_bundles', bundleId), {
          data: codeChunks[i],
          chunkIndex: i,
          count: codeChunks[i].length,
          updatedAt: now,
        }, { merge: true });
      }
      return true;
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('syncShiftCodes cloud write warning:', error?.message || error);
      return false;
    }
  },

  // Fast targeted sync for Biometric Punches (unified 2,000 punches per bundle with parallel writes & timeout safety)
  async syncBiometricPunches(punches: BiometricRawPunch[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const now = new Date().toISOString();
      const promises = await writeBiometricPunchesChunksInternal(punches, now);
      await promiseWithTimeout(Promise.all(promises), 35000, []);
      return true;
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('syncBiometricPunches cloud write warning:', error?.message || error);
      return false;
    }
  },

  // Debounced bundle synchronization timer for Shift Plans
  scheduleDebouncedShiftPlansBundleSync(plans: DailyShiftPlan[]) {
    if (shiftPlansBundleDebounceTimer) clearTimeout(shiftPlansBundleDebounceTimer);
    shiftPlansBundleDebounceTimer = setTimeout(() => {
      this.writeShiftPlansBundle(plans).catch(console.warn);
    }, 400);
  },

  // Write full shift plans bundle to Cloud Firestore (chunked in 1500 items)
  async writeShiftPlansBundle(plans: DailyShiftPlan[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const now = new Date().toISOString();

      // Preserve existing plans in cloud bundle so departmental uploads NEVER wipe out other departments
      let plansToBundle = plans || [];
      try {
        const existingBundleSnap = await promiseWithTimeout(
          getDoc(doc(db, 'app_bundles', 'shift_plans_0')),
          8000,
          null
        );
        if (existingBundleSnap?.exists()) {
          const existingList: DailyShiftPlan[] = existingBundleSnap.data()?.data || [];
          if (existingList.length > 0) {
            const planMap = new Map<string, DailyShiftPlan>();
            existingList.forEach(p => {
              if (p && p.date && (p.empNo || p.gid)) {
                const k = `${(p.empNo || p.gid).trim().toUpperCase()}_${p.date}`;
                planMap.set(k, p);
              }
            });
            plansToBundle.forEach(p => {
              if (p && p.date && (p.empNo || p.gid)) {
                const k = `${(p.empNo || p.gid).trim().toUpperCase()}_${p.date}`;
                planMap.set(k, p);
              }
            });
            plansToBundle = Array.from(planMap.values());
          }
        }
      } catch {}

      // Canonicalize and deduplicate plans by employee and date
      const dedupedPlans = deduplicateAndCanonicalizeShiftPlans(plansToBundle);
      const stampedPlans = dedupedPlans
        .filter(p => !p.date || p.date >= '2025-01-01')
        .map(p => ({
          ...p,
          updatedAt: p.updatedAt || now,
        }));
      const planChunks = chunkArray(stampedPlans, 1500);

      const promises: Promise<any>[] = [];

      promises.push(
        setDoc(doc(db, 'app_bundles', 'shift_plans_manifest'), {
          chunks: planChunks.length,
          totalPlans: stampedPlans.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        })
      );

      if (planChunks.length === 0) {
        promises.push(
          setDoc(doc(db, 'app_bundles', 'shift_plans_0'), {
            data: [],
            chunkIndex: 0,
            count: 0,
            updatedAt: now,
          }, { merge: true }).catch(err => {
            if (isQuotaExceededError(err)) markQuotaExceeded(err);
          })
        );
      } else {
        for (let i = 0; i < planChunks.length; i++) {
          const payload = {
            data: planChunks[i],
            chunkIndex: i,
            count: planChunks[i].length,
            updatedAt: now,
          };
          promises.push(
            setDoc(doc(db, 'app_bundles', `shift_plans_${i}`), payload, { merge: true }).catch(err => {
              if (isQuotaExceededError(err)) markQuotaExceeded(err);
            })
          );
        }
      }

      // Manifest specifies the exact chunk count; fetchAllFromCloud strictly loads valid chunks
      // Also update legacy shift_plans bundle
      promises.push(
        setDoc(doc(db, 'app_bundles', 'shift_plans'), {
          data: planChunks[0] || [],
          totalPlans: stampedPlans.length,
          updatedAt: now,
          isChunked: planChunks.length > 1,
        }, { merge: true }).catch(() => null)
      );

      await promiseWithTimeout(Promise.all(promises), 30000, []);
      return true;
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('writeShiftPlansBundle warning:', error?.message || error);
      return false;
    }
  },

  // Fast targeted sync for Shift Plans
  async syncShiftPlans(plans: DailyShiftPlan[], newlyChangedPlans?: DailyShiftPlan[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const now = new Date().toISOString();

      // 1. If newlyChangedPlans are provided (from Painter Mode / Quick Scheduling):
      // Write individual changed documents IMMEDIATELY for sub-50ms real-time delivery across clients
      // Do NOT overwrite cloud bundle with single user's departmental slice
      if (newlyChangedPlans && newlyChangedPlans.length > 0) {
        const writeItems = newlyChangedPlans.slice(0, 100);
        await Promise.all(
          writeItems.map(p => {
            const cleanEmp = (p.empNo || '').trim();
            const cleanGid = (p.gid || '').trim();
            const targetEmp = cleanEmp || cleanGid;
            const docId = p.id || `plan_${cleanDocId(targetEmp)}_${p.date}`;
            return setDoc(doc(db, 'shift_plans', docId), {
              ...p,
              updatedAt: p.updatedAt || now
            }, { merge: true }).catch(err => {
              if (isQuotaExceededError(err)) markQuotaExceeded(err);
            });
          })
        );
        // Schedule debounced bundle sync so all connected users receive real-time shift updates via app_bundles
        if (plans && plans.length > 0) {
          this.scheduleDebouncedShiftPlansBundleSync(plans);
        }
        return true;
      }

      // 2. Otherwise (bulk import / full sync), write the bundles safely
      return await this.writeShiftPlansBundle(plans);
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('syncShiftPlans cloud write warning:', error?.message || error);
      return false;
    }
  },

  // Save single shift plan directly (fast atomic update for individual shift changes)
  async saveShiftPlanDirect(plan: DailyShiftPlan, allPlans?: DailyShiftPlan[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return true;
    try {
      const now = new Date().toISOString();
      const cleanEmp = (plan.empNo || '').trim();
      const cleanGid = (plan.gid || '').trim();
      const targetEmp = cleanEmp || cleanGid;
      const deterministicId = `plan_${cleanDocId(targetEmp)}_${plan.date}`;

      const stampedPlan: DailyShiftPlan = {
        ...plan,
        id: deterministicId,
        empNo: plan.empNo ? plan.empNo.trim() : '',
        gid: plan.gid ? plan.gid.trim() : '',
        updatedAt: plan.updatedAt || now,
      };

      // 1. Instant individual doc write to 'shift_plans' collection with deterministic ID
      await setDoc(doc(db, 'shift_plans', deterministicId), stampedPlan, { merge: true }).catch(err => {
        if (isQuotaExceededError(err)) markQuotaExceeded(err);
      });

      // 2. Schedule debounced bundle sync
      if (allPlans && allPlans.length > 0) {
        this.scheduleDebouncedShiftPlansBundleSync(allPlans);
      }
      return true;
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('saveShiftPlanDirect error:', error?.message);
      return false;
    }
  },

  // Save single shift code (updates cloud bundle without exceeding quota)
  async saveShiftCode(sc: ShiftCode, allCodes?: ShiftCode[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      let codesToSave = allCodes;
      if (!codesToSave) {
        // Fetch or load existing
        const snap = await getDoc(doc(db, 'app_bundles', 'shift_codes')).catch(() => null);
        const existing: ShiftCode[] = snap?.exists() ? (snap.data().data || []) : [];
        const map = new Map<string, ShiftCode>();
        existing.forEach(c => {
          if (c && c.code) {
            map.set(`${c.code.trim().toUpperCase()}_${(c.department || 'ALL').trim().toUpperCase()}`, c);
          }
        });
        const scDept = (sc.department || 'ALL').trim().toUpperCase();
        map.set(`${sc.code.trim().toUpperCase()}_${scDept}`, sc);
        codesToSave = Array.from(map.values());
      }
      return await this.syncShiftCodes(codesToSave);
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('saveShiftCode error:', error?.message);
      return false;
    }
  },

  // Delete single shift code from Cloud Firestore
  async deleteShiftCode(code: string, department: string, allCodes?: ShiftCode[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const upperCode = (code || '').trim().toUpperCase();
      const upperDept = (department || 'ALL').trim().toUpperCase();

      // Attempt deletion of legacy collection documents too
      deleteDoc(doc(db, 'shift_codes', `${upperCode}_${upperDept}`)).catch(() => null);
      deleteDoc(doc(db, 'shift_codes', upperCode)).catch(() => null);

      if (allCodes) {
        const cleaned = allCodes.filter(c => 
          !(c.code.trim().toUpperCase() === upperCode && (c.department || 'ALL').trim().toUpperCase() === upperDept)
        );
        return await this.syncShiftCodes(cleaned);
      }
      const snap = await getDoc(doc(db, 'app_bundles', 'shift_codes')).catch(() => null);
      if (snap?.exists()) {
        const existing: ShiftCode[] = snap.data().data || [];
        const filtered = existing.filter(c => 
          !(c.code.trim().toUpperCase() === upperCode && (c.department || 'ALL').trim().toUpperCase() === upperDept)
        );
        return await this.syncShiftCodes(filtered);
      }
      return true;
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('deleteShiftCode error:', error?.message);
      return false;
    }
  },

  // Delete single department from Cloud Firestore
  async deleteDepartment(code: string, allDepartments?: Department[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const upper = (code || '').trim().toUpperCase();
      deleteDoc(doc(db, 'departments', upper)).catch(() => null);
      deleteDoc(doc(db, 'departments', code)).catch(() => null);

      try {
        const delSnap = await getDoc(doc(db, 'app_bundles', 'deleted_departments')).catch(() => null);
        let existingIds: string[] = [];
        if (delSnap?.exists() && Array.isArray(delSnap.data().ids)) {
          existingIds = delSnap.data().ids;
        }
        if (!existingIds.includes(upper)) {
          existingIds.push(upper);
          await setDoc(doc(db, 'app_bundles', 'deleted_departments'), {
            ids: existingIds,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
      } catch (err) {
        console.warn('Could not update deleted_departments bundle:', err);
      }

      let filtered = allDepartments;
      if (!filtered) {
        const snap = await getDoc(doc(db, 'app_bundles', 'departments')).catch(() => null);
        if (snap?.exists()) {
          const existing: Department[] = snap.data().data || [];
          filtered = existing.filter(d => (d.code || '').trim().toUpperCase() !== upper);
        }
      }
      if (filtered) {
        await this.syncDepartments(filtered);
      }
      return true;
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('deleteDepartment error:', error?.message);
      return false;
    }
  },

  // Sync Departments list
  async syncDepartments(departments: Department[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const now = new Date().toISOString();
      const cleanDepartments: Department[] = (departments || [])
        .filter(d => d && d.code)
        .map(d => removeUndefinedFields(cleanDepartmentForFirestore(d, now)));

      const deptPayload = removeUndefinedFields({
        data: cleanDepartments,
        count: cleanDepartments.length,
        updatedAt: now,
      });

      // 1. Primary high-efficiency bundle write (strictly sanitized with no undefined keys)
      await setDoc(doc(db, 'app_bundles', 'departments'), deptPayload, { merge: true });

      // Clean up deleted_departments in Firestore: only remove a department code if it was explicitly created/updated as a custom active department with recent timestamp
      // Do NOT arbitrarily wipe out deleted department codes!

      // 2. Dual-sync individual documents in background for 100% cloud consistency
      Promise.all(cleanDepartments.map(d => 
        setDoc(doc(db, 'departments', d.code), removeUndefinedFields({
          code: d.code,
          name: d.name,
          updatedAt: d.updatedAt || now,
        }), { merge: true }).catch(() => null)
      )).catch(() => {});

      return true;
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('syncDepartments error:', error?.message);
      return false;
    }
  },

  // Sync Employees list (Pure bundle write: 1 write per update, eliminates multi-doc race conditions)
  async syncEmployees(employees: Employee[], timeoutMs = 35000): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const now = new Date().toISOString();
      const deduped = deduplicateAndCanonicalizeEmployees(employees || []);
      const cleanEmployees: Employee[] = deduped
        .filter(emp => emp && emp.empNo && !isDemoEmployee(emp))
        .map(emp => removeUndefinedFields(cleanEmployeeForFirestore(emp, now)));

      const empPayload = removeUndefinedFields({
        data: cleanEmployees,
        count: cleanEmployees.length,
        updatedAt: now,
      });

      const syncTask = async () => {
        // Master employee bundle write
        await setDoc(doc(db, 'app_bundles', 'employees'), empPayload);

        // Background non-blocking cleanup of deleted_employees (never stalls employee sync)
        (async () => {
          try {
            const activeKeys = new Set<string>();
            cleanEmployees.forEach(e => {
              if (e.empNo) activeKeys.add(e.empNo.trim().toUpperCase());
              if (e.empNo) activeKeys.add(cleanDocId(e.empNo).toUpperCase());
              if (e.gid) activeKeys.add(e.gid.trim().toUpperCase());
              if (e.empCode) activeKeys.add(e.empCode.trim().toUpperCase());
            });
            const delRef = doc(db, 'app_bundles', 'deleted_employees');
            const delSnap = await promiseWithTimeout(getDoc(delRef), 2000, null).catch(() => null);
            if (delSnap?.exists()) {
              const ids: string[] = delSnap.data()?.ids || [];
              const remaining = ids.filter(id => !activeKeys.has(id.toUpperCase()));
              if (remaining.length !== ids.length) {
                await setDoc(delRef, { ids: remaining, updatedAt: now }, { merge: true }).catch(() => null);
              }
            }
          } catch {}
        })().catch(() => {});

        return true;
      };

      const timeoutTask = new Promise<boolean>((resolve) =>
        setTimeout(() => {
          console.warn(`[syncEmployees] Cloud sync timeout (${Math.round(timeoutMs / 1000)}s); local storage active.`);
          resolve(false);
        }, timeoutMs)
      );

      return await Promise.race([syncTask(), timeoutTask]);
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('syncEmployees error:', error?.message);
      return false;
    }
  },

  // Sync OT Records with safe chunking and multi-user resilience
  async syncOTRecords(records: OTRecord[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const now = new Date().toISOString();
      const cleanRecords = (records || []).filter(o => {
        const targetD = o.retroactiveTargetDate || o.date;
        return !targetD || targetD >= '2025-01-01';
      });
      const otChunks = chunkArray(cleanRecords, 1200);

      const syncTask = async () => {
        const promises: Promise<any>[] = [];

        // 1. Write manifest
        promises.push(
          setDoc(doc(db, 'app_bundles', 'ot_records_manifest'), {
            chunks: otChunks.length,
            totalRecords: cleanRecords.length,
            updatedAt: now,
          })
        );

        // 2. Write chunked documents
        if (otChunks.length === 0) {
          promises.push(
            setDoc(doc(db, 'app_bundles', 'ot_records_0'), {
              data: [],
              chunkIndex: 0,
              count: 0,
              updatedAt: now,
            })
          );
        } else {
          for (let i = 0; i < otChunks.length; i++) {
            promises.push(
              setDoc(doc(db, 'app_bundles', `ot_records_${i}`), {
                data: otChunks[i],
                chunkIndex: i,
                count: otChunks[i].length,
                updatedAt: now,
              })
            );
          }
        }

        // Manifest specifies the exact chunk count; fetchAllFromCloud strictly loads valid chunks
        // 3. Write primary ot_records document for backward compatibility
        promises.push(
          setDoc(doc(db, 'app_bundles', 'ot_records'), {
            data: otChunks.length <= 1 ? (otChunks[0] || []) : otChunks[0],
            count: cleanRecords.length,
            totalRecords: cleanRecords.length,
            isChunked: otChunks.length > 1,
            updatedAt: now,
          })
        );

        await Promise.all(promises);
        return true;
      };

      const timeoutTask = new Promise<boolean>((resolve) =>
        setTimeout(() => {
          console.warn('[syncOTRecords] Cloud sync timeout (45s)');
          resolve(true);
        }, 45000)
      );

      return await Promise.race([syncTask(), timeoutTask]);
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('syncOTRecords error:', error?.message);
      return false;
    }
  },

  // Sync Other Allowances
  async syncOtherAllowances(allw: OtherAllowance[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const syncTask = async () => {
        await setDoc(doc(db, 'app_bundles', 'other_allowances'), {
          data: allw,
          count: allw.length,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        return true;
      };

      const timeoutTask = new Promise<boolean>((resolve) =>
        setTimeout(() => {
          console.warn('[syncOtherAllowances] Cloud sync timeout (35s)');
          resolve(true);
        }, 35000)
      );

      return await Promise.race([syncTask(), timeoutTask]);
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('syncOtherAllowances error:', error?.message);
      return false;
    }
  },

  // Sync Manual Overrides
  async syncManualOverrides(overrides: Record<string, Partial<TimeSheetRow>>): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const syncTask = async () => {
        await setDoc(doc(db, 'app_bundles', 'manual_overrides'), {
          data: overrides,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        return true;
      };

      const timeoutTask = new Promise<boolean>((resolve) =>
        setTimeout(() => {
          console.warn('[syncManualOverrides] Cloud sync timeout (35s)');
          resolve(true);
        }, 35000)
      );

      return await Promise.race([syncTask(), timeoutTask]);
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('syncManualOverrides error:', error?.message);
      return false;
    }
  },

  // Save single user directly to Firestore (individual doc + app_bundles/users merge)
  async saveUserDirect(user: UserAccount): Promise<boolean> {
    if (isFirestoreQuotaExceeded) {
      return true; // Local storage is already updated
    }
    try {
      if (!user || !user.email) return false;
      if (isDemoUser(user)) {
        console.warn('Prevented saving demo user:', user.email);
        return false;
      }
      const cleanEmail = user.email.trim().toLowerCase();
      const docKey = cleanDocId(cleanEmail);

      // Normalize status
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
        updatedAt: new Date().toISOString(),
      };

      const syncOperation = async () => {
        const bundleRef = doc(db, 'app_bundles', 'users');
        const delDocRef = doc(db, 'app_bundles', 'deleted_users');

        // Stage 1: Parallel fetch bundle, deleted_users, and write individual user doc
        const [bundleSnap, delSnap] = await Promise.all([
          getDoc(bundleRef).catch(() => null),
          getDoc(delDocRef).catch(() => null),
          setDoc(doc(db, 'user_accounts', docKey), normalizedUser, { merge: true }).catch(err => {
            if (isQuotaExceededError(err)) markQuotaExceeded(err);
            console.warn('saveUserDirect individual doc error:', err?.message);
            return null;
          }),
        ]);

        const writePromises: Promise<any>[] = [];

        // Secondary id alias write if id differs from docKey
        if (normalizedUser.id && cleanDocId(normalizedUser.id) !== docKey) {
          writePromises.push(
            setDoc(doc(db, 'user_accounts', cleanDocId(normalizedUser.id)), normalizedUser, { merge: true }).catch(err => {
              if (isQuotaExceededError(err)) markQuotaExceeded(err);
              return null;
            })
          );
        }

        // Deduplicate & upsert to app_bundles/users (filtering out any demo users)
        let list: UserAccount[] = [];
        if (bundleSnap?.exists()) {
          list = bundleSnap.data().data || [];
        }
        const userMap = new Map<string, UserAccount>();
        list.forEach(u => {
          if (u && u.email && !isDemoUser(u)) {
            userMap.set(u.email.trim().toLowerCase(), u);
          }
        });
        userMap.set(cleanEmail, { ...(userMap.get(cleanEmail) || {}), ...normalizedUser });
        const deduplicatedList = Array.from(userMap.values()).filter(u => !isDemoUser(u));

        writePromises.push(
          setDoc(bundleRef, {
            data: deduplicatedList,
            count: deduplicatedList.length,
            updatedAt: new Date().toISOString(),
          }, { merge: true }).catch(err => {
            if (isQuotaExceededError(err)) markQuotaExceeded(err);
          })
        );

        // Remove user from deleted_users if present
        if (delSnap?.exists()) {
          const ids: string[] = delSnap.data()?.ids || [];
          const keysToRemove = new Set([
            cleanEmail,
            cleanDocId(cleanEmail).toLowerCase(),
            cleanEmail.replace(/\./g, '_').toLowerCase(),
            normalizedUser.id?.toLowerCase(),
          ].filter(Boolean) as string[]);

          const filtered = ids.filter(id => !keysToRemove.has(id.toLowerCase()));
          if (filtered.length !== ids.length) {
            writePromises.push(
              setDoc(delDocRef, { ids: filtered, updatedAt: new Date().toISOString() }, { merge: true }).catch(err => {
                if (isQuotaExceededError(err)) markQuotaExceeded(err);
                return null;
              })
            );
          }
        }

        // Stage 2: Parallel flush writes
        await Promise.all(writePromises);
        return true;
      };

      // Safety timeout so UI / storage never hangs (local storage is already updated first)
      const timeoutPromise = new Promise<boolean>((resolve) =>
        setTimeout(() => {
          // Gracefully complete without disrupting active user session
          resolve(true);
        }, 20000)
      );

      return await Promise.race([syncOperation(), timeoutPromise]);
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      return false;
    }
  },

  // Sync Users list (strictly deduplicates, removes demo users, and updates bundle + user_accounts)
  async syncUsers(users: UserAccount[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const now = new Date().toISOString();
      const userMap = new Map<string, UserAccount>();
      users.forEach(u => {
        if (u && u.email && !isDemoUser(u)) {
          const cleanEmail = u.email.trim().toLowerCase();
          let status = u.status;
          if (status) {
            const s = status.toLowerCase();
            if (s === 'active') status = 'Active';
            else if (s.includes('pending')) status = 'Pending_Approval';
            else if (s === 'deactivated') status = 'Deactivated';
          } else {
            status = 'Active';
          }
          userMap.set(cleanEmail, { ...u, email: cleanEmail, status, updatedAt: now });
        }
      });
      const cleanUsers = Array.from(userMap.values());

      await setDoc(doc(db, 'app_bundles', 'users'), {
        data: cleanUsers,
        count: cleanUsers.length,
        updatedAt: now,
      });

      // Also persist individual documents in user_accounts collection
      for (const u of cleanUsers) {
        if (u && u.email) {
          const docKey = cleanDocId(u.email);
          setDoc(doc(db, 'user_accounts', docKey), u, { merge: true }).catch(err => {
            if (isQuotaExceededError(err)) markQuotaExceeded(err);
            return null;
          });
        }
      }

      return true;
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('syncUsers error:', error?.message);
      return false;
    }
  },

  // Delete User from Firestore (both bundle and legacy collections)
  async deleteUser(userId: string, email?: string, allUsers?: UserAccount[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const cleanEmail = email ? email.trim().toLowerCase() : '';
      const dotReplaced = cleanEmail ? cleanEmail.replace(/\./g, '_') : '';
      const docClean = cleanEmail ? cleanDocId(cleanEmail) : '';

      // 1. Delete from collections
      if (userId) {
        deleteDoc(doc(db, 'user_accounts', userId)).catch(() => null);
        deleteDoc(doc(db, 'user_accounts', cleanDocId(userId))).catch(() => null);
        deleteDoc(doc(db, 'users', userId)).catch(() => null);
      }
      if (cleanEmail) {
        deleteDoc(doc(db, 'user_accounts', cleanEmail)).catch(() => null);
        deleteDoc(doc(db, 'user_accounts', docClean)).catch(() => null);
        deleteDoc(doc(db, 'user_accounts', dotReplaced)).catch(() => null);
        deleteDoc(doc(db, 'users', cleanEmail)).catch(() => null);
      }

      // 2. Update deleted_users bundle
      const deletedUserKeys = [
        userId, 
        userId?.toLowerCase(),
        cleanEmail, 
        dotReplaced, 
        docClean
      ].filter(Boolean) as string[];

      if (deletedUserKeys.length > 0) {
        setDoc(
          doc(db, 'app_bundles', 'deleted_users'),
          { ids: arrayUnion(...deletedUserKeys), updatedAt: new Date().toISOString() },
          { merge: true }
        ).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        });
      }

      // 3. Update bundle with filtered list
      let usersToSave = allUsers;
      if (!usersToSave) {
        const snap = await getDoc(doc(db, 'app_bundles', 'users')).catch(() => null);
        if (snap?.exists()) {
          const existing: UserAccount[] = snap.data().data || [];
          usersToSave = existing.filter(u => 
            u.id !== userId && (!cleanEmail || u.email?.toLowerCase() !== cleanEmail)
          );
        }
      }
      if (usersToSave) {
        await this.syncUsers(usersToSave);
      }
      return true;
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('deleteUser error:', error?.message);
      return false;
    }
  },

  // Delete Employee (Admin action)
  async deleteEmployee(empNo: string, allEmployees?: Employee[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const cleanId = cleanDocId(empNo);
      const cleanEmpNo = empNo.trim().toUpperCase();

      const deleteOps = async (): Promise<boolean> => {
        // 1. Delete individual legacy document
        await deleteDoc(doc(db, 'employees', cleanId)).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        });

        // 2. Track deleted ID in cloud so stale legacy caches never resurrect
        try {
          const delRef = doc(db, 'app_bundles', 'deleted_employees');
          const delSnap = await getDoc(delRef).catch(() => null);
          const deletedEmpIds: string[] = delSnap?.exists() && Array.isArray(delSnap.data()?.ids) ? delSnap.data()?.ids : [];
          if (!deletedEmpIds.includes(cleanId) || !deletedEmpIds.includes(cleanEmpNo)) {
            const updatedIds = Array.from(new Set([...deletedEmpIds, cleanId, cleanEmpNo]));
            await setDoc(delRef, {
              ids: updatedIds,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          }
        } catch (delErr: any) {
          if (isQuotaExceededError(delErr)) markQuotaExceeded(delErr);
          console.warn('deleted_employees tracking warning:', delErr?.message);
        }

        // 3. Update app_bundles with filtered list
        let empsToSave = allEmployees;
        if (!empsToSave) {
          const snap = await getDoc(doc(db, 'app_bundles', 'employees')).catch(() => null);
          if (snap?.exists()) {
            const existing: Employee[] = snap.data().data || [];
            empsToSave = existing.filter(e => cleanDocId(e.empNo) !== cleanId && e.empNo.trim().toUpperCase() !== cleanEmpNo && !isDemoEmployee(e));
          }
        } else {
          empsToSave = empsToSave.filter(e => !isDemoEmployee(e));
        }
        if (empsToSave) {
          await this.syncEmployees(empsToSave);
        }
        return true;
      };

      const timeoutPromise = new Promise<boolean>((resolve) =>
        setTimeout(() => {
          console.warn('deleteEmployee firestore timeout fallback (25s)');
          resolve(true);
        }, 25000)
      );

      return await Promise.race([deleteOps(), timeoutPromise]);
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('deleteEmployee error:', error?.message);
      return false;
    }
  },

  // Fetch all collections from Cloud Firestore (Reads bundled documents first, falls back to legacy collections)
  async fetchAllFromCloud() {
    if (isFirestoreQuotaExceeded) {
      return {
        hasData: false,
        shiftCodes: [],
        employees: [],
        departments: [],
        shiftPlans: [],
        punches: [],
        otRecords: [],
        otherAllowances: [],
        users: [],
        manualOverrides: {}
      };
    }
    try {
      // 1. First attempt to read from high-efficiency app_bundles (with 35000ms safety timeout for high-capacity transfer)
      let bundleSnap = null;
      try {
        bundleSnap = await promiseWithTimeout(
          getDocs(collection(db, 'app_bundles')),
          35000,
          null
        );
      } catch (_err: any) {
        bundleSnap = null;
      }

      let employees: Employee[] = [];
      let shiftCodes: ShiftCode[] = [];
      let departments: Department[] = [];
      let shiftPlans: DailyShiftPlan[] = [];
      let legacyShiftPlans: DailyShiftPlan[] = [];
      let punches: BiometricRawPunch[] = [];
      let otRecords: OTRecord[] = [];
      let legacyOTRecords: OTRecord[] = [];
      let hasOTBundle = false;
      let hasShiftPlansBundle = false;
      let hasPunchesBundle = false;
      let hasOtherAllowancesBundle = false;
      let otherAllowances: OtherAllowance[] = [];
      let users: UserAccount[] = [];
      let manualOverrides: Record<string, Partial<TimeSheetRow>> = {};
      const deletedIds = new Set<string>();
      const deletedUserKeysSet = new Set<string>();
      const deletedDeptCodesSet = new Set<string>();

      let otManifestChunks: number | null = null;
      let otManifestTotal: number | null = null;
      const rawChunkedOTDocs: { index: number; data: any[] }[] = [];

      let shiftPlansManifestChunks: number | null = null;
      let shiftPlansManifestTotal: number | null = null;
      const rawChunkedPlanDocs: { index: number; data: any[] }[] = [];

      let punchesManifestChunks: number | null = null;
      let punchesManifestTotal: number | null = null;
      const rawChunkedPunchDocs: { index: number; data: any[] }[] = [];

      let foundBundles = false;

      if (bundleSnap && !bundleSnap.empty) {
        foundBundles = true;
        bundleSnap.forEach(d => {
          const id = d.id;
          const data = d.data();

          if (id === 'shift_codes' || id.startsWith('shift_codes_')) {
            if (Array.isArray(data.data)) {
              shiftCodes.push(...data.data);
            }
          } else if (id === 'employees' || id.startsWith('employees_')) {
            if (Array.isArray(data.data)) {
              employees.push(...data.data);
            }
          } else if (id === 'departments') {
            if (Array.isArray(data.data)) {
              departments.push(...data.data);
            }
          } else if (id === 'punches_manifest') {
            hasPunchesBundle = true;
            punchesManifestChunks = typeof data.chunks === 'number' ? data.chunks : null;
            punchesManifestTotal = typeof data.totalPunches === 'number' ? data.totalPunches : null;
          } else if (id.startsWith('punches_') && id !== 'punches_manifest') {
            hasPunchesBundle = true;
            const idx = parseInt(id.replace('punches_', ''), 10);
            rawChunkedPunchDocs.push({
              index: isNaN(idx) ? 0 : idx,
              data: Array.isArray(data.data) ? data.data : [],
            });
          } else if (id === 'punches') {
            hasPunchesBundle = true;
            if (Array.isArray(data.data)) {
              const valid = data.data.filter((p: any) => p && (!p.date || p.date >= '2025-01-01'));
              punches.push(...valid);
            }
          } else if (id === 'shift_plans_manifest') {
            hasShiftPlansBundle = true;
            shiftPlansManifestChunks = typeof data.chunks === 'number' ? data.chunks : null;
            shiftPlansManifestTotal = typeof data.totalPlans === 'number' ? data.totalPlans : null;
          } else if (id.startsWith('shift_plans_') && id !== 'shift_plans_manifest') {
            hasShiftPlansBundle = true;
            const idx = parseInt(id.replace('shift_plans_', ''), 10);
            rawChunkedPlanDocs.push({
              index: isNaN(idx) ? 0 : idx,
              data: Array.isArray(data.data) ? data.data : [],
            });
          } else if (id === 'shift_plans') {
            hasShiftPlansBundle = true;
            if (Array.isArray(data.data)) {
              const valid = data.data.filter((p: any) => p && (!p.date || p.date >= '2025-01-01'));
              legacyShiftPlans.push(...valid);
            }
          } else if (id === 'ot_records_manifest') {
            hasOTBundle = true;
            otManifestChunks = typeof data.chunks === 'number' ? data.chunks : null;
            otManifestTotal = typeof data.totalRecords === 'number' ? data.totalRecords : null;
          } else if (id.startsWith('ot_records_') && id !== 'ot_records_manifest') {
            hasOTBundle = true;
            const idx = parseInt(id.replace('ot_records_', ''), 10);
            rawChunkedOTDocs.push({
              index: isNaN(idx) ? 0 : idx,
              data: Array.isArray(data.data) ? data.data : [],
            });
          } else if (id === 'ot_records') {
            hasOTBundle = true;
            if (Array.isArray(data.data)) {
              const valid = data.data.filter((o: any) => o && (!o.date || o.date >= '2025-01-01'));
              legacyOTRecords.push(...valid);
            }
          } else if (id === 'other_allowances') {
            hasOtherAllowancesBundle = true;
            if (Array.isArray(data.data)) {
              const valid = data.data.filter((a: any) => a && (!a.monthYear || a.monthYear >= '2025-01'));
              otherAllowances.push(...valid);
            }
          } else if (id === 'users') {
            if (Array.isArray(data.data)) {
              users.push(...data.data);
            }
          } else if (id === 'manual_overrides') {
            if (data.data && typeof data.data === 'object') {
              const validOverrides: Record<string, any> = {};
              Object.entries(data.data).forEach(([k, v]) => {
                const parts = k.split('_');
                const dateStr = parts[parts.length - 1];
                if (!dateStr || dateStr >= '2025-01-01') {
                  validOverrides[k] = v;
                }
              });
              manualOverrides = { ...manualOverrides, ...validOverrides };
            }
          } else if (id === 'deleted_employees') {
            if (Array.isArray(data.ids)) {
              data.ids.forEach((did: string) => {
                if (did) deletedIds.add(String(did).trim().toUpperCase());
              });
            }
          } else if (id === 'deleted_users') {
            if (Array.isArray(data.ids)) {
              data.ids.forEach((duid: string) => {
                if (duid) deletedUserKeysSet.add(String(duid).trim().toLowerCase());
              });
            }
          } else if (id === 'deleted_departments') {
            if (Array.isArray(data.ids)) {
              data.ids.forEach((ddid: string) => {
                if (ddid) deletedDeptCodesSet.add(String(ddid).trim().toUpperCase());
              });
            }
          }
        });
      }

      // Reconstruct Punches: Merge all available chunks with deduplication so zero records are lost
      if (punchesManifestTotal === 0 || punchesManifestChunks === 0) {
        punches = [];
      } else if (rawChunkedPunchDocs.length > 0 || punches.length > 0) {
        const punchMap = new Map<string, BiometricRawPunch>();
        // Add any legacy punches already collected
        punches.forEach(p => {
          if (!p || !p.date || !p.time || p.date < '2024-01-01') return;
          const k = `${(p.empIdentifier || '').trim().toLowerCase()}_${p.date}_${p.time}_${p.type || ''}`;
          punchMap.set(k, p);
        });
        // Merge all chunked docs
        rawChunkedPunchDocs.forEach(c => {
          (c.data || []).forEach((p: any) => {
            if (!p || !p.date || !p.time || p.date < '2024-01-01') return;
            const k = `${(p.empIdentifier || '').trim().toLowerCase()}_${p.date}_${p.time}_${p.type || ''}`;
            if (!punchMap.has(k)) punchMap.set(k, p);
          });
        });
        punches = Array.from(punchMap.values()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      }

      // Reconstruct Shift Plans
      if (shiftPlansManifestTotal === 0 || shiftPlansManifestChunks === 0) {
        shiftPlans = [];
      } else {
        const validPlanDocs = shiftPlansManifestChunks !== null
          ? rawChunkedPlanDocs.filter(c => c.index < shiftPlansManifestChunks)
          : rawChunkedPlanDocs;
        validPlanDocs.sort((a, b) => a.index - b.index);
        const combinedPlans: DailyShiftPlan[] = [];
        validPlanDocs.forEach(c => {
          const valid = c.data.filter((p: any) => p && (!p.date || p.date >= '2025-01-01'));
          combinedPlans.push(...valid);
        });
        if (combinedPlans.length > 0) {
          shiftPlans = combinedPlans;
        } else {
          shiftPlans = legacyShiftPlans;
        }
      }

      // Reconstruct OT Records
      if (otManifestTotal === 0 || otManifestChunks === 0) {
        otRecords = [];
      } else {
        const validOTDocs = otManifestChunks !== null
          ? rawChunkedOTDocs.filter(c => c.index < otManifestChunks)
          : rawChunkedOTDocs;
        validOTDocs.sort((a, b) => a.index - b.index);
        const combinedOT: OTRecord[] = [];
        validOTDocs.forEach(c => {
          const valid = c.data.filter((o: any) => o && (!o.date || o.date >= '2025-01-01'));
          combinedOT.push(...valid);
        });
        if (combinedOT.length > 0) {
          otRecords = combinedOT;
        } else {
          otRecords = legacyOTRecords;
        }
      }

      // 2. If bundles did not have specific datasets, fallback to legacy individual collections
      const needLegacyShiftCodes = shiftCodes.length === 0;
      const needLegacyEmployees = employees.length === 0;
      const needLegacyDepartments = departments.length === 0;
      const needLegacyPunches = punches.length === 0 && !hasPunchesBundle;
      const needLegacyPlans = shiftPlans.length === 0 && !hasShiftPlansBundle;

      const legacyEmployees: Employee[] = [];
      const legacyShiftCodes: ShiftCode[] = [];
      const legacyDepartments: Department[] = [];

      try {
        const [
          empSnap,
          scSnap,
          planSnap,
          punchSnap,
          otSnap,
          allwSnap,
          userSnap,
          ovSnap,
          deptSnap
        ] = await Promise.all([
          needLegacyEmployees ? promiseWithTimeout(getDocs(collection(db, 'employees')), 3000, null).catch(() => null) : null,
          needLegacyShiftCodes ? promiseWithTimeout(getDocs(collection(db, 'shift_codes')), 3000, null).catch(() => null) : null,
          needLegacyPlans ? promiseWithTimeout(getDocs(collection(db, 'shift_plans')), 3500, null).catch(() => null) : null,
          needLegacyPunches ? promiseWithTimeout(getDocs(collection(db, 'raw_punches')), 3000, null).catch(() => null) : null,
          !hasOTBundle && otRecords.length === 0 ? promiseWithTimeout(getDocs(collection(db, 'ot_records')), 3000, null).catch(() => null) : null,
          !hasOtherAllowancesBundle && otherAllowances.length === 0 ? promiseWithTimeout(getDocs(collection(db, 'other_allowances')), 3000, null).catch(() => null) : null,
          promiseWithTimeout(getDocs(collection(db, 'user_accounts')), 3000, null).catch(() => null), // ALWAYS fetch user_accounts so all real accounts are merged
          Object.keys(manualOverrides).length === 0 ? promiseWithTimeout(getDocs(collection(db, 'manual_overrides')), 3000, null).catch(() => null) : null,
          needLegacyDepartments ? promiseWithTimeout(getDocs(collection(db, 'departments')), 3000, null).catch(() => null) : null,
        ]);

        if (empSnap) empSnap.forEach(d => legacyEmployees.push(d.data() as Employee));
        if (scSnap) scSnap.forEach(d => legacyShiftCodes.push(d.data() as ShiftCode));
        if (deptSnap) deptSnap.forEach(d => legacyDepartments.push(d.data() as Department));
        if (planSnap) planSnap.forEach(d => shiftPlans.push(d.data() as DailyShiftPlan));
        if (punchSnap) punchSnap.forEach(d => punches.push(d.data() as BiometricRawPunch));
        if (otSnap) otSnap.forEach(d => otRecords.push(d.data() as OTRecord));
        if (allwSnap) allwSnap.forEach(d => otherAllowances.push(d.data() as OtherAllowance));
        if (userSnap) {
          userSnap.forEach(d => {
            const uData = d.data() as UserAccount;
            if (uData && (uData.email || uData.id)) {
              users.push(uData);
            }
          });
        }
        if (ovSnap) {
          ovSnap.forEach(d => {
            const docData = d.data();
            if (docData.key && docData.data) {
              manualOverrides[docData.key] = docData.data;
            }
          });
        }
      } catch (_legacyErr) {
        // Silently continue if legacy collections do not exist
      }

      // Deduplicate shift codes (key: code_department) - Bundles override legacy
      const scMap = new Map<string, ShiftCode>();
      legacyShiftCodes.forEach(sc => {
        if (sc && sc.code) {
          scMap.set(`${sc.code.toUpperCase()}_${(sc.department || 'ALL').toUpperCase()}`, sc);
        }
      });
      shiftCodes.forEach(sc => {
        if (sc && sc.code) {
          scMap.set(`${sc.code.toUpperCase()}_${(sc.department || 'ALL').toUpperCase()}`, sc);
        }
      });
      const cleanShiftCodes = Array.from(scMap.values());

      // Deduplicate employees and canonicalize numeric IDs & departments (TRW/TRD -> TRW/TRL)
      const rawCandidates = employees.length > 0 ? employees : legacyEmployees;
      const filteredCandidates = rawCandidates.filter(emp => {
        if (!emp || !emp.empNo || isDemoEmployee(emp)) return false;
        const id = cleanDocId(emp.empNo).toUpperCase();
        const rawNo = emp.empNo.trim().toUpperCase();
        const gid = (emp.gid || '').trim().toUpperCase();
        return !deletedIds.has(id) && !deletedIds.has(rawNo) && (!gid || !deletedIds.has(gid));
      });
      const cleanEmployees = deduplicateAndCanonicalizeEmployees(filteredCandidates);

      // Deduplicate and canonicalize shift plans against employee master
      if (shiftPlans.length > 0) {
        shiftPlans = deduplicateAndCanonicalizeShiftPlans(shiftPlans, cleanEmployees);
      }

      // Deduplicate users (key: email) - Merge bundle and individual documents, normalize status, filter out deleted users
      const uMap = new Map<string, UserAccount>();
      users.forEach(u => {
        if (u && u.email) {
          const cleanEmail = u.email.trim().toLowerCase();
          let status = u.status;
          if (status) {
            const s = status.toLowerCase();
            if (s === 'active') status = 'Active';
            else if (s.includes('pending')) status = 'Pending_Approval';
            else if (s === 'deactivated') status = 'Deactivated';
          } else {
            status = 'Active';
          }

          const normalizedUser: UserAccount = {
            ...u,
            email: cleanEmail,
            status,
          };

          const existing = uMap.get(cleanEmail);
          if (!existing) {
            uMap.set(cleanEmail, normalizedUser);
          } else {
            // Compare updatedAt if available, otherwise take the latest incoming
            const existingTime = existing.updatedAt || existing.lastLogin || existing.createdAt || '';
            const incomingTime = normalizedUser.updatedAt || normalizedUser.lastLogin || normalizedUser.createdAt || '';
            const isIncomingNewer = incomingTime >= existingTime;

            const primary = isIncomingNewer ? normalizedUser : existing;
            const secondary = isIncomingNewer ? existing : normalizedUser;

            const isAlreadyActive = existing.status === 'Active' || normalizedUser.status === 'Active';
            const resolvedStatus = cleanEmail === 'smo.cs.th.bts@gmail.com' 
              ? 'Active' 
              : (isAlreadyActive ? 'Active' : (primary.status || secondary.status || 'Active'));

            uMap.set(cleanEmail, {
              ...secondary,
              ...primary,
              // Admin role protection for default admin
              role: cleanEmail === 'smo.cs.th.bts@gmail.com' ? 'Admin' : (primary.role || secondary.role),
              department: (primary.department && primary.department !== 'PENDING') ? primary.department : (secondary.department || primary.department),
              status: resolvedStatus,
              photoURL: primary.photoURL || secondary.photoURL,
            });
          }
        }
      });

      const cleanUsers = Array.from(uMap.values()).filter(u => {
        if (!u || !u.email) return false;
        if (isDemoUser(u)) return false;
        const cleanEmail = u.email.trim().toLowerCase();
        const idLower = (u.id || '').toLowerCase();
        const docClean = cleanDocId(cleanEmail).toLowerCase();
        const dotReplaced = cleanEmail.replace(/\./g, '_').toLowerCase();

        // Always keep authenticated Google accounts, pending approval users, and active users
        if (u.isGoogleAccount || u.status === 'Active' || u.status === 'Pending_Approval' || cleanEmail.endsWith('@siemens.com') || cleanEmail.endsWith('@gmail.com')) {
          return true;
        }

        if (deletedUserKeysSet.has(cleanEmail)) return false;
        if (deletedUserKeysSet.has(docClean)) return false;
        if (deletedUserKeysSet.has(dotReplaced)) return false;
        if (idLower && deletedUserKeysSet.has(idLower)) return false;
        return true;
      });

      // The real active departments used by the company (including MRL/MLR)
      const REAL_SYSTEM_DEPT_CODES = new Set([
        'ADM/CMM', 'BES/PSY', 'BES/PSY2', 'DWE', 'GM', 'MCC', 'MLR', 'MRL', 'OHL', 'RST', 'RST2', 'STR', 'TEL', 'TRW/TRD', 'TRW/TRL'
      ]);

      // Departments with active employees are protected from being hidden
      const assignedDeptCodes = new Set(cleanEmployees.map(e => (e.department || '').trim().toUpperCase()).filter(Boolean));

      const deptMap = new Map<string, Department>();
      // 1. Seed with authentic active BTS departments
      INITIAL_DEPARTMENTS.forEach(d => {
        if (d && d.code) {
          const upper = d.code.trim().toUpperCase();
          if (!deletedDeptCodesSet.has(upper)) {
            deptMap.set(upper, { code: upper, name: resolveDepartmentFullName(upper, d.name) });
          }
        }
      });

      // 2. Overlay from cloud departments bundle (smart-merge: never downgrade full names)
      departments.forEach(d => {
        if (d && d.code) {
          const upper = d.code.trim().toUpperCase();
          if (deletedDeptCodesSet.has(upper) || isDemoDepartment(upper)) {
            deleteDoc(doc(db, 'departments', upper)).catch(() => null);
            deletedDeptCodesSet.add(upper);
            return;
          }
          if (REAL_SYSTEM_DEPT_CODES.has(upper)) {
            const existing = deptMap.get(upper);
            const resolvedName = resolveDepartmentFullName(upper, d.name, existing?.name);
            deptMap.set(upper, {
              ...d,
              code: upper,
              name: resolvedName,
              updatedAt: d.updatedAt || existing?.updatedAt,
            });
          } else {
            // Delete unused/demo doc from cloud collection
            deleteDoc(doc(db, 'departments', upper)).catch(() => null);
            deletedDeptCodesSet.add(upper);
          }
        }
      });

      // 3. Overlay from legacy collection (only real authentic active departments)
      legacyDepartments.forEach(d => {
        if (d && d.code) {
          const upper = d.code.trim().toUpperCase();
          if (deletedDeptCodesSet.has(upper) || isDemoDepartment(upper)) {
            deleteDoc(doc(db, 'departments', upper)).catch(() => null);
            deletedDeptCodesSet.add(upper);
            return;
          }
          if (REAL_SYSTEM_DEPT_CODES.has(upper)) {
            const existing = deptMap.get(upper);
            const resolvedName = resolveDepartmentFullName(upper, d.name, existing?.name);
            deptMap.set(upper, {
              ...d,
              code: upper,
              name: resolvedName,
              updatedAt: d.updatedAt || existing?.updatedAt,
            });
          } else {
            // Unused/demo legacy department: delete from cloud collection
            deleteDoc(doc(db, 'departments', upper)).catch(() => null);
            deletedDeptCodesSet.add(upper);
          }
        }
      });

      // Guarantee OHL (Overhaul) is present if not deleted
      if (!deletedDeptCodesSet.has('OHL') && !deptMap.has('OHL')) {
        deptMap.set('OHL', { code: 'OHL', name: 'Overhaul' });
      }

      // Hide TRW/TRD, TRD, OVH, and MRL from displayed departments list
      deptMap.delete('TRW/TRD');
      deptMap.delete('TRD');
      deptMap.delete('OVH');
      deptMap.delete('MRL');

      const cleanDepartments = Array.from(deptMap.values())
        .filter(d => d.code !== 'TRW/TRD' && d.code !== 'TRD' && d.code !== 'OVH' && d.code !== 'MRL')
        .map(d => ({
          ...d,
          name: resolveDepartmentFullName(d.code, d.name)
        }))
        .sort((a, b) => a.code.localeCompare(b.code));

      // Filter and deduplicate shift plans (keeping latest updatedAt timestamp, >= 2025-01-01)
      const cleanIdentifier = (v: any) => String(v || '').trim();
      const empCanonicalMap = new Map<string, string>();
      cleanEmployees.forEach(e => {
        const canonicalNo = cleanIdentifier(e.empNo).toUpperCase();
        const canonicalGid = cleanIdentifier(e.gid).toUpperCase();
        const targetId = canonicalNo || canonicalGid;

        if (canonicalNo) empCanonicalMap.set(canonicalNo, targetId);
        if (canonicalGid) empCanonicalMap.set(canonicalGid, targetId);
        if (e.empCode) empCanonicalMap.set(cleanIdentifier(e.empCode).toUpperCase(), targetId);
        const digits = canonicalNo.replace(/\D/g, '').replace(/^0+/, '');
        if (digits) {
          if (!empCanonicalMap.has(digits)) empCanonicalMap.set(digits, targetId);
          if (!empCanonicalMap.has(digits.padStart(4, '0'))) empCanonicalMap.set(digits.padStart(4, '0'), targetId);
          if (!empCanonicalMap.has(`1000${digits.padStart(4, '0')}`)) empCanonicalMap.set(`1000${digits.padStart(4, '0')}`, targetId);
        }
      });

      // Sort plans with oldest first so that newer updatedAt entries take precedence
      const sortedShiftPlans = [...shiftPlans].sort((a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        const vA = isNaN(timeA) ? 0 : timeA;
        const vB = isNaN(timeB) ? 0 : timeB;
        return vA - vB;
      });

      const planMap = new Map<string, DailyShiftPlan>();
      sortedShiftPlans.forEach(p => {
        if (p && p.date && p.date >= '2025-01-01' && (p.empNo || p.gid)) {
          const rawEmp = cleanIdentifier(p.empNo).toUpperCase();
          const rawGid = cleanIdentifier(p.gid).toUpperCase();
          const rawDigits = rawEmp.replace(/\D/g, '').replace(/^0+/, '');

          const canonicalId = (
            empCanonicalMap.get(rawEmp) ||
            empCanonicalMap.get(rawGid) ||
            empCanonicalMap.get(rawDigits) ||
            rawEmp ||
            rawGid ||
            rawDigits
          );
          const key = `${canonicalId}_${p.date}`;

          const existing = planMap.get(key);
          if (!existing) {
            planMap.set(key, p);
          } else {
            const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
            const newTime = p.updatedAt ? new Date(p.updatedAt).getTime() : 0;
            const validExisting = isNaN(existingTime) ? 0 : existingTime;
            const validNew = isNaN(newTime) ? 0 : newTime;

            if (validNew >= validExisting) {
              planMap.set(key, {
                ...existing,
                ...p,
                empNo: p.empNo || existing.empNo,
                gid: p.gid || existing.gid,
                shiftCode: p.shiftCode || existing.shiftCode,
                updatedAt: p.updatedAt || existing.updatedAt,
              });
            }
          }
        }
      });
      const cleanShiftPlans = Array.from(planMap.values());

      // Filter and deduplicate biometric punches (>= 2025-01-01)
      const punchMap = new Map<string, BiometricRawPunch>();
      punches.forEach(p => {
        if (!p || !p.date || !p.time || p.date < '2025-01-01') return;
        const key = `${(p.empIdentifier || '').trim().toLowerCase()}_${p.date}_${p.time}_${p.type || ''}`;
        if (!punchMap.has(key)) punchMap.set(key, p);
      });
      const cleanPunches = Array.from(punchMap.values());

      // Filter and deduplicate OT records (>= 2025-01-01, key: id or emp_targetDate_rate_startTime)
      const otMap = new Map<string, OTRecord>();
      otRecords.forEach(o => {
        if (!o) return;
        const targetD = o.retroactiveTargetDate || o.date;
        if (targetD && targetD < '2025-01-01') return;
        const key = o.id || `${(o.empNo || o.gid || '').trim().toUpperCase()}_${targetD}_${o.rate}_${o.startTime || ''}`;
        if (!otMap.has(key)) {
          otMap.set(key, o);
        }
      });
      const cleanOT = Array.from(otMap.values());
      const cleanAllowances = otherAllowances.filter(a => !a.monthYear || a.monthYear >= '2025-01');

      const hasData = (
        cleanEmployees.length > 0 ||
        cleanShiftCodes.length > 0 ||
        cleanShiftPlans.length > 0 ||
        cleanPunches.length > 0 ||
        cleanOT.length > 0 ||
        cleanAllowances.length > 0 ||
        cleanUsers.length > 0 ||
        cleanDepartments.length > 0
      );

      return {
        hasData,
        hasOTBundle,
        hasShiftPlansBundle,
        hasPunchesBundle,
        employees: cleanEmployees,
        shiftCodes: cleanShiftCodes,
        departments: cleanDepartments,
        deletedDepartments: Array.from(deletedDeptCodesSet),
        shiftPlans: cleanShiftPlans,
        punches: cleanPunches,
        otRecords: cleanOT,
        otherAllowances: cleanAllowances,
        users: cleanUsers,
        manualOverrides,
      };
    } catch (error) {
      console.warn('fetchAllFromCloud caught error:', error);
      return null;
    }
  },

  // Save single shift plan
  async saveShiftPlan(plan: DailyShiftPlan, allPlans?: DailyShiftPlan[]) {
    return await this.saveShiftPlanDirect(plan, allPlans);
  },

  // Save single manual override
  async saveManualOverride(key: string, data: Partial<TimeSheetRow>) {
    if (isFirestoreQuotaExceeded) return;
    try {
      await setDoc(doc(db, 'manual_overrides', cleanDocId(key)), { key, data }, { merge: true });
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('saveManualOverride error:', error?.message);
    }
  },

  // Save employee
  async saveEmployee(emp: Employee, allEmployees?: Employee[]) {
    if (isFirestoreQuotaExceeded) return;
    try {
      if (allEmployees) {
        return await this.syncEmployees(allEmployees);
      }
      // Direct bundle-first update (avoids individual collection write)
      try {
        const bundleRef = doc(db, 'app_bundles', 'employees');
        const bundleSnap = await getDoc(bundleRef).catch(() => null);
        if (bundleSnap?.exists()) {
          const raw = bundleSnap.data();
          const list: Employee[] = Array.isArray(raw?.data) ? raw.data : [];
          const idx = list.findIndex(e => e.empNo.trim().toUpperCase() === emp.empNo.trim().toUpperCase());
          if (idx >= 0) {
            list[idx] = emp;
          } else {
            list.push(emp);
          }
          await setDoc(bundleRef, {
            data: list,
            count: list.length,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
      } catch (bundleErr: any) {
        if (isQuotaExceededError(bundleErr)) markQuotaExceeded(bundleErr);
        console.warn('Bundle single employee update warning:', bundleErr?.message);
      }
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('saveEmployee error:', error?.message);
    }
  },

  // Clear specific collections from Cloud Firestore
  async clearCloudCollections(collectionNames: string[]) {
    if (isFirestoreQuotaExceeded) return false;
    try {
      for (const colName of collectionNames) {
        const snap = await getDocs(collection(db, colName)).catch(() => null);
        if (!snap || snap.empty) continue;
        
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i += 400) {
          const chunk = docs.slice(i, i + 400);
          const batch = writeBatch(db);
          chunk.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      return true;
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.error('Error clearing cloud collections:', error?.message);
      return false;
    }
  },

  // Clear only transaction/operational data
  async clearCloudTransactions() {
    if (isFirestoreQuotaExceeded) return false;
    return await this.clearCloudCollections([
      'shift_plans',
      'raw_punches',
      'ot_records',
      'other_allowances',
      'manual_overrides'
    ]);
  },

  // Purge demo user accounts from Cloud Firestore directly
  async purgeDemoUsersFromCloud(): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      if (typeof window !== 'undefined' && localStorage.getItem('demo_users_purged_cloud') === 'true') {
        return true;
      }
      const demoKeys = [
        'usr-user-1', 'usr-user-2', 'usr-rs-lead', 'usr-gm-lead', 'usr-demo'
      ];

      // 1. Delete individual legacy documents in user_accounts
      for (const k of demoKeys) {
        deleteDoc(doc(db, 'user_accounts', cleanDocId(k))).catch(() => null);
        deleteDoc(doc(db, 'user_accounts', k)).catch(() => null);
        deleteDoc(doc(db, 'users', k)).catch(() => null);
      }

      // 2. Track in deleted_users bundle so they are permanently ignored
      const delDocRef = doc(db, 'app_bundles', 'deleted_users');
      setDoc(delDocRef, {
        ids: arrayUnion(...demoKeys),
        updatedAt: new Date().toISOString(),
      }, { merge: true }).catch(err => {
        if (isQuotaExceededError(err)) markQuotaExceeded(err);
      });

      // 3. Clean app_bundles/users
      const userBundleRef = doc(db, 'app_bundles', 'users');
      const snap = await getDoc(userBundleRef).catch(() => null);
      if (snap?.exists()) {
        const existing: UserAccount[] = snap.data().data || [];
        const clean = existing.filter(u => !isDemoUser(u));
        await setDoc(userBundleRef, {
          data: clean,
          count: clean.length,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('demo_users_purged_cloud', 'true');
        }
      } catch {}

      return true;
    } catch (e: any) {
      if (isQuotaExceededError(e)) markQuotaExceeded(e);
      console.warn('purgeDemoUsersFromCloud error:', e?.message);
      return false;
    }
  },

  // Purge all demo dataset (demo shift codes, demo departments, demo plans, and reassign demo employees)
  async purgeAllDemoDataset(): Promise<{ success: boolean; message: string }> {
    if (isFirestoreQuotaExceeded) {
      return { success: false, message: 'ระบบอยู่ในโหมด Local (โควต้า Cloud เต็ม) — ข้อมูลถูกบันทึกในเครื่องเรียบร้อย' };
    }
    try {
      // 1. Shift codes
      const scSnap = await getDoc(doc(db, 'app_bundles', 'shift_codes')).catch(() => null);
      if (scSnap?.exists()) {
        const existing: ShiftCode[] = scSnap.data().data || [];
        const clean = existing.filter(sc => !isDemoShiftCode(sc.code, sc.department));
        await this.syncShiftCodes(clean).catch(() => null);
      }

      // 2. Departments: ensure all authentic standard departments are kept & demo departments are eradicated
      const deptSnap = await getDoc(doc(db, 'app_bundles', 'departments')).catch(() => null);
      const existingDepts: Department[] = deptSnap?.exists() && Array.isArray(deptSnap.data().data) ? deptSnap.data().data : [];
      const deptMap = new Map<string, Department>();
      INITIAL_DEPARTMENTS.forEach(d => {
        const upper = d.code.toUpperCase();
        deptMap.set(upper, { code: upper, name: resolveDepartmentFullName(upper, d.name) });
      });
      existingDepts.forEach(d => { 
        if (d && d.code && !isDemoDepartment(d.code)) {
          const upper = d.code.toUpperCase();
          const existing = deptMap.get(upper);
          const resolvedName = resolveDepartmentFullName(upper, d.name, existing?.name);
          deptMap.set(upper, { ...d, code: upper, name: resolvedName, updatedAt: d.updatedAt || existing?.updatedAt }); 
        }
      });
      const cleanDepts = Array.from(deptMap.values()).sort((a, b) => a.code.localeCompare(b.code));
      await this.syncDepartments(cleanDepts).catch(() => null);

      // Permanently remove demo department individual docs from Firestore
      const demoDeptDeletes = DEMO_DEPARTMENT_CODES.map(c => deleteDoc(doc(db, 'departments', c)).catch(() => null));
      await Promise.all(demoDeptDeletes);

      // Add to deleted_departments bundle so clients never re-adopt them
      const delDeptRef = doc(db, 'app_bundles', 'deleted_departments');
      await setDoc(delDeptRef, {
        data: DEMO_DEPARTMENT_CODES,
        updatedAt: new Date().toISOString(),
      }, { merge: true }).catch(() => null);

      // 3. Employees (filter demo employees completely and sanitize departments)
      const empSnap = await getDoc(doc(db, 'app_bundles', 'employees')).catch(() => null);
      if (empSnap?.exists()) {
        const existing: Employee[] = empSnap.data().data || [];
        const clean = existing.filter(e => !isDemoEmployee(e)).map(sanitizeEmployeeDepartment);
        await this.syncEmployees(clean).catch(() => null);
      }
      // Purge known demo employee individual docs
      await Promise.all([
        deleteDoc(doc(db, 'employees', '0315')).catch(() => null),
        deleteDoc(doc(db, 'employees', 'Z00315TH')).catch(() => null),
        deleteDoc(doc(db, 'employees', 'doc_0315')).catch(() => null),
        deleteDoc(doc(db, 'employees', 'doc_Z00315TH')).catch(() => null),
        deleteDoc(doc(db, 'employees', '10000315')).catch(() => null),
      ]);

      // 4. Shift plans (clean demo plans from bundle)
      const planSnap = await getDoc(doc(db, 'app_bundles', 'shift_plans_0')).catch(() => null);
      if (planSnap?.exists()) {
        const existing: DailyShiftPlan[] = planSnap.data().data || [];
        const clean = existing.filter(p => !isDemoShiftCode(p.shiftCode, p.department));
        await setDoc(doc(db, 'app_bundles', 'shift_plans_0'), {
          data: clean,
          count: clean.length,
          updatedAt: new Date().toISOString(),
        }, { merge: true }).catch(() => null);
      }

      // 5. Demo user accounts purge
      await this.purgeDemoUsersFromCloud().catch(() => null);

      // 6. Clean operational collections
      await this.clearCloudTransactions().catch(() => null);

      return { success: true, message: 'ล้างข้อมูล Demo และปรับปรุงฐานข้อมูลเรียบร้อยแล้ว' };
    } catch (err: any) {
      if (isQuotaExceededError(err)) markQuotaExceeded(err);
      console.warn('purgeAllDemoDataset cloud error:', err?.message);
      return { success: false, message: err?.message || 'บันทึกในเครื่องเรียบร้อย (คลาวด์จะซิงค์เมื่อโควต้าพร้อม)' };
    }
  },

  // Real-time listener across Develop and Production
  // Low-quota bundle-only real-time listener (Consumes only ~1 read when bundle changes, instead of thousands of reads)
  subscribeToCloudChanges(onUpdate: (source: string, data?: any) => void): () => void {
    let isUnmounted = false;
    let unsubBundles: (() => void) | null = null;
    let isFirstBundles = true;
    let reconnectTimer: any = null;

    const setupListeners = () => {
      if (isUnmounted || isFirestoreQuotaExceeded) return;
      try {
        if (unsubBundles) { unsubBundles(); unsubBundles = null; }

        unsubBundles = onSnapshot(collection(db, 'app_bundles'), (snap) => {
          if (isFirstBundles) {
            isFirstBundles = false;
            return;
          }
          onUpdate('app_bundles');
        }, err => {
          if (isFirestoreInternalAssertion(err)) return;
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        });
      } catch (_e) {
        // Suppress listener setup notice
      }
    };

    setupListeners();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { if (unsubBundles) unsubBundles(); } catch {}
    };
  },

  // Real-time listener specifically for User Accounts via user bundle
  subscribeToUserChanges(onUpdate: (users?: UserAccount[]) => void): () => void {
    if (isFirestoreQuotaExceeded) return () => {};
    try {
      const unsub = onSnapshot(doc(db, 'app_bundles', 'users'), (snap) => {
        if (snap.exists()) {
          const bundleData = snap.data();
          const users = (bundleData?.data || []) as UserAccount[];
          onUpdate(users);
        } else {
          onUpdate();
        }
      }, err => {
        if (isFirestoreInternalAssertion(err)) return;
        if (isQuotaExceededError(err)) markQuotaExceeded(err);
      });

      return () => {
        try { unsub(); } catch {}
      };
    } catch {
      return () => {};
    }
  },

  // Real-time listener for the currently active user account (Role, Status, Department)
  subscribeToCurrentUser(email: string, onUpdate: (user: UserAccount | null) => void): () => void {
    if (!email || isFirestoreQuotaExceeded) return () => {};
    try {
      const docKey = cleanDocId(email);
      const unsub = onSnapshot(doc(db, 'user_accounts', docKey), (snap) => {
        if (snap.exists()) {
          onUpdate(snap.data() as UserAccount);
        } else {
          onUpdate(null);
        }
      }, err => {
        if (isFirestoreInternalAssertion(err)) return;
        if (isQuotaExceededError(err)) markQuotaExceeded(err);
      });
      return () => {
        try { unsub(); } catch {}
      };
    } catch {
      return () => {};
    }
  }
};

export const subscribeToCloudChanges = firestoreSync.subscribeToCloudChanges;
export const subscribeToUserChanges = firestoreSync.subscribeToUserChanges;
export const subscribeToCurrentUser = firestoreSync.subscribeToCurrentUser;

