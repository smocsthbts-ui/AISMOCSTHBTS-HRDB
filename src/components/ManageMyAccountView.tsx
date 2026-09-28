import React, { useState } from 'react';
import { UserAccount } from '../types';
import { storage } from '../utils/storage';
import { updateProfile, updatePassword, auth } from '../firebase';
import { 
  UserCircle2, 
  KeyRound, 
  CheckCircle2, 
  AlertCircle, 
  Building2, 
  Mail, 
  ShieldCheck, 
  Save,
  Lock,
  Sparkles,
  Info
} from 'lucide-react';

interface ManageMyAccountViewProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
}

export const ManageMyAccountView: React.FC<ManageMyAccountViewProps> = ({
  currentUser,
  theme
}) => {
  const isDark = theme === 'dark';

  const [name, setName] = useState(currentUser.name);
  const [department, setDepartment] = useState(currentUser.department);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setMessage(null);

    try {
      // 1. Update Firebase Auth Profile (if Firebase user exists)
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: name });
      }

      // 2. Update Local Storage User & Storage
      const users = storage.getUsers();
      const idx = users.findIndex(u => u.id === currentUser.id || u.email.toLowerCase() === currentUser.email.toLowerCase());
      if (idx >= 0) {
        users[idx].name = name;
        users[idx].department = department;
        storage.setUsers(users);
        storage.setCurrentUser(users[idx]);
      }
      
      setMessage({ type: 'success', text: 'บันทึกข้อมูลส่วนตัวสำเร็จเรียบร้อยแล้ว' });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล';
      setMessage({ type: 'error', text: 'เกิดข้อผิดพลาด: ' + errMsg });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน' });
      return;
    }
    
    setIsProcessing(true);
    setMessage(null);

    try {
      if (auth.currentUser) {
        await updatePassword(auth.currentUser, newPassword);
        setMessage({ type: 'success', text: 'เปลี่ยนรหัสผ่านสำเร็จเรียบร้อยแล้ว' });
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setMessage({ type: 'error', text: 'ไม่พบเซสชันการเข้าสู่ระบบใน Firebase กรุณาลองเข้าสู่ระบบใหม่อีกครั้ง' });
      }
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err.code === 'auth/requires-recent-login') {
        setMessage({ type: 'error', text: 'เพื่อความปลอดภัย กรุณาออกจากระบบและเข้าสู่ระบบใหม่อีกครั้งก่อนเปลี่ยนรหัสผ่าน' });
      } else {
        setMessage({ type: 'error', text: 'เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + (err.message || 'เกิดข้อผิดพลาด') });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={`p-4 md:p-6 flex flex-col space-y-5 min-h-full ${
      isDark ? 'bg-[#091017] text-slate-100' : 'bg-[#f4f7f9] text-slate-800'
    }`}>
      {/* Header Banner */}
      <div className={`p-4 rounded border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
        isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/30">
            <UserCircle2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-base font-bold flex items-center gap-2">
              Manage My Account (จัดการข้อมูลส่วนตัวและรหัสผ่าน)
            </h1>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              อัปเดตข้อมูลบัญชีผู้ใช้งาน สังกัดแผนก และตั้งค่ารหัสผ่านใหม่สำหรับบัญชี: <span className="font-mono text-teal-400 font-semibold">{currentUser.email}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className={`text-xs px-2.5 py-1 rounded font-mono font-bold flex items-center gap-1.5 ${
            currentUser.role === 'Admin'
              ? isDark ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-red-100 text-red-700 border border-red-200'
              : isDark ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
          }`}>
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Role: {currentUser.role}</span>
          </span>
          <span className={`text-xs px-2.5 py-1 rounded font-mono ${
            isDark ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30' : 'bg-teal-50 text-teal-700 border border-teal-200'
          }`}>
            Dept: {currentUser.department}
          </span>
        </div>
      </div>

      {/* Notification Message */}
      {message && (
        <div className={`p-3.5 rounded border text-xs font-medium flex items-center space-x-2.5 ${
          message.type === 'success' 
            ? isDark ? 'bg-teal-500/15 border-teal-500/30 text-teal-200' : 'bg-teal-50 border-teal-200 text-teal-800'
            : isDark ? 'bg-red-500/15 border-red-500/30 text-red-200' : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-teal-400" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Two Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Profile Details Card */}
        <div className={`p-5 rounded border ${
          isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          <div className="flex items-center space-x-2.5 pb-4 mb-4 border-b border-inherit">
            <div className="p-1.5 rounded bg-teal-500/10 text-teal-400">
              <UserCircle2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold">ข้อมูลโปรไฟล์ทั่วไป (Profile Information)</h2>
              <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                แก้ไขชื่อที่แสดงในระบบและแผนกที่สังกัด
              </p>
            </div>
          </div>

          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div>
              <label className={`block text-xs font-semibold mb-1.5 flex items-center justify-between ${
                isDark ? 'text-slate-300' : 'text-slate-600'
              }`}>
                <span className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span>อีเมลประจำบัญชี (Account Email)</span>
                </span>
                <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  (ไม่สามารถแก้ไขได้)
                </span>
              </label>
              <input
                type="email"
                disabled
                value={currentUser.email}
                className={`w-full p-2.5 rounded border text-xs font-mono opacity-70 cursor-not-allowed ${
                  isDark ? 'bg-[#0b1219] border-[#243648] text-slate-300' : 'bg-slate-100 border-slate-300 text-slate-600'
                }`}
              />
            </div>

            <div>
              <label className={`block text-xs font-semibold mb-1.5 flex items-center gap-1.5 ${
                isDark ? 'text-slate-300' : 'text-slate-600'
              }`}>
                <UserCircle2 className="w-3.5 h-3.5 text-teal-400" />
                <span>ชื่อ - นามสกุล (Display Name) *</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="เช่น สมชาย ใจดี"
                className={`w-full p-2.5 rounded border text-xs font-medium transition ${
                  isDark 
                    ? 'bg-[#0b1219] border-[#243648] text-slate-100 focus:border-[#00e5e5] focus:outline-none' 
                    : 'bg-slate-50 border-slate-300 text-slate-800 focus:border-teal-500 focus:outline-none'
                }`}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={`text-xs font-semibold flex items-center gap-1.5 ${
                  isDark ? 'text-slate-300' : 'text-slate-600'
                }`}>
                  <Building2 className="w-3.5 h-3.5 text-teal-400" />
                  <span>แผนกที่สังกัด (Department) *</span>
                </label>
                {currentUser.role !== 'Admin' && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-teal-500/15 text-teal-300 border border-teal-500/30">
                    กำหนดโดย Admin
                  </span>
                )}
              </div>
              <select
                value={department}
                onChange={e => setDepartment(e.target.value)}
                disabled={currentUser.role !== 'Admin'}
                className={`w-full p-2.5 rounded border text-xs font-medium font-mono transition ${
                  isDark 
                    ? 'bg-[#0b1219] border-[#243648] text-slate-100 focus:border-[#00e5e5] focus:outline-none' 
                    : 'bg-slate-50 border-slate-300 text-slate-800 focus:border-teal-500 focus:outline-none'
                } ${currentUser.role !== 'Admin' ? 'opacity-80 cursor-not-allowed' : ''}`}
              >
                {storage.getDepartments().map(d => (
                  <option key={d.code} value={d.code} className={isDark ? 'bg-[#0f1822] text-white' : 'bg-white text-slate-800'}>
                    {d.name && d.name !== d.code ? `${d.code} — ${d.name}` : d.code}
                  </option>
                ))}
              </select>
            </div>

            <div className={`p-3 rounded border text-[11px] flex items-start space-x-2 ${
              isDark ? 'bg-[#0b1219]/60 border-[#1e2e3d] text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'
            }`}>
              <Info className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
              <span>
                {currentUser.role === 'Admin'
                  ? 'Admin: สามารถปรับเปลี่ยนสังกัดแผนกของตนเองหรือสลับดูข้อมูลได้'
                  : 'Role User: สังกัดแผนกถูกกำหนดโดย Admin เพื่อความถูกต้องของสิทธิ์การจัดตารางกะ (หากต้องการปรับปรุงสังกัดแผนก กรุณาติดต่อ Admin)'}
              </span>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isProcessing}
                className="w-full py-2.5 px-4 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isProcessing ? 'กำลังบันทึกข้อมูล...' : 'บันทึกข้อมูลส่วนตัว (Save Profile)'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Password Security Card */}
        <div className={`p-5 rounded border ${
          isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          <div className="flex items-center space-x-2.5 pb-4 mb-4 border-b border-inherit">
            <div className="p-1.5 rounded bg-amber-500/10 text-amber-400">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold">ความปลอดภัยและรหัสผ่าน (Password & Security)</h2>
              <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                เปลี่ยนรหัสผ่านเพื่อความปลอดภัยในการเข้าใช้งาน
              </p>
            </div>
          </div>

          <form onSubmit={handleUpdatePassword} className="space-y-4">
            <div>
              <label className={`block text-xs font-semibold mb-1.5 flex items-center gap-1.5 ${
                isDark ? 'text-slate-300' : 'text-slate-600'
              }`}>
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>รหัสผ่านใหม่ (New Password) *</span>
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="อย่างน้อย 6 ตัวอักษร"
                className={`w-full p-2.5 rounded border text-xs font-medium transition ${
                  isDark 
                    ? 'bg-[#0b1219] border-[#243648] text-slate-100 focus:border-amber-400 focus:outline-none' 
                    : 'bg-slate-50 border-slate-300 text-slate-800 focus:border-amber-500 focus:outline-none'
                }`}
              />
            </div>

            <div>
              <label className={`block text-xs font-semibold mb-1.5 flex items-center gap-1.5 ${
                isDark ? 'text-slate-300' : 'text-slate-600'
              }`}>
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>ยืนยันรหัสผ่านใหม่อีกครั้ง (Confirm New Password) *</span>
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
                className={`w-full p-2.5 rounded border text-xs font-medium transition ${
                  isDark 
                    ? 'bg-[#0b1219] border-[#243648] text-slate-100 focus:border-amber-400 focus:outline-none' 
                    : 'bg-slate-50 border-slate-300 text-slate-800 focus:border-amber-500 focus:outline-none'
                }`}
              />
            </div>

            <div className={`p-3 rounded border text-[11px] flex items-start space-x-2 ${
              isDark ? 'bg-[#0b1219]/60 border-[#1e2e3d] text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'
            }`}>
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                คำแนะนำ: ควรใช้รหัสผ่านที่มีความยาวตั้งแต่ 8 ตัวอักษรขึ้นไป ผสมผสานตัวอักษรพิมพ์ใหญ่ พิมพ์เล็ก ตัวเลข และสัญลักษณ์
              </span>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isProcessing || !newPassword || !confirmPassword}
                className="w-full py-2.5 px-4 rounded font-bold text-xs bg-amber-600 hover:bg-amber-700 text-white shadow transition flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{isProcessing ? 'กำลังเปลี่ยนรหัสผ่าน...' : 'อัปเดตรหัสผ่านใหม่ (Change Password)'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
