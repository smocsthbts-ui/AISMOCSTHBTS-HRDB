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
import { auth, onAuthStateChanged, logOut } from './firebase';
import { SiemensSidebar } from './components/SiemensSidebar';
import { SiemensHeader } from './components/SiemensHeader';
import { ShiftRosterView } from './components/ShiftRosterView';
import { UploadShiftPlanView } from './components/UploadShiftPlanView';
import { TimeSheetView } from './components/TimeSheetView';
import { ImportCenterView } from './components/ImportCenterView';
import { ExportCenterView } from './components/ExportCenterView';
import { EmployeeMasterView } from './components/EmployeeMasterView';
import { UserManagementView } from './components/UserManagementView';
import { SettingsAndTemplatesView } from './components/SettingsAndTemplatesView';
import { AuthModal } from './components/AuthModal';
import { ManageMyAccountView } from './components/ManageMyAccountView';

export default function App() {
  // Theme: Dark mode by default as requested by Siemens IX Industrial guidelines
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('siemens_theme') as 'dark' | 'light') || 'dark';
  });

  // Current User (RBAC: Admin vs User)
  const [currentUser, setCurrentUser] = useState<UserAccount>(() => {
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
    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser && firebaseUser.email) {
        // Find user in storage by email
        const users = storage.getUsers();
        let targetUser = users.find(u => u.email.toLowerCase() === firebaseUser.email?.toLowerCase());
        
        // Auto-create Admin if it's the default admin and doesn't exist
        const isDefaultAdmin = firebaseUser.email.toLowerCase() === 'smo.cs.th.bts@gmail.com';
        if (!targetUser && isDefaultAdmin) {
          targetUser = {
            id: `usr-${firebaseUser.uid}`,
            email: firebaseUser.email,
            name: firebaseUser.email.split('@')[0],
            role: 'Admin',
            department: 'ALL',
            status: 'Active',
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
          };
          users.push(targetUser);
          storage.setUsers(users);
        }

        if (targetUser) {
          if (targetUser.status === 'Deactivated' || targetUser.status === 'Pending_Approval') {
            logOut();
            setCurrentUser(null as any);
            setIsAuthModalOpen(true);
          } else {
            storage.setCurrentUser(targetUser);
            setCurrentUser(targetUser);
            setIsAuthModalOpen(false);
          }
        } else {
          // If no local user profile found (maybe deleted by Admin), sign out
          logOut();
          setCurrentUser(null as any);
          setIsAuthModalOpen(true);
        }
      } else {
        // No firebase user
        setCurrentUser(null as any);
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

    // Listen to cross-component data changes
    const handleDataUpdated = () => {
      reloadData();
    };
    window.addEventListener('siemens-data-updated', handleDataUpdated);

    return () => {
      window.removeEventListener('siemens-data-updated', handleDataUpdated);
      unsubscribeAuth();
    };
  }, [reloadData]);

  // Manual cloud sync trigger
  const handleSyncCloud = async () => {
    setCloudStatus((prev) => ({ ...prev, isSyncing: true }));
    const success = await storage.syncAllToCloud();
    setCloudStatus({
      isConnected: success,
      isSyncing: false,
      lastSync: new Date().toLocaleTimeString('th-TH'),
    });
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
          isOpen={isAuthModalOpen || !currentUser}
          onClose={() => {}}
          onSwitchUser={handleSwitchUser}
          isDark={isDark}
        />
      </div>
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
            />
          )}
        </main>
      </div>

      {/* Auth & User Switcher Modal */}
      <AuthModal
        currentUser={currentUser}
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSwitchUser={handleSwitchUser}
        isDark={isDark}
      />
    </div>
  );
}
