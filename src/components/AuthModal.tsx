import React, { useState } from 'react';
import { UserAccount } from '../types';
import { storage } from '../utils/storage';
import { 
  ShieldCheck, 
  UserPlus, 
  KeyRound, 
  LogOut, 
  ArrowLeft, 
  CheckCircle2, 
  AlertCircle,
  Mail,
  Loader2,
  Building2,
  X
} from 'lucide-react';
import { 
  auth, 
  signInWithGoogle, 
  logOut,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from '../firebase';

interface AuthModalProps {
  currentUser: UserAccount | null;
  isOpen: boolean;
  onClose: () => void;
  onSwitchUser: (user: UserAccount) => void;
  isDark: boolean;
  canClose?: boolean;
  onSignOut?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  currentUser,
  isOpen,
  onClose,
  onSwitchUser,
  canClose = false,
  onSignOut,
}) => {
  const [activeView, setActiveView] = useState<'login' | 'recovery' | 'register'>('login');
  
  // Login form state
  const [email, setEmail] = useState('');
  
  // Register form state
  const [regForm, setRegForm] = useState({
    name: '',
    email: '',
    password: '',
    department: 'GM',
  });

  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingAction, setProcessingAction] = useState<string>('');

  // Handle successful Firebase User Login & sync to storage
  const handleFirebaseUserLogin = async (
    userEmail: string | null, 
    uid: string, 
    displayName?: string | null,
    photoURL?: string | null
  ) => {
    if (!userEmail) return;
    const cleanEmail = userEmail.trim().toLowerCase();
    const currentUsers = storage.getUsers();
    let targetUser = currentUsers.find(u => u.email.toLowerCase() === cleanEmail);
    
    // Default admin check
    const isDefaultAdmin = cleanEmail === 'smo.cs.th.bts@gmail.com';
    
    // Check if user matches an employee in employee master
    const employees = storage.getEmployees();
    const matchedEmp = employees.find(e => 
      (e.gid && cleanEmail.includes(e.gid.toLowerCase())) ||
      (e.empNo && cleanEmail.includes(e.empNo.toLowerCase())) ||
      (e.firstName && cleanEmail.includes(e.firstName.toLowerCase()))
    );

    if (!targetUser) {
      const resolvedName = displayName || (matchedEmp ? `${matchedEmp.firstName} ${matchedEmp.familyName}`.trim() : userEmail.split('@')[0]);
      const resolvedDept = matchedEmp?.department || (isDefaultAdmin ? 'ALL' : 'PENDING');

      targetUser = {
        id: `usr-${uid}`,
        email: userEmail,
        name: resolvedName,
        role: isDefaultAdmin ? 'Admin' : 'User',
        department: resolvedDept,
        status: isDefaultAdmin ? 'Active' : 'Pending_Approval',
        photoURL: photoURL || undefined,
        isGoogleAccount: true,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await storage.saveUser(targetUser);
    } else {
      const updatedUser: UserAccount = {
        ...targetUser,
        name: displayName && (!targetUser.name || targetUser.name === targetUser.email.split('@')[0]) ? displayName : targetUser.name,
        photoURL: photoURL || targetUser.photoURL,
        lastLogin: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      targetUser = updatedUser;
      await storage.saveUser(updatedUser);
    }
    
    if (targetUser.status === 'Deactivated') {
      setMessage({ type: 'error', text: `บัญชี ${targetUser.email} ถูกระงับการใช้งาน กรุณาติดต่อ Admin` });
      await logOut();
      return;
    }
    
    onSwitchUser(targetUser);
    onClose();
  };

  // Google Sign-In with optional loginHint (defaults to Google Siemens @siemens.com)
  const triggerGoogleSiemensAuth = async (hint?: string, actionName: string = 'Google') => {
    setIsProcessing(true);
    setProcessingAction(actionName);
    setMessage(null);
    try {
      const user = await signInWithGoogle(hint || email);
      if (user) {
        await handleFirebaseUserLogin(user.email, user.uid, user.displayName, user.photoURL);
      }
    } catch (error: any) {
      if (error?.code !== 'auth/popup-closed-by-user') {
        setMessage({ type: 'error', text: 'เชื่อมต่อการเข้าสู่ระบบล้มเหลว: ' + (error?.message || 'โปรดลองใหม่อีกครั้ง') });
      }
    } finally {
      setIsProcessing(false);
      setProcessingAction('');
    }
  };

  // Continue Button Click Handler
  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    await triggerGoogleSiemensAuth(email, 'Continue');
  };

  // Register Handler
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regForm.email) {
      setMessage({ type: 'error', text: 'กรุณากรอกอีเมลพนักงาน Siemens (@siemens.com)' });
      return;
    }
    const cleanEmail = regForm.email.trim().toLowerCase();
    const currentUsers = storage.getUsers();
    const existing = currentUsers.find(u => u.email.trim().toLowerCase() === cleanEmail);
    if (existing) {
      const statusLabel = existing.status === 'Active' ? 'พร้อมใช้งาน' : existing.status === 'Pending_Approval' ? 'รอ Admin อนุมัติ' : 'ถูกระงับการใช้งาน';
      setMessage({
        type: 'error',
        text: `อีเมล ${cleanEmail} ได้รับการลงทะเบียนและกำหนดค่าในระบบแล้ว (สถานะ: ${statusLabel}) กรุณาเข้าสู่ระบบ`
      });
      return;
    }

    setIsProcessing(true);
    setMessage(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, regForm.password);
      const isDefaultAdmin = cleanEmail === 'smo.cs.th.bts@gmail.com';
      
      const newUser: UserAccount = {
        id: `usr-${cred.user.uid}`,
        email: cleanEmail,
        name: regForm.name || cleanEmail.split('@')[0],
        role: isDefaultAdmin ? 'Admin' : 'User',
        department: regForm.department,
        status: isDefaultAdmin ? 'Active' : 'Pending_Approval',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      await storage.saveUser(newUser);
      setMessage({ type: 'success', text: 'ลงทะเบียนสำเร็จ! บัญชีของคุณถูกส่งให้ Admin ตรวจสอบและอนุมัติสิทธิ์การเข้าใช้งานแล้ว' });
      setRegForm({ name: '', email: '', password: '', department: 'GM' });
      await logOut();
      setTimeout(() => setActiveView('login'), 2500);
    } catch (error: any) {
      if (error.code === 'auth/email-already-in-use') {
        setMessage({ type: 'error', text: `อีเมล ${cleanEmail} นี้มีการลงทะเบียนในระบบ Firebase Auth แล้ว กรุณาเข้าสู่ระบบหรือใช้ฟังก์ชันรีเซ็ตรหัสผ่าน` });
      } else {
        setMessage({ type: 'error', text: 'ลงทะเบียนล้มเหลว: ' + (error.message || 'เกิดข้อผิดพลาด') });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Reset Password Handler
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setMessage({ type: 'error', text: 'กรุณากรอกอีเมล Siemens ที่ต้องการรีเซ็ตรหัสผ่าน' });
      return;
    }
    setIsProcessing(true);
    setMessage(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage({ type: 'success', text: `ส่งลิงก์รีเซ็ตรหัสผ่านไปยัง ${email} สำเร็จแล้ว กรุณาตรวจสอบกล่องจดหมายของคุณ` });
    } catch (error: any) {
      setMessage({ type: 'error', text: 'รีเซ็ตรหัสผ่านล้มเหลว: ' + (error.message || 'เกิดข้อผิดพลาด') });
    } finally {
      setIsProcessing(false);
    }
  };

  // Logout current user
  const handleLogoutAction = async () => {
    setIsProcessing(true);
    try {
      if (onSignOut) {
        onSignOut();
      } else {
        storage.clearCurrentUser();
        await logOut();
      }
      onClose();
    } catch (err) {
      console.warn('Logout action err:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] bg-[#060b14]/80 backdrop-blur-md flex items-center justify-center p-4 select-none overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && canClose && currentUser && currentUser.status === 'Active') {
          onClose();
        }
      }}
    >
      <div 
        id="siemens-auth-card"
        className="w-full max-w-[430px] bg-[#121929] border border-[#1e293b] rounded-xl shadow-2xl p-7 sm:p-9 text-slate-200 relative animate-in fade-in zoom-in-95 duration-150 my-auto"
      >
        {/* Top Close Button (if permitted) */}
        {canClose && currentUser && currentUser.status === 'Active' && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="ปิดหน้าต่าง"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* If user is already logged in, show current session banner */}
        {currentUser && currentUser.status === 'Active' && (
          <div className="mb-6 p-3.5 rounded-lg bg-[#0b1220] border border-cyan-500/30 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-400">เข้าสู่ระบบอยู่ในชื่อ</div>
              <div className="text-xs font-bold text-white truncate">{currentUser.name}</div>
              <div className="text-[10px] text-cyan-400 truncate">{currentUser.email} ({currentUser.role})</div>
            </div>
            <button
              onClick={handleLogoutAction}
              disabled={isProcessing}
              className="px-2.5 py-1.5 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>ออกจากระบบ</span>
            </button>
          </div>
        )}

        {/* Status Messages */}
        {message && (
          <div className={`p-3 rounded-lg text-xs mb-5 border flex items-start gap-2.5 ${
            message.type === 'success' 
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' 
              : message.type === 'info'
                ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
                : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            )}
            <span className="leading-relaxed">{message.text}</span>
          </div>
        )}

        {/* ================= VIEW 1: LOGIN (Matching Provided Image) ================= */}
        {activeView === 'login' && (
          <>
            {/* Header Titles */}
            <div className="mb-6">
              <h1 className="text-2xl sm:text-[26px] font-bold text-white tracking-tight leading-snug">
                Log in
              </h1>
              <p className="text-sm text-slate-300 mt-1 font-normal">
                Sign in to your account
              </p>
            </div>

            {/* Email Form */}
            <form onSubmit={handleContinue} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Email address<span className="text-rose-400 ml-0.5">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@siemens.com"
                  className="w-full px-3.5 py-2.5 bg-[#09101d] border border-slate-700 rounded-md text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition"
                />
              </div>

              {/* Can't log in to your account? Link */}
              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setMessage(null);
                    setActiveView('recovery');
                  }}
                  className="text-xs font-medium text-cyan-400 hover:text-cyan-300 transition hover:underline cursor-pointer"
                >
                  Can't log in to your account?
                </button>
              </div>

              {/* Continue Solid Button */}
              <button
                type="submit"
                disabled={isProcessing}
                className="w-full py-3 px-4 rounded-md bg-[#00d2d3] hover:bg-[#00e5e5] active:bg-[#00bebe] text-slate-950 font-bold text-sm shadow-md transition duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing && processingAction === 'Continue' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    <span>Connecting Siemens Google SSO...</span>
                  </>
                ) : (
                  <span>Continue</span>
                )}
              </button>
            </form>

            {/* Divider OR */}
            <div className="relative my-5 flex items-center justify-center">
              <div className="border-t border-slate-700 w-full" />
              <span className="bg-[#121929] px-3.5 text-xs uppercase tracking-wider text-slate-400 font-semibold absolute">
                OR
              </span>
            </div>

            {/* Secondary Outlined Buttons with Cyan Border */}
            <div className="space-y-2.5">
              {/* Option 1: Continue with a passkey */}
              <button
                type="button"
                onClick={() => triggerGoogleSiemensAuth(email, 'Passkey')}
                disabled={isProcessing}
                className="w-full py-2.5 px-4 rounded-md border border-cyan-400/80 bg-transparent hover:bg-cyan-950/30 active:bg-cyan-950/50 text-cyan-300 font-semibold text-sm transition duration-150 flex items-center justify-center gap-3 cursor-pointer disabled:opacity-50"
              >
                {/* User with Key Passkey Icon */}
                <svg className="w-5 h-5 text-cyan-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <circle cx="18" cy="8" r="2.5" />
                  <path d="m20 10.5 2 2-1 1-1-1-1 1-1.5-1.5" />
                </svg>
                <span>Continue with a passkey</span>
              </button>

              {/* Option 2: Sign in with Siemens Entra ID */}
              <button
                type="button"
                onClick={() => triggerGoogleSiemensAuth(email, 'EntraID')}
                disabled={isProcessing}
                className="w-full py-2.5 px-4 rounded-md border border-cyan-400/80 bg-transparent hover:bg-cyan-950/30 active:bg-cyan-950/50 text-cyan-300 font-semibold text-sm transition duration-150 flex items-center justify-center gap-3 cursor-pointer disabled:opacity-50"
              >
                {/* Siemens Entra ID Faceted Diamond Prism */}
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 8.5L12 15L22 8.5L12 2Z" fill="#00D2D3" />
                  <path d="M2 8.5L12 15V22L2 15.5V8.5Z" fill="#0078D4" />
                  <path d="M22 8.5L12 15V22L22 15.5V8.5Z" fill="#28A8EA" />
                </svg>
                <span>Sign in with Siemens Entra ID</span>
              </button>

              {/* Option 3: Sign in with Microsoft account */}
              <button
                type="button"
                onClick={() => triggerGoogleSiemensAuth(email, 'Microsoft')}
                disabled={isProcessing}
                className="w-full py-2.5 px-4 rounded-md border border-cyan-400/80 bg-transparent hover:bg-cyan-950/30 active:bg-cyan-950/50 text-cyan-300 font-semibold text-sm transition duration-150 flex items-center justify-center gap-3 cursor-pointer disabled:opacity-50"
              >
                {/* Microsoft 4-Color Grid Logo */}
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 21 21">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                </svg>
                <span>Sign in with Microsoft account</span>
              </button>
            </div>

            {/* Siemens Mobility Google SSO Footer Notice */}
            <div className="mt-6 pt-4 border-t border-slate-800 text-center text-[11px] text-slate-400 leading-relaxed">
              ระบบยืนยันตัวตน Siemens Mobility CS BTS ผ่านบัญชี Google Siemens 
              <span className="text-cyan-400 font-mono ml-1">(@siemens.com)</span>
            </div>
          </>
        )}

        {/* ================= VIEW 2: ACCOUNT RECOVERY & REGISTRATION ================= */}
        {activeView === 'recovery' && (
          <>
            <div className="mb-5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setMessage(null);
                  setActiveView('login');
                }}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                title="ย้อนกลับ"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-lg font-bold text-white">Can't log in to your account?</h2>
                <p className="text-xs text-slate-400">ช่วยเหลือการเข้าสู่ระบบและลงทะเบียนบัญชี Siemens</p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Option A: Quick Google Siemens Register / Recovery */}
              <div className="p-3.5 rounded-lg bg-[#0a111e] border border-cyan-500/30">
                <div className="text-xs font-bold text-cyan-300 mb-1 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  <span>เข้าใช้งานด้วยบัญชี Google Siemens</span>
                </div>
                <p className="text-[11px] text-slate-300 mb-3 leading-relaxed">
                  หากคุณเป็นพนักงาน Siemens สามารถเข้าสู่ระบบด้วยบัญชี <span className="text-cyan-400 font-mono">name@siemens.com</span> ได้ทันที
                </p>
                <button
                  type="button"
                  onClick={() => triggerGoogleSiemensAuth(email, 'GoogleDirect')}
                  disabled={isProcessing}
                  className="w-full py-2.5 px-3 rounded bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs flex items-center justify-center gap-2 shadow transition cursor-pointer disabled:opacity-50"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                  <span>ยืนยันตัวตนด้วย Google Siemens (@siemens.com)</span>
                </button>
              </div>

              {/* Option B: Reset Password Link */}
              <form onSubmit={handleResetPassword} className="p-3.5 rounded-lg bg-[#0a111e] border border-slate-700 space-y-2.5">
                <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-amber-400" />
                  <span>ส่งลิงก์รีเซ็ตรหัสผ่าน</span>
                </div>
                <div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@siemens.com"
                    className="w-full px-3 py-2 bg-[#080e18] border border-slate-700 rounded text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="w-full py-2 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition cursor-pointer disabled:opacity-50"
                >
                  ส่งลิงก์รีเซ็ตรหัสผ่าน (Send Reset Link)
                </button>
              </form>

              {/* Option C: Register Form Switch */}
              <div className="p-3.5 rounded-lg bg-[#0a111e] border border-slate-700 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-slate-200">ยังไม่มีบัญชีในระบบ?</div>
                  <div className="text-[11px] text-slate-400">ลงทะเบียนบัญชี Siemens ใหม่เพื่อขอสิทธิ์</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMessage(null);
                    setActiveView('register');
                  }}
                  className="px-3 py-1.5 rounded border border-cyan-400 text-cyan-300 text-xs font-semibold hover:bg-cyan-950/30 transition shrink-0 cursor-pointer"
                >
                  ลงทะเบียน
                </button>
              </div>

              {/* Back to Login */}
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMessage(null);
                    setActiveView('login');
                  }}
                  className="text-xs text-slate-400 hover:text-white transition cursor-pointer"
                >
                  ← กลับไปยังหน้าเข้าสู่ระบบ (Back to Log in)
                </button>
              </div>
            </div>
          </>
        )}

        {/* ================= VIEW 3: REGISTER NEW USER ================= */}
        {activeView === 'register' && (
          <>
            <div className="mb-5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setMessage(null);
                  setActiveView('login');
                }}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                title="ย้อนกลับ"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-lg font-bold text-white">ลงทะเบียนบัญชี Siemens</h2>
                <p className="text-xs text-slate-400">กรอกข้อมูลเพื่อส่งให้ Admin อนุมัติการเข้าใช้งาน</p>
              </div>
            </div>

            {/* Quick Google Register */}
            <div className="mb-4">
              <button
                type="button"
                onClick={() => triggerGoogleSiemensAuth(regForm.email || email, 'GoogleReg')}
                disabled={isProcessing}
                className="w-full py-2.5 px-3 rounded bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs flex items-center justify-center gap-2 shadow transition cursor-pointer disabled:opacity-50"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>ลงทะเบียนด้วยบัญชี Google Siemens (@siemens.com)</span>
              </button>
            </div>

            <div className="relative my-4 flex items-center justify-center">
              <div className="border-t border-slate-700 w-full" />
              <span className="bg-[#121929] px-2.5 text-[11px] text-slate-400 absolute">หรือกรอกข้อมูล</span>
            </div>

            <form onSubmit={handleRegisterSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  ชื่อ - นามสกุล *
                </label>
                <input
                  type="text"
                  required
                  value={regForm.name}
                  onChange={(e) => setRegForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="เช่น สมชาย ใจดี"
                  className="w-full px-3 py-2 bg-[#09101d] border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  อีเมลพนักงาน Siemens (@siemens.com) *
                </label>
                <input
                  type="email"
                  required
                  value={regForm.email}
                  onChange={(e) => setRegForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="name@siemens.com"
                  className="w-full px-3 py-2 bg-[#09101d] border border-slate-700 rounded text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  รหัสผ่าน (อย่างน้อย 6 ตัวอักษร) *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={regForm.password}
                  onChange={(e) => setRegForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full px-3 py-2 bg-[#09101d] border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  แผนกที่สังกัด *
                </label>
                <select
                  value={regForm.department}
                  onChange={(e) => setRegForm(prev => ({ ...prev, department: e.target.value }))}
                  className="w-full px-3 py-2 bg-[#09101d] border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-cyan-400"
                >
                  {storage.getDepartments().map(d => (
                    <option key={d.code} value={d.code}>
                      {d.name && d.name !== d.code ? `${d.code} - ${d.name}` : d.code}
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-[11px] text-amber-400/90 pt-1 leading-relaxed">
                * เมื่อลงทะเบียนแล้ว บัญชีจะมีสถานะ <span className="font-semibold text-amber-300">Pending Approval</span> และจะใช้งานได้เมื่อ Admin ได้รับการยืนยันและเปิดสิทธิ์แล้ว
              </div>

              <button
                type="submit"
                disabled={isProcessing}
                className="w-full py-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <UserPlus className="w-4 h-4" />
                <span>ยืนยันการลงทะเบียน</span>
              </button>

              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMessage(null);
                    setActiveView('login');
                  }}
                  className="text-xs text-slate-400 hover:text-white transition cursor-pointer"
                >
                  ← กลับไปยังหน้าเข้าสู่ระบบ (Back to Log in)
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
