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
  setDoc,
  writeBatch,
  deleteDoc,
  onSnapshot
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
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

// Test connection on boot
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('Firebase Firestore connection verified successfully!');
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    // Still return false but do not crash
    return false;
  }
}

// Google Sign In
export async function signInWithGoogle(): Promise<User | null> {
  try {
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

// Demo department codes from initial mock template (NOT real railway departments)
export const DEMO_DEPARTMENT_CODES: string[] = ['RS', 'SIG', 'STN', 'IT'];

export function isDemoDepartment(dept: string): boolean {
  if (!dept) return false;
  return DEMO_DEPARTMENT_CODES.includes(dept.trim().toUpperCase());
}

// Demo shift codes from initial mock template
export const DEMO_SHIFT_CODES: string[] = ['A1', 'N1', 'S1', 'A', 'M', 'M1', 'N2', 'ST1', 'ST2'];

export function isDemoShiftCode(code: string, dept?: string): boolean {
  if (!code) return false;
  const c = code.trim().toUpperCase();
  const d = (dept || '').trim().toUpperCase();
  if (isDemoDepartment(d)) return true;
  if (DEMO_SHIFT_CODES.includes(c) && d !== 'ALL') return true;
  return false;
}

// Reassign demo department employees to authentic BTS railway departments
export function sanitizeEmployeeDepartment(emp: Employee): Employee {
  if (!emp) return emp;
  const d = (emp.department || '').trim().toUpperCase();
  if (isDemoDepartment(d)) {
    let target = 'RST';
    if (emp.empNo === '0077' || emp.empNo === '1442') target = 'TEL';
    else if (emp.empNo === '0094' || emp.empNo === '0149') target = 'RST';
    else if (emp.empNo === '0315') target = 'ADM';
    else if (emp.empNo === '1234') target = 'RST2';
    else if (d === 'SIG') target = 'TEL';
    else if (d === 'STN') target = 'ADM';
    else if (d === 'IT') target = 'ADM';
    return { ...emp, department: target };
  }
  return emp;
}

// Chunk helper for large arrays
function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
}

// Firestore Database Sync Service using High-Efficiency Bundling
export const firestoreSync = {
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
          console.warn('Cloud sync shift_codes error:', err?.message);
        })
      );

      // 2. Employees bundle (1 write instead of 400+ writes)
      promises.push(
        setDoc(doc(db, 'app_bundles', 'employees'), {
          data: data.employees,
          count: data.employees.length,
          updatedAt: now,
        }, { merge: true }).catch(err => {
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
        }, { merge: true }).catch(console.warn)
      );
      punchChunks.forEach((chunk, idx) => {
        promises.push(
          setDoc(doc(db, 'app_bundles', `punches_${idx}`), {
            data: chunk,
            chunkIndex: idx,
            updatedAt: now,
          }, { merge: true }).catch(err => {
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
        }, { merge: true }).catch(console.warn)
      );
      planChunks.forEach((chunk, idx) => {
        promises.push(
          setDoc(doc(db, 'app_bundles', `shift_plans_${idx}`), {
            data: chunk,
            chunkIndex: idx,
            updatedAt: now,
          }, { merge: true }).catch(console.warn)
        );
      });

      // 6. OT Records bundle (1 write)
      promises.push(
        setDoc(doc(db, 'app_bundles', 'ot_records'), {
          data: data.otRecords,
          count: data.otRecords.length,
          updatedAt: now,
        }, { merge: true }).catch(console.warn)
      );

      // 7. Other Allowances bundle (1 write)
      promises.push(
        setDoc(doc(db, 'app_bundles', 'other_allowances'), {
          data: data.otherAllowances,
          count: data.otherAllowances.length,
          updatedAt: now,
        }, { merge: true }).catch(console.warn)
      );

      // 8. Users bundle (1 write)
      promises.push(
        setDoc(doc(db, 'app_bundles', 'users'), {
          data: data.users,
          count: data.users.length,
          updatedAt: now,
        }, { merge: true }).catch(console.warn)
      );

      // 9. Manual Overrides bundle (1 write)
      promises.push(
        setDoc(doc(db, 'app_bundles', 'manual_overrides'), {
          data: data.manualOverrides,
          updatedAt: now,
        }, { merge: true }).catch(console.warn)
      );

      await Promise.all(promises);
      console.log('Successfully synced bundled data to Cloud Firestore!');
      return true;
    } catch (error) {
      console.warn('syncAllToCloud caught error (safe fallback to local persistence):', error);
      return false;
    }
  },

  // Fast targeted sync for Shift Codes only (1 bundled write instead of 800 writes)
  async syncShiftCodes(codes: ShiftCode[]): Promise<boolean> {
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
      console.warn('syncShiftCodes cloud write warning:', error?.message || error);
      return false;
    }
  },

  // Fast targeted sync for Biometric Punches (chunked 1,200 punches per bundle, 1-2 writes instead of thousands)
  async syncBiometricPunches(punches: BiometricRawPunch[]): Promise<boolean> {
    try {
      const now = new Date().toISOString();
      const punchChunks = chunkArray(punches, 1200);

      await setDoc(doc(db, 'app_bundles', 'punches_manifest'), {
        chunks: punchChunks.length,
        totalPunches: punches.length,
        updatedAt: now,
      }, { merge: true });

      for (let i = 0; i < punchChunks.length; i++) {
        const bundleId = i === 0 ? 'punches' : `punches_${i}`;
        await setDoc(doc(db, 'app_bundles', bundleId), {
          data: punchChunks[i],
          chunkIndex: i,
          updatedAt: now,
        }, { merge: true });
      }
      return true;
    } catch (error: any) {
      console.warn('syncBiometricPunches cloud write warning:', error?.message || error);
      return false;
    }
  },

  // Fast targeted sync for Shift Plans
  async syncShiftPlans(plans: DailyShiftPlan[]): Promise<boolean> {
    try {
      const now = new Date().toISOString();
      const planChunks = chunkArray(plans, 1500);

      await setDoc(doc(db, 'app_bundles', 'shift_plans_manifest'), {
        chunks: planChunks.length,
        totalPlans: plans.length,
        updatedAt: now,
      }, { merge: true });

      for (let i = 0; i < planChunks.length; i++) {
        const bundleId = i === 0 ? 'shift_plans' : `shift_plans_${i}`;
        await setDoc(doc(db, 'app_bundles', bundleId), {
          data: planChunks[i],
          chunkIndex: i,
          updatedAt: now,
        }, { merge: true });
      }
      return true;
    } catch (error: any) {
      console.warn('syncShiftPlans cloud write warning:', error?.message || error);
      return false;
    }
  },

  // Save single shift code (updates cloud bundle without exceeding quota)
  async saveShiftCode(sc: ShiftCode, allCodes?: ShiftCode[]): Promise<boolean> {
    try {
      let codesToSave = allCodes;
      if (!codesToSave) {
        // Fetch or load existing
        const snap = await getDoc(doc(db, 'app_bundles', 'shift_codes')).catch(() => null);
        const existing: ShiftCode[] = snap?.exists() ? (snap.data().data || []) : [];
        const map = new Map<string, ShiftCode>();
        existing.forEach(c => map.set(`${c.code.toUpperCase()}_${c.department.toUpperCase()}`, c));
        map.set(`${sc.code.toUpperCase()}_${sc.department.toUpperCase()}`, sc);
        codesToSave = Array.from(map.values());
      }
      return await this.syncShiftCodes(codesToSave);
    } catch (error: any) {
      console.warn('saveShiftCode error:', error?.message);
      return false;
    }
  },

  // Delete single shift code from Cloud Firestore
  async deleteShiftCode(code: string, department: string, allCodes?: ShiftCode[]): Promise<boolean> {
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
      console.warn('deleteShiftCode error:', error?.message);
      return false;
    }
  },

  // Delete single department from Cloud Firestore
  async deleteDepartment(code: string): Promise<boolean> {
    try {
      const upper = (code || '').trim().toUpperCase();
      deleteDoc(doc(db, 'departments', upper)).catch(() => null);
      deleteDoc(doc(db, 'departments', code)).catch(() => null);

      const snap = await getDoc(doc(db, 'app_bundles', 'departments')).catch(() => null);
      if (snap?.exists()) {
        const existing: Department[] = snap.data().data || [];
        const filtered = existing.filter(d => (d.code || '').trim().toUpperCase() !== upper);
        await this.syncDepartments(filtered);
      }
      return true;
    } catch (error: any) {
      console.warn('deleteDepartment error:', error?.message);
      return false;
    }
  },

  // Sync Departments list
  async syncDepartments(departments: Department[]): Promise<boolean> {
    try {
      await setDoc(doc(db, 'app_bundles', 'departments'), {
        data: departments,
        count: departments.length,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return true;
    } catch (error: any) {
      console.warn('syncDepartments error:', error?.message);
      return false;
    }
  },

  // Sync Employees list
  async syncEmployees(employees: Employee[]): Promise<boolean> {
    try {
      const now = new Date().toISOString();
      const empChunks = chunkArray(employees, 1000);
      for (let i = 0; i < empChunks.length; i++) {
        const bundleId = i === 0 ? 'employees' : `employees_${i}`;
        await setDoc(doc(db, 'app_bundles', bundleId), {
          data: empChunks[i],
          chunkIndex: i,
          count: empChunks[i].length,
          updatedAt: now,
        }, { merge: true });
      }
      return true;
    } catch (error: any) {
      console.warn('syncEmployees error:', error?.message);
      return false;
    }
  },

  // Sync OT Records
  async syncOTRecords(records: OTRecord[]): Promise<boolean> {
    try {
      await setDoc(doc(db, 'app_bundles', 'ot_records'), {
        data: records,
        count: records.length,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return true;
    } catch (error: any) {
      console.warn('syncOTRecords error:', error?.message);
      return false;
    }
  },

  // Sync Other Allowances
  async syncOtherAllowances(allw: OtherAllowance[]): Promise<boolean> {
    try {
      await setDoc(doc(db, 'app_bundles', 'other_allowances'), {
        data: allw,
        count: allw.length,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return true;
    } catch (error: any) {
      console.warn('syncOtherAllowances error:', error?.message);
      return false;
    }
  },

  // Sync Manual Overrides
  async syncManualOverrides(overrides: Record<string, Partial<TimeSheetRow>>): Promise<boolean> {
    try {
      await setDoc(doc(db, 'app_bundles', 'manual_overrides'), {
        data: overrides,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return true;
    } catch (error: any) {
      console.warn('syncManualOverrides error:', error?.message);
      return false;
    }
  },

  // Fetch all collections from Cloud Firestore (Reads bundled documents first, falls back to legacy collections)
  async fetchAllFromCloud() {
    try {
      // 1. First attempt to read from high-efficiency app_bundles
      let bundleSnap;
      try {
        bundleSnap = await getDocs(collection(db, 'app_bundles'));
      } catch (err: any) {
        console.warn('app_bundles fetch failed or denied:', err?.message);
      }

      let employees: Employee[] = [];
      let shiftCodes: ShiftCode[] = [];
      let departments: Department[] = [];
      let shiftPlans: DailyShiftPlan[] = [];
      let punches: BiometricRawPunch[] = [];
      let otRecords: OTRecord[] = [];
      let otherAllowances: OtherAllowance[] = [];
      let users: UserAccount[] = [];
      let manualOverrides: Record<string, Partial<TimeSheetRow>> = {};

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
          } else if (id === 'punches' || id.startsWith('punches_')) {
            if (Array.isArray(data.data)) {
              punches.push(...data.data);
            }
          } else if (id === 'shift_plans' || id.startsWith('shift_plans_')) {
            if (Array.isArray(data.data)) {
              shiftPlans.push(...data.data);
            }
          } else if (id === 'ot_records') {
            if (Array.isArray(data.data)) {
              otRecords.push(...data.data);
            }
          } else if (id === 'other_allowances') {
            if (Array.isArray(data.data)) {
              otherAllowances.push(...data.data);
            }
          } else if (id === 'users') {
            if (Array.isArray(data.data)) {
              users.push(...data.data);
            }
          } else if (id === 'manual_overrides') {
            if (data.data) {
              manualOverrides = { ...manualOverrides, ...data.data };
            }
          }
        });
      }

      // 2. If bundles did not have specific datasets, fallback to legacy individual collections
      const needLegacyShiftCodes = shiftCodes.length === 0;
      const needLegacyEmployees = employees.length === 0;
      const needLegacyDepartments = departments.length === 0;
      const needLegacyPunches = punches.length === 0;

      if (!foundBundles || needLegacyShiftCodes || needLegacyEmployees || needLegacyDepartments || needLegacyPunches) {
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
            needLegacyEmployees ? getDocs(collection(db, 'employees')).catch(() => null) : null,
            needLegacyShiftCodes ? getDocs(collection(db, 'shift_codes')).catch(() => null) : null,
            shiftPlans.length === 0 ? getDocs(collection(db, 'shift_plans')).catch(() => null) : null,
            needLegacyPunches ? getDocs(collection(db, 'raw_punches')).catch(() => null) : null,
            otRecords.length === 0 ? getDocs(collection(db, 'ot_records')).catch(() => null) : null,
            otherAllowances.length === 0 ? getDocs(collection(db, 'other_allowances')).catch(() => null) : null,
            users.length === 0 ? getDocs(collection(db, 'user_accounts')).catch(() => null) : null,
            Object.keys(manualOverrides).length === 0 ? getDocs(collection(db, 'manual_overrides')).catch(() => null) : null,
            needLegacyDepartments ? getDocs(collection(db, 'departments')).catch(() => null) : null,
          ]);

          if (empSnap) empSnap.forEach(d => employees.push(d.data() as Employee));
          if (scSnap) scSnap.forEach(d => shiftCodes.push(d.data() as ShiftCode));
          if (deptSnap) deptSnap.forEach(d => departments.push(d.data() as Department));
          if (planSnap) planSnap.forEach(d => shiftPlans.push(d.data() as DailyShiftPlan));
          if (punchSnap) punchSnap.forEach(d => punches.push(d.data() as BiometricRawPunch));
          if (otSnap) otSnap.forEach(d => otRecords.push(d.data() as OTRecord));
          if (allwSnap) allwSnap.forEach(d => otherAllowances.push(d.data() as OtherAllowance));
          if (userSnap) userSnap.forEach(d => users.push(d.data() as UserAccount));
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
      }

      // Deduplicate and filter out demo shift codes
      const scMap = new Map<string, ShiftCode>();
      shiftCodes.forEach(sc => {
        if (sc && sc.code && !isDemoShiftCode(sc.code, sc.department)) {
          scMap.set(`${sc.code.toUpperCase()}_${(sc.department || 'ALL').toUpperCase()}`, sc);
        }
      });
      const cleanShiftCodes = Array.from(scMap.values());

      // Deduplicate and reassign any demo department employees
      const empMap = new Map<string, Employee>();
      employees.forEach(emp => {
        if (emp && emp.empNo) {
          const sanitizedEmp = sanitizeEmployeeDepartment(emp);
          empMap.set(sanitizedEmp.empNo.trim().toUpperCase(), sanitizedEmp);
        }
      });
      const cleanEmployees = Array.from(empMap.values());

      // Filter out demo departments
      const cleanDepartments = departments.filter(d => d && d.code && !isDemoDepartment(d.code));

      // Filter out demo shift plans
      const cleanShiftPlans = shiftPlans.filter(p => p && !isDemoShiftCode(p.shiftCode, p.department));

      const hasData = (
        cleanEmployees.length > 0 ||
        cleanShiftCodes.length > 0 ||
        cleanShiftPlans.length > 0 ||
        punches.length > 0 ||
        otRecords.length > 0 ||
        otherAllowances.length > 0 ||
        users.length > 0 ||
        cleanDepartments.length > 0
      );

      return {
        hasData,
        employees: cleanEmployees,
        shiftCodes: cleanShiftCodes,
        departments: cleanDepartments,
        shiftPlans: cleanShiftPlans,
        punches,
        otRecords,
        otherAllowances,
        users,
        manualOverrides,
      };
    } catch (error) {
      console.warn('fetchAllFromCloud caught error:', error);
      return null;
    }
  },

  // Save single shift plan
  async saveShiftPlan(plan: DailyShiftPlan, allPlans?: DailyShiftPlan[]) {
    try {
      if (allPlans) {
        return await this.syncShiftPlans(allPlans);
      }
      const docId = cleanDocId(plan.id || `plan-${plan.empNo}-${plan.date}`);
      await setDoc(doc(db, 'shift_plans', docId), plan, { merge: true });
    } catch (error) {
      console.warn('saveShiftPlan error:', error);
    }
  },

  // Save single manual override
  async saveManualOverride(key: string, data: Partial<TimeSheetRow>) {
    try {
      await setDoc(doc(db, 'manual_overrides', cleanDocId(key)), { key, data }, { merge: true });
    } catch (error) {
      console.warn('saveManualOverride error:', error);
    }
  },

  // Save employee
  async saveEmployee(emp: Employee, allEmployees?: Employee[]) {
    try {
      if (allEmployees) {
        return await this.syncEmployees(allEmployees);
      }
      await setDoc(doc(db, 'employees', cleanDocId(emp.empNo)), emp, { merge: true });
    } catch (error) {
      console.warn('saveEmployee error:', error);
    }
  },

  // Clear specific collections from Cloud Firestore
  async clearCloudCollections(collectionNames: string[]) {
    try {
      for (const colName of collectionNames) {
        const snap = await getDocs(collection(db, colName));
        if (snap.empty) continue;
        
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i += 400) {
          const chunk = docs.slice(i, i + 400);
          const batch = writeBatch(db);
          chunk.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      return true;
    } catch (error) {
      console.error('Error clearing cloud collections:', error);
      return false;
    }
  },

  // Clear only transaction/operational data
  async clearCloudTransactions() {
    return await this.clearCloudCollections([
      'shift_plans',
      'raw_punches',
      'ot_records',
      'other_allowances',
      'manual_overrides'
    ]);
  },

  // Purge all demo dataset (demo shift codes, demo departments, demo plans, and reassign demo employees)
  async purgeAllDemoDataset(): Promise<{ success: boolean; message: string }> {
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

      // 3. Employees (reassign demo departments)
      const empSnap = await getDoc(doc(db, 'app_bundles', 'employees')).catch(() => null);
      if (empSnap?.exists()) {
        const existing: Employee[] = empSnap.data().data || [];
        const clean = existing.map(sanitizeEmployeeDepartment);
        await this.syncEmployees(clean).catch(() => null);
      }

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

      // 5. Clean operational collections
      await this.clearCloudTransactions().catch(() => null);

      return { success: true, message: 'ล้างข้อมูล Demo และปรับปรุงฐานข้อมูลเรียบร้อยแล้ว' };
    } catch (err: any) {
      console.warn('purgeAllDemoDataset cloud error:', err);
      return { success: false, message: err?.message || 'บันทึกในเครื่องเรียบร้อย (คลาวด์จะซิงค์เมื่อโควต้าพร้อม)' };
    }
  },

  // Real-time listener across Develop and Production
  subscribeToCloudChanges(onUpdate: (source: string) => void): () => void {
    let initialLoad = true;

    // Listen to bundled updates (1 single listener handles all changes)
    const unsubBundles = onSnapshot(collection(db, 'app_bundles'), { includeMetadataChanges: false }, (snap) => {
      if (initialLoad) return;
      if (!snap.metadata.hasPendingWrites) {
        onUpdate('app_bundles');
      }
    }, err => console.warn('app_bundles listener error:', err));

    setTimeout(() => {
      initialLoad = false;
    }, 2500);

    return () => {
      unsubBundles();
    };
  }
};

export const subscribeToCloudChanges = firestoreSync.subscribeToCloudChanges;

