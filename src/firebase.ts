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

// Test connection on boot (with 3-second timeout so it never hangs)
export async function testFirestoreConnection(): Promise<boolean> {
  if (isFirestoreQuotaExceeded) {
    return false; // In local persistence mode when quota is reached
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

    const result = await promiseWithTimeout(checkPromise, 3000, false);
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

// Authentic BTS departments (RS=Rolling Stock, SIG=Signaling, STN=Station, GM, etc. are REAL departments)
export const DEMO_DEPARTMENT_CODES: string[] = [];

export function isDemoDepartment(_dept: string): boolean {
  return false;
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

export function isDemoShiftCode(_code: string, _dept?: string): boolean {
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

// Preserve original employee department without alterations
export function sanitizeEmployeeDepartment(emp: Employee): Employee {
  return emp;
}

// Ensure employee object has no undefined fields (which would cause Firestore writes to crash)
export function cleanEmployeeForFirestore(emp: Employee, defaultTime?: string): Employee {
  const baseTime = defaultTime || '1970-01-01T00:00:00.000Z';
  const clean: any = {
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
    updatedAt: emp.updatedAt || baseTime,
  };
  if (emp.empCode && String(emp.empCode).trim()) {
    clean.empCode = String(emp.empCode).trim();
  }
  if (emp.id && String(emp.id).trim()) {
    clean.id = String(emp.id).trim();
  }
  return clean as Employee;
}

// Chunk helper for large arrays
function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
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
      promises.push(
        setDoc(doc(db, 'app_bundles', 'shift_codes'), {
          data: data.shiftCodes,
          count: data.shiftCodes.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
          console.warn('Cloud sync shift_codes error:', err?.message);
        })
      );

      // 2. Employees bundle (1 write instead of 400+ writes)
      const cleanEmps = (data.employees || []).map(e => cleanEmployeeForFirestore(e, now));
      promises.push(
        setDoc(doc(db, 'app_bundles', 'employees'), {
          data: cleanEmps,
          count: cleanEmps.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
          console.warn('Cloud sync employees error:', err?.message);
        })
      );

      // 3. Departments bundle (1 write)
      if (data.departments && data.departments.length > 0) {
        promises.push(
          setDoc(doc(db, 'app_bundles', 'departments'), {
            data: data.departments,
            count: data.departments.length,
            updatedAt: now,
          }, { merge: true }).catch(err => {
            if (isQuotaExceededError(err)) markQuotaExceeded(err);
            console.warn('Cloud sync departments error:', err?.message);
          })
        );
      }

      // 4. Biometric Punches bundles (chunked in 1,200 punches per bundle, 1-2 writes instead of 2,000+ writes)
      const punchChunks = chunkArray(data.punches, 1200);
      promises.push(
        setDoc(doc(db, 'app_bundles', 'punches_manifest'), {
          chunks: punchChunks.length,
          totalPunches: data.punches.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        })
      );
      punchChunks.forEach((chunk, idx) => {
        promises.push(
          setDoc(doc(db, 'app_bundles', `punches_${idx}`), {
            data: chunk,
            chunkIndex: idx,
            updatedAt: now,
          }, { merge: true }).catch(err => {
            if (isQuotaExceededError(err)) markQuotaExceeded(err);
            console.warn(`Cloud sync punches_${idx} error:`, err?.message);
          })
        );
      });

      // 5. Shift Plans bundles (chunked in 1,500 plans per bundle)
      const planChunks = chunkArray(data.shiftPlans, 1500);
      promises.push(
        setDoc(doc(db, 'app_bundles', 'shift_plans_manifest'), {
          chunks: planChunks.length,
          totalPlans: data.shiftPlans.length,
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
      promises.push(
        setDoc(doc(db, 'app_bundles', 'ot_records'), {
          data: data.otRecords,
          count: data.otRecords.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        })
      );

      // 7. Other Allowances bundle (1 write)
      promises.push(
        setDoc(doc(db, 'app_bundles', 'other_allowances'), {
          data: data.otherAllowances,
          count: data.otherAllowances.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        })
      );

      // 8. Users bundle (1 write)
      promises.push(
        setDoc(doc(db, 'app_bundles', 'users'), {
          data: data.users,
          count: data.users.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        })
      );

      // 9. Manual Overrides bundle (1 write)
      promises.push(
        setDoc(doc(db, 'app_bundles', 'manual_overrides'), {
          data: data.manualOverrides,
          updatedAt: now,
        }, { merge: true }).catch(err => {
          if (isQuotaExceededError(err)) markQuotaExceeded(err);
        })
      );

      await promiseWithTimeout(Promise.all(promises), 6000, []);
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

  // Fast targeted sync for Biometric Punches (chunked 1,500 punches per bundle with parallel writes & timeout safety)
  async syncBiometricPunches(punches: BiometricRawPunch[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const now = new Date().toISOString();
      // Filter >= 2025-01-01, clean and compact punches to minimize Firestore document payload
      const leanPunches = punches
        .filter(p => !p.date || p.date >= '2025-01-01')
        .map(p => ({
          id: p.id,
          empIdentifier: p.empIdentifier,
          type: p.type || 'I',
          timestamp: p.timestamp,
          date: p.date,
          time: p.time,
          deviceId: p.deviceId || '01',
        }));

      const punchChunks = chunkArray(leanPunches, 1500);

      const syncTask = async () => {
        const promises: Promise<any>[] = [];
        promises.push(
          setDoc(doc(db, 'app_bundles', 'punches_manifest'), {
            chunks: punchChunks.length,
            totalPunches: leanPunches.length,
            updatedAt: now,
          })
        );

        if (punchChunks.length === 0) {
          promises.push(
            setDoc(doc(db, 'app_bundles', 'punches_0'), {
              data: [],
              chunkIndex: 0,
              count: 0,
              updatedAt: now,
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
              })
            );
          }
        }

        // Clean up orphaned punch chunks
        const startOrphan = Math.max(1, punchChunks.length);
        for (let orphanIdx = startOrphan; orphanIdx < 20; orphanIdx++) {
          promises.push(
            deleteDoc(doc(db, 'app_bundles', `punches_${orphanIdx}`)).catch(() => null)
          );
        }

        await Promise.all(promises);
        return true;
      };

      const timeoutTask = new Promise<boolean>((resolve) =>
        setTimeout(() => {
          console.warn('[syncBiometricPunches] Cloud sync timeout (10s); local memory/storage remains active.');
          resolve(true);
        }, 10000)
      );

      return await Promise.race([syncTask(), timeoutTask]);
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
    }, 2500);
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
          2500,
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

      const stampedPlans = plansToBundle
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

      // Clean up orphaned shift plan chunks
      const startOrphan = Math.max(1, planChunks.length);
      for (let orphanIdx = startOrphan; orphanIdx < 20; orphanIdx++) {
        promises.push(
          deleteDoc(doc(db, 'app_bundles', `shift_plans_${orphanIdx}`)).catch(() => null)
        );
      }

      // Also update legacy shift_plans bundle
      promises.push(
        setDoc(doc(db, 'app_bundles', 'shift_plans'), {
          data: planChunks[0] || [],
          totalPlans: stampedPlans.length,
          updatedAt: now,
          isChunked: planChunks.length > 1,
        }, { merge: true }).catch(() => null)
      );

      await promiseWithTimeout(Promise.all(promises), 6000, []);
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
        .map(d => ({
          code: d.code.trim().toUpperCase(),
          name: (d.name || d.code).trim(),
          updatedAt: d.updatedAt || now,
        }));

      // 1. Primary high-efficiency bundle write
      await setDoc(doc(db, 'app_bundles', 'departments'), {
        data: cleanDepartments,
        count: cleanDepartments.length,
        updatedAt: now,
      }, { merge: true });

      // 2. Dual-sync individual documents in background for 100% cloud consistency
      Promise.all(cleanDepartments.map(d => 
        setDoc(doc(db, 'departments', d.code), {
          code: d.code,
          name: d.name,
          updatedAt: d.updatedAt || now,
        }, { merge: true }).catch(() => null)
      )).catch(() => {});

      return true;
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('syncDepartments error:', error?.message);
      return false;
    }
  },

  // Sync Employees list (Pure bundle write: 1 write per update, eliminates multi-doc race conditions)
  async syncEmployees(employees: Employee[]): Promise<boolean> {
    if (isFirestoreQuotaExceeded) return false;
    try {
      const now = new Date().toISOString();
      const cleanEmployees: Employee[] = (employees || [])
        .filter(emp => emp && emp.empNo && !isDemoEmployee(emp))
        .map(emp => cleanEmployeeForFirestore(emp, now));

      const syncTask = async () => {
        await setDoc(doc(db, 'app_bundles', 'employees'), {
          data: cleanEmployees,
          count: cleanEmployees.length,
          updatedAt: now,
        });

        // Un-blacklist any active employees in app_bundles/deleted_employees
        try {
          const activeKeys = new Set<string>();
          cleanEmployees.forEach(e => {
            if (e.empNo) activeKeys.add(e.empNo.trim().toUpperCase());
            if (e.empNo) activeKeys.add(cleanDocId(e.empNo).toUpperCase());
            if (e.gid) activeKeys.add(e.gid.trim().toUpperCase());
            if (e.empCode) activeKeys.add(e.empCode.trim().toUpperCase());
          });
          const delRef = doc(db, 'app_bundles', 'deleted_employees');
          const delSnap = await getDoc(delRef).catch(() => null);
          if (delSnap?.exists()) {
            const ids: string[] = delSnap.data()?.ids || [];
            const remaining = ids.filter(id => !activeKeys.has(id.toUpperCase()));
            if (remaining.length !== ids.length) {
              await setDoc(delRef, { ids: remaining, updatedAt: now }, { merge: true });
            }
          }
        } catch (delErr) {
          console.warn('Cleanup deleted_employees warning:', delErr);
        }

        return true;
      };

      const timeoutTask = new Promise<boolean>((resolve) =>
        setTimeout(() => {
          console.warn('[syncEmployees] Cloud sync timeout (10s); local storage active.');
          resolve(true); // Don't fail locally on network latency
        }, 10000)
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

        // Clean up orphaned OT record chunks
        const startOrphan = Math.max(1, otChunks.length);
        for (let orphanIdx = startOrphan; orphanIdx < 20; orphanIdx++) {
          promises.push(
            deleteDoc(doc(db, 'app_bundles', `ot_records_${orphanIdx}`)).catch(() => null)
          );
        }

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
          console.warn('[syncOTRecords] Cloud sync timeout (10s)');
          resolve(true);
        }, 10000)
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
          console.warn('[syncOtherAllowances] Cloud sync timeout (10s)');
          resolve(true);
        }, 10000)
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
          console.warn('[syncManualOverrides] Cloud sync timeout (10s)');
          resolve(true);
        }, 10000)
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

      // Safety timeout so UI / storage never hangs
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('saveUserDirect timeout')), 6000)
      );

      return await Promise.race([syncOperation(), timeoutPromise]);
    } catch (error: any) {
      if (isQuotaExceededError(error)) markQuotaExceeded(error);
      console.warn('saveUserDirect warning:', error?.message);
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
          console.warn('deleteEmployee firestore timeout fallback');
          resolve(true);
        }, 5000)
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
      // 1. First attempt to read from high-efficiency app_bundles (with 4000ms safety timeout)
      let bundleSnap = null;
      try {
        bundleSnap = await promiseWithTimeout(
          getDocs(collection(db, 'app_bundles')),
          4000,
          null
        );
      } catch (err: any) {
        console.warn('app_bundles fetch timeout or error:', err?.message);
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

      // Reconstruct Punches
      if (punchesManifestTotal === 0 || punchesManifestChunks === 0) {
        punches = [];
      } else if (rawChunkedPunchDocs.length > 0) {
        const validPunches = punchesManifestChunks !== null
          ? rawChunkedPunchDocs.filter(c => c.index < punchesManifestChunks)
          : rawChunkedPunchDocs;
        validPunches.sort((a, b) => a.index - b.index);
        punches = [];
        validPunches.forEach(c => {
          const valid = c.data.filter((p: any) => p && (!p.date || p.date >= '2025-01-01'));
          punches.push(...valid);
        });
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
      } catch (legacyErr) {
        console.warn('Legacy collection fetch warning:', legacyErr);
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

      // Deduplicate employees (key: empNo) - Latest updatedAt always wins
      const empMap = new Map<string, Employee>();
      if (employees.length > 0) {
        employees.forEach(emp => {
          if (emp && emp.empNo && !isDemoEmployee(emp)) {
            const key = emp.empNo.trim().toUpperCase();
            const clean = cleanEmployeeForFirestore(emp);
            const existing = empMap.get(key);
            if (!existing) {
              empMap.set(key, clean);
            } else {
              const existingTime = existing.updatedAt || '1970-01-01T00:00:00.000Z';
              const incomingTime = clean.updatedAt || '1970-01-01T00:00:00.000Z';
              if (incomingTime >= existingTime) {
                empMap.set(key, clean);
              }
            }
          }
        });
      } else {
        legacyEmployees.forEach(emp => {
          if (emp && emp.empNo && !isDemoEmployee(emp)) {
            const id = cleanDocId(emp.empNo).toUpperCase();
            const rawNo = emp.empNo.trim().toUpperCase();
            const gid = (emp.gid || '').trim().toUpperCase();
            if (!deletedIds.has(id) && !deletedIds.has(rawNo) && (!gid || !deletedIds.has(gid))) {
              empMap.set(rawNo, cleanEmployeeForFirestore(emp));
            }
          }
        });
      }
      const cleanEmployees = Array.from(empMap.values());

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

            uMap.set(cleanEmail, {
              ...secondary,
              ...primary,
              // Admin role protection for default admin
              role: cleanEmail === 'smo.cs.th.bts@gmail.com' ? 'Admin' : (primary.role || secondary.role),
              department: (primary.department && primary.department !== 'PENDING') ? primary.department : (secondary.department || primary.department),
              status: cleanEmail === 'smo.cs.th.bts@gmail.com' ? 'Active' : (primary.status || secondary.status || 'Active'),
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

      // Deduplicate departments (key: code)
      const deptMap = new Map<string, Department>();
      departments.forEach(d => {
        if (d && d.code) {
          const upper = d.code.trim().toUpperCase();
          if (!deletedDeptCodesSet.has(upper)) {
            deptMap.set(upper, { ...d, code: upper, name: (d.name || d.code).trim() });
          }
        }
      });
      legacyDepartments.forEach(d => {
        if (d && d.code) {
          const upper = d.code.trim().toUpperCase();
          if (!deletedDeptCodesSet.has(upper)) {
            const existing = deptMap.get(upper);
            if (!existing) {
              deptMap.set(upper, { ...d, code: upper, name: (d.name || d.code).trim() });
            } else {
              const legTime = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
              const exTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
              if (legTime > exTime || (d.name && d.name !== d.code && existing.name === existing.code)) {
                deptMap.set(upper, { ...d, code: upper, name: (d.name || d.code).trim() });
              }
            }
          }
        }
      });
      const cleanDepartments = Array.from(deptMap.values()).sort((a, b) => a.code.localeCompare(b.code));

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

      // 2. Departments
      const deptSnap = await getDoc(doc(db, 'app_bundles', 'departments')).catch(() => null);
      if (deptSnap?.exists()) {
        const existing: Department[] = deptSnap.data().data || [];
        const clean = existing.filter(d => !isDemoDepartment(d.code));
        await this.syncDepartments(clean).catch(() => null);
      }

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
          console.warn('app_bundles listener notice:', err?.message);
        });
      } catch (e) {
        console.warn('subscribeToCloudChanges setup error:', e);
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
        console.warn('users bundle listener notice:', err?.message);
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
        console.warn('subscribeToCurrentUser listener notice:', err?.message);
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

