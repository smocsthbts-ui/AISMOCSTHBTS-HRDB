import React from 'react';
import { 
  UserCircle2, 
  RefreshCw,
  ChevronDown,
  Menu,
  Cloud,
  CloudOff
} from 'lucide-react';
import { UserAccount } from '../types';

interface SiemensHeaderProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  onToggleTheme?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  selectedMonthYear?: string;
  onSelectMonthYear?: (my: string) => void;
  selectedDepartment?: string;
  onSelectDepartment?: (dept: string) => void;
  onOpenAuthModal: () => void;
  onResetData: () => void;
  activeTab: string;
  onToggleSidebar?: () => void;
  cloudStatus?: { isConnected: boolean; isSyncing: boolean; lastSync: string | null };
  onSyncCloud?: () => void;
}

export const SiemensHeader: React.FC<SiemensHeaderProps> = ({
  currentUser,
  theme,
  onOpenAuthModal,
  onResetData,
  activeTab,
  onToggleSidebar,
  cloudStatus,
  onSyncCloud,
}) => {
  const isDark = theme === 'dark';

  const tabTitles: Record<string, string> = {
    roster: 'Shift Roster — Monthly Schedule (ตารางกะทำงานรายเดือน)',
    'upload-shift-plan': 'Upload Shift Plan — Department Schedule (อัปโหลดตารางกะรายแผนก)',
    timesheet: 'Time Sheet — Standard Attendance Form (บันทึกเวลาทำงานรายบุคคล)',
    import: 'Data Import Center — Integration Hub (ศูนย์นำเข้าข้อมูลระบบ)',
    export: 'Reports & Export — PDF & Payroll (ศูนย์ส่งออกรายงาน)',
    employees: 'Employee Master — Personnel Directory (ฐานข้อมูลพนักงาน)',
    users: 'User Accounts — Roles & Access (จัดการสิทธิ์ผู้ใช้งาน)',
    manage_account: 'Manage My Account — Profile & Security (จัดการข้อมูลส่วนตัวและรหัสผ่าน)',
    settings: 'Settings & Cloud — System Configuration (ตั้งค่าระบบและ Cloud)',
  };

  return (
    <header 
      id="siemens-top-appbar" 
      className={`border-b transition-colors select-none ${
        isDark 
          ? 'bg-[#0f1822] border-[#1e2e3d] text-slate-100' 
          : 'bg-[#005f69] border-[#00474e] text-white shadow-xs'
      }`}
    >
      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        {/* Left: Sidebar Toggle & Active Module Breadcrumb */}
        <div className="flex items-center space-x-3 min-w-0">
          {onToggleSidebar && (
            <button
              id="btn-toggle-sidebar"
              onClick={onToggleSidebar}
              title="Toggle Sidebar Menu (เปิด/ปิด แถบเมนูด้านข้าง)"
              className={`p-1.5 rounded transition ${
                isDark 
                  ? 'hover:bg-[#1a2838] text-slate-300' 
                  : 'hover:bg-white/20 text-white'
              }`}
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div className="flex flex-col min-w-0">
            <div className="text-xs font-bold truncate text-[#00e5e5] flex items-center gap-1.5">
              <span>{tabTitles[activeTab] || 'Time & Shift System'}</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate hidden sm:block">
              Siemens Mobility • MO CS BTS
            </div>
          </div>
        </div>

        {/* Right: Cloud Firestore Status Badge + User Profile + Quick Tools */}
        <div className="flex items-center space-x-2.5 text-xs shrink-0">
          {/* Cloud Firestore Status Badge */}
          <button
            id="btn-cloud-status"
            onClick={onSyncCloud}
            title={cloudStatus?.isConnected ? `Cloud Firestore: Connected (${cloudStatus.lastSync ? `Last synced: ${cloudStatus.lastSync}` : 'Click to sync'})` : 'Cloud Firestore: Connecting...'}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-xs transition cursor-pointer ${
              cloudStatus?.isConnected
                ? isDark 
                  ? 'bg-teal-950/40 border-teal-500/40 text-teal-300 hover:bg-teal-900/40' 
                  : 'bg-emerald-600/20 border-white/30 text-white hover:bg-emerald-600/30'
                : isDark 
                  ? 'bg-amber-950/40 border-amber-500/40 text-amber-300' 
                  : 'bg-amber-500/20 text-white'
            }`}
          >
            {cloudStatus?.isSyncing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-300" />
            ) : cloudStatus?.isConnected ? (
              <Cloud className="w-3.5 h-3.5 text-teal-400" />
            ) : (
              <CloudOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span className="font-mono text-[11px] hidden sm:inline">
              {cloudStatus?.isSyncing ? 'Syncing...' : cloudStatus?.isConnected ? 'Cloud Online' : 'Offline'}
            </span>
            {cloudStatus?.isConnected && !cloudStatus.isSyncing && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          {/* User Profile Pill */}
          <button
            id="btn-user-profile"
            onClick={onOpenAuthModal}
            title="Switch User / View Permissions (สลับผู้ใช้งาน / ดูสิทธิ์)"
            className={`flex items-center space-x-2 px-3 py-1.5 rounded border text-xs transition cursor-pointer ${
              isDark 
                ? 'bg-[#141f2c] border-[#273a4e] hover:bg-[#1a2838]' 
                : 'bg-white/15 border-white/25 hover:bg-white/25'
            }`}
          >
            <UserCircle2 className="w-4 h-4 text-[#00e5e5]" />
            <span className="font-semibold hidden md:inline">{currentUser.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
              currentUser.role === 'Admin'
                ? 'bg-red-500/25 text-red-300 border border-red-500/30'
                : 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/30'
            }`}>
              {currentUser.role}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {/* Quick Reset Button */}
          <button
            id="btn-header-reset"
            onClick={onResetData}
            title="Reset Initial Sample Data (คืนค่าข้อมูลตัวอย่างเริ่มต้น)"
            className={`p-1.5 rounded transition cursor-pointer ${
              isDark ? 'hover:bg-[#1a2838] text-slate-400 hover:text-slate-200' : 'hover:bg-white/20 text-white/80'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
