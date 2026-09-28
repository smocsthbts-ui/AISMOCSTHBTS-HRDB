import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { UserAccount } from '../types';
import { storage } from '../utils/storage';
import { firestoreSync, subscribeToUserChanges, isDemoUser } from '../firebase';
import { 
  ShieldCheck, 
  UserCheck, 
  UserPlus, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Lock, 
  Building2,
  Trash2,
  AlertTriangle,
  Search,
  Filter,
  Info,
  UserX,
  Mail,
  UserCircle2,
  RefreshCw
} from 'lucide-react';

interface UserManagementViewProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  onUserChanged: () => void;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({
  currentUser,
  theme,
  onUserChanged,
}) => {
  const isDark = theme === 'dark';
  const isAdmin = currentUser.role === 'Admin';
  const [users, setUsers] = useState<UserAccount[]>(() => storage.getUsers());
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);

  // Real-time synchronization for multi-user account changes
  const refreshUsers = useCallback(() => {
    setUsers(storage.getUsers());
  }, []);

  // Manual cloud refresh handler
  const handleManualCloudSync = async () => {
    setIsSyncingCloud(true);
    try {
      const fresh = await firestoreSync.fetchAllFromCloud();
      if (fresh && fresh.users && fresh.users.length > 0) {
        storage.setUsers(fresh.users);
        setUsers(fresh.users);
        const pendingCount = fresh.users.filter(u => u.status === 'Pending_Approval').length;
        showNotification(
          'success', 
          `ดึงข้อมูลผู้ใช้จาก Cloud Firestore สำเร็จ (พบทั้งหมด ${fresh.users.length} บัญชี, รออนุมัติ ${pendingCount} บัญชี)`
        );
      } else {
        refreshUsers();
        showNotification('success', 'ซิงค์ข้อมูลผู้ใช้จาก Cloud เรียบร้อยแล้ว');
      }
      onUserChanged();
    } catch (err: any) {
      console.warn('Manual cloud sync error:', err);
      showNotification('error', `ไม่สามารถดึงข้อมูลจาก Cloud ได้: ${err?.message || 'โปรดลองอีกครั้ง'}`);
    } finally {
      setIsSyncingCloud(false);
    }
  };

  useEffect(() => {
    // 1. Initial load from local cache
    refreshUsers();

    // 2. Fetch directly from Cloud Firestore to pick up newly registered users
    const syncFromCloud = async () => {
      try {
        const fresh = await firestoreSync.fetchAllFromCloud();
        if (fresh && fresh.users && fresh.users.length > 0) {
          storage.setUsers(fresh.users);
          setUsers(fresh.users);
        }
      } catch (err) {
        console.warn('UserManagementView auto sync error:', err);
      }
    };
    syncFromCloud();

    // 3. Realtime listener directly for user changes
    const unsubUserChanges = subscribeToUserChanges((cloudUsers) => {
      if (cloudUsers && cloudUsers.length > 0) {
        storage.updateUsersFromCloud(cloudUsers);
        setUsers(storage.getUsers());
      } else {
        refreshUsers();
      }
    });

    window.addEventListener('siemens-data-updated', refreshUsers);
    window.addEventListener('storage-changed', refreshUsers);
    window.addEventListener('firestore-sync-completed', refreshUsers);
    return () => {
      unsubUserChanges();
      window.removeEventListener('siemens-data-updated', refreshUsers);
      window.removeEventListener('storage-changed', refreshUsers);
      window.removeEventListener('firestore-sync-completed', refreshUsers);
    };
  }, [refreshUsers]);

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'Admin' | 'User'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Active' | 'Pending_Approval' | 'Deactivated'>('ALL');

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserAccount | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'warning' | 'error' | 'info'; message: string } | null>(null);

  const [userForm, setUserForm] = useState<Partial<UserAccount>>({
    name: '',
    email: '',
    department: 'GM',
    role: 'User',
    status: 'Active',
  });

  // Activate User State (assign role & department)
  const [userToActivate, setUserToActivate] = useState<UserAccount | null>(null);
  const [activateRole, setActivateRole] = useState<'Admin' | 'User'>('User');
  const [activateDept, setActivateDept] = useState<string>('GM');
  const [isActivating, setIsActivating] = useState<boolean>(false);
  const [matchedEmpInfo, setMatchedEmpInfo] = useState<any>(null);

  const pendingUsers = useMemo(() => {
    return users.filter(u => u.status === 'Pending_Approval');
  }, [users]);

  // Escape key handler to close modals instantly
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isAddModalOpen) setIsAddModalOpen(false);
        if (userToDelete) setUserToDelete(null);
        if (userToActivate) setUserToActivate(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddModalOpen, userToDelete, userToActivate]);

  const openActivateModal = (targetUser: UserAccount) => {
    setUserToActivate(targetUser);
    setActivateRole(targetUser.role || 'User');
    
    // Check matching employee in master
    const employees = storage.getEmployees();
    const cleanEmail = targetUser.email.toLowerCase();
    const matchedEmp = employees.find(e => 
      (e.gid && cleanEmail.includes(e.gid.toLowerCase())) ||
      (e.empNo && cleanEmail.includes(e.empNo.toLowerCase())) ||
      (e.firstName && cleanEmail.includes(e.firstName.toLowerCase()))
    );
    setMatchedEmpInfo(matchedEmp || null);

    if (targetUser.department && targetUser.department !== 'PENDING') {
      setActivateDept(targetUser.department);
    } else if (matchedEmp?.department) {
      setActivateDept(matchedEmp.department);
    } else {
      setActivateDept('GM');
    }
  };

  const handleConfirmActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToActivate || !isAdmin || isActivating) return;
    setIsActivating(true);

    const targetUser = userToActivate;
    const activatedUser: UserAccount = {
      ...targetUser,
      status: 'Active' as const,
      role: activateRole,
      department: activateDept,
      activatedAt: new Date().toISOString(),
      assignedBy: currentUser.email,
    };

    try {
      // 1. Instant Optimistic UI Update: update list & close modal immediately
      const updated = users.map(u => 
        (u.id === activatedUser.id || u.email.toLowerCase() === activatedUser.email.toLowerCase()) 
          ? activatedUser 
          : u
      );
      setUsers(updated);
      setUserToActivate(null);
      showNotification('success', `ทำการ Activate User บัญชี ${targetUser.name} (${targetUser.email}) เรียบร้อยแล้ว (บทบาท: ${activateRole}, แผนก: ${activateDept})`);
      onUserChanged();

      // 2. Persist to storage & Cloud Firestore in background
      await storage.saveUser(activatedUser);
    } catch (err: any) {
      console.warn('Activate user warning:', err);
    } finally {
      setIsActivating(false);
    }
  };

  const showNotification = (type: 'success' | 'warning' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(prev => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // Change user status (Active, Pending_Approval, Deactivated)
  const handleChangeStatus = async (targetUser: UserAccount, nextStatus: UserAccount['status']) => {
    if (!isAdmin) return;
    if (targetUser.id === currentUser.id || targetUser.email.trim().toLowerCase() === 'smo.cs.th.bts@gmail.com') {
      showNotification('warning', 'ไม่สามารถปรับสถานะบัญชี Admin หลักได้');
      return;
    }

    const updatedUser: UserAccount = { 
      ...targetUser, 
      status: nextStatus,
      updatedAt: new Date().toISOString()
    };
    
    // Optimistic UI update
    const updated = users.map(u => 
      (u.id === targetUser.id || u.email.toLowerCase() === targetUser.email.toLowerCase()) 
        ? updatedUser 
        : u
    );
    setUsers(updated);
    onUserChanged();

    const statusLabels: Record<string, string> = {
      'Active': 'Active (เปิดใช้งาน)',
      'Pending_Approval': 'Pending Approval (รอ Admin อนุมัติ)',
      'Deactivated': 'Deactivated (ระงับสิทธิ์)',
    };
    showNotification('success', `ปรับสถานะบัญชี ${targetUser.email} เป็น ${statusLabels[nextStatus || 'Active']} เรียบร้อยแล้ว`);

    try {
      await storage.saveUser(updatedUser);
    } catch (err) {
      console.warn('Status change save error:', err);
    }
  };

  // Legacy toggle status wrapper
  const handleToggleStatus = async (targetUser: UserAccount) => {
    const nextStatus = targetUser.status === 'Active' ? 'Deactivated' : 'Active';
    await handleChangeStatus(targetUser, nextStatus);
  };

  // Change user role (Admin vs User)
  const handleChangeRole = async (targetUser: UserAccount, newRole: 'Admin' | 'User') => {
    if (!isAdmin) return;
    if (targetUser.id === currentUser.id) {
      showNotification('warning', 'ไม่สามารถเปลี่ยน Role ของตนเองได้');
      return;
    }

    const updatedUser: UserAccount = { 
      ...targetUser, 
      role: newRole,
      updatedAt: new Date().toISOString()
    };
    
    // Instant optimistic update
    const updated = users.map(u => 
      (u.id === targetUser.id || u.email.toLowerCase() === targetUser.email.toLowerCase()) ? updatedUser : u
    );
    setUsers(updated);
    onUserChanged();

    if (newRole === 'User') {
      showNotification('success', `ปรับ Role ของ ${targetUser.name} เป็น User เรียบร้อยแล้ว (สามารถลบบัญชีนี้ได้แล้ว)`);
    } else {
      showNotification('success', `ปรับ Role ของ ${targetUser.name} เป็น Admin เรียบร้อยแล้ว (ได้รับการป้องกันการลบ)`);
    }

    try {
      await storage.saveUser(updatedUser);
    } catch (err) {
      console.warn('Role change save error:', err);
    }
  };

  // Change user department
  const handleChangeDept = async (targetUser: UserAccount, newDept: string) => {
    if (!isAdmin) return;
    const updatedUser: UserAccount = { 
      ...targetUser, 
      department: newDept,
      updatedAt: new Date().toISOString()
    };
    
    // Instant optimistic update
    const updated = users.map(u => 
      (u.id === targetUser.id || u.email.toLowerCase() === targetUser.email.toLowerCase()) ? updatedUser : u
    );
    setUsers(updated);
    onUserChanged();
    showNotification('success', `เปลี่ยนแผนกของ ${targetUser.name} เป็น ${newDept} สำเร็จ`);

    try {
      await storage.saveUser(updatedUser);
    } catch (err) {
      console.warn('Dept change save error:', err);
    }
  };

  // Delete User handler (permanently removes from LocalStorage and Cloud Firestore)
  const confirmDeleteUser = async () => {
    if (!userToDelete || !isAdmin || isDeleting) return;

    // Strict validation
    if (userToDelete.id === currentUser.id) {
      showNotification('error', 'ไม่สามารถลบบัญชีของตนเองได้');
      setUserToDelete(null);
      return;
    }

    if (userToDelete.email?.trim().toLowerCase() === 'smo.cs.th.bts@gmail.com') {
      showNotification('error', 'ไม่สามารถลบบัญชี Admin หลักของระบบได้');
      setUserToDelete(null);
      return;
    }

    setIsDeleting(true);
    const targetEmail = userToDelete.email;
    const targetName = userToDelete.name;
    const targetId = userToDelete.id;

    // Immediately close modal to eliminate modal freezing/hanging
    setUserToDelete(null);

    try {
      await storage.deleteUser(targetId, targetEmail);
      onUserChanged();
      showNotification('success', `ลบบัญชีผู้ใช้ ${targetName} (${targetEmail}) ออกจากฐานข้อมูลเรียบร้อยแล้วอย่างถาวร`);
    } catch (err: any) {
      showNotification('error', `เกิดข้อผิดพลาดในการลบบัญชี: ${err?.message || 'โปรดลองใหม่อีกครั้ง'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Add new user
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!userForm.name || !userForm.email) return;

    const cleanEmail = userForm.email.trim().toLowerCase();
    const currentUsers = storage.getUsers();
    const existing = currentUsers.find(u => u.email.trim().toLowerCase() === cleanEmail);
    if (existing) {
      showNotification('error', `อีเมล ${cleanEmail} มีอยู่ในระบบแล้ว (สถานะ: ${existing.status || 'Active'}, แผนก: ${existing.department || '-'}) ไม่สามารถสร้างซ้ำได้`);
      return;
    }

    const newUser: UserAccount = {
      id: `usr-${Date.now()}`,
      email: cleanEmail,
      name: userForm.name.trim(),
      department: userForm.department || 'GM',
      role: userForm.role || 'User',
      status: userForm.status || 'Active',
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Close modal immediately and clear form to prevent UI hang
    setIsAddModalOpen(false);
    setUserForm({ name: '', email: '', department: 'GM', role: 'User', status: 'Active' });
    showNotification('info', `กำลังสร้างและซิงค์บัญชีผู้ใช้ ${newUser.name}...`);

    try {
      await storage.saveUser(newUser);
      onUserChanged();
      showNotification('success', `สร้างบัญชีผู้ใช้ ${newUser.name} (${newUser.email}) สำเร็จ`);
    } catch (err: any) {
      showNotification('error', `เกิดข้อผิดพลาดในการสร้างบัญชี: ${err?.message || 'โปรดลองอีกครั้ง'}`);
    }
  };

  // Filtered users list (strictly deduplicated by email and excluding demo users)
  const filteredUsers = useMemo(() => {
    const uMap = new Map<string, UserAccount>();
    users.forEach(u => {
      if (u && u.email && !isDemoUser(u)) {
        const cleanEmail = u.email.trim().toLowerCase();
        const existing = uMap.get(cleanEmail);
        if (!existing) {
          uMap.set(cleanEmail, u);
        } else {
          // Merge keeping Active status
          const isActive = u.status?.toLowerCase() === 'active' || existing.status?.toLowerCase() === 'active';
          uMap.set(cleanEmail, {
            ...existing,
            ...u,
            status: isActive ? 'Active' : (u.status || existing.status),
          });
        }
      }
    });
    const uniqueUsers = Array.from(uMap.values()).filter(u => !isDemoUser(u));

    return uniqueUsers.filter(u => {
      const matchesSearch = 
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.department.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
      const matchesStatus = statusFilter === 'ALL' || 
        (statusFilter === 'Active' && u.status?.toLowerCase() === 'active') ||
        (statusFilter === 'Pending_Approval' && (u.status?.toLowerCase().includes('pending'))) ||
        (statusFilter === 'Deactivated' && u.status?.toLowerCase() === 'deactivated');

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  return (
    <div className={`p-4 md:p-6 flex flex-col space-y-4 min-h-full ${
      isDark ? 'bg-[#091017] text-slate-100' : 'bg-[#f4f7f9] text-slate-800'
    }`}>
      {/* Header Banner */}
      <div className={`p-4 rounded border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
        isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/30">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-base font-bold flex items-center gap-2">
              การจัดการสิทธิ์และบัญชีผู้ใช้งาน (User Accounts & Roles)
            </h1>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              {isAdmin 
                ? 'Admin: สิทธิ์เต็มรูปแบบจัดการทุกแผนก อนุมัติผู้ใช้ และกำหนดสิทธิ์' 
                : `Role User (${currentUser.name}): โหมดเรียกดูข้อมูลผู้ใช้งาน (View Only) • การเพิ่ม อนุมัติ กำหนดบทบาท และลบบัญชีสงวนไว้สำหรับ Admin เท่านั้น`}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleManualCloudSync}
            disabled={isSyncingCloud}
            title="ดึงข้อมูลผู้ใช้ล่าสุดทั้งหมดจาก Cloud Firestore"
            className={`flex items-center space-x-1.5 px-3 py-2 rounded font-medium text-xs border transition cursor-pointer ${
              isDark 
                ? 'bg-[#152332] hover:bg-[#1a2c40] text-teal-300 border-teal-500/40' 
                : 'bg-teal-50 hover:bg-teal-100 text-teal-800 border-teal-300 shadow-xs'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCloud ? 'animate-spin text-teal-400' : ''}`} />
            <span>{isSyncingCloud ? 'กำลังซิงค์...' : 'รีเฟรชผู้ใช้จาก Cloud'}</span>
          </button>

          {isAdmin && (
            <button
              onClick={() => {
                setUserForm({
                  name: '',
                  email: '',
                  department: 'GM',
                  role: 'User',
                  status: 'Active',
                });
                setIsAddModalOpen(true);
              }}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded font-semibold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>สร้างบัญชีผู้ใช้ใหม่</span>
            </button>
          )}
        </div>
      </div>

      {/* Pending Approval Alert Callout Banner for Admin */}
      {isAdmin && pendingUsers.length > 0 && (
        <div className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm ${
          isDark 
            ? 'bg-gradient-to-r from-amber-950/40 via-[#192534] to-[#121e2b] border-amber-500/40 text-slate-200' 
            : 'bg-amber-50 border-amber-300 text-amber-900'
        }`}>
          <div className="flex items-start space-x-3">
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40 shrink-0 mt-0.5">
              <Clock className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="font-bold text-sm text-amber-400 flex items-center gap-2">
                <span>มีบัญชีผู้ใช้ใหม่รอ Verify จาก Admin ({pendingUsers.length} ท่าน)</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Google / @siemens.com
                </span>
              </div>
              <p className="text-xs opacity-90 mt-1">
                มีพนักงานเข้าสู่ระบบครั้งแรกด้วย Google Account หรือ Email @siemens.com ระบบได้บันทึกบัญชีไว้แล้ว รอให้ Admin ทำการ Activate User เพื่อกำหนดบทบาท (Role) และแผนกที่รับผิดชอบ (Department)
              </p>
            </div>
          </div>
          <button
            onClick={() => setStatusFilter(statusFilter === 'Pending_Approval' ? 'ALL' : 'Pending_Approval')}
            className={`shrink-0 px-3.5 py-2 rounded-lg text-xs font-bold border transition cursor-pointer flex items-center gap-1.5 ${
              statusFilter === 'Pending_Approval'
                ? 'bg-amber-500 text-slate-950 border-amber-400'
                : isDark ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40' : 'bg-amber-100 hover:bg-amber-200 text-amber-800 border-amber-300'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>{statusFilter === 'Pending_Approval' ? 'แสดงผู้ใช้ทั้งหมด' : `กรองเฉพาะรออนุมัติ (${pendingUsers.length})`}</span>
          </button>
        </div>
      )}

      {/* Security Policy Information Callout */}
      <div className={`p-3.5 rounded border text-xs flex items-start space-x-3 ${
        isDark ? 'bg-[#101b26] border-[#1e2e3d] text-slate-300' : 'bg-amber-50/70 border-amber-200 text-amber-900'
      }`}>
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold text-amber-400">กฎความปลอดภัยในการลบบัญชี (Account Deletion Policy):</span>
          <ul className="list-disc list-inside space-y-0.5 text-[11px] opacity-90">
            <li>Admin สามารถกดปุ่มลบบัญชี (Delete) ของผู้ใช้งานระดับ <strong>User</strong> ได้ทันที</li>
            <li>บัญชีระดับ <strong>Admin</strong> จะได้รับการป้องกัน ไม่สามารถลบได้โดยตรง หากต้องการลบ ต้องให้ <strong>Admin ท่านอื่นปรับ Role เป็น User ก่อน</strong> แล้วจึงจะสามารถลบได้</li>
            <li>Admin ไม่สามารถลบหรือเปลี่ยน Role บัญชีของตนเองได้</li>
          </ul>
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div className={`p-3.5 rounded border text-xs font-medium flex items-center space-x-2.5 transition-all ${
          notification.type === 'success'
            ? isDark ? 'bg-teal-500/15 border-teal-500/30 text-teal-200' : 'bg-teal-50 border-teal-200 text-teal-800'
            : notification.type === 'info'
              ? isDark ? 'bg-sky-500/15 border-sky-500/30 text-sky-200' : 'bg-sky-50 border-sky-200 text-sky-800'
              : notification.type === 'warning'
                ? isDark ? 'bg-amber-500/15 border-amber-500/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800'
                : isDark ? 'bg-red-500/15 border-red-500/30 text-red-200' : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {notification.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 text-teal-400" />}
          {notification.type === 'info' && <CheckCircle2 className="w-4 h-4 shrink-0 text-sky-400" />}
          {notification.type === 'warning' && <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />}
          {notification.type === 'error' && <XCircle className="w-4 h-4 shrink-0 text-red-400" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Filters Bar */}
      <div className={`p-3 rounded border flex flex-wrap items-center justify-between gap-3 text-xs ${
        isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex items-center space-x-2 flex-1 min-w-[200px] max-w-md">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อ, อีเมล หรือแผนก..."
              className={`w-full pl-8 pr-3 py-1.5 rounded border text-xs ${
                isDark 
                  ? 'bg-[#0b1219] border-[#243648] text-slate-100 placeholder-slate-500 focus:border-[#00e5e5] focus:outline-none' 
                  : 'bg-slate-50 border-slate-300 text-slate-800 placeholder-slate-400 focus:border-teal-500 focus:outline-none'
              }`}
            />
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-slate-400 text-[11px] flex items-center gap-1">
            <Filter className="w-3 h-3" /> สิทธิ์:
          </span>
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value as any)}
            className={`px-2 py-1.5 rounded border text-xs ${
              isDark ? 'bg-[#0b1219] border-[#243648] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            <option value="ALL">ทั้งหมด (All Roles)</option>
            <option value="Admin">Admin</option>
            <option value="User">User</option>
          </select>

          <span className="text-slate-400 text-[11px] ml-2">สถานะ:</span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className={`px-2 py-1.5 rounded border text-xs ${
              isDark ? 'bg-[#0b1219] border-[#243648] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            <option value="ALL">ทั้งหมด (All Status)</option>
            <option value="Active">Active</option>
            <option value="Pending_Approval">Pending Approval</option>
            <option value="Deactivated">Deactivated</option>
          </select>

          <span className={`text-[11px] px-2 py-1 rounded ml-2 ${
            isDark ? 'bg-[#0b1219] text-teal-400 border border-[#243648]' : 'bg-slate-100 text-teal-700 border border-slate-200'
          }`}>
            พบ {filteredUsers.length} บัญชี
          </span>
        </div>
      </div>

      {/* Users Table */}
      <div className={`rounded border text-xs overflow-hidden shadow-sm ${
        isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
      }`}>
        <div className="overflow-x-auto max-h-[60vh] scrollbar-thin">
          <table className="w-full border-collapse text-left">
            <thead className={`sticky top-0 z-10 ${
              isDark ? 'bg-[#0a1118] text-slate-200 border-b border-[#223344]' : 'bg-slate-100 text-slate-700 border-b border-slate-300'
            }`}>
              <tr>
                <th className="p-3 border-r border-inherit">ชื่อ - นามสกุล</th>
                <th className="p-3 border-r border-inherit">อีเมล (Email)</th>
                <th className="p-3 border-r border-inherit">ระดับสิทธิ์ (Role)</th>
                <th className="p-3 border-r border-inherit">แผนกสังกัด (Department)</th>
                <th className="p-3 border-r border-inherit text-center">สถานะบัญชี (Status)</th>
                <th className="p-3 text-center min-w-[200px]">การจัดการ (Actions)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-inherit">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    <UserX className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <span>ไม่พบบัญชีผู้ใช้งานตามเงื่อนไขที่ค้นหา</span>
                  </td>
                </tr>
              ) : (
                filteredUsers.map(u => {
                  const isMe = u.id === currentUser.id || u.email.toLowerCase() === currentUser.email.toLowerCase();
                  const isTargetAdmin = u.role === 'Admin';

                  return (
                    <tr 
                      key={u.id} 
                      className={`transition ${
                        isDark 
                          ? 'hover:bg-[#182635] border-[#1e2e3d]' 
                          : 'hover:bg-teal-50/50 border-slate-200'
                      }`}
                    >
                      {/* Name */}
                      <td className="p-3 font-semibold border-r border-inherit">
                        <div className="flex items-center space-x-2">
                          <div className={`p-1 rounded ${
                            isTargetAdmin 
                              ? isDark ? 'bg-red-500/20 text-red-300' : 'bg-red-100 text-red-700'
                              : isDark ? 'bg-teal-500/20 text-teal-300' : 'bg-teal-100 text-teal-700'
                          }`}>
                            <UserCircle2 className="w-4 h-4" />
                          </div>
                          <span className={isDark ? 'text-slate-100' : 'text-slate-800'}>{u.name}</span>
                          {isMe && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30 font-semibold">
                              (คุณ)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Email */}
                      <td className="p-3 font-mono text-xs border-r border-inherit">
                        <span className={isDark ? 'text-slate-300' : 'text-slate-600'}>{u.email}</span>
                      </td>

                      {/* Role selector */}
                      <td className="p-3 border-r border-inherit">
                        {isAdmin && !isMe ? (
                          <div className="flex items-center space-x-1.5">
                            <select
                              value={u.role}
                              onChange={e => handleChangeRole(u, e.target.value as any)}
                              className={`p-1.5 rounded font-bold text-xs outline-none border cursor-pointer transition ${
                                u.role === 'Admin'
                                  ? isDark ? 'bg-red-500/20 text-red-300 border-red-500/40' : 'bg-red-50 text-red-700 border-red-300'
                                  : isDark ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                              }`}
                            >
                              <option value="Admin" className={isDark ? 'bg-[#141f2c] text-white' : ''}>Admin (ผู้ดูแลระบบ)</option>
                              <option value="User" className={isDark ? 'bg-[#141f2c] text-white' : ''}>User (ผู้ใช้ทั่วไป)</option>
                            </select>
                          </div>
                        ) : (
                          <span className={`text-[11px] px-2.5 py-1 rounded font-mono font-bold inline-flex items-center gap-1 ${
                            u.role === 'Admin' 
                              ? isDark ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-red-100 text-red-700 border border-red-200'
                              : isDark ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                          }`}>
                            <ShieldCheck className="w-3 h-3" />
                            {u.role}
                          </span>
                        )}
                      </td>

                      {/* Department */}
                      <td className="p-3 border-r border-inherit">
                        {isAdmin && !isMe ? (
                          <div className="flex items-center space-x-1.5">
                            <select
                              value={u.department}
                              onChange={e => handleChangeDept(u, e.target.value)}
                              className={`p-1.5 rounded font-mono text-xs border cursor-pointer ${
                                u.department === 'PENDING'
                                  ? isDark ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-amber-50 border-amber-300 text-amber-800'
                                  : isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-white border-slate-300 text-slate-800'
                              }`}
                            >
                              {u.department === 'PENDING' && (
                                <option value="PENDING">PENDING (รอ Admin กำหนด)</option>
                              )}
                              <option value="ALL">ALL (ทุกแผนก)</option>
                              {storage.getDepartments().map(d => (
                                <option key={d.code} value={d.code}>{d.name && d.name !== d.code ? `${d.code} - ${d.name}` : d.code}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <span className={`font-mono font-semibold ${
                            u.department === 'PENDING' ? 'text-amber-400 italic' : 'text-teal-400'
                          }`}>
                            {u.department === 'PENDING' ? 'รอ Admin กำหนดแผนก' : u.department}
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="p-3 text-center border-r border-inherit">
                        {u.status?.toLowerCase().includes('pending') ? (
                          <span className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            isDark ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-amber-100 text-amber-800 border border-amber-300'
                          }`}>
                            <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                            <span>รอ Verify from Admin</span>
                          </span>
                        ) : (
                          <span className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-medium ${
                            u.status?.toLowerCase() === 'active'
                              ? isDark ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : isDark ? 'bg-red-500/15 text-red-300 border border-red-500/30' : 'bg-red-50 text-red-700 border border-red-200'
                          }`}>
                            {u.status?.toLowerCase() === 'active' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            <span>{u.status?.toLowerCase() === 'active' ? 'Active' : (u.status || 'Deactivated')}</span>
                          </span>
                        )}
                      </td>

                      {/* Actions Column */}
                      <td className="p-3 text-center">
                        {isAdmin && !isMe ? (
                          <div className="flex items-center justify-center space-x-2">
                            {u.status?.toLowerCase().includes('pending') ? (
                              <>
                                {/* Direct Activate User & Role Assignment Button */}
                                <button
                                  onClick={() => openActivateModal(u)}
                                  title="Activate User เพื่อกำหนดบทบาทและแผนกที่รับผิดชอบ"
                                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-md transition flex items-center space-x-1.5 cursor-pointer"
                                >
                                  <UserCheck className="w-3.5 h-3.5" />
                                  <span>Activate User & กำหนดสิทธิ์</span>
                                </button>

                                {(!isMe && u.email?.trim().toLowerCase() !== 'smo.cs.th.bts@gmail.com') && (
                                  <button
                                    onClick={() => setUserToDelete(u)}
                                    title="ปฏิเสธ / ลบบัญชีที่รออนุมัตินี้"
                                    className={`p-1.5 rounded text-xs transition flex items-center cursor-pointer ${
                                      isDark 
                                        ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30' 
                                        : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                                    }`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </>
                            ) : (
                              <>
                                {/* Activate / Edit Role & Dept Modal Opener */}
                                <button
                                  onClick={() => openActivateModal(u)}
                                  title="ปรับบทบาทและแผนกที่รับผิดชอบ"
                                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition cursor-pointer flex items-center space-x-1 ${
                                    isDark ? 'bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30' : 'bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200'
                                  }`}
                                >
                                  <UserCheck className="w-3 h-3" />
                                  <span>กำหนดสิทธิ์/แผนก</span>
                                </button>

                                {/* Toggle / Set Status Buttons */}
                                {u.status?.toLowerCase() === 'active' ? (
                                  <button
                                    onClick={() => handleChangeStatus(u, 'Deactivated')}
                                    title="ระงับสิทธิ์การใช้งาน (Deactivate)"
                                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                                      isDark 
                                        ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30' 
                                        : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                                    }`}
                                  >
                                    Deactivate
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleChangeStatus(u, 'Active')}
                                    title="เปิดใช้งานบัญชี (Activate)"
                                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                                      isDark 
                                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40' 
                                        : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300'
                                    }`}
                                  >
                                    Activate
                                  </button>
                                )}

                                {/* Delete Button */}
                                {(!isMe && u.email?.trim().toLowerCase() !== 'smo.cs.th.bts@gmail.com') ? (
                                  <button
                                    onClick={() => setUserToDelete(u)}
                                    title="ลบบัญชีผู้ใช้งานนี้อย่างถาวร"
                                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition flex items-center space-x-1 cursor-pointer ${
                                      isDark 
                                        ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 hover:border-red-500/50' 
                                        : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                                    }`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>ลบ</span>
                                  </button>
                                ) : (
                                  <button
                                    disabled
                                    title={isMe ? 'ไม่สามารถลบบัญชีของตนเองได้' : 'บัญชี Admin หลักคุ้มครองการลบ'}
                                    className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center space-x-1 opacity-50 cursor-not-allowed ${
                                      isDark 
                                        ? 'bg-slate-800 text-slate-500 border border-slate-700' 
                                        : 'bg-slate-100 text-slate-400 border border-slate-200'
                                    }`}
                                  >
                                    <Lock className="w-3.5 h-3.5" />
                                    <span>ลบ</span>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        ) : (
                          <span className={`text-[11px] italic ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                            {isMe ? '(บัญชีของคุณ)' : '-'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete User Confirmation Modal */}
      {userToDelete && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setUserToDelete(null);
          }}
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className={`w-full max-w-md rounded-lg border shadow-2xl p-5 ${
            isDark ? 'bg-[#142230] border-[#294058] text-white' : 'bg-white border-slate-300 text-slate-900'
          }`}>
            <div className="flex items-center space-x-3 pb-3 border-b border-inherit text-red-400">
              <div className="p-2 rounded bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-red-400">ยืนยันการลบบัญชีผู้ใช้งาน (Delete Account)</h3>
                <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>การดำเนินการนี้ไม่สามารถยกเลิกได้</p>
              </div>
            </div>

            <div className="my-4 space-y-3 text-xs">
              <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                คุณแน่ใจหรือไม่ว่าต้องการลบบัญชีผู้ใช้งานรายนี้ออกจากระบบ?
              </p>

              <div className={`p-3 rounded border space-y-1.5 font-mono ${
                isDark ? 'bg-[#0c141d] border-[#223344]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex justify-between">
                  <span className="text-slate-400">ชื่อ - นามสกุล:</span>
                  <span className="font-bold text-slate-200">{userToDelete.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">อีเมล:</span>
                  <span className="text-teal-400">{userToDelete.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">ระดับสิทธิ์ (Role):</span>
                  <span className="text-emerald-400 font-bold">{userToDelete.role}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">แผนกสังกัด:</span>
                  <span className="text-slate-200">{userToDelete.department}</span>
                </div>
              </div>

              <div className={`p-2.5 rounded text-[11px] ${
                isDark ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-red-50 text-red-800 border border-red-100'
              }`}>
                ⚠️ เมื่อลบแล้ว ผู้ใช้นี้จะไม่สามารถเข้าสู่ระบบหรือเข้าถึงข้อมูลตารางกะได้อีกต่อไป
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-inherit">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setUserToDelete(null)}
                className={`px-3.5 py-1.5 rounded text-xs transition cursor-pointer disabled:opacity-50 ${
                  isDark ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                }`}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={confirmDeleteUser}
                className="px-4 py-1.5 rounded text-xs font-bold bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white shadow transition flex items-center space-x-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'กำลังลบข้อมูลจากฐานข้อมูล...' : 'ยืนยันการลบบัญชี'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {isAddModalOpen && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className={`w-full max-w-md rounded-lg border shadow-2xl p-5 ${
            isDark ? 'bg-[#142230] border-[#294058] text-white' : 'bg-white border-slate-300 text-slate-900'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-inherit">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-teal-400" />
                สร้างบัญชีผู้ใช้งานใหม่ (Create User Account)
              </h3>
              <button 
                onClick={() => setIsAddModalOpen(false)} 
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="my-4 space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">ชื่อ - นามสกุล *</label>
                <input
                  type="text"
                  required
                  value={userForm.name || ''}
                  onChange={e => setUserForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="เช่น สมชาย ใจดี"
                  className={`w-full p-2.5 rounded border text-xs ${
                    isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">อีเมลพนักงาน *</label>
                <input
                  type="email"
                  required
                  value={userForm.email || ''}
                  onChange={e => setUserForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="somchai.j@siemens.com"
                  className={`w-full p-2.5 rounded border font-mono text-xs ${
                    isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">ระดับสิทธิ์ (Role)</label>
                  <select
                    value={userForm.role || 'User'}
                    onChange={e => setUserForm(prev => ({ ...prev, role: e.target.value as any }))}
                    className={`w-full p-2.5 rounded border font-semibold text-xs ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
                    }`}
                  >
                    <option value="User">User (ผู้ใช้งานทั่วไป)</option>
                    <option value="Admin">Admin (ผู้ดูแลระบบ)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">แผนกสังกัด</label>
                  <select
                    value={userForm.department || 'GM'}
                    onChange={e => setUserForm(prev => ({ ...prev, department: e.target.value }))}
                    className={`w-full p-2.5 rounded border font-mono text-xs ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
                    }`}
                  >
                    <option value="ALL">ALL (ทุกแผนก)</option>
                    {storage.getDepartments().map(d => (
                      <option key={d.code} value={d.code}>{d.name && d.name !== d.code ? `${d.code} - ${d.name}` : d.code}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-inherit">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className={`px-3 py-1.5 rounded text-xs transition cursor-pointer ${
                    isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded text-xs font-semibold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow cursor-pointer transition"
                >
                  บันทึกผู้ใช้
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Activate User & Assign Role/Department Modal */}
      {userToActivate && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setUserToActivate(null);
          }}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-xs"
        >
          <div className={`w-full max-w-lg rounded-xl border shadow-2xl overflow-hidden ${
            isDark ? 'bg-[#121d2a] border-[#223548] text-white' : 'bg-white border-slate-300 text-slate-900'
          }`}>
            {/* Top Accent Bar */}
            <div className="h-1 w-full bg-gradient-to-r from-[#00646e] via-[#00a3a6] to-[#00e5e5]" />

            <div className={`p-4 flex items-center justify-between border-b ${
              isDark ? 'bg-[#152332] border-[#223548]' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-lg bg-teal-500/15 text-teal-400 border border-teal-500/30">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">
                    Activate User — กำหนดบทบาทและแผนกที่รับผิดชอบ
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    อนุมัติเปิดใช้งานบัญชีและมอบหมายสิทธิ์การทำงาน
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setUserToActivate(null)} 
                title="ปิดหน้าต่าง"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer text-base font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmActivate} className="p-5 space-y-4 text-xs">
              {/* User Identity Box */}
              <div className={`p-3 rounded-lg border space-y-2 ${
                isDark ? 'bg-[#0c141d] border-[#1e2f41]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex items-center space-x-3">
                  {userToActivate.photoURL ? (
                    <img 
                      src={userToActivate.photoURL} 
                      alt={userToActivate.name} 
                      className="w-10 h-10 rounded-full border border-teal-500/50 object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30 flex items-center justify-center font-bold text-sm">
                      {userToActivate.name ? userToActivate.name.charAt(0).toUpperCase() : 'U'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate flex items-center gap-1.5">
                      <span>{userToActivate.name}</span>
                      {userToActivate.email.toLowerCase().endsWith('@siemens.com') && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#00646e]/30 text-[#00e5e5] border border-[#00a3a6]/40 font-mono">
                          @siemens.com
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-slate-400 text-xs truncate">
                      {userToActivate.email}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" /> รออนุมัติ
                    </span>
                  </div>
                </div>
              </div>

              {/* Matched Employee Master Suggestion */}
              {matchedEmpInfo && (
                <div className={`p-3 rounded-lg border flex items-start justify-between gap-2 text-xs ${
                  isDark ? 'bg-teal-950/20 border-teal-500/30 text-teal-200' : 'bg-teal-50 border-teal-200 text-teal-900'
                }`}>
                  <div className="space-y-0.5">
                    <div className="font-bold flex items-center gap-1 text-teal-400">
                      <span>💡 ตรวจพบในฐานข้อมูล Employee Master:</span>
                    </div>
                    <div className="text-[11px] opacity-90">
                      รหัส: <strong>{matchedEmpInfo.empNo || matchedEmpInfo.gid}</strong> • ชื่อ: {matchedEmpInfo.firstName} {matchedEmpInfo.familyName} • แผนก: <strong className="text-teal-400">{matchedEmpInfo.department}</strong>
                    </div>
                  </div>
                  {activateDept !== matchedEmpInfo.department && (
                    <button
                      type="button"
                      onClick={() => setActivateDept(matchedEmpInfo.department)}
                      className="shrink-0 px-2 py-1 rounded text-[10px] font-bold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-xs cursor-pointer"
                    >
                      ใช้แผนก {matchedEmpInfo.department}
                    </button>
                  )}
                </div>
              )}

              {/* Role Selection */}
              <div>
                <label className="block text-slate-300 font-bold mb-1.5">
                  1. กำหนดระดับบทบาท (Assign Role) *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div 
                    onClick={() => setActivateRole('User')}
                    className={`p-3 rounded-lg border cursor-pointer transition ${
                      activateRole === 'User'
                        ? isDark 
                          ? 'bg-teal-500/15 border-teal-500 text-white ring-1 ring-teal-500' 
                          : 'bg-teal-50 border-teal-500 text-teal-900 ring-1 ring-teal-500'
                        : isDark ? 'bg-[#0f1722] border-slate-700 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center gap-1.5">
                      <UserCircle2 className="w-4 h-4 text-teal-400" />
                      <span>User (ผู้ใช้งานทั่วไป)</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                      เข้าถึง ดู และจัดการตารางกะ บันทึกเวลา และทำโอทีเฉพาะในแผนกที่รับผิดชอบ
                    </p>
                  </div>

                  <div 
                    onClick={() => setActivateRole('Admin')}
                    className={`p-3 rounded-lg border cursor-pointer transition ${
                      activateRole === 'Admin'
                        ? isDark 
                          ? 'bg-red-500/15 border-red-500 text-white ring-1 ring-red-500' 
                          : 'bg-red-50 border-red-500 text-red-900 ring-1 ring-red-500'
                        : isDark ? 'bg-[#0f1722] border-slate-700 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-red-400" />
                      <span>Admin (ผู้ดูแลระบบ)</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                      สิทธิ์เต็มรูปแบบ จัดการได้ทุกแผนก อนุมัติ Activate ผู้ใช้ และนำเข้าข้อมูล OT
                    </p>
                  </div>
                </div>
              </div>

              {/* Department Responsibility */}
              <div>
                <label className="block text-slate-300 font-bold mb-1.5">
                  2. กำหนดแผนกที่รับผิดชอบ (Department Responsibility) *
                </label>
                <select
                  required
                  value={activateDept}
                  onChange={e => setActivateDept(e.target.value)}
                  className={`w-full p-2.5 rounded-lg border font-mono text-xs cursor-pointer ${
                    isDark ? 'bg-[#0f1722] border-[#294058] text-white' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}
                >
                  <option value="ALL">ALL — ทุกแผนก (All Departments)</option>
                  {storage.getDepartments().map(d => (
                    <option key={d.code} value={d.code}>
                      {d.code} — {d.name && d.name !== d.code ? d.name : d.code}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  💡 หากเลือก User ผู้ใช้จะเห็นเฉพาะพนักงานและตารางกะของแผนก <strong className="text-teal-400">{activateDept}</strong> เท่านั้น
                </p>
              </div>

              {/* Activation Status Preview */}
              <div className={`p-3 rounded-lg border flex items-center space-x-2.5 ${
                isDark ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200' : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}>
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="text-xs">
                  สถานะหลังการบันทึก: <strong className="text-emerald-400">Active (เปิดใช้งานทันที)</strong> ผู้ใช้จะสามารถเข้าสู่ระบบและเริ่มใช้งานได้ทันที
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2.5 pt-4 border-t border-inherit">
                <button
                  type="button"
                  onClick={() => setUserToActivate(null)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isActivating}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-md cursor-pointer transition flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>{isActivating ? 'กำลังบันทึกและเปิดใช้งาน...' : 'ยืนยันและเปิดใช้งาน (Activate User)'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
