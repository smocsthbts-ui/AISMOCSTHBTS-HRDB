import React from 'react';
import { 
  Calendar, 
  Clock, 
  BarChart3,
  Upload, 
  Download, 
  Users, 
  ShieldCheck, 
  Settings, 
  ChevronLeft, 
  ChevronRight,
  UserCircle2,
  Building2,
  Sun,
  Moon,
  Maximize2,
  Minimize2,
  Layers,
  Sparkles,
  FileSpreadsheet,
  LogOut,
  Loader2
} from 'lucide-react';
import { UserAccount } from '../types';
import { logOut } from '../firebase';

interface SiemensSidebarProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  navigatingTab?: string | null;
  pendingOTCount: number;
  pendingUserCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenAuthModal: () => void;
  onSignOut?: () => void;
}

export const SiemensSidebar: React.FC<SiemensSidebarProps> = ({
  currentUser,
  theme,
  onToggleTheme,
  isFullscreen,
  onToggleFullscreen,
  activeTab,
  onSelectTab,
  navigatingTab,
  pendingOTCount,
  pendingUserCount,
  isCollapsed,
  onToggleCollapse,
  onOpenAuthModal,
  onSignOut,
}) => {
  const isDark = theme === 'dark';

  const menuItems = [
    { 
      id: 'roster', 
      label: 'Shift Roster', 
      sublabel: 'ตารางกะการทำงาน', 
      icon: Calendar,
      badge: null 
    },
    { 
      id: 'upload-shift-plan', 
      label: 'Upload Shift Plan', 
      sublabel: 'อัปโหลดตารางกะรายแผนก (Excel/CSV)', 
      icon: FileSpreadsheet,
      badge: null 
    },
    { 
      id: 'timesheet', 
      label: 'Time Sheet', 
      sublabel: 'บันทึกเวลาทำงานรายบุคคล', 
      icon: Clock,
      badge: null 
    },
    { 
      id: 'statistics', 
      label: 'Statistics', 
      sublabel: 'สถิติการทำงานและการลา (Late/Leaves)', 
      icon: BarChart3,
      badge: null 
    },
    { 
      id: 'import', 
      label: 'Data Import Center', 
      sublabel: 'นำเข้าข้อมูลรวม (Punches, OT, Allowances)', 
      icon: Upload,
      badge: pendingOTCount > 0 ? `${pendingOTCount} OT` : null,
      badgeColor: 'bg-amber-500 text-slate-950 font-bold'
    },
    { 
      id: 'export', 
      label: 'Reports & Export', 
      sublabel: 'ส่งออกรายงาน Time Sheet & Payroll', 
      icon: Download,
      badge: null 
    },
    { 
      id: 'employees', 
      label: 'Employee Master', 
      sublabel: 'ฐานข้อมูลพนักงานประจำแผนก', 
      icon: Users,
      badge: null 
    },
    { 
      id: 'users', 
      label: 'User Accounts', 
      sublabel: 'จัดการสิทธิ์ผู้ใช้งานและบทบาท', 
      icon: ShieldCheck,
      badge: pendingUserCount > 0 ? `${pendingUserCount} Users` : null,
      badgeColor: 'bg-teal-400 text-slate-950 font-bold'
    },
    {
      id: 'manage_account',
      label: 'Manage My Account',
      sublabel: 'จัดการข้อมูลส่วนตัวและรหัสผ่าน',
      icon: UserCircle2,
      badge: null
    },
    { 
      id: 'settings', 
      label: 'Settings & Cloud', 
      sublabel: 'ตั้งค่าระบบและฐานข้อมูล Cloud', 
      icon: Settings,
      badge: null 
    },
  ];

  return (
    <aside
      id="siemens-ix-sidebar"
      className={`relative z-20 flex flex-col border-r transition-all duration-300 select-none ${
        isCollapsed ? 'w-18' : 'w-64'
      } ${
        isDark 
          ? 'bg-[#0b1219] border-[#1e2e3d] text-slate-200' 
          : 'bg-[#00383e] border-[#002b30] text-slate-100 shadow-xl'
      }`}
    >
      {/* Brand & System Title */}
      <div className={`p-3.5 border-b flex items-center justify-between ${
        isDark ? 'border-[#1e2e3d] bg-[#080d12]' : 'border-[#002b30] bg-[#002f34]'
      }`}>
        <div className="flex items-center space-x-2.5 overflow-hidden">
          {/* Siemens Logo Icon */}
          <div className="w-8 h-8 rounded shrink-0 bg-gradient-to-br from-[#00e5e5] to-[#008b99] flex items-center justify-center shadow-sm">
            <span className="font-black text-slate-950 text-xs tracking-tighter">S</span>
          </div>

          {!isCollapsed && (
            <div className="flex flex-col truncate">
              <div className="flex items-center space-x-1.5">
                <span className="font-extrabold tracking-wider text-base text-[#00e5e5]">
                  SIEMENS
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-teal-500/20 text-[#00e5e5] border border-teal-500/30 font-mono font-bold">
                  IX
                </span>
              </div>
              <span className="text-[10px] text-slate-400 truncate">
                MO CS BTS • Shift & TimeSheet
              </span>
            </div>
          )}
        </div>

        {/* Collapse / Expand Toggle Button */}
        <button
          id="btn-sidebar-collapse"
          onClick={onToggleCollapse}
          title={isCollapsed ? 'ขยายแถบเมนู (Expand)' : 'ย่อแถบเมนู (Collapse)'}
          className={`p-1.5 rounded transition ${
            isDark 
              ? 'hover:bg-[#182635] text-slate-400 hover:text-white' 
              : 'hover:bg-white/15 text-slate-300 hover:text-white'
          }`}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Main Navigation Menu */}
      <nav className="flex-1 py-3 px-2 space-y-1.5 overflow-y-auto scrollbar-thin">
        {!isCollapsed && (
          <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            ระบบงานหลัก (Main Modules)
          </div>
        )}

        {menuItems.map(item => {
          const isActive = activeTab === item.id;
          const isNavigatingThis = navigatingTab === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              id={`sidebar-tab-${item.id}`}
              onClick={() => onSelectTab(item.id)}
              disabled={isNavigatingThis}
              title={isCollapsed ? `${item.label} (${item.sublabel})` : undefined}
              className={`w-full flex items-center rounded-md transition group text-left relative ${
                isCollapsed ? 'justify-center p-2.5' : 'px-3 py-2.5 space-x-3'
              } ${
                isActive
                  ? isDark
                    ? 'bg-[#142838] text-[#00e5e5] font-semibold border-l-3 border-[#00e5e5] shadow-xs'
                    : 'bg-white/20 text-white font-semibold border-l-3 border-[#00e5e5] shadow-sm'
                  : isDark
                    ? 'text-slate-300 hover:bg-[#121c27] hover:text-white border-l-3 border-transparent'
                    : 'text-slate-200 hover:bg-white/10 hover:text-white border-l-3 border-transparent'
              } ${isNavigatingThis ? 'ring-1 ring-[#00e5e5]/50 bg-[#00e5e5]/10 animate-pulse' : ''}`}
            >
              {isNavigatingThis ? (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin text-[#00e5e5]" />
              ) : (
                <Icon className={`w-4 h-4 shrink-0 transition ${
                  isActive ? 'text-[#00e5e5]' : 'text-slate-400 group-hover:text-slate-200'
                }`} />
              )}

              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate flex items-center justify-between">
                    <span className="flex items-center space-x-1.5">
                      <span>{item.label}</span>
                      {isNavigatingThis && (
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#00e5e5]/20 text-[#00e5e5] animate-pulse">
                          กำลังโหลด...
                        </span>
                      )}
                    </span>
                    {item.badge && !isNavigatingThis && (
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ml-1 ${
                        item.badgeColor || 'bg-teal-500 text-slate-900'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate opacity-80">
                    {item.sublabel}
                  </div>
                </div>
              )}

              {/* Badge for Collapsed Mode */}
              {isCollapsed && item.badge && !isNavigatingThis && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-slate-900" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Area: User Card & Quick Controls */}
      <div className={`p-2.5 border-t ${
        isDark ? 'border-[#1e2e3d] bg-[#091017]' : 'border-[#002b30] bg-[#00282c]'
      }`}>
        {/* User Card */}
        <div
          onClick={() => onSelectTab('manage_account')}
          title="จัดการบัญชี (Manage Account)"
          className={`flex items-center rounded-md p-2 cursor-pointer transition ${
            isCollapsed ? 'justify-center' : 'space-x-2.5'
          } ${
            isDark 
              ? 'hover:bg-[#152332] bg-[#0f1924] border border-[#203448]' 
              : 'hover:bg-white/15 bg-white/10 border border-white/10'
          }`}
        >
          <div className="relative shrink-0">
            <UserCircle2 className="w-6 h-6 text-[#00e5e5]" />
            <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full ${
              currentUser.role === 'Admin' ? 'bg-red-400' : 'bg-emerald-400'
            }`} />
          </div>

          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate flex items-center justify-between">
                <span className="truncate">{currentUser.name}</span>
                <span className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold ${
                  currentUser.role === 'Admin'
                    ? 'bg-red-500/25 text-red-300 border border-red-500/30'
                    : 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/30'
                }`}>
                  {currentUser.role}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                แผนก: <span className="text-teal-300 font-medium">{currentUser.department}</span>
              </div>
            </div>
          )}
        </div>

        {/* Quick Utilities */}
        <div className={`mt-2 flex items-center ${isCollapsed ? 'flex-col space-y-1' : 'justify-between px-1'}`}>
          <div className="flex items-center space-x-1">
            <button
              onClick={() => {
                if (onSignOut) {
                  onSignOut();
                } else {
                  logOut();
                }
              }}
              className={`p-1.5 rounded transition cursor-pointer ${
                isDark ? 'text-slate-400 hover:text-rose-300 hover:bg-rose-500/25' : 'text-slate-200 hover:text-white hover:bg-rose-600/30'
              }`}
              title="ออกจากระบบ (Sign Out)"
            >
              <LogOut className="w-4 h-4" />
            </button>
            <button
              onClick={onToggleTheme}
              title={isDark ? 'สลับเป็นธีมสว่าง (Light Mode)' : 'สลับเป็นธีมมืด (Dark Mode)'}
              className={`p-1.5 rounded text-xs transition ${
                isDark 
                  ? 'text-amber-400 hover:bg-[#182635]' 
                  : 'text-amber-300 hover:bg-white/15'
              }`}
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'ย่อหน้าต่าง' : 'โหมดเต็มหน้าจอ (Full Screen)'}
              className={`p-1.5 rounded text-xs transition ${
                isDark 
                  ? 'text-slate-300 hover:bg-[#182635]' 
                  : 'text-white hover:bg-white/15'
              }`}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>

          {!isCollapsed && (
            <span className="text-[9px] font-mono text-slate-400">
              v1.0 • Siemens IX
            </span>
          )}
        </div>
      </div>
    </aside>
  );
};
