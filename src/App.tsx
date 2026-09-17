import React, { useState, useEffect, useCallback } from 'react';
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
import { auth, onAuthStateChanged, logOut, firestoreSync, db, cleanDocId, subscribeToUserChanges } from './firebase';
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

  // Navigation tab
  const [activeTab, setActiveTab] = useState<string>('roster');

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
  }>({
    isConnected: false,
    isSyncing: true,
    lastSync: null,
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
        setCloudStatus({
          isConnected: res.connected,
          isSyncing: false,
          lastSync: new Date().toLocaleTimeString('th-TH'),
        });
        if (res.connected) {
          reloadData();
        }
      })
      .catch((err) => {
        console.error('Cloud sync initialization failed:', err);
        setCloudStatus((prev) => ({ ...prev, isSyncing: false }));
      });

    // Real-time listener for user account changes
    const unsubUsersRealtime = subscribeToUserChanges(() => {
      const allUsers = storage.getUsers();
      const currentStored = storage.getCurrentUser();
      if (currentStored && currentStored.email) {
        const clean = currentStored.email.trim().toLowerCase();
        const updated = allUsers.find(u => u.email.trim().toLowerCase() === clean);
        if (updated && (updated.status !== currentStored.status || updated.department !== currentStored.department || updated.role !== currentStored.role)) {
          storage.setCurrentUser(updated);
          setCurrentUser(updated);
        }
      }
    });

    // Listen to cross-component & multi-user real-time cloud data changes
    const handleDataUpdated = () => {
      reloadData();
      setCloudStatus((prev) => ({
        ...prev,
        isConnected: true,
        lastSync: new Date().toLocaleTimeString('th-TH'),
      }));
    };
    window.addEventListener('siemens-data-updated', handleDataUpdated);
    window.addEventListener('storage-changed', handleDataUpdated);
    window.addEventListener('firestore-sync-completed', handleDataUpdated);

    return () => {
      window.removeEventListener('siemens-data-updated', handleDataUpdated);
      window.removeEventListener('storage-changed', handleDataUpdated);
      window.removeEventListener('firestore-sync-completed', handleDataUpdated);
      unsubUsersRealtime();
      unsubscribeAuth();
    };
  }, [reloadData]);

  // Manual cloud sync trigger
  const handleSyncCloud = async () => {
    setCloudStatus((prev) => ({ ...prev, isSyncing: true }));
    try {
      const res = await storage.initCloudSync();
      reloadData();
      setCloudStatus({
        isConnected: res.connected,
        isSyncing: false,
        lastSync: new Date().toLocaleTimeString('th-TH'),
      });
    } catch (e) {
      console.error('Manual sync failed:', e);
      setCloudStatus((prev) => ({ ...prev, isSyncing: false }));
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
        onSignOut={async () => {
          await logOut();
          storage.clearCurrentUser();
          setCurrentUser(null);
          setIsAuthModalOpen(true);
        }}
      />
    );
  }

  return (
    <div className={`min-h-screen flex font-sans transition-colors duration-200 overflow-hidden ${
      isDark 
        ? 'bg-[#091017] text-slate-100' 
        : 'bg-[#f4f7f9] text-slate-800'
    }`}>
      {/* Siemens IX Left Sidebar Navigation */}
      <SiemensSidebar
        currentUser={currentUser}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        pendingOTCount={pendingOTCount}
        pendingUserCount={pendingUserCount}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
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
        />

        {/* Work Area Viewport */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-0">
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
              onNavigateToImport={() => setActiveTab('upload-shift-plan')}
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
              onNavigateToRoster={() => setActiveTab('roster')}
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
              onNavigateToUploadShiftPlan={() => setActiveTab('upload-shift-plan')}
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
              onNavigateToUploadShiftPlan={() => setActiveTab('upload-shift-plan')}
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
      />
    </div>
  );
}
