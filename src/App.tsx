import React, { useState, useEffect, useCallback, useTransition } from 'react';
import { 
  UserAccount, 
  Employee, 
  ShiftCode, 
  DailyShiftPlan, 
  BiometricRawPunch, 
  OTRecord, 
  OtherAllowance,
  Department
} from './types';
import { storage } from './utils/storage';
import { auth, onAuthStateChanged, logOut, firestoreSync, db, cleanDocId, subscribeToUserChanges, subscribeToCurrentUser, subscribeToCloudChanges } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { SiemensSidebar } from './components/SiemensSidebar';
import { SiemensHeader } from './components/SiemensHeader';
import { ShiftRosterView } from './components/ShiftRosterView';
import { UploadShiftPlanView } from './components/UploadShiftPlanView';
import { TimeSheetView } from './components/TimeSheetView';
import { StatisticsView } from './components/StatisticsView';
import { ImportCenterView } from './components/ImportCenterView';
import { ExportCenterView } from './components/ExportCenterView';
import { EmployeeMasterView } from './components/EmployeeMasterView';
import { UserManagementView } from './components/UserManagementView';
import { SettingsAndTemplatesView } from './components/SettingsAndTemplatesView';
import { AuthModal } from './components/AuthModal';
import { ManageMyAccountView } from './components/ManageMyAccountView';
import { WaitingVerificationScreen } from './components/WaitingVerificationScreen';
import { ErrorBoundary } from './components/ErrorBoundary';

const TAB_TITLES: Record<string, { en: string; th: string }> = {
  'roster': { en: 'Shift Roster', th: 'ตารางกะการทำงาน' },
  'upload-shift-plan': { en: 'Upload Shift Plan', th: 'อัปโหลดตารางกะรายแผนก' },
  'timesheet': { en: 'Time Sheet', th: 'บันทึกเวลาทำงานรายบุคคล' },
  'statistics': { en: 'Statistics', th: 'สถิติการทำงานและการลา' },
  'import': { en: 'Data Import Center', th: 'ศูนย์นำเข้าข้อมูลรวม' },
  'export': { en: 'Reports & Export', th: 'ส่งออกรายงาน Time Sheet & Payroll' },
  'employees': { en: 'Employee Master', th: 'ฐานข้อมูลพนักงานประจำแผนก' },
  'users': { en: 'User Accounts', th: 'จัดการสิทธิ์ผู้ใช้งาน' },
  'manage_account': { en: 'Manage My Account', th: 'จัดการบัญชีของฉัน' },
  'settings': { en: 'Settings & Cloud', th: 'ตั้งค่าระบบและ Cloud' },
};

export default function App() {
  // Theme: Dark mode by default as requested by Siemens IX Industrial guidelines
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('siemens_theme') as 'dark' | 'light') || 'dark';
  });

  // Current User (RBAC: Admin vs User)
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    return storage.getCurrentUser();
  });

  // Global filters
  const [selectedMonthYear, setSelectedMonthYear] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedDepartment, setSelectedDepartment] = useState<string>('ALL');

  // Navigation tab & smooth transition
  const [activeTab, setActiveTab] = useState<string>('roster');
  const [isPending, startTransition] = useTransition();
  const [navigatingTab, setNavigatingTab] = useState<string | null>(null);
  const [navigationProgress, setNavigationProgress] = useState<number>(0);
  const [importInitialTab, setImportInitialTab] = useState<'shift-plan' | 'shift-code' | 'attendance' | 'ot' | 'allowances'>('shift-plan');

  // Smooth, non-blocking page transition handler
  const handleSelectTab = useCallback((tab: string) => {
    if (tab === activeTab) return;
    setNavigatingTab(tab);
    setNavigationProgress(30);

    const timer = setTimeout(() => {
      setNavigationProgress(75);
    }, 60);

    // Yield control to browser so loading state repaints immediately
    requestAnimationFrame(() => {
      startTransition(() => {
        setActiveTab(tab);
        setNavigationProgress(100);
        setTimeout(() => {
          clearTimeout(timer);
          setNavigatingTab(null);
          setNavigationProgress(0);
        }, 180);
      });
    });
  }, [activeTab]);

  // Sidebar collapsed state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Auth modal
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  // Core Data
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shiftCodes, setShiftCodes] = useState<ShiftCode[]>([]);
  const [shiftPlans, setShiftPlans] = useState<DailyShiftPlan[]>([]);
  const [biometricPunches, setBiometricPunches] = useState<BiometricRawPunch[]>([]);
  const [otRecords, setOTRecords] = useState<OTRecord[]>([]);
  const [otherAllowances, setOtherAllowances] = useState<OtherAllowance[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  // Cloud Database Status
  const [cloudStatus, setCloudStatus] = useState<{
    isConnected: boolean;
    isSyncing: boolean;
    lastSync: string | null;
    isQuotaExceeded?: boolean;
  }>({
    isConnected: false,
    isSyncing: true,
    lastSync: null,
    isQuotaExceeded: firestoreSync.isQuotaExceeded(),
  });

  // Load data from storage
  const reloadData = useCallback(() => {
    setDepartments(storage.getDepartments());
    setEmployees(storage.getEmployees());
    setShiftCodes(storage.getShiftCodes());
    setShiftPlans(storage.getShiftPlans());
    setBiometricPunches(storage.getBiometricPunches());
    setOTRecords(storage.getOTRecords());
    setOtherAllowances(storage.getOtherAllowances());
    setCurrentUser(storage.getCurrentUser());
  }, []);

  // Initial load and Cloud Sync
  useEffect(() => {
    reloadData();

    // Auto-purge any legacy demo datasets from LocalStorage and Cloud Firestore on startup
    if (typeof window !== 'undefined' && !localStorage.getItem('sys_demo_dataset_purged_v3')) {
      storage.purgeAllDemoDataset().then(() => {
        try { localStorage.setItem('sys_demo_dataset_purged_v3', 'true'); } catch {}
        reloadData();
      }).catch(() => null);
    }

    // Firebase Auth State Listener
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && firebaseUser.email) {
        const cleanEmail = firebaseUser.email.trim().toLowerCase();
        const docKey = cleanDocId(cleanEmail);
        const isDefaultAdmin = cleanEmail === 'smo.cs.th.bts@gmail.com';

        let users = storage.getUsers();
        let targetUser = users.find(u => u.email.trim().toLowerCase() === cleanEmail);

        // Fetch cloud user doc to ensure authoritative status and avoid stale state
        try {
          const userDocSnap = await getDoc(doc(db, 'user_accounts', docKey)).catch(() => null);
          if (userDocSnap?.exists()) {
            const cloudUser = userDocSnap.data() as UserAccount;
            if (cloudUser) {
              targetUser = targetUser ? { ...targetUser, ...cloudUser } : cloudUser;
            }
          }
        } catch (err) {
          console.warn('Cloud user direct lookup warning:', err);
        }

        // If not found in direct doc or local cache, attempt to fetch fresh bundle
        if (!targetUser) {
          try {
            const fresh = await firestoreSync.fetchAllFromCloud();
            if (fresh && fresh.users && fresh.users.length > 0) {
              storage.setUsers(fresh.users);
              users = fresh.users;
              targetUser = users.find(u => u.email.trim().toLowerCase() === cleanEmail);
            }
          } catch (err) {
            console.warn('Cloud user check failed:', err);
          }
        }

        // Auto-provision User profile if authenticated in Firebase Auth but missing in DB
        if (!targetUser) {
          const employees = storage.getEmployees();
          const matchedEmp = employees.find(e => 
            (e.gid && cleanEmail.includes(e.gid.toLowerCase())) ||
            (e.empNo && cleanEmail.includes(e.empNo.toLowerCase())) ||
            (e.firstName && cleanEmail.includes(e.firstName.toLowerCase()))
          );

          targetUser = {
            id: `usr-${firebaseUser.uid}`,
            email: firebaseUser.email,
            name: firebaseUser.displayName || (matchedEmp ? `${matchedEmp.firstName} ${matchedEmp.familyName}`.trim() : firebaseUser.email.split('@')[0]),
            role: isDefaultAdmin ? 'Admin' : 'User',
            department: isDefaultAdmin ? 'ALL' : (matchedEmp?.department || 'PENDING'),
            status: isDefaultAdmin ? 'Active' : 'Pending_Approval',
            photoURL: firebaseUser.photoURL || undefined,
            isGoogleAccount: true,
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
          };
          await storage.saveUser(targetUser);
        } else {
          // Update photoURL or last login without reverting status
          const updatedUser: UserAccount = {
            ...targetUser,
            name: firebaseUser.displayName || targetUser.name,
            photoURL: firebaseUser.photoURL || targetUser.photoURL,
            lastLogin: new Date().toISOString(),
            role: isDefaultAdmin ? 'Admin' : targetUser.role,
            status: isDefaultAdmin ? 'Active' : targetUser.status,
          };
          targetUser = updatedUser;
          await storage.saveUser(updatedUser);
        }

        if (targetUser) {
          if (targetUser.status === 'Deactivated') {
            await logOut();
            storage.clearCurrentUser();
            setCurrentUser(null);
            setIsAuthModalOpen(true);
          } else {
            storage.setCurrentUser(targetUser);
            setCurrentUser(targetUser);
            if (targetUser.role === 'User' && targetUser.department && targetUser.department !== 'ALL' && targetUser.department !== 'PENDING') {
              setSelectedDepartment(targetUser.department);
            }
            setIsAuthModalOpen(false);
          }
        }
      } else {
        // No firebase user
        storage.clearCurrentUser();
        setCurrentUser(null);
        setIsAuthModalOpen(true);
      }
    });

    // Connect and sync with Firebase Firestore
    storage.initCloudSync()
      .then((res) => {
        const isQuota = firestoreSync.isQuotaExceeded();
        setCloudStatus({
          isConnected: res.connected && !isQuota,
          isSyncing: false,
          lastSync: new Date().toLocaleTimeString('th-TH'),
          isQuotaExceeded: isQuota,
        });
        if (res.connected) {
          reloadData();
        }
      })
      .catch((err) => {
        console.error('Cloud sync initialization failed:', err);
        setCloudStatus((prev) => ({ 
          ...prev, 
          isSyncing: false,
          isQuotaExceeded: firestoreSync.isQuotaExceeded()
        }));
      });

    // Real-time listener for app_bundles updates (Employees, Departments, Shift Plans, Shift Codes, Punches, OT, etc.)
    const unsubCloudBundles = subscribeToCloudChanges(async (source) => {
      try {
        console.log(`[Cloud Sync] Multi-user realtime update from ${source}...`);
        await storage.initCloudSync();
        reloadData();
      } catch (e) {
        console.warn('Realtime cloud sync refresh notice:', e);
      }
    });

    // Real-time listener for user account changes
    const unsubUsersRealtime = subscribeToUserChanges((cloudUsers) => {
      if (cloudUsers && cloudUsers.length > 0) {
        storage.updateUsersFromCloud(cloudUsers);
      }
      const allUsers = storage.getUsers();
      const currentStored = storage.getCurrentUser();
      if (currentStored && currentStored.email) {
        const clean = currentStored.email.trim().toLowerCase();
        const updated = allUsers.find(u => u.email.trim().toLowerCase() === clean);
        if (updated) {
          if (updated.status === 'Deactivated') {
            handleSignOut();
            return;
          }
          if (updated.status !== currentStored.status || updated.department !== currentStored.department || updated.role !== currentStored.role) {
            storage.setCurrentUser(updated);
            setCurrentUser(updated);
          }
        }
      }
    });

    // Listen to cross-component & multi-user real-time cloud data changes
    const handleDataUpdated = () => {
      reloadData();
      const isQuota = firestoreSync.isQuotaExceeded();
      setCloudStatus((prev) => ({
        ...prev,
        isConnected: !isQuota,
        lastSync: new Date().toLocaleTimeString('th-TH'),
        isQuotaExceeded: isQuota,
      }));
    };

    const handleQuotaExceeded = () => {
      setCloudStatus((prev) => ({
        ...prev,
        isConnected: false,
        isSyncing: false,
        isQuotaExceeded: true,
      }));
    };

    window.addEventListener('siemens-data-updated', handleDataUpdated);
    window.addEventListener('storage-changed', handleDataUpdated);
    window.addEventListener('firestore-sync-completed', handleDataUpdated);
    window.addEventListener('firestore-quota-exceeded', handleQuotaExceeded);

    // Refresh instantly when user tabs back or focuses the window
    const handleWindowFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        storage.initCloudSync().then(res => {
          if (res.connected) reloadData();
        }).catch(() => null);
      }
    };
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('visibilitychange', handleWindowFocus);

    return () => {
      window.removeEventListener('siemens-data-updated', handleDataUpdated);
      window.removeEventListener('storage-changed', handleDataUpdated);
      window.removeEventListener('firestore-sync-completed', handleDataUpdated);
      window.removeEventListener('firestore-quota-exceeded', handleQuotaExceeded);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('visibilitychange', handleWindowFocus);
      unsubCloudBundles();
      unsubUsersRealtime();
      unsubscribeAuth();
    };
  }, [reloadData]);

  // Manual cloud sync trigger / retry connection
  const handleSyncCloud = async () => {
    setCloudStatus((prev) => ({ ...prev, isSyncing: true }));
    try {
      // Clear local quota exceeded flag to attempt fresh cloud probe
      await firestoreSync.resetQuotaState();
      const res = await storage.initCloudSync();
      reloadData();
      const isQuota = firestoreSync.isQuotaExceeded();
      setCloudStatus({
        isConnected: res.connected && !isQuota,
        isSyncing: false,
        lastSync: new Date().toLocaleTimeString('th-TH'),
        isQuotaExceeded: isQuota,
      });
    } catch (e) {
      console.error('Manual sync failed:', e);
      setCloudStatus((prev) => ({ 
        ...prev, 
        isSyncing: false, 
        isQuotaExceeded: firestoreSync.isQuotaExceeded() 
      }));
    }
  };

  // Handle Theme Toggle
  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('siemens_theme', nextTheme);
  };

  // Fullscreen toggle
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
        setIsFullscreen(false);
      }
    }
  };

  // Reset to default initial dataset
  const handleResetData = () => {
    storage.resetToDefaults();
    reloadData();
  };

  // Clear demo transaction data (shifts, biometric punches, OT, allowances)
  const handleClearDemoData = async () => {
    await storage.clearAllDemoData();
    reloadData();
  };

  // Clear all data including employees
  const handleClearAllData = async () => {
    await storage.clearAllData();
    reloadData();
  };

  // Handle switch user
  const handleSwitchUser = (user: UserAccount) => {
    storage.setCurrentUser(user);
    setCurrentUser(user);
  };

  // Direct real-time sync for current user profile changes (Roles, Dept, Status)
  useEffect(() => {
    if (!currentUser?.email) return;
    const unsubCurrentUser = subscribeToCurrentUser(currentUser.email, (cloudUser) => {
      if (cloudUser) {
        if (cloudUser.status === 'Deactivated') {
          handleSignOut();
          return;
        }
        if (
          cloudUser.role !== currentUser.role ||
          cloudUser.status !== currentUser.status ||
          cloudUser.department !== currentUser.department
        ) {
          storage.setCurrentUser(cloudUser);
          setCurrentUser(cloudUser);
        }
      }
    });
    return () => unsubCurrentUser();
  }, [currentUser?.email, currentUser?.role, currentUser?.status, currentUser?.department]);

  // Centralized, 1-Click Instant Sign-Out
  const handleSignOut = async () => {
    // 1. Immediately wipe local storage and UI state for instant response
    storage.clearCurrentUser();
    setCurrentUser(null);
    setIsAuthModalOpen(true);
    // 2. Terminate Firebase session cleanly
    try {
      await logOut();
    } catch (err) {
      console.warn('Sign-out error:', err);
    }
  };

  // Pending counts for badges
  const pendingOTCount = otRecords.filter(r => r.isRetroactive && r.status === 'Pending_Admin_Review').length;
  const pendingUserCount = storage.getUsers().filter(u => u.status === 'Pending_Approval').length;

  const isDark = theme === 'dark';

  if (!currentUser) {
    return (
      <div className={`min-h-screen flex items-center justify-center font-sans ${
        isDark ? 'bg-[#091017] text-slate-100' : 'bg-[#f4f7f9] text-slate-800'
      }`}>
        <AuthModal
          currentUser={currentUser}
          isOpen={true}
          canClose={false}
          onClose={() => {}}
          onSwitchUser={handleSwitchUser}
          isDark={isDark}
          onSignOut={handleSignOut}
        />
      </div>
    );
  }

  // If user is registered via Google / Siemens and waiting for Admin verification and activation
  if (currentUser.status === 'Pending_Approval') {
    return (
      <WaitingVerificationScreen
        currentUser={currentUser}
        theme={theme}
        onUserActivated={(activatedUser) => {
          setCurrentUser(activatedUser);
          storage.setCurrentUser(activatedUser);
          reloadData();
        }}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <div className={`min-h-screen flex font-sans transition-colors duration-200 overflow-hidden relative ${
      isDark 
        ? 'bg-[#091017] text-slate-100' 
        : 'bg-[#f4f7f9] text-slate-800'
    }`}>
      {/* Top Global Progress Bar for Smooth Page Transitions */}
      {(navigatingTab || isPending) && (
        <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-[#002b30] overflow-hidden pointer-events-none">
          <div 
            className="h-full bg-gradient-to-r from-[#00b3b3] via-[#00e5e5] to-[#73ffff] transition-all duration-200 ease-out shadow-[0_0_12px_#00e5e5]"
            style={{ width: `${navigationProgress}%` }}
          />
        </div>
      )}

      {/* Floating Transition Status Toast */}
      {navigatingTab && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center space-x-2.5 px-3.5 py-2 rounded-lg bg-[#08121a]/95 border border-[#00e5e5]/40 text-slate-100 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="w-3.5 h-3.5 border-2 border-[#00e5e5] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium text-slate-200">
            กำลังสลับหน้าไปยัง <span className="text-[#00e5e5] font-semibold">{TAB_TITLES[navigatingTab]?.en || navigatingTab}</span> ({TAB_TITLES[navigatingTab]?.th || ''})...
          </span>
        </div>
      )}

      {/* Siemens IX Left Sidebar Navigation */}
      <SiemensSidebar
        currentUser={currentUser}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        navigatingTab={navigatingTab}
        pendingOTCount={pendingOTCount}
        pendingUserCount={pendingUserCount}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onSignOut={handleSignOut}
      />

      {/* Main Container: Top App Bar + Dynamic Module View */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Top App Bar Header */}
        <SiemensHeader
          currentUser={currentUser}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          selectedMonthYear={selectedMonthYear}
          onSelectMonthYear={setSelectedMonthYear}
          selectedDepartment={selectedDepartment}
          onSelectDepartment={setSelectedDepartment}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onResetData={handleResetData}
          activeTab={activeTab}
          onToggleSidebar={() => setIsSidebarCollapsed(prev => !prev)}
          cloudStatus={cloudStatus}
          onSyncCloud={handleSyncCloud}
          onSignOut={handleSignOut}
        />

        {/* Work Area Viewport */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-0">
          <ErrorBoundary key={activeTab} onReset={reloadData}>
            {activeTab === 'roster' && (
              <ShiftRosterView
                currentUser={currentUser}
                theme={theme}
                selectedMonthYear={selectedMonthYear}
                onSelectMonthYear={setSelectedMonthYear}
                selectedDepartment={selectedDepartment}
                onSelectDepartment={setSelectedDepartment}
                employees={employees}
                shiftCodes={shiftCodes}
                shiftPlans={shiftPlans}
                onNavigateToImport={() => handleSelectTab('upload-shift-plan')}
              />
            )}

          {activeTab === 'upload-shift-plan' && (
            <UploadShiftPlanView
              currentUser={currentUser}
              theme={theme}
              selectedMonthYear={selectedMonthYear}
              onSelectMonthYear={setSelectedMonthYear}
              selectedDepartment={selectedDepartment}
              onSelectDepartment={setSelectedDepartment}
              employees={employees}
              shiftCodes={shiftCodes}
              shiftPlans={shiftPlans}
              onDataImported={reloadData}
              onNavigateToRoster={() => handleSelectTab('roster')}
              onNavigateToShiftCodes={() => {
                setImportInitialTab('shift-code');
                handleSelectTab('import');
              }}
              onNavigateToEmployees={() => handleSelectTab('employees')}
            />
          )}

          {activeTab === 'timesheet' && (
            <TimeSheetView
              currentUser={currentUser}
              theme={theme}
              selectedMonthYear={selectedMonthYear}
              onSelectMonthYear={setSelectedMonthYear}
              selectedDepartment={selectedDepartment}
              onSelectDepartment={setSelectedDepartment}
              employees={employees}
              shiftCodes={shiftCodes}
              shiftPlans={shiftPlans}
              biometricPunches={biometricPunches}
              otRecords={otRecords}
              otherAllowances={otherAllowances}
            />
          )}

          {activeTab === 'statistics' && (
            <StatisticsView
              currentUser={currentUser}
              theme={theme}
              employees={employees}
              shiftCodes={shiftCodes}
              shiftPlans={shiftPlans}
              biometricPunches={biometricPunches}
              selectedMonthYear={selectedMonthYear}
              onSelectMonthYear={setSelectedMonthYear}
              selectedDepartment={selectedDepartment}
              onSelectDepartment={setSelectedDepartment}
              onNavigateToUploadShiftPlan={() => handleSelectTab('upload-shift-plan')}
            />
          )}

          {activeTab === 'import' && (
            <ImportCenterView
              currentUser={currentUser}
              theme={theme}
              selectedMonthYear={selectedMonthYear}
              selectedDepartment={selectedDepartment}
              employees={employees}
              shiftCodes={shiftCodes}
              onDataImported={reloadData}
              onNavigateToUploadShiftPlan={() => handleSelectTab('upload-shift-plan')}
              onNavigateToRoster={() => handleSelectTab('roster')}
              initialTab={importInitialTab}
            />
          )}

          {activeTab === 'export' && (
            <ExportCenterView
              currentUser={currentUser}
              theme={theme}
              selectedMonthYear={selectedMonthYear}
              onSelectMonthYear={setSelectedMonthYear}
              selectedDepartment={selectedDepartment}
              onSelectDepartment={setSelectedDepartment}
              employees={employees}
              shiftCodes={shiftCodes}
              shiftPlans={shiftPlans}
              biometricPunches={biometricPunches}
              otRecords={otRecords}
              otherAllowances={otherAllowances}
            />
          )}

          {activeTab === 'employees' && (
            <EmployeeMasterView
              departments={departments}
              currentUser={currentUser}
              theme={theme}
              employees={employees}
              selectedDepartment={selectedDepartment}
              onSelectDepartment={setSelectedDepartment}
              onDataChanged={reloadData}
            />
          )}

          {activeTab === 'users' && (
            <UserManagementView
              currentUser={currentUser}
              theme={theme}
              onUserChanged={reloadData}
            />
          )}

          {activeTab === 'manage_account' && (
            <ManageMyAccountView
              currentUser={currentUser}
              theme={theme}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsAndTemplatesView
              currentUser={currentUser}
              theme={theme}
              onResetData={handleResetData}
              onClearDemoData={handleClearDemoData}
              onClearAllData={handleClearAllData}
            />
          )}
          </ErrorBoundary>
        </main>
      </div>

      {/* Auth & User Switcher Modal */}
      <AuthModal
        currentUser={currentUser}
        isOpen={isAuthModalOpen}
        canClose={currentUser?.status === 'Active'}
        onClose={() => setIsAuthModalOpen(false)}
        onSwitchUser={handleSwitchUser}
        isDark={isDark}
        onSignOut={handleSignOut}
      />
    </div>
  );
}
