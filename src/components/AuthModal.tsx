import React, { useState, useEffect } from 'react';
import { UserAccount } from '../types';
import { storage } from '../utils/storage';
import { 
  UserCircle2, 
  ShieldCheck, 
  UserPlus, 
  Building2, 
  CheckCircle2, 
  Clock, 
  LogOut,
  ChevronRight,
  Sparkles,
  Cloud,
  KeyRound
} from 'lucide-react';
import { 
  auth, 
  signInWithGoogle, 
  logOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,

} from '../firebase';
import { User as FirebaseUser } from 'firebase/auth';

interface AuthModalProps {
  currentUser: UserAccount | null;
  isOpen: boolean;
  onClose: () => void;
  onSwitchUser: (user: UserAccount) => void;
  isDark: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  currentUser,
  isOpen,
  onClose,
  onSwitchUser,
  isDark,
}) => {
  const [activeTab, setActiveTab] = useState<'login' | 'register' | 'forgot'>('login');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Registration Form
  const [regForm, setRegForm] = useState({
    name: '',
    email: '',
    password: '',
    department: 'GM',
  });

  const [message, setMessage] = useState<{type: 'success'|'error', text: string} | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Sync users logic
  const handleFirebaseUserLogin = (userEmail: string | null, uid: string) => {
    if (!userEmail) return;
    const currentUsers = storage.getUsers();
    let targetUser = currentUsers.find(u => u.email.toLowerCase() === userEmail.toLowerCase());
    
    // First time admin check
    const isDefaultAdmin = userEmail.toLowerCase() === 'smo.cs.th.bts@gmail.com';
    
    if (!targetUser) {
      targetUser = {
        id: `usr-${uid}`,
        email: userEmail,
        name: userEmail.split('@')[0],
        role: isDefaultAdmin ? 'Admin' : 'User',
        department: isDefaultAdmin ? 'ALL' : 'GM',
        status: isDefaultAdmin ? 'Active' : 'Pending_Approval',
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
      };
      currentUsers.push(targetUser);
      storage.setUsers(currentUsers);
    } else {
      targetUser.lastLogin = new Date().toISOString();
      const idx = currentUsers.findIndex(u => u.id === targetUser?.id);
      if (idx >= 0) currentUsers[idx] = targetUser;
      storage.setUsers(currentUsers);
    }
    
    if (targetUser.status === 'Deactivated' || targetUser.status === 'Pending_Approval') {
      setMessage({ type: 'error', text: `บัญชีนี้อยู่ในสถานะ ${targetUser.status} กรุณาติดต่อ Admin`});
      logOut();
      return;
    }
    
    onSwitchUser(targetUser);
    onClose();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setMessage(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      handleFirebaseUserLogin(cred.user.email, cred.user.uid);
    } catch (error: any) {
      setMessage({ type: 'error', text: 'เข้าสู่ระบบล้มเหลว: ' + (error.message || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง') });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setMessage(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, regForm.email, regForm.password);
      
      const currentUsers = storage.getUsers();
      const isDefaultAdmin = regForm.email.toLowerCase() === 'smo.cs.th.bts@gmail.com';
      
      const newUser: UserAccount = {
        id: `usr-${cred.user.uid}`,
        email: regForm.email,
        name: regForm.name,
        role: isDefaultAdmin ? 'Admin' : 'User',
        department: regForm.department,
        status: isDefaultAdmin ? 'Active' : 'Pending_Approval',
        createdAt: new Date().toISOString(),
      };
      
      currentUsers.push(newUser);
      storage.setUsers(currentUsers);
      
      setMessage({ type: 'success', text: 'ลงทะเบียนสำเร็จ! กรุณารอ Admin อนุมัติการเข้าใช้งาน' });
      setRegForm({ name: '', email: '', password: '', department: 'GM' });
      setActiveTab('login');
      await logOut(); // Sign out the newly created user until approved
    } catch (error: any) {
      setMessage({ type: 'error', text: 'ลงทะเบียนล้มเหลว: ' + (error.message || 'เกิดข้อผิดพลาด') });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setMessage({ type: 'error', text: 'กรุณากรอกอีเมล' });
      return;
    }
    setIsProcessing(true);
    setMessage(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage({ type: 'success', text: 'ส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลของคุณแล้ว' });
    } catch (error: any) {
      setMessage({ type: 'error', text: 'รีเซ็ตรหัสผ่านล้มเหลว: ' + (error.message || 'เกิดข้อผิดพลาด') });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsProcessing(true);
    setMessage(null);
    try {
      const user = await signInWithGoogle();
      if (user) {
        handleFirebaseUserLogin(user.email, user.uid);
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: 'เชื่อมต่อ Google ล้มเหลว: ' + error.message });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`w-full max-w-md rounded-xl shadow-2xl border overflow-hidden ${
        isDark ? 'bg-[#121c27] border-[#273a4e]' : 'bg-white border-slate-200'
      }`}>
        <div className={`p-5 flex justify-between items-center border-b ${
          isDark ? 'border-[#273a4e]' : 'border-slate-100'
        }`}>
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Authentication</h2>
              <p className="text-[11px] text-slate-400">ระบบเข้าสู่ระบบเพื่อใช้งาน</p>
            </div>
          </div>
          {currentUser && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition"
            >
              ✕
            </button>
          )}
        </div>

        <div className="p-5">
          {message && (
            <div className={`p-2.5 rounded text-xs mb-4 border ${
              message.type === 'success' ? 'bg-teal-500/15 border-teal-500/30 text-teal-200' : 'bg-red-500/15 border-red-500/30 text-red-200'
            }`}>
              {message.text}
            </div>
          )}

          <div className="flex border-b border-slate-700/60 mb-4 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('login')}
              className={`flex-1 py-2 text-center border-b-2 transition ${
                activeTab === 'login' ? 'border-[#00e5e5] text-[#00e5e5]' : 'border-transparent text-slate-400'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => setActiveTab('register')}
              className={`flex-1 py-2 text-center border-b-2 transition ${
                activeTab === 'register' ? 'border-[#00e5e5] text-[#00e5e5]' : 'border-transparent text-slate-400'
              }`}
            >
              Register
            </button>
            <button
              onClick={() => setActiveTab('forgot')}
              className={`flex-1 py-2 text-center border-b-2 transition ${
                activeTab === 'forgot' ? 'border-[#00e5e5] text-[#00e5e5]' : 'border-transparent text-slate-400'
              }`}
            >
              Reset Password
            </button>
          </div>

          {activeTab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">อีเมล (Email)</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={`w-full p-2 rounded border font-mono ${
                    isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">รหัสผ่าน (Password)</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={`w-full p-2 rounded border ${
                    isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>
              <button
                type="submit"
                disabled={isProcessing}
                className="w-full py-2.5 mt-2 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition flex items-center justify-center disabled:opacity-50"
              >
                {isProcessing ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
              </button>
            </form>
          )}

          {activeTab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">ชื่อ - นามสกุล *</label>
                <input
                  type="text"
                  required
                  value={regForm.name}
                  onChange={e => setRegForm(prev => ({ ...prev, name: e.target.value }))}
                  className={`w-full p-2 rounded border ${
                    isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">อีเมลพนักงาน *</label>
                <input
                  type="email"
                  required
                  value={regForm.email}
                  onChange={e => setRegForm(prev => ({ ...prev, email: e.target.value }))}
                  className={`w-full p-2 rounded border font-mono ${
                    isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">รหัสผ่าน *</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={regForm.password}
                  onChange={e => setRegForm(prev => ({ ...prev, password: e.target.value }))}
                  className={`w-full p-2 rounded border ${
                    isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">แผนกที่ต้องการสังกัด *</label>
                <select
                  value={regForm.department}
                  onChange={e => setRegForm(prev => ({ ...prev, department: e.target.value }))}
                  className={`w-full p-2 rounded border font-mono font-medium ${
                    isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                  }`}
                >
                  {storage.getDepartments().map(d => (
                    <option key={d.code} value={d.code}>{d.code} - {d.name}</option>
                  ))}
                </select>
              </div>
              <div className="text-[11px] text-amber-400/90 pt-1">
                * ผู้ลงทะเบียนใหม่จะมีสถานะ "Pending Approval" และต้องให้ Admin อนุมัติก่อน
              </div>
              <button
                type="submit"
                disabled={isProcessing}
                className="w-full py-2.5 rounded font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow transition flex items-center justify-center space-x-1.5 disabled:opacity-50"
              >
                <UserPlus className="w-4 h-4" />
                <span>ยืนยันการลงทะเบียน</span>
              </button>
            </form>
          )}

          {activeTab === 'forgot' && (
            <form onSubmit={handleResetPassword} className="space-y-3 text-xs">
              <p className="text-slate-400 mb-2">
                กรอกอีเมลของคุณที่ใช้ในการลงทะเบียน เพื่อรับลิงก์รีเซ็ตรหัสผ่าน
              </p>
              <div>
                <label className="block text-slate-400 mb-1">อีเมล (Email)</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={`w-full p-2 rounded border font-mono ${
                    isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>
              <button
                type="submit"
                disabled={isProcessing}
                className="w-full py-2.5 mt-2 rounded font-bold text-xs bg-amber-600 hover:bg-amber-700 text-white shadow transition flex items-center justify-center space-x-1.5 disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4" />
                <span>ส่งลิงก์รีเซ็ตรหัสผ่าน</span>
              </button>
            </form>
          )}

          <div className="mt-5 pt-4 border-t border-slate-700/60">
            <button
              onClick={handleGoogleSignIn}
              disabled={isProcessing}
              className="w-full py-2 px-3 rounded bg-white hover:bg-slate-100 text-slate-900 font-bold flex items-center justify-center space-x-2 shadow transition cursor-pointer text-xs disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>เข้าสู่ระบบด้วย Google Account</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
