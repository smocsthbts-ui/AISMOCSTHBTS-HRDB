import React, { useState } from 'react';
import { UserAccount } from '../types';
import { storage } from '../utils/storage';
import { 
  downloadBlob, 
  downloadWorkbook,
  generateShiftCodeTemplate, 
  generateOTApprovedTemplate, 
  generateShiftPlanTemplate,
  generateEmployeeMasterTemplate 
} from '../utils/fileParser';
import { 
  Settings, 
  Download, 
  Database, 
  Cloud, 
  FileText, 
  Users,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';

interface SettingsAndTemplatesViewProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  onResetData?: () => void;
  onClearDemoData?: () => Promise<void>;
  onClearAllData?: () => Promise<void>;
}

export const SettingsAndTemplatesView: React.FC<SettingsAndTemplatesViewProps> = ({
  currentUser,
  theme,
  onResetData,
  onClearDemoData,
  onClearAllData,
}) => {
  const isDark = theme === 'dark';
  const isAdmin = currentUser.role === 'Admin';
  const [activeSubTab, setActiveSubTab] = useState<'templates' | 'backup'>('templates');
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sample Biometric Attendance .txt for download template
  const SAMPLE_BIOMETRIC_TEMPLATE = `0149   I 260505 0530 01
0149   O 260505 1400 01
0950   I 260505 0739 01
0950   O 260505 1729 01
1442   I 260505 0730 01
1442   O 260505 1630 01
0077   I 260505 0732 01
0077   O 260505 1640 01
0094   I 260505 0545 01
0094   O 260505 1415 01`;

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
    if (!isAdmin) {
      setActionMessage({ type: 'error', text: 'สิทธิ์ไม่เพียงพอ: การกู้คืนข้อมูลสำรองสงวนไว้สำหรับ Role Admin เท่านั้น' });
      return;
    }
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
        setActionMessage({ type: 'success', text: 'กู้คืนข้อมูลจากไฟล์สำรองสำเร็จแล้ว!' });
        setTimeout(() => window.location.reload(), 1000);
      } catch (err: any) {
        setActionMessage({ type: 'error', text: 'ไฟล์สำรองไม่ถูกต้อง: ' + err.message });
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
              {isAdmin 
                ? 'ดาวน์โหลดแบบฟอร์มเทมเพลตมาตรฐาน และการสำรอง/กู้คืนฐานข้อมูล' 
                : `Role User (${currentUser.name}): สิทธิ์ดาวน์โหลดเทมเพลต และส่งออกไฟล์สำรองข้อมูล (View & Export Only) • สิทธิ์การกู้คืนข้อมูลสงวนไว้สำหรับ Role Admin`}
            </p>
          </div>
        </div>
      </div>

      {/* Action Notification Message */}
      {actionMessage && (
        <div className={`p-3 rounded border text-xs flex items-center gap-2 ${
          actionMessage.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Sub-tab Navigation */}
      <div className={`flex border-b text-xs font-semibold overflow-x-auto ${
        isDark ? 'border-[#223344]' : 'border-slate-300'
      }`}>
        {[
          { id: 'templates', label: 'ศูนย์ดาวน์โหลดเทมเพลต (Templates Center)', icon: Download },
          { id: 'backup', label: 'การสำรองและกู้คืนข้อมูล (Backup & Restore)', icon: Database },
        ].map(tab => {
          const isActive = activeSubTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`px-4 py-3 flex items-center space-x-2 border-b-2 transition whitespace-nowrap cursor-pointer ${
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
              ไฟล์เทมเพลตจัดตารางการทำงานของแต่ละแผนก ใช้ข้อมูลรหัสพนักงาน <strong>(Emp No)</strong> สำหรับใช้ Mapping และคอลัมน์ชื่อ <strong>(Name)</strong>, แผนก <strong>(Department)</strong> เพื่อใช้อ้างอิง พร้อมคอลัมน์วันที่ 01-31 (ตัดคอลัมน์ Emp Code / GID / Function ออกเพื่อความกระชับ) ชื่อ Sheet ตั้งชื่อตามงวดเดือนจริง เช่น <strong>SEP-2026</strong> รูปแบบเดียวกันกับเทมเพลตรายปี
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => {
                  const employees = storage.getEmployees();
                  const shiftCodes = storage.getShiftCodes();
                  const { workbook, filename, sheetName } = generateShiftPlanTemplate('GM', '2026-09', employees, shiftCodes);
                  downloadWorkbook(workbook, filename || `Template_ShiftPlan_GM_${sheetName || 'SEP-2026'}.xlsx`);
                }}
                className="w-full py-2 rounded bg-teal-700 hover:bg-teal-600 text-white font-medium flex items-center justify-center space-x-1.5 cursor-pointer text-xs"
              >
                <Download className="w-3.5 h-3.5 text-amber-300" />
                <span>โหลด Excel (.xlsx) [Sheet: SEP-2026]</span>
              </button>
              <button
                onClick={() => {
                  const employees = storage.getEmployees();
                  const shiftCodes = storage.getShiftCodes();
                  const { csvContent, sheetName } = generateShiftPlanTemplate('GM', '2026-09', employees, shiftCodes);
                  downloadBlob(csvContent, `Template_ShiftPlan_GM_${sheetName || 'SEP-2026'}.csv`, 'text/csv;charset=utf-8;');
                }}
                className="w-full py-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-medium flex items-center justify-center space-x-1.5 cursor-pointer text-xs"
              >
                <Download className="w-3.5 h-3.5 text-teal-400" />
                <span>โหลด CSV (.csv)</span>
              </button>
            </div>
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
              className="w-full py-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-medium flex items-center justify-center space-x-1.5 cursor-pointer"
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
                downloadBlob(SAMPLE_BIOMETRIC_TEMPLATE, 'Time Attendance.txt', 'text/plain;charset=utf-8;');
              }}
              className="w-full py-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-medium flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-teal-400" />
              <span>ดาวน์โหลด Time Attendance.txt ตัวอย่าง</span>
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
              className="w-full py-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-medium flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-teal-400" />
              <span>ดาวน์โหลด Approved OT Template</span>
            </button>
          </div>

          {/* Template 5: Employee Master Database with EmpCode (8 digits) */}
          <div className={`p-4 rounded border space-y-2.5 ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#00e5e5] flex items-center gap-1.5">
                <Users className="w-4 h-4" />
                5. เทมเพลต Employee Master Database (EmpCode 8 หลัก)
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold">
                Payroll Ready
              </span>
            </div>
            <p className="text-slate-400">
              ไฟล์เทมเพลตนำเข้า/ส่งออกข้อมูลพนักงาน พร้อมคอลัมน์ <span className="text-amber-300 font-mono font-semibold">EmpCode (ตัวเลข 8 หลัก)</span> สำหรับใช้อ้างอิงส่งฝ่าย Payroll พร้อม GID, EmpNo, แผนก, ตำแหน่ง และสถานะเข้ากะ
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => {
                  const { csvContent } = generateEmployeeMasterTemplate();
                  downloadBlob(csvContent, 'Template_Employee_Master_Import.csv', 'text/csv;charset=utf-8;');
                }}
                className="py-2 px-2 rounded bg-teal-600 hover:bg-teal-500 text-white font-medium flex items-center justify-center space-x-1 cursor-pointer"
                title="ดาวน์โหลดไฟล์ Template เปล่าพร้อมตัวอย่างสำหรับนำเข้าข้อมูลพนักงาน"
              >
                <Download className="w-3.5 h-3.5" />
                <span>ดาวน์โหลด Template นำเข้า</span>
              </button>
              <button
                onClick={() => {
                  const employees = storage.getEmployees();
                  const { csvContent } = generateEmployeeMasterTemplate(employees);
                  downloadBlob(csvContent, 'Siemens_Employee_Master_Current.csv', 'text/csv;charset=utf-8;');
                }}
                className="py-2 px-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-medium flex items-center justify-center space-x-1 cursor-pointer"
                title="ส่งออกข้อมูลพนักงานปัจจุบันทั้งหมดพร้อมคอลัมน์ EmpCode"
              >
                <Download className="w-3.5 h-3.5 text-teal-400" />
                <span>Export พนักงานปัจจุบัน</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: Backup, Restore & Clean */}
      {activeSubTab === 'backup' && (
        <div className="space-y-4 max-w-2xl">
          {actionMessage && (
            <div className={`p-3 rounded border flex items-center gap-2 text-xs ${
              actionMessage.type === 'success' 
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300' 
                : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
            }`}>
              {actionMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{actionMessage.text}</span>
            </div>
          )}

          {/* Section 1: Backup & Restore */}
          <div className={`p-5 rounded border space-y-4 text-xs ${
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
                className="w-full sm:w-auto px-4 py-2.5 rounded font-semibold bg-[#008b99] hover:bg-[#00a3a6] text-white flex items-center justify-center space-x-1.5 shadow cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>ดาวน์โหลดไฟล์สำรองข้อมูล (.json)</span>
              </button>

              {isAdmin ? (
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
              ) : (
                <div className={`text-[11px] px-3 py-2 rounded border flex items-center gap-1.5 ${
                  isDark ? 'bg-[#0e1722] border-[#203040] text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-600'
                }`}>
                  <AlertTriangle className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                  <span>Role User: สิทธิ์ดาวน์โหลดข้อมูลสำรอง (Export) • การกู้คืนข้อมูลสงวนไว้สำหรับ Admin</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

