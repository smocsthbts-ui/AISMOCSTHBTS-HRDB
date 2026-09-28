import React, { useState, useEffect, useRef } from 'react';
import { UserAccount } from '../types';
import { storage } from '../utils/storage';
import { firestoreSync, db, cleanDocId, logOut } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { 
  Clock, 
  RefreshCw, 
  LogOut, 
  ShieldAlert, 
  CheckCircle2, 
  User, 
  Building2, 
  Mail, 
  Shield, 
  ExternalLink,
  Info
} from 'lucide-react';

interface WaitingVerificationScreenProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  onUserActivated: (updatedUser: UserAccount) => void;
  onSignOut: () => void;
}

export const WaitingVerificationScreen: React.FC<WaitingVerificationScreenProps> = ({
  currentUser,
  theme,
  onUserActivated,
  onSignOut,
}) => {
  const isDark = theme === 'dark';
  const [isChecking, setIsChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [lastCheckTime, setLastCheckTime] = useState<string>(new Date().toLocaleTimeString('th-TH'));
  const hasActivatedRef = useRef(false);

  // Function to check if Admin has activated the user
  const checkApprovalStatus = async (showToast = true) => {
    if (hasActivatedRef.current) return;
    setIsChecking(true);
    setCheckMessage(null);
    try {
      const cleanEmail = currentUser.email.trim().toLowerCase();

      // 1. Check local storage first
      const localUsers = storage.getUsers();
      const localFound = localUsers.find(u => u.email.trim().toLowerCase() === cleanEmail || u.id === currentUser.id);
      if (localFound && localFound.status === 'Active') {
        hasActivatedRef.current = true;
        storage.setCurrentUser(localFound);
        onUserActivated(localFound);
        return;
      }

      // 2. Fetch fresh cloud state
      const fresh = await firestoreSync.fetchAllFromCloud();
      let users = storage.getUsers();
      if (fresh && fresh.users && fresh.users.length > 0) {
        users = fresh.users;
        storage.setUsers(fresh.users);
      }

      const latestUser = users.find(u => u.email.trim().toLowerCase() === cleanEmail || u.id === currentUser.id);
      setLastCheckTime(new Date().toLocaleTimeString('th-TH'));

      if (latestUser && latestUser.status === 'Active') {
        hasActivatedRef.current = true;
        storage.setCurrentUser(latestUser);
        onUserActivated(latestUser);
        return;
      }

      if (showToast) {
        setCheckMessage('สถานะ: ยังอยู่ระหว่างรอ Admin อนุมัติและกำหนดแผนก กรุณารอสักครู่หรือแจ้ง Admin');
      }
    } catch (err) {
      console.warn('Check approval status error:', err);
      if (showToast) {
        setCheckMessage('ไม่สามารถตรวจสอบสถานะได้ในขณะนี้ โปรดลองอีกครั้ง');
      }
    } finally {
      setIsChecking(false);
    }
  };

  // Direct Real-time WebSocket Listeners for Instant Activation
  useEffect(() => {
    if (!currentUser || !currentUser.email) return;

    const cleanEmail = currentUser.email.trim().toLowerCase();
    const docKey = cleanDocId(cleanEmail);

    const handleActivated = (activated: UserAccount) => {
      if (hasActivatedRef.current) return;
      hasActivatedRef.current = true;
      storage.setCurrentUser(activated);
      onUserActivated(activated);
    };

    // 1. Direct listener on individual user_accounts doc
    const unsubUserDoc = !firestoreSync.isQuotaExceeded() ? onSnapshot(doc(db, 'user_accounts', docKey), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as UserAccount;
        if (data && data.status === 'Active') {
          handleActivated({ ...currentUser, ...data, status: 'Active' });
        }
      }
    }, err => console.warn('user_accounts snapshot error:', err)) : () => {};

    // 2. Direct listener on app_bundles/users doc
    const unsubBundle = !firestoreSync.isQuotaExceeded() ? onSnapshot(doc(db, 'app_bundles', 'users'), (snap) => {
      if (snap.exists()) {
        const list: UserAccount[] = snap.data()?.data || [];
        const found = list.find(u => u && (u.email?.trim().toLowerCase() === cleanEmail || u.id === currentUser.id));
        if (found && found.status === 'Active') {
          handleActivated({ ...currentUser, ...found, status: 'Active' });
        }
      }
    }, err => console.warn('app_bundles/users snapshot error:', err)) : () => {};

    // 3. Fast fallback interval (every 3s)
    const interval = setInterval(() => {
      if (!hasActivatedRef.current) {
        checkApprovalStatus(false);
      }
    }, 3000);

    const handleLocalSync = () => {
      if (!hasActivatedRef.current) {
        checkApprovalStatus(false);
      }
    };

    window.addEventListener('firestore-sync-completed', handleLocalSync);
    window.addEventListener('storage-changed', handleLocalSync);
    window.addEventListener('siemens-data-updated', handleLocalSync);

    return () => {
      unsubUserDoc();
      unsubBundle();
      clearInterval(interval);
      window.removeEventListener('firestore-sync-completed', handleLocalSync);
      window.removeEventListener('storage-changed', handleLocalSync);
      window.removeEventListener('siemens-data-updated', handleLocalSync);
    };
  }, [currentUser]);

  const isSiemensEmail = currentUser.email.toLowerCase().endsWith('@siemens.com');

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center p-4 select-none ${
      isDark ? 'bg-[#091017] text-slate-100' : 'bg-[#f0f4f8] text-slate-800'
    }`}>
      {/* Background Graphic Accents */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[#00646e] blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-[#00e5e5] blur-3xl" />
      </div>

      <div className={`relative w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden backdrop-blur-md transition-all ${
        isDark ? 'bg-[#121c27]/95 border-[#223344]' : 'bg-white/95 border-slate-200'
      }`}>
        {/* Top Siemens Corporate Accent Bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-[#00646e] via-[#00a3a6] to-[#00e5e5]" />

        {/* Header Section */}
        <div className={`p-6 border-b text-center ${
          isDark ? 'bg-[#152332] border-[#223344]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 mb-3 shadow-inner">
            <Clock className="w-8 h-8 animate-pulse" />
          </div>
          <h1 className="text-xl font-bold tracking-tight flex items-center justify-center gap-2">
            <span>รอการตรวจสอบและอนุมัติสิทธิ์จาก Admin</span>
          </h1>
          <p className="text-xs text-amber-400/90 font-medium mt-1">
            Waiting for Verification & Activation from Administrator
          </p>
          <div className="text-[11px] text-slate-400 mt-1">
            Siemens Mobility • MO CS BTS Multi-Department Shift & Time Attendance
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 text-xs">
          {/* Informative Alert Banner */}
          <div className={`p-4 rounded-xl border flex items-start space-x-3 ${
            isDark 
              ? 'bg-[#101b26] border-amber-500/30 text-slate-200' 
              : 'bg-amber-50/80 border-amber-300 text-amber-900 shadow-xs'
          }`}>
            <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1.5 text-xs leading-relaxed">
              <div className="font-bold text-amber-400 flex items-center gap-1.5 text-sm">
                <span>บันทึกบัญชีผู้ใช้ในระบบเรียบร้อยแล้ว</span>
              </div>
              <p>
                การเข้าสู่ระบบครั้งแรกด้วยบัญชี Google {isSiemensEmail ? '(@siemens.com)' : ''} ของท่าน ระบบได้บันทึกข้อมูลเข้าสู่ฐานข้อมูลแล้ว 
                แต่จำเป็นต้องได้รับการ <strong>Activate User (เปิดใช้งาน)</strong> จากผู้ดูแลระบบ (Admin) ก่อน
              </p>
              <p className="text-[11px] opacity-90">
                เมื่อ Admin ทำการ Activate จะกำหนด <strong>บทบาท (Role: Admin / User)</strong> และ <strong>แผนกที่รับผิดชอบ (Department)</strong> ให้กับบัญชีของท่าน เพื่อให้สามารถดูและจัดการตารางกะ บันทึกเวลา และทำโอทีได้อย่างถูกต้อง
              </p>
            </div>
          </div>

          {/* User Profile Card */}
          <div className={`p-4 rounded-xl border space-y-3 ${
            isDark ? 'bg-[#0d1620] border-[#1e2e3d]' : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>ข้อมูลบัญชีที่ลงทะเบียนในระบบ (Registered Account)</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40">
                <Clock className="w-3 h-3" /> รอการ Verify
              </span>
            </div>

            <div className="flex items-center space-x-3.5 pt-1">
              {currentUser.photoURL ? (
                <img 
                  src={currentUser.photoURL} 
                  alt={currentUser.name} 
                  className="w-12 h-12 rounded-full border-2 border-teal-500/50 object-cover shadow-sm"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/40 flex items-center justify-center text-lg font-bold">
                  {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
                </div>
              )}

              <div className="flex-1 min-w-0 space-y-1">
                <div className="font-bold text-sm truncate flex items-center gap-2">
                  <span>{currentUser.name}</span>
                  {isSiemensEmail && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#00646e]/30 text-[#00e5e5] border border-[#00a3a6]/40 font-mono">
                      Siemens Corporate
                    </span>
                  )}
                </div>
                <div className="text-slate-400 font-mono text-xs flex items-center gap-1 truncate">
                  <Mail className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                  <span className="truncate">{currentUser.email}</span>
                </div>
              </div>
            </div>

            <div className={`pt-3 border-t grid grid-cols-2 gap-2 text-[11px] font-mono ${
              isDark ? 'border-slate-800 text-slate-300' : 'border-slate-200 text-slate-600'
            }`}>
              <div>
                <span className="text-slate-500 block">สถานะปัจจุบัน:</span>
                <span className="font-bold text-amber-400">Pending Approval</span>
              </div>
              <div>
                <span className="text-slate-500 block">แผนกสังกัด:</span>
                <span className="font-semibold text-teal-400">
                  {currentUser.department && currentUser.department !== 'PENDING' ? currentUser.department : 'รอ Admin กำหนดแผนก'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">วันที่ลงทะเบียน:</span>
                <span>{new Date(currentUser.createdAt || Date.now()).toLocaleDateString('th-TH')}</span>
              </div>
              <div>
                <span className="text-slate-500 block">ตรวจสอบล่าสุด:</span>
                <span>{lastCheckTime}</span>
              </div>
            </div>
          </div>

          {/* Feedback message if checked */}
          {checkMessage && (
            <div className={`p-3 rounded-lg border text-xs flex items-center space-x-2 animate-fade-in ${
              checkMessage.includes('Active')
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800/80 border-slate-700 text-amber-300'
            }`}>
              <Info className="w-4 h-4 shrink-0 text-amber-400" />
              <span>{checkMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={() => checkApprovalStatus(true)}
              disabled={isChecking}
              className="w-full sm:flex-1 py-2.5 px-4 rounded-xl font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-md transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
              <span>{isChecking ? 'กำลังตรวจสอบข้อมูล...' : 'ตรวจสอบสถานะการอนุมัติ (Check Status)'}</span>
            </button>

            <button
              onClick={onSignOut}
              className={`w-full sm:w-auto py-2.5 px-4 rounded-xl font-semibold text-xs border transition flex items-center justify-center space-x-1.5 cursor-pointer ${
                isDark 
                  ? 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-300 hover:text-white' 
                  : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
              }`}
            >
              <LogOut className="w-4 h-4" />
              <span>ออกจากระบบ (Sign Out)</span>
            </button>
          </div>

          {/* Admin Contact Box */}
          <div className={`p-3.5 rounded-xl border text-[11px] space-y-1.5 ${
            isDark ? 'bg-[#0e1722]/60 border-[#1c2c3d] text-slate-400' : 'bg-slate-100/70 border-slate-200 text-slate-600'
          }`}>
            <div className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-teal-400" />
              <span>ติดต่อผู้ดูแลระบบ (System Administrator):</span>
            </div>
            <p>
              หากต้องการเร่งรัดการอนุมัติหรือเปิดใช้งานสิทธิ์เร่งด่วน โปรดติดต่อผู้ดูแลระบบหลักทางอีเมล:
            </p>
            <div className="font-mono text-teal-400 font-bold">
              smo.cs.th.bts@gmail.com
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
