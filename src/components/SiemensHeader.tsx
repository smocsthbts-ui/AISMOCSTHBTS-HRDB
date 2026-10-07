import React, { useState, useRef, useEffect } from 'react';
import { 
  UserCircle2, 
  RefreshCw,
  ChevronDown,
  Menu,
  Cloud,
  CloudOff,
  Database,
  LogOut,
  Settings
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
  cloudStatus?: { isConnected: boolean; isSyncing: boolean; lastSync: string | null; isQuotaExceeded?: boolean };
  onSyncCloud?: () => void;
  onSignOut?: () => void;
}

export const SiemensHeader: React.FC<SiemensHeaderProps> = ({
  currentUser,
  theme,
  onOpenAuthModal,
  activeTab,
  onToggleSidebar,
  cloudStatus,
  onSyncCloud,
  onSignOut,
}) => {
  const isDark = theme === 'dark';
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const tabTitles: Record<string, string> = {
    roster: 'Shift Roster — Monthly Schedule (ตารางกะทำงานรายเดือน)',
    'upload-shift-plan': 'Upload Shift Plan — Department Schedule (อัปโหลดตารางกะรายแผนก)',
    timesheet: 'Time Sheet — Standard Attendance Form (บันทึกเวลาทำงานรายบุคคล)',
    statistics: 'Statistics & Analytics — Work, Leaves & Attendance (สถิติการทำงาน การลา และการมาสาย)',
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

        {/* Right: Cloud / Local Status Badge + User Profile + Quick Tools */}
        <div className="flex items-center space-x-2.5 text-xs shrink-0">
          {/* Cloud / Local Status Badge */}
          <button
            id="btn-cloud-status"
            onClick={() => {
              if (onSyncCloud) {
                onSyncCloud();
              }
            }}
            title={
              cloudStatus?.isQuotaExceeded
                ? 'ระบบทำงานบน Local Storage ปลอดภัย 100% (คลิกเพื่อทดสอบเชื่อมต่อ Cloud ใหม่)'
                : cloudStatus?.isConnected 
                  ? `Cloud Firestore: เชื่อมต่อแล้ว (${cloudStatus.lastSync ? `ซิงค์ล่าสุด: ${cloudStatus.lastSync}` : 'คลิกเพื่อซิงค์'})` 
                  : 'โหมด Local พร้อมใช้งาน (คลิกเพื่อทดสอบเชื่อมต่อ Cloud ใหม่)...'
            }
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-xs transition cursor-pointer ${
              cloudStatus?.isQuotaExceeded
                ? isDark
                  ? 'bg-amber-950/40 border-amber-500/50 text-amber-300 hover:bg-amber-900/40'
                  : 'bg-amber-500/20 border-amber-300/40 text-amber-100 hover:bg-amber-500/30'
                : cloudStatus?.isConnected
                  ? isDark 
                    ? 'bg-teal-950/40 border-teal-500/40 text-teal-300 hover:bg-teal-900/40' 
                    : 'bg-emerald-600/20 border-white/30 text-white hover:bg-emerald-600/30'
                  : isDark 
                    ? 'bg-amber-950/40 border-amber-500/40 text-amber-300 hover:bg-amber-900/40' 
                    : 'bg-amber-500/20 text-white hover:bg-amber-500/30'
            }`}
          >
            {cloudStatus?.isSyncing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-300" />
            ) : cloudStatus?.isQuotaExceeded ? (
              <Database className="w-3.5 h-3.5 text-amber-400" />
            ) : cloudStatus?.isConnected ? (
              <Cloud className="w-3.5 h-3.5 text-teal-400" />
            ) : (
              <CloudOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span className="font-mono text-[11px] hidden sm:inline flex items-center gap-1">
              {cloudStatus?.isSyncing 
                ? 'Syncing...' 
                : cloudStatus?.isQuotaExceeded
                  ? 'Local Mode'
                  : cloudStatus?.isConnected 
                    ? 'Cloud Online' 
                    : 'Local Mode'}
              {cloudStatus?.isConnected && cloudStatus.lastSync && (
                <span className="text-[10px] opacity-80 font-normal hidden lg:inline ml-0.5">
                  ({cloudStatus.lastSync})
                </span>
              )}
            </span>
            {cloudStatus?.isConnected && !cloudStatus.isSyncing && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            )}
            {cloudStatus?.isQuotaExceeded && (
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Local Persistence Active" />
            )}
          </button>

          {/* User Profile Pill & Dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              id="btn-user-profile"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              title="ข้อมูลบัญชีและสิทธิ์การใช้งาน"
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

            {/* Dropdown Menu */}
            {isMenuOpen && (
              <div className={`absolute right-0 mt-2 w-56 rounded-xl shadow-2xl border py-2 z-50 animate-in fade-in zoom-in-95 duration-100 ${
                isDark ? 'bg-[#121a28] border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
              }`}>
                <div className="px-3 py-2 border-b border-slate-700/50">
                  <div className="text-xs font-bold truncate">{currentUser.name}</div>
                  <div className="text-[11px] text-slate-400 truncate">{currentUser.email}</div>
                  <div className="text-[10px] text-cyan-400 mt-0.5">
                    แผนก: <span className="font-semibold">{currentUser.department}</span> • สิทธิ์: <span className="font-semibold">{currentUser.role}</span>
                  </div>
                </div>

                <div className="p-1 space-y-0.5">
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenAuthModal();
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded text-xs flex items-center gap-2 transition cursor-pointer ${
                      isDark ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <Settings className="w-3.5 h-3.5 text-cyan-400" />
                    <span>จัดการบัญชี / สลับผู้ใช้</span>
                  </button>

                  {onSignOut && (
                    <button
                      onClick={() => {
                        setIsMenuOpen(false);
                        onSignOut();
                      }}
                      className="w-full text-left px-3 py-1.5 rounded text-xs flex items-center gap-2 text-rose-400 hover:bg-rose-500/15 transition cursor-pointer font-medium"
                    >
                      <LogOut className="w-3.5 h-3.5 text-rose-400" />
                      <span>ออกจากระบบ (Sign Out)</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick Direct Sign Out Button */}
          {onSignOut && (
            <button
              id="btn-header-signout"
              onClick={onSignOut}
              title="ออกจากระบบทันที (Sign Out)"
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-xs transition cursor-pointer ${
                isDark
                  ? 'bg-rose-950/30 border-rose-500/30 text-rose-300 hover:bg-rose-900/50'
                  : 'bg-rose-700/25 border-rose-300/40 text-white hover:bg-rose-700/40'
              }`}
            >
              <LogOut className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden sm:inline font-medium">ลงชื่อออก</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
