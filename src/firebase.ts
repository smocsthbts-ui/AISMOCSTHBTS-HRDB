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
  getDocFromServer, 
  collection, 
  getDocs, 
  setDoc,
  writeBatch
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
  TimeSheetRow 
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

// Firestore Database Sync Service
export const firestoreSync = {
  // Sync all entities to Cloud Firestore
  async syncAllToCloud(data: {
    employees: Employee[];
    shiftCodes: ShiftCode[];
    shiftPlans: DailyShiftPlan[];
    punches: BiometricRawPunch[];
    otRecords: OTRecord[];
    otherAllowances: OtherAllowance[];
    users: UserAccount[];
    manualOverrides: Record<string, Partial<TimeSheetRow>>;
  }) {
    try {
      // 1. Employees
      const empBatch = writeBatch(db);
      data.employees.forEach(emp => {
        const ref = doc(db, 'employees', emp.empNo);
        empBatch.set(ref, emp, { merge: true });
      });
      await empBatch.commit();

      // 2. Shift Codes
      const scBatch = writeBatch(db);
      data.shiftCodes.forEach(sc => {
        const ref = doc(db, 'shift_codes', sc.code);
        scBatch.set(ref, sc, { merge: true });
      });
      await scBatch.commit();

      // 3. Shift Plans
      // Split into chunks of 450 to adhere to 500 writes per batch limit
      for (let i = 0; i < data.shiftPlans.length; i += 400) {
        const chunk = data.shiftPlans.slice(i, i + 400);
        const planBatch = writeBatch(db);
        chunk.forEach(p => {
          const docId = p.id || `plan-${p.empNo}-${p.date}`;
          const ref = doc(db, 'shift_plans', docId);
          planBatch.set(ref, p, { merge: true });
        });
        await planBatch.commit();
      }

      // 4. Raw Punches
      for (let i = 0; i < data.punches.length; i += 400) {
        const chunk = data.punches.slice(i, i + 400);
        const punchBatch = writeBatch(db);
        chunk.forEach(p => {
          const docId = p.id || `punch-${p.empIdentifier}-${p.date}-${p.time}`;
          const ref = doc(db, 'raw_punches', docId);
          punchBatch.set(ref, p, { merge: true });
        });
        await punchBatch.commit();
      }

      // 5. OT Records
      const otBatch = writeBatch(db);
      data.otRecords.forEach(ot => {
        const ref = doc(db, 'ot_records', ot.id);
        otBatch.set(ref, ot, { merge: true });
      });
      await otBatch.commit();

      // 6. Other Allowances
      const allwBatch = writeBatch(db);
      data.otherAllowances.forEach(allw => {
        const ref = doc(db, 'other_allowances', allw.id);
        allwBatch.set(ref, allw, { merge: true });
      });
      await allwBatch.commit();

      // 7. Users
      const userBatch = writeBatch(db);
      data.users.forEach(u => {
        const emailKey = u.email.replace(/\./g, '_');
        const ref = doc(db, 'user_accounts', emailKey);
        userBatch.set(ref, u, { merge: true });
      });
      await userBatch.commit();

      // 8. Manual Overrides
      const ovBatch = writeBatch(db);
      Object.entries(data.manualOverrides).forEach(([key, val]) => {
        const ref = doc(db, 'manual_overrides', key);
        ovBatch.set(ref, { key, data: val }, { merge: true });
      });
      await ovBatch.commit();

      console.log('Successfully synced all data to Cloud Firestore!');
      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'all_collections');
      return false;
    }
  },

  // Fetch all collections from Cloud Firestore
  async fetchAllFromCloud() {
    try {
      const [
        empSnap,
        scSnap,
        planSnap,
        punchSnap,
        otSnap,
        allwSnap,
        userSnap,
        ovSnap
      ] = await Promise.all([
        getDocs(collection(db, 'employees')),
        getDocs(collection(db, 'shift_codes')),
        getDocs(collection(db, 'shift_plans')),
        getDocs(collection(db, 'raw_punches')),
        getDocs(collection(db, 'ot_records')),
        getDocs(collection(db, 'other_allowances')),
        getDocs(collection(db, 'user_accounts')),
        getDocs(collection(db, 'manual_overrides')),
      ]);

      const employees: Employee[] = [];
      empSnap.forEach(d => employees.push(d.data() as Employee));

      const shiftCodes: ShiftCode[] = [];
      scSnap.forEach(d => shiftCodes.push(d.data() as ShiftCode));

      const shiftPlans: DailyShiftPlan[] = [];
      planSnap.forEach(d => shiftPlans.push(d.data() as DailyShiftPlan));

      const punches: BiometricRawPunch[] = [];
      punchSnap.forEach(d => punches.push(d.data() as BiometricRawPunch));

      const otRecords: OTRecord[] = [];
      otSnap.forEach(d => otRecords.push(d.data() as OTRecord));

      const otherAllowances: OtherAllowance[] = [];
      allwSnap.forEach(d => otherAllowances.push(d.data() as OtherAllowance));

      const users: UserAccount[] = [];
      userSnap.forEach(d => users.push(d.data() as UserAccount));

      const manualOverrides: Record<string, Partial<TimeSheetRow>> = {};
      ovSnap.forEach(d => {
        const docData = d.data();
        if (docData.key && docData.data) {
          manualOverrides[docData.key] = docData.data;
        }
      });

      return {
        hasData: employees.length > 0 || shiftPlans.length > 0,
        employees,
        shiftCodes,
        shiftPlans,
        punches,
        otRecords,
        otherAllowances,
        users,
        manualOverrides,
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'fetch_all');
      return null;
    }
  },

  // Save single shift plan
  async saveShiftPlan(plan: DailyShiftPlan) {
    try {
      const docId = plan.id || `plan-${plan.empNo}-${plan.date}`;
      await setDoc(doc(db, 'shift_plans', docId), plan, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `shift_plans/${plan.id}`);
    }
  },

  // Save single manual override
  async saveManualOverride(key: string, data: Partial<TimeSheetRow>) {
    try {
      await setDoc(doc(db, 'manual_overrides', key), { key, data }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `manual_overrides/${key}`);
    }
  },

  // Save employee
  async saveEmployee(emp: Employee) {
    try {
      await setDoc(doc(db, 'employees', emp.empNo), emp, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `employees/${emp.empNo}`);
    }
  }
};
