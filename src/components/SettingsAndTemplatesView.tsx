import React, { useState } from 'react';
import { UserAccount } from '../types';
import { storage } from '../utils/storage';
import { 
  downloadBlob, 
  generateShiftCodeTemplate, 
  generateOTApprovedTemplate,
  generateShiftPlanTemplate
} from '../utils/fileParser';
import { INITIAL_RAW_PUNCHES_TEXT } from '../data/initialData';
import { 
  Settings, 
  Download, 
  Database, 
  Cloud, 
  FileText, 
  ShieldCheck, 
  RotateCcw,
  CheckCircle2,
  Code2,
  Server
} from 'lucide-react';

interface SettingsAndTemplatesViewProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  onResetData: () => void;
}

export const SettingsAndTemplatesView: React.FC<SettingsAndTemplatesViewProps> = ({
  currentUser,
  theme,
  onResetData,
}) => {
  const isDark = theme === 'dark';
  const [activeSubTab, setActiveSubTab] = useState<'templates' | 'rules' | 'firebase' | 'backup'>('templates');

  // Business rules configuration
  const [divisionName, setDivisionName] = useState('MO CS BTS');
  const [defaultCostCenter, setDefaultCostCenter] = useState('C93056');
  const [punchRule, setPunchRule] = useState<'latest' | 'earliest'>('latest');

  // Backup state to JSON
  const handleExportBackup = () => {
    const data = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      employees: storage.getEmployees(),
      shiftCodes: storage.getShiftCodes(),
      shiftPlans: storage.getShiftPlans(),
      biometricPunches: storage.getBiometricPunches(),
      otRecords: storage.getOTRecords(),
      otherAllowances: storage.getOtherAllowances(),
      manualOverrides: storage.getManualOverrides(),
      users: storage.getUsers(),
    };
    downloadBlob(
      JSON.stringify(data, null, 2),
      `Siemens_Shift_System_Backup_${Date.now()}.json`,
      'application/json;charset=utf-8;'
    );
  };

  // Restore backup from JSON
  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json.employees) storage.setEmployees(json.employees);
        if (json.shiftCodes) storage.setShiftCodes(json.shiftCodes);
        if (json.shiftPlans) storage.setShiftPlans(json.shiftPlans);
        if (json.biometricPunches) storage.setBiometricPunches(json.biometricPunches);
        if (json.otRecords) storage.setOTRecords(json.otRecords);
        if (json.otherAllowances) storage.setOtherAllowances(json.otherAllowances);
        if (json.manualOverrides) storage.setManualOverrides(json.manualOverrides);
        if (json.users) storage.setUsers(json.users);
        alert('กู้คืนข้อมูลจากไฟล์สำรองสำเร็จแล้ว!');
        window.location.reload();
      } catch (err: any) {
        alert('ไฟล์สำรองไม่ถูกต้อง: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className={`p-4 flex flex-col space-y-4 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
      {/* Header Banner */}
      <div className={`p-4 rounded border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
        isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/30">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold flex items-center gap-2">
              ตั้งค่าระบบ & เทมเพลตมาตรฐาน (Settings & Templates)
            </h1>
            <p className="text-xs text-slate-400">
              ดาวน์โหลดแบบฟอร์มเทมเพลต, ปรับแต่งกฎการคำนวณเวลา, คู่มือการเชื่อมต่อ Firebase Cloud และสำรองข้อมูล
            </p>
          </div>
        </div>
      </div>

      {/* Sub-tab Navigation */}
      <div className={`flex border-b text-xs font-semibold overflow-x-auto ${
        isDark ? 'border-[#223344]' : 'border-slate-300'
      }`}>
        {[
          { id: 'templates', label: 'ศูนย์ดาวน์โหลดเทมเพลต (Templates Center)', icon: Download },
          { id: 'rules', label: 'กฎคำนวณและข้อมูลองค์กร (Business Rules)', icon: Settings },
          { id: 'firebase', label: 'คู่มือเชื่อมต่อ Firebase Cloud (Deployment Guide)', icon: Cloud },
          { id: 'backup', label: 'สำรองและกู้คืนข้อมูล (Backup & Restore)', icon: Database },
        ].map(tab => {
          const isActive = activeSubTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`px-4 py-3 flex items-center space-x-2 border-b-2 transition whitespace-nowrap ${
                isActive
                  ? 'border-[#00e5e5] text-[#00e5e5] bg-teal-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* SUB-TAB 1: Template Center */}
      {activeSubTab === 'templates' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* Template 1: Shift Plan */}
          <div className={`p-4 rounded border space-y-2.5 ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#00e5e5] flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                1. เทมเพลต Shift Plan (ตารางกะรายเดือน)
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-teal-900/40 text-teal-300 font-mono">
                .CSV / .XLSX
              </span>
            </div>
            <p className="text-slate-400">
              ไฟล์เทมเพลตจัดตารางการทำงานของแต่ละแผนก มีรายชื่อพนักงานและ GID ครบถ้วน พร้อมคอลัมน์วันที่ 1-31
            </p>
            <button
              onClick={() => {
                const employees = storage.getEmployees();
                const { csvContent } = generateShiftPlanTemplate('GM', '2026-05', employees);
                downloadBlob(csvContent, 'Template_ShiftPlan_GM_2026-05.csv', 'text/csv;charset=utf-8;');
              }}
              className="w-full py-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-medium flex items-center justify-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5 text-teal-400" />
              <span>ดาวน์โหลด Shift Plan (ตัวอย่าง แผนก GM)</span>
            </button>
          </div>

          {/* Template 2: Shift Code */}
          <div className={`p-4 rounded border space-y-2.5 ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#00e5e5] flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                2. เทมเพลต Shift Code (รหัสกะทำงาน)
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-teal-900/40 text-teal-300 font-mono">
                .CSV
              </span>
            </div>
            <p className="text-slate-400">
              สำหรับเพิ่มหรือปรับปรุงเวลาเริ่ม-เลิกกะ เวลาพัก และชั่วโมงทำงาน เช่น D (08:00-17:00), N (20:00-05:00)
            </p>
            <button
              onClick={() => {
                const shiftCodes = storage.getShiftCodes();
                const { csvContent } = generateShiftCodeTemplate(shiftCodes);
                downloadBlob(csvContent, 'Template_ShiftCodes.csv', 'text/csv;charset=utf-8;');
              }}
              className="w-full py-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-medium flex items-center justify-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5 text-teal-400" />
              <span>ดาวน์โหลด Shift Codes Master</span>
            </button>
          </div>

          {/* Template 3: Time Attendance.txt */}
          <div className={`p-4 rounded border space-y-2.5 ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#00e5e5] flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                3. ไฟล์ตัวอย่าง Time Attendance.txt (เครื่องรูดบัตร)
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-teal-900/40 text-teal-300 font-mono">
                .TXT
              </span>
            </div>
            <p className="text-slate-400">
              ตัวอย่างไฟล์จริงจากการดึง log เครื่องสแกนลายนิ้วมือ/บัตร เช่น <code>0149   I 260128 0442 01</code>
            </p>
            <button
              onClick={() => {
                downloadBlob(INITIAL_RAW_PUNCHES_TEXT, 'Time Attendance.txt', 'text/plain;charset=utf-8;');
              }}
              className="w-full py-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-medium flex items-center justify-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5 text-teal-400" />
              <span>ดาวน์โหลด Time Attendance.txt</span>
            </button>
          </div>

          {/* Template 4: Approved OT */}
          <div className={`p-4 rounded border space-y-2.5 ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#00e5e5] flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                4. เทมเพลต Approved OT Report (Power BI)
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-teal-900/40 text-teal-300 font-mono">
                .CSV / .XLSX
              </span>
            </div>
            <p className="text-slate-400">
              ไฟล์รายงานโอทีที่ได้รับการอนุมัติแล้ว พร้อมช่องระบุ OT 1.5 หรือ 3.0 เท่า เหตุผล และผู้อนุมัติ
            </p>
            <button
              onClick={() => {
                const { csvContent } = generateOTApprovedTemplate();
                downloadBlob(csvContent, 'Template_Approved_OT.csv', 'text/csv;charset=utf-8;');
              }}
              className="w-full py-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-medium flex items-center justify-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5 text-teal-400" />
              <span>ดาวน์โหลด Approved OT Template</span>
            </button>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: Business Rules */}
      {activeSubTab === 'rules' && (
        <div className={`p-5 rounded border space-y-4 text-xs max-w-2xl ${
          isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
        }`}>
          <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
            <Settings className="w-4 h-4 text-teal-400" />
            ตั้งค่ากฎการทำงานและหัวเอกสาร (Siemens Standards)
          </h3>

          <div className="space-y-3">
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Division Name (ส่วนงาน)</label>
              <input
                type="text"
                value={divisionName}
                onChange={e => setDivisionName(e.target.value)}
                className={`w-full p-2 rounded border font-semibold ${
                  isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                }`}
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Default Cost Center</label>
              <input
                type="text"
                value={defaultCostCenter}
                onChange={e => setDefaultCostCenter(e.target.value)}
                className={`w-full p-2 rounded border font-mono ${
                  isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                }`}
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                กฎการประมวลผลการบันทึกเวลาเข้า-ออกซ้ำในเวลาใกล้เคียงกัน:
              </label>
              <select
                value={punchRule}
                onChange={e => setPunchRule(e.target.value as any)}
                className={`w-full p-2 rounded border font-medium ${
                  isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                }`}
              >
                <option value="latest">ใช้เวลาล่าสุดที่พบ (Latest Punch Rule - ตามระเบียบข้อ 5)</option>
                <option value="earliest">ใช้เวลาแรกสุด (Earliest Punch Rule)</option>
              </select>
              <p className="text-[11px] text-teal-400 mt-1">
                * ระบบปฏิบัติตามข้อกำหนด: หากพนักงานสแกนนิ้วหรือทาบบัตรซ้ำ ระบบจะเลือกเวลาล่าสุดเพื่อความถูกต้องในการเข้ากะ
              </p>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: Firebase Cloud Deployment Guide */}
      {activeSubTab === 'firebase' && (
        <div className={`p-5 rounded border space-y-4 text-xs ${
          isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-100">
                คู่มือการเชื่อมต่อและ Deploy บน Firebase Firestore & Firebase Auth
              </h3>
              <p className="text-slate-400 text-[11px]">
                แนวทางการเชื่อมต่อฐานข้อมูล Cloud Database ถาวรเพื่อการใช้งานจริงในองค์กรหลายแผนก
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Step by step */}
            <div className={`p-4 rounded border space-y-3 ${
              isDark ? 'bg-[#0b1219] border-[#1e2e3d]' : 'bg-slate-50 border-slate-200'
            }`}>
              <h4 className="font-bold text-xs text-[#00e5e5] flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                ขั้นตอนการเปิดใช้งาน Firebase
              </h4>
              <ol className="list-decimal list-inside space-y-2 text-slate-300 leading-relaxed">
                <li>
                  <strong>สร้างโปรเจกต์ Firebase:</strong> เข้าสู่ Firebase Console (https://console.firebase.google.com) และสร้างโปรเจกต์ใหม่ เช่น <code>siemens-timesheet-mgmt</code>
                </li>
                <li>
                  <strong>เปิดใช้งาน Firestore Database:</strong> เลือกโหมด Production หรือ Test ในเขต Cloud Region เช่น <code>asia-southeast1</code> (สิงคโปร์) เพื่อความรวดเร็ว
                </li>
                <li>
                  <strong>เปิดใช้งาน Firebase Authentication:</strong> เปิดใช้งาน Email/Password Auth Provider และ Google Sign-In สำหรับผู้ใช้งานองค์กร
                </li>
                <li>
                  <strong>นำ Config มาใส่ใน .env:</strong>
                  <pre className="mt-1 p-2 rounded bg-black/40 text-[10px] font-mono text-teal-300 overflow-x-auto">
{`VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=siemens-timesheet.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=siemens-timesheet
VITE_FIREBASE_STORAGE_BUCKET=siemens-timesheet.appspot.com`}
                  </pre>
                </li>
              </ol>
            </div>

            {/* Firestore Schema */}
            <div className={`p-4 rounded border space-y-3 ${
              isDark ? 'bg-[#0b1219] border-[#1e2e3d]' : 'bg-slate-50 border-slate-200'
            }`}>
              <h4 className="font-bold text-xs text-[#00e5e5] flex items-center gap-1.5">
                <Server className="w-4 h-4" />
                โครงสร้าง Collection ใน Firestore Database
              </h4>
              <div className="space-y-1.5 font-mono text-[11px]">
                <div className="p-1.5 rounded bg-slate-800/60 border border-slate-700/50">
                  <span className="text-amber-400 font-bold">employees/</span>
                  <span className="text-slate-400"> (GID, EmpNo, Name, Department, ShiftStatus, CostCenter)</span>
                </div>
                <div className="p-1.5 rounded bg-slate-800/60 border border-slate-700/50">
                  <span className="text-amber-400 font-bold">shift_codes/</span>
                  <span className="text-slate-400"> (Code, StartTime, EndTime, Break, Hours, Color)</span>
                </div>
                <div className="p-1.5 rounded bg-slate-800/60 border border-slate-700/50">
                  <span className="text-amber-400 font-bold">shift_plans/</span>
                  <span className="text-slate-400"> (EmpNo, Date, ShiftCode, Department, MonthYear)</span>
                </div>
                <div className="p-1.5 rounded bg-slate-800/60 border border-slate-700/50">
                  <span className="text-amber-400 font-bold">biometric_punches/</span>
                  <span className="text-slate-400"> (EmpNo, GID, Date, Time, Type, Device)</span>
                </div>
                <div className="p-1.5 rounded bg-slate-800/60 border border-slate-700/50">
                  <span className="text-amber-400 font-bold">ot_records/</span>
                  <span className="text-slate-400"> (EmpNo, Date, Hours, Rate, Reason, ApprovedBy)</span>
                </div>
                <div className="p-1.5 rounded bg-slate-800/60 border border-slate-700/50">
                  <span className="text-amber-400 font-bold">manual_overrides/</span>
                  <span className="text-slate-400"> (Key: EmpNo_Date, CustomIn, CustomOut, Notes)</span>
                </div>
                <div className="p-1.5 rounded bg-slate-800/60 border border-slate-700/50">
                  <span className="text-amber-400 font-bold">users/</span>
                  <span className="text-slate-400"> (Email, Role: Admin|User, Department, Status)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: Backup & Restore */}
      {activeSubTab === 'backup' && (
        <div className={`p-5 rounded border space-y-4 text-xs max-w-xl ${
          isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
        }`}>
          <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
            <Database className="w-4 h-4 text-teal-400" />
            การสำรองและกู้คืนฐานข้อมูล (Backup & Restore)
          </h3>

          <p className="text-slate-400 leading-relaxed">
            สามารถสำรองข้อมูลทั้งหมดในระบบ (พนักงาน, กะทำงาน, เวลาสแกนบัตร, OT, และประวัติการแก้ไข) เป็นไฟล์ JSON หรือกู้คืนข้อมูลกลับมาได้ทุกเมื่อ
          </p>

          <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={handleExportBackup}
              className="w-full sm:w-auto px-4 py-2.5 rounded font-semibold bg-[#008b99] hover:bg-[#00a3a6] text-white flex items-center justify-center space-x-1.5 shadow"
            >
              <Download className="w-4 h-4" />
              <span>ดาวน์โหลดไฟล์สำรองข้อมูล (.json)</span>
            </button>

            <label className="w-full sm:w-auto cursor-pointer px-4 py-2.5 rounded font-semibold bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center space-x-1.5">
              <Cloud className="w-4 h-4 text-teal-400" />
              <span>กู้คืนข้อมูลจากไฟล์ (.json)</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImportBackup}
                className="hidden"
              />
            </label>
          </div>

          <div className="pt-4 border-t border-slate-700/50">
            <div className="text-red-400 font-bold mb-1">ล้างข้อมูลและคืนค่าเริ่มต้น (Factory Reset)</div>
            <p className="text-slate-400 mb-2">
              ลบการแก้ไขทั้งหมดและรีเซ็ตข้อมูลกลับเป็นข้อมูลตัวอย่างเริ่มต้น (Initial Demo Dataset)
            </p>
            <button
              onClick={() => {
                if (confirm('คุณต้องการรีเซ็ตข้อมูลกลับสู่ค่าเริ่มต้นใช่หรือไม่? ข้อมูลที่แก้ไขจะถูกลบทั้งหมด')) {
                  onResetData();
                }
              }}
              className="px-3.5 py-2 rounded bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40 font-semibold flex items-center space-x-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>รีเซ็ตข้อมูลตัวอย่างทั้งหมด</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
