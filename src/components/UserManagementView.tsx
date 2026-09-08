import React, { useState, useMemo } from 'react';
import { UserAccount } from '../types';
import { storage } from '../utils/storage';
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
  UserCircle2
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
  const users = storage.getUsers();

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'Admin' | 'User'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Active' | 'Pending_Approval' | 'Deactivated'>('ALL');

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserAccount | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  const [userForm, setUserForm] = useState<Partial<UserAccount>>({
    name: '',
    email: '',
    department: 'GM',
    role: 'User',
    status: 'Active',
  });

  const showNotification = (type: 'success' | 'warning' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(prev => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // Toggle user activation / approval
  const handleToggleStatus = (targetUser: UserAccount) => {
    if (!isAdmin) return;
    if (targetUser.id === currentUser.id) {
      showNotification('warning', 'ไม่สามารถระงับสิทธิ์บัญชีของตนเองได้');
      return;
    }

    const nextStatus: UserAccount['status'] = targetUser.status === 'Active' ? 'Deactivated' : 'Active';
    const updated = users.map(u => u.id === targetUser.id ? { ...u, status: nextStatus } : u);
    storage.setUsers(updated);
    onUserChanged();
    showNotification('success', `เปลี่ยนสถานะบัญชี ${targetUser.email} เป็น ${nextStatus} สำเร็จ`);
  };

  // Change user role (Admin vs User)
  const handleChangeRole = (targetUser: UserAccount, newRole: 'Admin' | 'User') => {
    if (!isAdmin) return;
    if (targetUser.id === currentUser.id) {
      showNotification('warning', 'ไม่สามารถเปลี่ยน Role ของตนเองได้');
      return;
    }

    const updated = users.map(u => u.id === targetUser.id ? { ...u, role: newRole } : u);
    storage.setUsers(updated);
    onUserChanged();
    
    if (newRole === 'User') {
      showNotification('success', `ปรับ Role ของ ${targetUser.name} เป็น User เรียบร้อยแล้ว (สามารถลบบัญชีนี้ได้แล้ว)`);
    } else {
      showNotification('success', `ปรับ Role ของ ${targetUser.name} เป็น Admin เรียบร้อยแล้ว (ได้รับการป้องกันการลบ)`);
    }
  };

  // Change user department
  const handleChangeDept = (targetUser: UserAccount, newDept: string) => {
    if (!isAdmin) return;
    const updated = users.map(u => u.id === targetUser.id ? { ...u, department: newDept } : u);
    storage.setUsers(updated);
    onUserChanged();
    showNotification('success', `เปลี่ยนแผนกของ ${targetUser.name} เป็น ${newDept} สำเร็จ`);
  };

  // Delete User handler
  const confirmDeleteUser = () => {
    if (!userToDelete || !isAdmin) return;

    // Strict validation
    if (userToDelete.id === currentUser.id) {
      showNotification('error', 'ไม่สามารถลบบัญชีของตนเองได้');
      setUserToDelete(null);
      return;
    }

    if (userToDelete.role === 'Admin') {
      showNotification('error', 'ไม่สามารถลบบัญชีระดับ Admin ได้โดยตรง กรุณาปรับ Role เป็น User ก่อน');
      setUserToDelete(null);
      return;
    }

    const targetEmail = userToDelete.email;
    const targetName = userToDelete.name;
    const updated = users.filter(u => u.id !== userToDelete.id);
    storage.setUsers(updated);
    onUserChanged();
    setUserToDelete(null);
    showNotification('success', `ลบบัญชีผู้ใช้ ${targetName} (${targetEmail}) ออกจากระบบเรียบร้อยแล้ว`);
  };

  // Add new user
  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!userForm.name || !userForm.email) return;

    if (users.some(u => u.email.toLowerCase() === userForm.email?.toLowerCase())) {
      showNotification('error', 'อีเมลนี้มีอยู่ในระบบแล้ว');
      return;
    }

    const newUser: UserAccount = {
      id: `usr-${Date.now()}`,
      email: userForm.email.trim(),
      name: userForm.name.trim(),
      department: userForm.department || 'GM',
      role: userForm.role || 'User',
      status: userForm.status || 'Active',
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    };

    storage.setUsers([...users, newUser]);
    setIsAddModalOpen(false);
    onUserChanged();
    showNotification('success', `สร้างบัญชีผู้ใช้ ${newUser.name} สำเร็จ`);
  };

  // Filtered users list
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const matchesSearch = 
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.department.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
      const matchesStatus = statusFilter === 'ALL' || u.status === statusFilter;

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
              Admin: สิทธิ์เต็มรูปแบบจัดการทุกแผนกและลบบัญชี User | User: สิทธิ์เฉพาะแผนกของตนเอง
            </p>
          </div>
        </div>

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
            : notification.type === 'warning'
              ? isDark ? 'bg-amber-500/15 border-amber-500/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800'
              : isDark ? 'bg-red-500/15 border-red-500/30 text-red-200' : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {notification.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 text-teal-400" />}
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
                          <select
                            value={u.department}
                            onChange={e => handleChangeDept(u, e.target.value)}
                            className={`p-1.5 rounded font-mono text-xs border cursor-pointer ${
                              isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-white border-slate-300 text-slate-800'
                            }`}
                          >
                            <option value="ALL">ALL (ทุกแผนก)</option>
                            {storage.getDepartments().map(d => (
                              <option key={d.code} value={d.code}>{d.code} - {d.name}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-mono font-semibold text-teal-400">{u.department}</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="p-3 text-center border-r border-inherit">
                        <span className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-medium ${
                          u.status === 'Active'
                            ? isDark ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : u.status === 'Pending_Approval'
                              ? isDark ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-amber-50 text-amber-700 border border-amber-200'
                              : isDark ? 'bg-red-500/15 text-red-300 border border-red-500/30' : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                          {u.status === 'Active' && <CheckCircle2 className="w-3 h-3" />}
                          {u.status === 'Pending_Approval' && <Clock className="w-3 h-3" />}
                          {u.status === 'Deactivated' && <XCircle className="w-3 h-3" />}
                          <span>{u.status === 'Pending_Approval' ? 'รออนุมัติ' : u.status}</span>
                        </span>
                      </td>

                      {/* Actions Column */}
                      <td className="p-3 text-center">
                        {isAdmin && !isMe ? (
                          <div className="flex items-center justify-center space-x-2">
                            {/* Toggle Status Button */}
                            <button
                              onClick={() => handleToggleStatus(u)}
                              title={u.status === 'Active' ? 'ระงับสิทธิ์การใช้งาน (Deactivate)' : 'เปิดใช้งาน / อนุมัติสิทธิ์ (Activate/Approve)'}
                              className={`px-2.5 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                                u.status === 'Active'
                                  ? isDark ? 'bg-slate-700/40 hover:bg-red-500/20 text-slate-300 hover:text-red-300 border border-slate-600/40' : 'bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-700 border border-slate-300'
                                  : isDark ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40' : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300'
                              }`}
                            >
                              {u.status === 'Active' ? 'Deactivate' : 'Approve / Activate'}
                            </button>

                            {/* Delete Button (User: Active, Admin: Protected/Disabled) */}
                            {!isTargetAdmin ? (
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
                                title="บัญชี Admin ไม่สามารถลบได้โดยตรง (ต้องปรับ Role เป็น User ก่อน)"
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
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-xs">
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
                onClick={() => setUserToDelete(null)}
                className={`px-3.5 py-1.5 rounded text-xs transition cursor-pointer ${
                  isDark ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                }`}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={confirmDeleteUser}
                className="px-4 py-1.5 rounded text-xs font-bold bg-red-600 hover:bg-red-700 text-white shadow transition flex items-center space-x-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>ยืนยันการลบบัญชี</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-xs">
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
                      <option key={d.code} value={d.code}>{d.code} - {d.name}</option>
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
    </div>
  );
};
