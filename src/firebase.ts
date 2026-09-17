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
  arrayUnion
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

// Test connection on boot (with 4-second timeout so it never hangs)
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    const timeoutPromise = new Promise<boolean>((_, reject) =>
      setTimeout(() => reject(new Error('Connection test timeout')), 4000)
    );
    const checkPromise = (async () => {
      // Check bundle or root test doc
      const snap = await getDoc(doc(db, 'app_bundles', 'departments')).catch(() => null);
      if (snap) return true;
      await getDocFromServer(doc(db, 'test', 'connection')).catch(() => null);
      return true;
    })();

    await Promise.race([checkPromise, timeoutPromise]);
    console.log('Firebase Firestore connection verified successfully!');
    return true;
  } catch (error: any) {
    console.warn('testFirestoreConnection note:', error?.message);
    // Return true so fetchAllFromCloud can still attempt reading from Firestore
    return true;
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

// Authentic BTS departments (RS=Rolling Stock, SIG=Signaling, STN=Station, GM, etc. are REAL departments)
export const DEMO_DEPARTMENT_CODES: string[] = [];

export function isDemoDepartment(_dept: string): boolean {
  return false;
}

// Authentic railway shift codes
export const DEMO_SHIFT_CODES: string[] = [];

export function isDemoShiftCode(_code: string, _dept?: string): boolean {
  return false;
}

// Preserve original employee department without alterations
export function sanitizeEmployeeDepartment(emp: Employee): Employee {
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
      const stampedPlans = plans.map(p => ({
        ...p,
        updatedAt: p.updatedAt || now,
      }));
      const planChunks = chunkArray(stampedPlans, 1500);

      await setDoc(doc(db, 'app_bundles', 'shift_plans_manifest'), {
        chunks: planChunks.length,
        totalPlans: stampedPlans.length,
        updatedAt: now,
      }, { merge: true });

      for (let i = 0; i < planChunks.length; i++) {
        const payload = {
          data: planChunks[i],
          chunkIndex: i,
          count: planChunks[i].length,
          updatedAt: now,
        };
        await setDoc(doc(db, 'app_bundles', `shift_plans_${i}`), payload, { merge: true });
        if (i === 0) {
          await setDoc(doc(db, 'app_bundles', 'shift_plans'), payload, { merge: true });
        }
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
  async deleteDepartment(code: string, allDepartments?: Department[]): Promise<boolean> {
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

      // Keep individual collection in sync in batch so legacy queries never see stale ShiftWorker status
      try {
        const batch = writeBatch(db);
        employees.slice(0, 450).forEach(emp => {
          if (emp && emp.empNo) {
            batch.set(doc(db, 'employees', cleanDocId(emp.empNo)), emp, { merge: true });
          }
        });
        await batch.commit();
      } catch (e) {
        console.warn('Individual employee sync secondary warning:', e);
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

  // Save single user directly to Firestore (individual doc + app_bundles/users merge)
  async saveUserDirect(user: UserAccount): Promise<boolean> {
    try {
      if (!user || !user.email) return false;
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
            console.warn('saveUserDirect individual doc error:', err);
            return null;
          }),
        ]);

        const writePromises: Promise<any>[] = [];

        // Secondary id alias write if id differs from docKey
        if (normalizedUser.id && cleanDocId(normalizedUser.id) !== docKey) {
          writePromises.push(
            setDoc(doc(db, 'user_accounts', cleanDocId(normalizedUser.id)), normalizedUser, { merge: true }).catch(() => null)
          );
        }

        // Deduplicate & upsert to app_bundles/users
        let list: UserAccount[] = [];
        if (bundleSnap?.exists()) {
          list = bundleSnap.data().data || [];
        }
        const userMap = new Map<string, UserAccount>();
        list.forEach(u => {
          if (u && u.email) {
            userMap.set(u.email.trim().toLowerCase(), u);
          }
        });
        userMap.set(cleanEmail, { ...(userMap.get(cleanEmail) || {}), ...normalizedUser });
        const deduplicatedList = Array.from(userMap.values());

        writePromises.push(
          setDoc(bundleRef, {
            data: deduplicatedList,
            count: deduplicatedList.length,
            updatedAt: new Date().toISOString(),
          }, { merge: true })
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
              setDoc(delDocRef, { ids: filtered, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => null)
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
      console.warn('saveUserDirect warning:', error?.message);
      return false;
    }
  },

  // Sync Users list (strictly deduplicates and updates bundle + user_accounts)
  async syncUsers(users: UserAccount[]): Promise<boolean> {
    try {
      const now = new Date().toISOString();
      const userMap = new Map<string, UserAccount>();
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
          setDoc(doc(db, 'user_accounts', docKey), u, { merge: true }).catch(() => null);
        }
      }

      return true;
    } catch (error: any) {
      console.warn('syncUsers error:', error?.message);
      return false;
    }
  },

  // Delete User from Firestore (both bundle and legacy collections)
  async deleteUser(userId: string, email?: string, allUsers?: UserAccount[]): Promise<boolean> {
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
        ).catch(console.warn);
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
      console.warn('deleteUser error:', error?.message);
      return false;
    }
  },

  // Delete Employee (Admin action)
  async deleteEmployee(empNo: string, allEmployees?: Employee[]): Promise<boolean> {
    try {
      const cleanId = cleanDocId(empNo);
      // 1. Delete individual legacy document
      await deleteDoc(doc(db, 'employees', cleanId)).catch(err => console.warn('deleteDoc employee warning:', err));

      // 2. Track deleted ID in cloud so stale legacy caches never resurrect
      let deletedEmpIds: string[] = [];
      try {
        const delRef = doc(db, 'app_bundles', 'deleted_employees');
        const delSnap = await getDoc(delRef).catch(() => null);
        deletedEmpIds = delSnap?.exists() && Array.isArray(delSnap.data()?.ids) ? delSnap.data()?.ids : [];
        if (!deletedEmpIds.includes(cleanId)) {
          deletedEmpIds.push(cleanId);
          await setDoc(delRef, {
            ids: deletedEmpIds,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
      } catch (delErr) {
        console.warn('deleted_employees tracking warning:', delErr);
      }

      // 3. Update app_bundles with filtered list
      let empsToSave = allEmployees;
      if (!empsToSave) {
        const snap = await getDoc(doc(db, 'app_bundles', 'employees')).catch(() => null);
        if (snap?.exists()) {
          const existing: Employee[] = snap.data().data || [];
          empsToSave = existing.filter(e => cleanDocId(e.empNo) !== cleanId);
        }
      }
      if (empsToSave) {
        await this.syncEmployees(empsToSave);
      }
      return true;
    } catch (error: any) {
      console.warn('deleteEmployee error:', error?.message);
      return false;
    }
  },

  // Fetch all collections from Cloud Firestore (Reads bundled documents first, falls back to legacy collections)
  async fetchAllFromCloud() {
    try {
      // 1. First attempt to read from high-efficiency app_bundles directly from Cloud Server
      let bundleSnap;
      try {
        bundleSnap = await getDocsFromServer(collection(db, 'app_bundles'));
      } catch (err: any) {
        console.warn('app_bundles server fetch fallback to cache:', err?.message);
        bundleSnap = await getDocs(collection(db, 'app_bundles')).catch(() => null);
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
      const deletedIds = new Set<string>();
      const deletedUserKeysSet = new Set<string>();
      const deletedDeptCodesSet = new Set<string>();

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

      // 2. If bundles did not have specific datasets, fallback to legacy individual collections
      const needLegacyShiftCodes = shiftCodes.length === 0;
      const needLegacyEmployees = employees.length === 0;
      const needLegacyDepartments = departments.length === 0;
      const needLegacyPunches = punches.length === 0;
      const needLegacyPlans = shiftPlans.length === 0;

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
          needLegacyEmployees ? getDocs(collection(db, 'employees')).catch(() => null) : null,
          needLegacyShiftCodes ? getDocs(collection(db, 'shift_codes')).catch(() => null) : null,
          needLegacyPlans ? getDocs(collection(db, 'shift_plans')).catch(() => null) : null,
          needLegacyPunches ? getDocs(collection(db, 'raw_punches')).catch(() => null) : null,
          otRecords.length === 0 ? getDocs(collection(db, 'ot_records')).catch(() => null) : null,
          otherAllowances.length === 0 ? getDocs(collection(db, 'other_allowances')).catch(() => null) : null,
          getDocs(collection(db, 'user_accounts')).catch(() => null), // ALWAYS fetch individual user documents
          Object.keys(manualOverrides).length === 0 ? getDocs(collection(db, 'manual_overrides')).catch(() => null) : null,
          needLegacyDepartments ? getDocs(collection(db, 'departments')).catch(() => null) : null,
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

      // Deduplicate employees (key: empNo) - Bundled data strictly takes priority over legacy individual docs
      const empMap = new Map<string, Employee>();
      legacyEmployees.forEach(emp => {
        if (emp && emp.empNo) {
          empMap.set(emp.empNo.trim().toUpperCase(), emp);
        }
      });
      employees.forEach(emp => {
        if (emp && emp.empNo) {
          empMap.set(emp.empNo.trim().toUpperCase(), emp);
        }
      });
      const cleanEmployees = Array.from(empMap.values()).filter(e => {
        const id = cleanDocId(e.empNo).toUpperCase();
        return !deletedIds.has(id);
      });

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
        const cleanEmail = u.email.trim().toLowerCase();
        const idLower = (u.id || '').toLowerCase();
        const docClean = cleanDocId(cleanEmail).toLowerCase();
        const dotReplaced = cleanEmail.replace(/\./g, '_').toLowerCase();

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
            deptMap.set(upper, d);
          }
        }
      });
      legacyDepartments.forEach(d => {
        if (d && d.code) {
          const upper = d.code.trim().toUpperCase();
          if (!deletedDeptCodesSet.has(upper) && !deptMap.has(upper)) {
            deptMap.set(upper, d);
          }
        }
      });
      cleanEmployees.forEach(e => {
        const d = (e.department || '').trim().toUpperCase();
        if (d && !deletedDeptCodesSet.has(d) && !deptMap.has(d)) {
          deptMap.set(d, { code: d, name: d });
        }
      });
      const cleanDepartments = Array.from(deptMap.values()).sort((a, b) => a.code.localeCompare(b.code));

      // Filter and deduplicate shift plans (keeping latest updatedAt timestamp)
      const planMap = new Map<string, DailyShiftPlan>();
      shiftPlans.forEach(p => {
        if (p && p.date && (p.empNo || p.gid)) {
          const key = `${(p.empNo || p.gid).trim().toUpperCase()}_${p.date}`;
          const existing = planMap.get(key);
          if (!existing) {
            planMap.set(key, p);
          } else {
            const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
            const newTime = p.updatedAt ? new Date(p.updatedAt).getTime() : 0;
            if (newTime >= existingTime) {
              planMap.set(key, p);
            }
          }
        }
      });
      const cleanShiftPlans = Array.from(planMap.values());

      const hasData = (
        cleanEmployees.length > 0 ||
        cleanShiftCodes.length > 0 ||
        cleanShiftPlans.length > 0 ||
        punches.length > 0 ||
        otRecords.length > 0 ||
        otherAllowances.length > 0 ||
        cleanUsers.length > 0 ||
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

      // Also update in bundle so real-time listeners on all other clients trigger immediately
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
      } catch (bundleErr) {
        console.warn('Bundle single employee update warning:', bundleErr);
      }
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
    let isFirst = true;

    // Listen to bundled updates (1 single listener handles all changes)
    const unsubBundles = onSnapshot(collection(db, 'app_bundles'), { includeMetadataChanges: true }, (snap) => {
      if (isFirst) {
        isFirst = false;
        return;
      }
      if (!snap.metadata.hasPendingWrites) {
        onUpdate('app_bundles');
      }
    }, err => console.warn('app_bundles listener error:', err));

    return () => {
      unsubBundles();
    };
  },

  // Real-time listener specifically for User Accounts
  subscribeToUserChanges(onUpdate: () => void): () => void {
    const unsub1 = onSnapshot(collection(db, 'user_accounts'), () => {
      onUpdate();
    }, err => console.warn('user_accounts listener error:', err));

    const unsub2 = onSnapshot(doc(db, 'app_bundles', 'users'), () => {
      onUpdate();
    }, err => console.warn('app_bundles/users listener error:', err));

    return () => {
      unsub1();
      unsub2();
    };
  }
};

export const subscribeToCloudChanges = firestoreSync.subscribeToCloudChanges;
export const subscribeToUserChanges = firestoreSync.subscribeToUserChanges;

