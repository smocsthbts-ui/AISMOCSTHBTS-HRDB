import React, { useState } from 'react';
import { 
  Employee, 
  ShiftCode, 
  UserAccount, 
  OTRecord, 
  DailyShiftPlan, 
  BiometricRawPunch,
  OtherAllowance 
} from '../types';
import { 
  Upload, 
  FileSpreadsheet, 
  FileText, 
  Download, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  DollarSign, 
  Building2, 
  HelpCircle,
  FileCheck2,
  Calendar,
  AlertCircle,
  ArrowRight,
  Plus,
  PlusCircle,
  Edit2,
  Trash2,
  X
} from 'lucide-react';
import { 
  readFileAsArrayBuffer, 
  readFileAsText, 
  parseSheetToRows,
  validateAndParseShiftPlan,
  parseShiftCodesFromRows,
  parseApprovedOTFile,
  parseOtherAllowances,
  generateShiftPlanTemplate,
  generateShiftCodeTemplate,
  generateOTApprovedTemplate,
  downloadBlob
} from '../utils/fileParser';
import { storage, parseBiometricText } from '../utils/storage';
import { firestoreSync } from '../firebase';

interface ImportCenterViewProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  selectedMonthYear: string;
  selectedDepartment: string;
  employees: Employee[];
  shiftCodes: ShiftCode[];
  onDataImported: () => void;
  onNavigateToUploadShiftPlan?: () => void;
}

export const ImportCenterView: React.FC<ImportCenterViewProps> = ({
  currentUser,
  theme,
  selectedMonthYear,
  selectedDepartment,
  employees,
  shiftCodes,
  onDataImported,
  onNavigateToUploadShiftPlan,
}) => {
  const isDark = theme === 'dark';
  const isAdmin = currentUser.role === 'Admin';

  const [activeImportTab, setActiveImportTab] = useState<'shift-plan' | 'shift-code' | 'attendance' | 'ot' | 'allowances'>('shift-plan');

  // Specific Department for Shift Plan Import (Rule 3: บังคับเลือกเดือนปีและแผนกก่อนทุกครั้ง)
  const [importDept, setImportDept] = useState<string>(
    selectedDepartment !== 'ALL' ? selectedDepartment : (currentUser.department !== 'ALL' ? currentUser.department : 'GM')
  );
  const [importMonthYear, setImportMonthYear] = useState<string>(selectedMonthYear);

  // Status message
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string; details?: string[] } | null>(null);

  // Retroactive OT inspection modal
  const [retroactiveOTs, setRetroactiveOTs] = useState<OTRecord[]>([]);
  const [showRetroModal, setShowRetroModal] = useState<boolean>(false);

  // Shift Code Filter by Department/Section
  const [shiftCodeDeptFilter, setShiftCodeDeptFilter] = useState<string>('SHOW_ALL');

  // Edit/Delete Shift Code Admin Mode States
  const [editingShiftCodeKey, setEditingShiftCodeKey] = useState<string | null>(null);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);

  const handleStartEditShiftCode = (sc: ShiftCode) => {
    setEditingShiftCodeKey(`${sc.code.toUpperCase()}_${sc.department.toUpperCase()}`);
    setManualCode(sc.code);
    setManualName(sc.name);
    setManualDept(sc.department);
    setManualStartTime(sc.startTime);
    setManualEndTime(sc.endTime);
    setManualBreak(sc.breakMinutes.toString());
    setManualWorkingHours(sc.workingHours.toString());
    setManualIsWorkingDay(sc.isWorkingDay);
    setManualColor(sc.color);
    setManualDesc(sc.description || '');
    setStatusMessage(null);
  };

  const handleCancelEdit = () => {
    setEditingShiftCodeKey(null);
    setManualCode('');
    setManualName('');
    setManualDept('ALL');
    setManualStartTime('08:00');
    setManualEndTime('17:00');
    setManualBreak('60');
    setManualWorkingHours('8');
    setManualIsWorkingDay(true);
    setManualColor('#008b99');
    setManualDesc('');
    setStatusMessage(null);
  };

  const handleDeleteShiftCode = async (sc: ShiftCode) => {
    try {
      const existing = storage.getShiftCodes();
      const filtered = existing.filter(c => 
        !(c.code.toUpperCase() === sc.code.toUpperCase() && c.department.toUpperCase() === sc.department.toUpperCase())
      );
      storage.setShiftCodes(filtered);
      // Delete document directly from Firestore too
      await firestoreSync.deleteShiftCode(sc.code, sc.department, filtered);
      setStatusMessage({
        type: 'success',
        text: `ลบรหัสกะ "${sc.code}" ของแผนก "${sc.department}" เรียบร้อยแล้ว!`,
      });
      setDeleteConfirmKey(null);
      onDataImported();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `ไม่สามารถลบรหัสกะได้: ${err.message}`,
      });
    }
  };

  // Manual Add Shift Code Form state
  const [manualCode, setManualCode] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualDept, setManualDept] = useState('ALL');
  const [manualStartTime, setManualStartTime] = useState('08:00');
  const [manualEndTime, setManualEndTime] = useState('17:00');
  const [manualBreak, setManualBreak] = useState('60');
  const [manualWorkingHours, setManualWorkingHours] = useState('8');
  const [manualIsWorkingDay, setManualIsWorkingDay] = useState(true);
  const [manualColor, setManualColor] = useState('#008b99');
  const [manualDesc, setManualDesc] = useState('');

  const handleManualAddShiftCode = (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    const code = manualCode.trim().toUpperCase();
    if (!code) {
      setStatusMessage({ type: 'error', text: 'กรุณากรอกรหัสกะ (Shift Code)' });
      return;
    }

    if (!manualName.trim()) {
      setStatusMessage({ type: 'error', text: 'กรุณากรอกชื่อกะ (Shift Name)' });
      return;
    }

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(manualStartTime) || !timeRegex.test(manualEndTime)) {
      setStatusMessage({ type: 'error', text: 'กรุณากรอกรูปแบบเวลาให้ถูกต้อง เช่น 08:00 หรือ 17:00' });
      return;
    }

    const breakMin = parseInt(manualBreak) || 0;
    const workHrs = parseFloat(manualWorkingHours) || 0;

    const newCodeObj: ShiftCode = {
      code,
      name: manualName.trim(),
      department: manualDept,
      startTime: manualStartTime,
      endTime: manualEndTime,
      breakMinutes: breakMin,
      workingHours: workHrs,
      isWorkingDay: manualIsWorkingDay,
      color: manualColor,
      description: manualDesc.trim() || undefined,
    };

    try {
      const existing = storage.getShiftCodes();
      const codeMap = new Map<string, ShiftCode>();
      existing.forEach(c => {
        const key = `${c.code.toUpperCase()}_${c.department.toUpperCase()}`;
        codeMap.set(key, c);
      });
      
      const newKey = `${code}_${manualDept.toUpperCase()}`;
      if (editingShiftCodeKey && editingShiftCodeKey !== newKey) {
        codeMap.delete(editingShiftCodeKey);
        const [oldCode, oldDept] = editingShiftCodeKey.split('_');
        if (oldCode && oldDept) {
          firestoreSync.deleteShiftCode(oldCode, oldDept).catch(console.warn);
        }
      }
      
      codeMap.set(newKey, newCodeObj);

      const updated = Array.from(codeMap.values());
      storage.setShiftCodes(updated);

      setStatusMessage({
        type: 'success',
        text: editingShiftCodeKey 
          ? `แก้ไขข้อมูลรหัสกะ "${code}" ของแผนก "${manualDept}" เรียบร้อยแล้ว!` 
          : `เพิ่ม/อัปเดตรหัสกะ "${code}" เรียบร้อยแล้ว!`,
      });

      // Reset form fields
      setEditingShiftCodeKey(null);
      setManualCode('');
      setManualName('');
      setManualDept('ALL');
      setManualStartTime('08:00');
      setManualEndTime('17:00');
      setManualBreak('60');
      setManualWorkingHours('8');
      setManualIsWorkingDay(true);
      setManualColor('#008b99');
      setManualDesc('');

      onDataImported();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `ไม่สามารถบันทึกรหัสกะได้: ${err.message}`,
      });
    }
  };

  // 1. Shift Plan File Handler
  const handleShiftPlanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setStatusMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const rawRows = parseSheetToRows(buffer);

      const result = validateAndParseShiftPlan(
        rawRows,
        importMonthYear,
        importDept,
        employees,
        shiftCodes,
        currentUser.email
      );

      if (!result.valid) {
        setStatusMessage({
          type: 'error',
          text: `พบข้อผิดพลาดในการตรวจสอบไฟล์ Shift Plan (${result.errors.length} รายการ)`,
          details: result.errors,
        });
        return;
      }

      // Merge into stored shift plans: overwrite only matching employees & month
      const currentPlans = storage.getShiftPlans();
      const newPlanMap = new Map<string, DailyShiftPlan>();
      
      // Keep existing plans not affected by this upload
      currentPlans.forEach(p => {
        const key = `${p.empNo}_${p.date}`;
        newPlanMap.set(key, p);
      });

      // Overwrite with uploaded records
      result.plans.forEach(p => {
        const key = `${p.empNo}_${p.date}`;
        newPlanMap.set(key, p);
      });

      const updatedPlans = Array.from(newPlanMap.values());
      storage.setShiftPlans(updatedPlans);

      setStatusMessage({
        type: result.warnings.length > 0 ? 'warning' : 'success',
        text: `อัปโหลดตารางกะสำเร็จ! นำเข้าข้อมูล ${result.plans.length} วันทำงาน (พนักงาน ${result.matchedEmployeesCount} คน แผนก ${importDept})`,
        details: result.warnings.length > 0 ? result.warnings : undefined,
      });

      onDataImported();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `ไม่สามารถประมวลผลไฟล์ได้: ${err.message || 'รูปแบบไฟล์ไม่ถูกต้อง'}`,
      });
    } finally {
      e.target.value = '';
    }
  };

  // 2. Shift Code File Handler
  const handleShiftCodeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setStatusMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const rawRows = parseSheetToRows(buffer);
      const newCodes = parseShiftCodesFromRows(rawRows);

      if (newCodes.length === 0) {
        setStatusMessage({
          type: 'error',
          text: 'ไม่พบข้อมูล Shift Code ในไฟล์ที่อัปโหลด',
        });
        return;
      }

      // Merge with existing codes uniquely by code and department
      const existing = storage.getShiftCodes();
      const codeMap = new Map<string, ShiftCode>();
      existing.forEach(c => {
        const key = `${c.code.toUpperCase()}_${c.department.toUpperCase()}`;
        codeMap.set(key, c);
      });
      newCodes.forEach(c => {
        const key = `${c.code.toUpperCase()}_${c.department.toUpperCase()}`;
        codeMap.set(key, c);
      });

      const merged = Array.from(codeMap.values());
      storage.setShiftCodes(merged);

      setStatusMessage({
        type: 'success',
        text: `อัปโหลด Shift Code เรียบร้อยแล้ว! (เพิ่ม/อัปเดต ${newCodes.length} รายการ รวมในระบบ ${merged.length} รหัสกะ)`,
      });

      onDataImported();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `ไม่สามารถประมวลผล Shift Code ได้: ${err.message}`,
      });
    } finally {
      e.target.value = '';
    }
  };

  // 3. Attendance Biometric File Handler
  const handleAttendanceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setStatusMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let punches: BiometricRawPunch[] = [];
      if (file.name.endsWith('.txt') || file.name.endsWith('.dat')) {
        const text = await readFileAsText(file);
        punches = parseBiometricText(text);
      } else {
        // Excel/CSV
        const buffer = await readFileAsArrayBuffer(file);
        const rows = parseSheetToRows(buffer);
        // Map common columns
        rows.forEach((r, idx) => {
          const emp = String(r['EmpNo'] || r['GID'] || r['empNo'] || r['Emp'] || '').trim();
          const type = String(r['Type'] || r['InOut'] || r['Direction'] || 'I').toUpperCase().includes('O') ? 'O' : 'I';
          const date = String(r['Date'] || r['PunchDate'] || '').trim();
          const time = String(r['Time'] || r['PunchTime'] || '').trim();
          if (emp && date && time) {
            punches.push({
              id: `punch-upload-${idx}-${Date.now()}`,
              empIdentifier: emp,
              type: type as 'I' | 'O',
              timestamp: `${date} ${time}`,
              date,
              time,
              deviceId: String(r['Device'] || '01'),
            });
          }
        });
      }

      if (punches.length === 0) {
        setStatusMessage({
          type: 'error',
          text: 'ไม่พบรายการเวลาเข้า-ออกในไฟล์ หรือรูปแบบบรรทัดไม่ถูกต้อง',
        });
        return;
      }

      // Rule 5: "ข้อมูลนี้จะถูกอับโหลดหลายครั้งภายในเดือนนั้นๆให้ใช้ค่าล่าสุด"
      // Merge with existing raw punches
      const existing = storage.getBiometricPunches();
      const combined = [...existing, ...punches];
      storage.setBiometricPunches(combined);

      setStatusMessage({
        type: 'success',
        text: `นำเข้าข้อมูลลงเวลาจากเครื่องรูดบัตร/บันทึกเวลาสำเร็จ! (${punches.length} รายการ punch records, ระบบรวมและใช้อัตโนมัติตามเวลาล่าสุด)`,
      });

      onDataImported();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `เกิดข้อผิดพลาดในการประมวลผลไฟล์เวลา: ${err.message}`,
      });
    } finally {
      e.target.value = '';
    }
  };

  // 4. Approved OT File Handler (From Power BI)
  const handleOTFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setStatusMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const rawRows = parseSheetToRows(buffer);
      const parseResult = parseApprovedOTFile(rawRows, importMonthYear);

      if (parseResult.records.length === 0) {
        setStatusMessage({
          type: 'error',
          text: 'ไม่พบรายการ Approved OT ในไฟล์',
        });
        return;
      }

      // Check if there are retroactive records (Rule 5: "หากมีการอับโหลดโอทีเดือนก่อนหน้าซึ่งล่าช้าเข้ามาในระบบจะต้องให้ Admin ตรวจสอบวันที่จะลงบันทึก OT ก่อน")
      const retroRecords = parseResult.records.filter(r => r.isRetroactive);

      if (retroRecords.length > 0) {
        setRetroactiveOTs(retroRecords);
        setShowRetroModal(true);
      }

      // Save approved current month records immediately
      const validCurrentRecords = parseResult.records.filter(r => !r.isRetroactive);
      const existingOT = storage.getOTRecords();
      storage.setOTRecords([...existingOT, ...validCurrentRecords]);

      setStatusMessage({
        type: retroRecords.length > 0 ? 'warning' : 'success',
        text: `นำเข้าข้อมูล OT สำเร็จ (${validCurrentRecords.length} รายการปกติ)`,
        details: retroRecords.length > 0 
          ? [`พบโอทีล่าช้าของเดือนก่อนหน้า ${retroRecords.length} รายการ กรุณากำหนดวันที่จะบันทึกลง Time Sheet ของเดือนนี้`]
          : undefined,
      });

      onDataImported();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `เกิดข้อผิดพลาดในการนำเข้า OT: ${err.message}`,
      });
    } finally {
      e.target.value = '';
    }
  };

  // Handle saving retroactive OT target dates
  const handleConfirmRetroactiveOT = () => {
    const existing = storage.getOTRecords();
    const approvedRetro = retroactiveOTs.map(r => ({
      ...r,
      status: 'Approved' as const,
    }));

    storage.setOTRecords([...existing, ...approvedRetro]);
    setShowRetroModal(false);
    setRetroactiveOTs([]);

    setStatusMessage({
      type: 'success',
      text: `บันทึกโอทีล่าช้าของเดือนก่อนหน้าเรียบร้อยแล้ว (${approvedRetro.length} รายการได้รับการยืนยันวันลงบันทึกใน Time Sheet)`,
    });

    onDataImported();
  };

  // 5. Other Allowances File Handler
  const handleAllowancesFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setStatusMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const rawRows = parseSheetToRows(buffer);
      const allowances = parseOtherAllowances(rawRows);

      if (allowances.length === 0) {
        setStatusMessage({
          type: 'error',
          text: 'ไม่พบข้อมูลรายได้เสริม/ค่าเบี้ยเลี้ยงในไฟล์',
        });
        return;
      }

      const existing = storage.getOtherAllowances();
      storage.setOtherAllowances([...existing, ...allowances]);

      setStatusMessage({
        type: 'success',
        text: `นำเข้ารายได้อื่นๆ (Team Emergency, Shift Allowance, Standby) สำเร็จ! (${allowances.length} รายการ)`,
      });

      onDataImported();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `เกิดข้อผิดพลาดในการนำเข้าเบี้ยเลี้ยง: ${err.message}`,
      });
    } finally {
      e.target.value = '';
    }
  };

  // Quick download department blank template
  const handleDownloadDeptPlanTemplate = () => {
    const { csvContent } = generateShiftPlanTemplate(importDept, importMonthYear, employees);
    downloadBlob(
      csvContent,
      `Template_ShiftPlan_${importDept}_${importMonthYear}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  return (
    <div className={`p-4 flex flex-col space-y-4 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
      {/* Header Banner */}
      <div className={`p-4 rounded border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
        isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/30">
            <Upload className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold flex items-center gap-2 text-slate-100">
              <span>Data Import Center</span>
              <span className="text-xs font-normal text-slate-400">(ศูนย์การนำเข้าข้อมูลระบบ)</span>
            </h1>
            <p className="text-xs text-slate-400">
              Import Shift Plans, Shift Codes, Biometric Raw Punches, Approved OT (Power BI), and Other Allowances
            </p>
          </div>
        </div>

        {/* Global Controls: Month-Year Period + Target Scope Indicator */}
        <div className={`flex items-center space-x-3 text-xs p-2 rounded border ${
          isDark ? 'bg-[#0e1722] border-[#263b4f]' : 'bg-slate-50 border-slate-300'
        }`}>
          <div className="flex items-center space-x-1.5">
            <Calendar className="w-3.5 h-3.5 text-teal-400" />
            <span className="font-semibold text-slate-300">Period (งวดเดือน):</span>
            <input
              type="month"
              aria-label="Target Period"
              value={importMonthYear}
              onChange={e => setImportMonthYear(e.target.value)}
              className={`p-1 rounded font-mono font-bold outline-none cursor-pointer ${
                isDark ? 'bg-[#172432] text-teal-300 border border-[#2c445c]' : 'bg-white text-slate-900 border'
              }`}
            />
          </div>

          <div className="h-4 w-px bg-slate-600/40" />

          {/* Dynamic Scope Badge: Dept-Specific for Shift Plan vs ALL for Attendance/OT/Allowances */}
          <div className="flex items-center space-x-1.5">
            <Building2 className="w-3.5 h-3.5 text-teal-400" />
            <span className="font-semibold text-slate-400">Scope (ขอบเขต):</span>
            {activeImportTab === 'shift-plan' ? (
              <span className="px-2 py-0.5 rounded font-bold font-mono text-[11px] bg-teal-500/20 text-teal-300 border border-teal-500/30">
                Dept: {importDept} (แยกแผนก)
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded font-bold font-mono text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                ALL Depts (ทุกแผนก)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Status or Validation Message Alert */}
      {statusMessage && (
        <div className={`p-4 rounded border text-xs flex flex-col space-y-2 ${
          statusMessage.type === 'error'
            ? 'bg-red-500/10 border-red-500/40 text-red-200'
            : statusMessage.type === 'warning'
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
              : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
        }`}>
          <div className="flex items-center space-x-2 font-bold text-sm">
            {statusMessage.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-400" />
            ) : statusMessage.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
            <span>{statusMessage.text}</span>
          </div>

          {statusMessage.details && (
            <ul className="list-disc list-inside space-y-1 pl-2 text-[11px] opacity-90 max-h-40 overflow-y-auto">
              {statusMessage.details.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Main Layout: Sub Sidebar (Left) + Import Form & Details (Right) */}
      <div className="flex flex-col lg:flex-row gap-4 items-start w-full">
        {/* Sub Sidebar Navigation */}
        <aside 
          id="import-center-sub-sidebar"
          className={`w-full lg:w-72 xl:w-80 shrink-0 rounded border p-3 flex flex-col space-y-2.5 ${
            isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
          }`}
        >
          <div className="px-1.5 py-1 flex items-center justify-between border-b border-inherit pb-2">
            <span className={`text-[11px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Import Modules (เมนูการนำเข้า)
            </span>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
              isDark ? 'bg-[#0e1722] text-teal-400 border border-[#23384c]' : 'bg-slate-100 text-teal-700'
            }`}>
              5 หมวดหมู่
            </span>
          </div>

          {/* Vertical Menu Buttons */}
          <nav className="space-y-1.5">
            {[
              { 
                id: 'shift-plan' as const, 
                title: '1. Shift Plan', 
                subtitle: 'ตารางกะรายเดือน (แยกแผนก)', 
                icon: FileSpreadsheet, 
                badge: `Dept: ${importDept}`, 
                isDeptSpecific: true 
              },
              { 
                id: 'shift-code' as const, 
                title: '2. Shift Codes', 
                subtitle: 'รหัสกะการทำงาน (ใช้ร่วมกัน)', 
                icon: Clock, 
                badge: 'All Depts', 
                isDeptSpecific: false 
              },
              { 
                id: 'attendance' as const, 
                title: '3. Biometric Attendance', 
                subtitle: 'เวลาสแกนนิ้วเข้า-ออก (Text/CSV)', 
                icon: FileText, 
                badge: 'All Depts', 
                isDeptSpecific: false 
              },
              { 
                id: 'ot' as const, 
                title: '4. Approved OT', 
                subtitle: 'โอทีที่อนุมัติแล้ว (Power BI)', 
                icon: FileCheck2, 
                badge: 'All Depts', 
                isDeptSpecific: false 
              },
              { 
                id: 'allowances' as const, 
                title: '5. Other Allowances', 
                subtitle: 'เบี้ยเลี้ยงและรายได้เสริม', 
                icon: DollarSign, 
                badge: 'All Depts', 
                isDeptSpecific: false 
              },
            ].map(tab => {
              const isActive = activeImportTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveImportTab(tab.id);
                    setStatusMessage(null);
                  }}
                  className={`w-full p-2.5 rounded text-left transition flex items-start space-x-2.5 cursor-pointer border ${
                    isActive
                      ? isDark 
                        ? 'bg-teal-500/15 border-teal-500/40 text-teal-200 shadow-sm' 
                        : 'bg-teal-50 border-teal-400 text-teal-900 shadow-xs'
                      : isDark 
                        ? 'bg-[#0f1722]/60 border-[#1c2a38] hover:bg-[#182635] hover:border-slate-600 text-slate-300 hover:text-white' 
                        : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className={`p-2 rounded mt-0.5 shrink-0 ${
                    isActive 
                      ? isDark ? 'bg-teal-500/20 text-[#00e5e5]' : 'bg-teal-200 text-teal-800'
                      : isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-600'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-xs font-bold truncate ${isActive ? isDark ? 'text-[#00e5e5]' : 'text-teal-800' : ''}`}>
                        {tab.title}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono shrink-0 font-semibold ${
                        tab.isDeptSpecific
                          ? isDark ? 'bg-teal-950 text-teal-300 border border-teal-700/60' : 'bg-teal-100 text-teal-700'
                          : isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {tab.badge}
                      </span>
                    </div>
                    <p className={`text-[11px] leading-tight mt-0.5 truncate ${
                      isActive ? isDark ? 'text-teal-300/80' : 'text-teal-700' : isDark ? 'text-slate-400' : 'text-slate-500'
                    }`}>
                      {tab.subtitle}
                    </p>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Workflow guidance card at bottom of Sub Sidebar */}
          <div className={`mt-2 p-2.5 rounded border text-[11px] space-y-1.5 ${
            isDark ? 'bg-[#0a121a] border-[#1e2e3d] text-slate-400' : 'bg-amber-50/60 border-amber-200 text-amber-900'
          }`}>
            <div className="font-bold flex items-center gap-1.5 text-amber-400 text-xs">
              <HelpCircle className="w-3.5 h-3.5 shrink-0" />
              <span>ขั้นตอนเตรียมข้อมูล:</span>
            </div>
            <ol className="list-decimal list-inside space-y-0.5 text-[10.5px] opacity-90">
              <li>อัปโหลด <strong>Shift Plan</strong> แต่ละแผนก</li>
              <li>นำเข้า <strong>Biometric</strong> สแกนนิ้วรวม</li>
              <li>นำเข้า <strong>Approved OT</strong> & <strong>Allowances</strong></li>
            </ol>
          </div>
        </aside>

        {/* Right Area: Selected Import Module Workspace */}
        <div className="flex-1 min-w-0 w-full space-y-4">
          {/* TAB 1: Shift Plan Import (Department-Specific) */}
      {activeImportTab === 'shift-plan' && (
        <div className="space-y-4">
          {/* Direct Link to Dedicated Menu */}
          {onNavigateToUploadShiftPlan && (
            <div className={`p-3.5 rounded-lg border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
              isDark ? 'bg-[#0f1d2b] border-[#1d364f]' : 'bg-teal-50 border-teal-200'
            }`}>
              <div className="flex items-center space-x-2.5 text-xs">
                <CheckCircle2 className="w-4 h-4 text-[#00e5e5] shrink-0" />
                <span>
                  <strong>New Dedicated Main Menu:</strong> You can now also access <strong>Upload Shift Plan</strong> directly from the main sidebar for quick departmental access.
                </span>
              </div>
              <button
                onClick={onNavigateToUploadShiftPlan}
                className="px-3 py-1.5 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition shrink-0 flex items-center space-x-1 cursor-pointer"
              >
                <span>Go to Upload Shift Plan Menu (ไปยังเมนูหลัก)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Department Selector for Shift Plan */}
          <div className={`p-3.5 rounded border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
            isDark ? 'bg-[#152332] border-[#29425c]' : 'bg-teal-50 border-teal-200'
          }`}>
            <div className="flex items-center space-x-2.5">
              <Building2 className="w-4 h-4 text-teal-400" />
              <div>
                <span className="font-bold text-xs text-slate-100">
                  Target Department for Shift Plan (เลือกแผนกเป้าหมายสำหรับตารางกะ):
                </span>
                <p className="text-[11px] text-slate-400">
                  Shift Plans are managed per department. Uploading will ONLY update employees in the selected department.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <span className="text-xs text-slate-400 font-medium">Department:</span>
              <select
                aria-label="Target Department for Shift Plan"
                value={importDept}
                onChange={e => setImportDept(e.target.value)}
                className={`p-1.5 rounded font-mono font-bold text-xs outline-none cursor-pointer ${
                  isDark ? 'bg-[#0f1722] text-teal-300 border border-teal-500/40' : 'bg-white text-slate-900 border-teal-300'
                }`}
              >
                <option value="ALL">ALL — All Departments (ทุกแผนก)</option>
                {storage.getDepartments().map(d => (
                  <option key={d.code} value={d.code} className={isDark ? 'bg-[#0f1722]' : ''}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Left: Instructions & Download Template */}
            <div className={`p-4 rounded border space-y-4 text-xs ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
            }`}>
              <h2 className="font-bold text-sm text-[#00e5e5] flex items-center gap-2">
                <Download className="w-4 h-4" />
                <span>Step 1: Download Template (ดาวน์โหลดเทมเพลต)</span>
              </h2>
              <p className="text-slate-400 leading-relaxed">
                Generate an Excel/CSV template pre-filled with all employees for department <strong>{importDept}</strong> for <strong>{importMonthYear}</strong> (Days 1–31).
              </p>

              <div className={`p-3 rounded border text-[11px] space-y-1.5 ${
                isDark ? 'bg-[#0b1219] border-[#1e2e3d]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="font-bold text-slate-300">Validation & Safety Rules (กฎความถูกต้อง):</div>
                <div className="text-teal-400">✓ Department Isolation: Only updates employees in {importDept}</div>
                <div className="text-teal-400">✓ Other departments' schedules are protected and untouched</div>
                <div className="text-teal-400">✓ Verify Employee GID & EmpNo matches roster</div>
                <div className="text-amber-400">⚠ Automatic alerts if unrecognised Shift Codes are used</div>
              </div>

              <button
                onClick={handleDownloadDeptPlanTemplate}
                className="w-full flex items-center justify-center space-x-2 py-2.5 rounded bg-slate-700 hover:bg-slate-600 text-white font-semibold transition"
              >
                <Download className="w-4 h-4 text-teal-400" />
                <span>Download Template ({importDept})</span>
              </button>
            </div>

            {/* Right: Upload Area */}
            <div className={`md:col-span-2 p-6 rounded border flex flex-col items-center justify-center text-center space-y-4 border-dashed ${
              isDark ? 'bg-[#121c27] border-[#2f4358]' : 'bg-white border-slate-300'
            }`}>
              <div className="p-4 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/30">
                <Upload className="w-8 h-8" />
              </div>
              <div>
                <h2 className="font-bold text-base text-slate-100">
                  Step 2: Upload Shift Plan File (อัปโหลดไฟล์ตารางกะ)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Target: Department <strong>{importDept}</strong> • Period <strong>{importMonthYear}</strong>
                </p>
                <p className="text-[11px] text-teal-400/90 mt-0.5">
                  Safe Overwrite: You can upload multiple revisions during the month; only matching employee rows are updated.
                </p>
              </div>

              <label className="cursor-pointer px-6 py-3 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-lg transition flex items-center space-x-2">
                <Upload className="w-4 h-4" />
                <span>Select Shift Plan File (.xlsx, .xls, .csv)</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleShiftPlanFile}
                  className="hidden"
                />
              </label>

              <span className="text-[11px] text-slate-500">
                Supports both wide format (Columns 01..31) and long format (Date, ShiftCode)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Shift Code Manager & Import */}
      {activeImportTab === 'shift-code' && (
        <div className="space-y-4">
          {/* Universal Scope Info Banner */}
          <div className={`p-3 rounded border flex items-center space-x-2 text-xs ${
            isDark ? 'bg-[#152332] border-[#29425c] text-slate-300' : 'bg-teal-50 border-teal-200 text-slate-700'
          }`}>
            <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
            <span>
              <strong>Company-Wide Shift Code Master (รหัสกะกลางสำหรับทุกแผนก):</strong> Shift codes are shared across all departments or can have department-specific prefixes (e.g. RS-D1, SIG-N1).
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-4">
              {/* Card 1: File Upload */}
              <div className={`p-4 rounded border space-y-3 text-xs ${
                isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
              }`}>
                <h2 className="font-bold text-sm text-[#00e5e5] flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  <span>Upload Shift Codes (อัปโหลดรหัสกะ)</span>
                </h2>
                <p className="text-slate-400">
                  Admins can upload or expand shift definitions (e.g. D = 08:00-17:00, N = 20:00-05:00) with break times and working hours.
                </p>

                <label className="cursor-pointer block text-center py-2.5 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition cursor-pointer">
                  <span>Select Shift Code File (.xlsx, .csv)</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleShiftCodeFile}
                    className="hidden"
                  />
                </label>

                <button
                  onClick={() => {
                    const { csvContent } = generateShiftCodeTemplate(shiftCodes);
                    downloadBlob(csvContent, 'Template_ShiftCodes.csv', 'text/csv;charset=utf-8;');
                  }}
                  className="w-full flex items-center justify-center space-x-1.5 py-2 rounded border border-slate-600 text-slate-300 hover:text-white text-xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Shift Code Template (CSV)</span>
                </button>
              </div>

              {/* Card 2: Manual Creator */}
              <div className={`p-4 rounded border space-y-3 text-xs ${
                isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
              }`}>
                <h2 className="font-bold text-sm text-[#00e5e5] flex items-center gap-2">
                  {editingShiftCodeKey ? (
                    <>
                      <Edit2 className="w-4 h-4 text-amber-400 animate-pulse" />
                      <span>Edit Shift Code (แก้ไขรหัสกะ)</span>
                    </>
                  ) : (
                    <>
                      <PlusCircle className="w-4 h-4 text-teal-400" />
                      <span>Manual Shift Code (เพิ่มรหัสกะด้วยตนเอง)</span>
                    </>
                  )}
                </h2>
                <p className="text-[11px] text-slate-400">
                  {editingShiftCodeKey 
                    ? `กำลังแก้ไขรหัสกะ "${manualCode}" ของแผนก "${manualDept}"`
                    : 'ระบุรายละเอียดเพื่อเพิ่มหรือแก้ไขรหัสกะรายแผนก หรือใช้งานร่วมกันทั้งหมด (ALL)'
                  }
                </p>

                <form onSubmit={handleManualAddShiftCode} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">รหัสกะ (Shift Code) *</label>
                    <input
                      type="text"
                      placeholder="เช่น D, N, RS-D1, SBY"
                      value={manualCode}
                      onChange={e => setManualCode(e.target.value)}
                      className={`w-full p-2 rounded text-xs outline-none font-mono font-bold ${
                        isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                      }`}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">ชื่อกะการทำงาน *</label>
                    <input
                      type="text"
                      placeholder="เช่น Day Shift 08:00-17:00"
                      value={manualName}
                      onChange={e => setManualName(e.target.value)}
                      className={`w-full p-2 rounded text-xs outline-none ${
                        isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                      }`}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">แผนก (Section)</label>
                      <select
                        value={manualDept}
                        onChange={e => setManualDept(e.target.value)}
                        className={`w-full p-2 rounded text-xs outline-none font-bold ${
                          isDark ? 'bg-[#0f1722] text-teal-300 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                        }`}
                      >
                        <option value="ALL">ALL (ทุกแผนก)</option>
                        {storage.getDepartments().map(d => (
                          <option key={d.code} value={d.code}>{d.code}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">เป็นวันทำงาน?</label>
                      <select
                        value={manualIsWorkingDay ? 'true' : 'false'}
                        onChange={e => setManualIsWorkingDay(e.target.value === 'true')}
                        className={`w-full p-2 rounded text-xs outline-none font-bold ${
                          isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                        }`}
                      >
                        <option value="true">ใช่ (Working)</option>
                        <option value="false">ไม่ใช่ (OFF / วันลา / วันหยุด)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">เวลาเริ่ม (Start Time) *</label>
                      <input
                        type="text"
                        placeholder="08:00"
                        value={manualStartTime}
                        onChange={e => setManualStartTime(e.target.value)}
                        className={`w-full p-2 rounded text-xs outline-none font-mono ${
                          isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                        }`}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">เวลาเลิก (End Time) *</label>
                      <input
                        type="text"
                        placeholder="17:00"
                        value={manualEndTime}
                        onChange={e => setManualEndTime(e.target.value)}
                        className={`w-full p-2 rounded text-xs outline-none font-mono ${
                          isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                        }`}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">เวลาพัก (Break Min)</label>
                      <input
                        type="number"
                        placeholder="60"
                        value={manualBreak}
                        onChange={e => setManualBreak(e.target.value)}
                        className={`w-full p-2 rounded text-xs outline-none font-mono ${
                          isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                        }`}
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">ชม.ทำงาน (Hours)</label>
                      <input
                        type="number"
                        step="0.5"
                        placeholder="8"
                        value={manualWorkingHours}
                        onChange={e => setManualWorkingHours(e.target.value)}
                        className={`w-full p-2 rounded text-xs outline-none font-mono ${
                          isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                        }`}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">สีสัญลักษณ์ (Color Tag)</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        value={manualColor}
                        onChange={e => setManualColor(e.target.value)}
                        className="w-7 h-7 rounded border-0 cursor-pointer p-0 bg-transparent shrink-0"
                        title="กำหนดสีเอง"
                      />
                      <div className="flex flex-wrap gap-1">
                        {['#008b99', '#0284c7', '#06b6d4', '#f59e0b', '#6366f1', '#10b981', '#ef4444', '#ec4899', '#475569'].map(c => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setManualColor(c)}
                            className="w-4 h-4 rounded-full border border-slate-700/50 cursor-pointer"
                            style={{ backgroundColor: c, ring: manualColor === c ? '2px solid white' : 'none' }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">คำอธิบายเพิ่มเติม</label>
                    <input
                      type="text"
                      placeholder="เช่น กะทำงานเช้าปกติโรงรถ"
                      value={manualDesc}
                      onChange={e => setManualDesc(e.target.value)}
                      className={`w-full p-2 rounded text-xs outline-none ${
                        isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                      }`}
                    />
                  </div>

                  {editingShiftCodeKey ? (
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="flex-1 py-2.5 rounded font-bold text-xs bg-amber-500 hover:bg-amber-600 text-[#09151e] shadow transition cursor-pointer flex items-center justify-center gap-1"
                      >
                        <Edit2 className="w-4 h-4 animate-pulse" />
                        <span>อัปเดตข้อมูลกะ (Update Shift Code)</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-3 py-2.5 rounded font-bold text-xs bg-slate-600 hover:bg-slate-700 text-white shadow transition cursor-pointer flex items-center justify-center gap-1"
                        title="ยกเลิกการแก้ไข"
                      >
                        <X className="w-4 h-4" />
                        <span>ยกเลิก</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="submit"
                      className="w-full py-2.5 rounded font-bold text-xs bg-teal-500 hover:bg-teal-600 text-[#09151e] shadow transition cursor-pointer flex items-center justify-center gap-1"
                    >
                      <Plus className="w-4 h-4" />
                      <span>บันทึกรหัสกะ (Save Shift Code)</span>
                    </button>
                  )}
                </form>
              </div>
            </div>

            {/* Current Registered Shift Codes List */}
            <div className={`md:col-span-2 p-4 rounded border text-xs overflow-hidden ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
            }`}>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
                <h3 className="font-bold text-sm text-slate-200">
                  Registered Shift Codes (รหัสกะในระบบทั้งหมด {shiftCodes.length} รหัส):
                </h3>
                
                {/* Filter Section Dropdown */}
                <div className="flex items-center space-x-2 shrink-0">
                  <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-teal-400" />
                    <span>Filter Section:</span>
                  </span>
                  <select
                    value={shiftCodeDeptFilter}
                    onChange={e => setShiftCodeDeptFilter(e.target.value)}
                    className={`p-1.5 rounded font-mono font-bold text-xs outline-none cursor-pointer ${
                      isDark ? 'bg-[#0f1722] text-teal-300 border border-[#23384c]' : 'bg-slate-100 text-slate-800 border'
                    }`}
                  >
                    <option value="SHOW_ALL">แสดงทั้งหมด (SHOW ALL)</option>
                    <option value="ALL">ALL (ทุกแผนก)</option>
                    {storage.getDepartments().map(d => (
                      <option key={d.code} value={d.code}>{d.code} — {d.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[500px] scrollbar-thin">
                <table className="w-full border-collapse text-left">
                  <thead className={isDark ? 'bg-[#0f1722] text-slate-300' : 'bg-slate-100 text-slate-700'}>
                    <tr>
                      <th className="p-2 border-b">Code (รหัส)</th>
                      <th className="p-2 border-b">Name (ชื่อกะ)</th>
                      <th className="p-2 border-b">Section (แผนก)</th>
                      <th className="p-2 border-b">Type (ประเภท)</th>
                      <th className="p-2 border-b">Time (ช่วงเวลา)</th>
                      <th className="p-2 border-b">Break (พัก)</th>
                      <th className="p-2 border-b">Hours (ชั่วโมง)</th>
                      {isAdmin && <th className="p-2 border-b text-center">Actions (จัดการ)</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shiftCodes
                      .filter(sc => {
                        if (shiftCodeDeptFilter === 'SHOW_ALL') return true;
                        return sc.department === shiftCodeDeptFilter;
                      })
                      .map(sc => {
                        const key = `${sc.code.toUpperCase()}_${sc.department.toUpperCase()}`;
                        const isConfirming = deleteConfirmKey === key;
                        return (
                          <tr key={key} className="border-b border-slate-700/30 hover:bg-slate-800/10 transition-colors">
                            <td className="p-2 font-mono font-bold">
                              <span 
                                className="px-2 py-0.5 rounded text-white text-[11px]"
                                style={{ backgroundColor: sc.color }}
                              >
                                {sc.code}
                              </span>
                            </td>
                            <td className="p-2 font-medium">
                              <div>{sc.name}</div>
                              {sc.description && <div className="text-[10px] text-slate-400 font-normal">{sc.description}</div>}
                            </td>
                            <td className="p-2 font-mono">
                              <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                                sc.department === 'ALL'
                                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                                  : 'bg-teal-500/10 text-teal-300 border border-teal-500/20'
                              }`}>
                                {sc.department}
                              </span>
                            </td>
                            <td className="p-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                sc.isWorkingDay 
                                  ? 'bg-blue-500/10 text-blue-300' 
                                  : 'bg-amber-500/10 text-amber-300'
                              }`}>
                                {sc.isWorkingDay ? 'Working' : 'OFF/Leave'}
                              </span>
                            </td>
                            <td className="p-2 font-mono">{sc.startTime} - {sc.endTime}</td>
                            <td className="p-2 font-mono">{sc.breakMinutes} min</td>
                            <td className="p-2 font-mono">{sc.workingHours} hrs</td>
                            {isAdmin && (
                              <td className="p-2 text-center font-mono">
                                {isConfirming ? (
                                  <div className="flex items-center justify-center space-x-1">
                                    <span className="text-[10px] text-red-400 font-bold shrink-0">Confirm?</span>
                                    <button 
                                      onClick={() => handleDeleteShiftCode(sc)}
                                      className="px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-bold cursor-pointer"
                                    >
                                      Yes
                                    </button>
                                    <button 
                                      onClick={() => setDeleteConfirmKey(null)}
                                      className="px-1.5 py-0.5 bg-slate-600 hover:bg-slate-700 text-white rounded text-[10px] font-bold cursor-pointer"
                                    >
                                      No
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center space-x-1.5">
                                    <button
                                      onClick={() => handleStartEditShiftCode(sc)}
                                      className="p-1 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 rounded transition cursor-pointer"
                                      title="แก้ไขข้อมูลกะ"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => setDeleteConfirmKey(key)}
                                      className="p-1 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded transition cursor-pointer"
                                      title="ลบรหัสกะ"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    {shiftCodes.filter(sc => {
                      if (shiftCodeDeptFilter === 'SHOW_ALL') return true;
                      return sc.department === shiftCodeDeptFilter;
                    }).length === 0 && (
                      <tr>
                        <td colSpan={isAdmin ? 8 : 7} className="text-center p-8 text-slate-400">
                          ไม่พบข้อมูลกะที่ตรงกับแผนกที่ระบุ
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Biometric Attendance Import (Company-Wide ALL) */}
      {activeImportTab === 'attendance' && (
        <div className="space-y-4">
          {/* Universal Scope & Reassurance Card */}
          <div className={`p-4 rounded border text-xs space-y-2 ${
            isDark ? 'bg-[#142334] border-[#294562] text-slate-300' : 'bg-emerald-50 border-emerald-300 text-slate-800'
          }`}>
            <div className="flex items-center space-x-2 font-bold text-sm text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span>Multi-Department & Cumulative Upload Support (รองรับไฟล์รวมทุกแผนก & อัปโหลดทับได้ตลอดเดือน)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] leading-relaxed pt-1">
              <div className="p-2.5 rounded bg-black/20 border border-white/5 space-y-1">
                <span className="font-bold text-teal-300">1. All Departments in One File (รวมทุกแผนกในไฟล์เดียว):</span>
                <p className="text-slate-400">
                  Biometric clock-in/out raw files contain punch records for staff across ALL departments. The system automatically routes and pairs punches to employees by their <strong>GID or EmpNo</strong>.
                </p>
              </div>
              <div className="p-2.5 rounded bg-black/20 border border-white/5 space-y-1">
                <span className="font-bold text-emerald-300">2. Safe Cumulative Multi-Uploads (อัปโหลดทับได้ปลอดภัย):</span>
                <p className="text-slate-400">
                  You can upload daily or weekly updates. The system merges new punches chronologically without deleting past days, and automatically selects the most recent punches.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`p-4 rounded border space-y-3 text-xs ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
            }`}>
              <h2 className="font-bold text-sm text-[#00e5e5] flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span>Step 1: Sample Biometric File (ตัวอย่างไฟล์)</span>
              </h2>
              <p className="text-slate-400 leading-relaxed">
                Supports raw Text (.txt), .dat, or Excel/CSV from attendance biometric fingerprint/card readers (e.g. <code>Time Attendance.txt</code>).
              </p>

              <div className={`p-3 rounded border text-[11px] space-y-1 ${
                isDark ? 'bg-[#0a1118] border-[#1e2e3d]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="font-mono text-slate-300">Format Samples (ตัวอย่างบรรทัด):</div>
                <div className="font-mono text-teal-400">0149   I 260128 0442 01</div>
                <div className="font-mono text-teal-400">0149   O 260128 1536 01</div>
                <div className="font-mono text-teal-400">Z0057PUI 260128 0757 01</div>
              </div>

              <button
                onClick={() => {
                  const sampleText = `0149   I 260505 0530 01\n0149   O 260505 1400 01\n0950   I 260505 0739 01\n0950   O 260505 1729 01\n1442   I 260505 0730 01\n1442   O 260505 1630 01\n0077   I 260505 0732 01\n0077   O 260505 1640 01\n0315   I 260505 0545 01\n0315   O 260505 1415 01`;
                  downloadBlob(sampleText, 'Time_Attendance_Sample.txt', 'text/plain;charset=utf-8;');
                }}
                className="w-full flex items-center justify-center space-x-1.5 py-2 rounded border border-slate-600 text-slate-300 hover:text-white text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Sample (Time Attendance.txt)</span>
              </button>
            </div>

            <div className={`md:col-span-2 p-6 rounded border flex flex-col items-center justify-center text-center space-y-4 border-dashed ${
              isDark ? 'bg-[#121c27] border-[#2f4358]' : 'bg-white border-slate-300'
            }`}>
              <div className="p-4 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/30">
                <Clock className="w-8 h-8" />
              </div>
              <div>
                <h2 className="font-bold text-base text-slate-100">
                  Step 2: Upload Attendance Punches (อัปโหลดไฟล์บันทึกเวลาเข้า-ออก)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Scope: <strong>All Departments (Company-Wide)</strong> • Automatically routed by GID / EmpNo
                </p>
                <p className="text-[11px] text-teal-400 mt-0.5">
                  Safe to re-upload multiple times during the month without overwriting past history.
                </p>
              </div>

              <label className="cursor-pointer px-6 py-3 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-lg transition flex items-center space-x-2">
                <Upload className="w-4 h-4" />
                <span>Select Attendance File (.txt, .dat, .csv, .xlsx)</span>
                <input
                  type="file"
                  accept=".txt,.dat,.csv,.xlsx,.xls"
                  onChange={handleAttendanceFile}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Approved OT Import (Company-Wide from Power BI) */}
      {activeImportTab === 'ot' && (
        <div className="space-y-4">
          {/* Universal Scope & Reassurance Card */}
          <div className={`p-4 rounded border text-xs space-y-2 ${
            isDark ? 'bg-[#142334] border-[#294562] text-slate-300' : 'bg-emerald-50 border-emerald-300 text-slate-800'
          }`}>
            <div className="flex items-center space-x-2 font-bold text-sm text-teal-400">
              <CheckCircle2 className="w-4 h-4" />
              <span>Company-Wide Approved OT File (ไฟล์โอทีที่อนุมัติแล้ว รวมทุกแผนกจาก Power BI)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] leading-relaxed pt-1">
              <div className="p-2.5 rounded bg-black/20 border border-white/5 space-y-1">
                <span className="font-bold text-teal-300">1. Universal Multi-Department File (รวมทุกแผนก):</span>
                <p className="text-slate-400">
                  Power BI reports contain approved OT records across all departments. The system automatically links each record to the appropriate employee Timesheet via GID.
                </p>
              </div>
              <div className="p-2.5 rounded bg-black/20 border border-white/5 space-y-1">
                <span className="font-bold text-amber-300">2. Retroactive Safeguard (ตรวจสอบโอทีย้อนหลัง):</span>
                <p className="text-slate-400">
                  If late OT from a prior month is uploaded, Admins are prompted to inspect and designate the target recording date before it is applied to the current Timesheet.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`p-4 rounded border space-y-3 text-xs ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
            }`}>
              <h2 className="font-bold text-sm text-[#00e5e5] flex items-center gap-2">
                <FileCheck2 className="w-4 h-4" />
                <span>Step 1: Download Template (ดาวน์โหลดเทมเพลต)</span>
              </h2>
              <p className="text-slate-400 leading-relaxed">
                Download the standardized Approved OT Excel/CSV template formatted to Power BI exports.
              </p>

              <div className={`p-3 rounded border text-[11px] space-y-1.5 ${
                isDark ? 'bg-[#0a1118] border-[#1e2e3d]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="font-bold text-slate-300">OT Processing Rules (กฎการประมวลผล):</div>
                <div className="text-teal-400">✓ Multiple OT intervals on the same day are automatically summed</div>
                <div className="text-teal-400">✓ Calculates OT rates (1.5x, 3.0x) automatically</div>
                <div className="text-amber-400">⚠ Retroactive prior-month OT requires Admin confirmation</div>
              </div>

              <button
                onClick={() => {
                  const { csvContent } = generateOTApprovedTemplate();
                  downloadBlob(csvContent, 'Template_Approved_OT.csv', 'text/csv;charset=utf-8;');
                }}
                className="w-full flex items-center justify-center space-x-1.5 py-2 rounded border border-slate-600 text-slate-300 hover:text-white text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Approved OT Template</span>
              </button>
            </div>

            <div className={`md:col-span-2 p-6 rounded border flex flex-col items-center justify-center text-center space-y-4 border-dashed ${
              isDark ? 'bg-[#121c27] border-[#2f4358]' : 'bg-white border-slate-300'
            }`}>
              <div className="p-4 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/30">
                <FileCheck2 className="w-8 h-8" />
              </div>
              <div>
                <h2 className="font-bold text-base text-slate-100">
                  Step 2: Upload Approved OT File (อัปโหลดไฟล์รายงาน OT)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Scope: <strong>All Departments (ทุกแผนก)</strong> • Linked automatically via GID / EmpNo
                </p>
              </div>

              <label className="cursor-pointer px-6 py-3 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-lg transition flex items-center space-x-2">
                <Upload className="w-4 h-4" />
                <span>Select Approved OT File (.xlsx, .csv)</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleOTFile}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: Other Allowances (Company-Wide ALL) */}
      {activeImportTab === 'allowances' && (
        <div className="space-y-4">
          {/* Universal Scope Card */}
          <div className={`p-3.5 rounded border text-xs space-y-1 ${
            isDark ? 'bg-[#152332] border-[#29425c] text-slate-300' : 'bg-teal-50 border-teal-200 text-slate-700'
          }`}>
            <div className="font-bold text-teal-400 flex items-center gap-1.5">
              <DollarSign className="w-4 h-4" />
              <span>Company-Wide Allowances (เบี้ยเลี้ยงและรายได้อื่นๆ รวมทุกแผนก)</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Upload Team Emergency, Shift Allowance, and Standby payments across all departments. Linked by GID/EmpNo to individual monthly Timesheets and Payroll.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`p-4 rounded border space-y-3 text-xs ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
            }`}>
              <h2 className="font-bold text-sm text-[#00e5e5] flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                <span>Step 1: Download Template (ดาวน์โหลดเทมเพลต)</span>
              </h2>
              <p className="text-slate-400 leading-relaxed">
                Download sample file covering Team Emergency, Shift Allowance, and Standby allowances.
              </p>

              <button
                onClick={() => {
                  const sampleCSV = '\uFEFFEmpNo,GID,MonthYear,TeamEmergency,ShiftAllowance,StandbyAllowance,Remark\n0149,Z00149TH,2026-05,800,1200,500,Emergency Team Coverage\n0950,Z00430UZ,2026-05,0,0,0,No shift allowance';
                  downloadBlob(sampleCSV, 'Template_Other_Allowances.csv', 'text/csv;charset=utf-8;');
                }}
                className="w-full flex items-center justify-center space-x-1.5 py-2 rounded border border-slate-600 text-slate-300 hover:text-white text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Allowances Template (CSV)</span>
              </button>
            </div>

            <div className={`md:col-span-2 p-6 rounded border flex flex-col items-center justify-center text-center space-y-4 border-dashed ${
              isDark ? 'bg-[#121c27] border-[#2f4358]' : 'bg-white border-slate-300'
            }`}>
              <div className="p-4 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/30">
                <DollarSign className="w-8 h-8" />
              </div>
              <div>
                <h2 className="font-bold text-base text-slate-100">
                  Step 2: Upload Allowances File (อัปโหลดไฟล์รายได้อื่นๆ)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Scope: <strong>All Departments (ทุกแผนก)</strong> • Linked by GID / EmpNo
                </p>
              </div>

              <label className="cursor-pointer px-6 py-3 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-lg transition flex items-center space-x-2">
                <Upload className="w-4 h-4" />
                <span>Select Allowances File (.xlsx, .csv)</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleAllowancesFile}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      )}
        </div>
      </div>

      {/* Retroactive OT Admin Verification Modal (Rule 5) */}
      {showRetroModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className={`w-full max-w-2xl rounded-lg border shadow-2xl p-5 ${
            isDark ? 'bg-[#142230] border-[#2a435c] text-white' : 'bg-white border-slate-300 text-slate-900'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <div className="flex items-center space-x-2 text-amber-400 font-bold text-sm">
                <AlertTriangle className="w-5 h-5" />
                <span>Review & Approve Retroactive OT (ตรวจสอบและอนุมัติวันลงบันทึกโอทีล่าช้า)</span>
              </div>
              <button onClick={() => setShowRetroModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <p className="text-xs text-slate-300 my-3">
              The system detected OT records from a prior month ({retroactiveOTs.length} items). In accordance with Siemens Attendance Policy: <strong>Admins must verify and designate the exact date to record each retroactive OT entry in the current monthly Timesheet.</strong>
            </p>

            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {retroactiveOTs.map((ot, idx) => (
                <div key={ot.id} className={`p-3 rounded border text-xs grid grid-cols-1 md:grid-cols-4 gap-2 items-center ${
                  isDark ? 'bg-[#0e1722] border-[#223548]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Employee (พนักงาน):</span>
                    <span className="font-mono font-bold text-teal-300">{ot.empNo} / {ot.gid}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Original Date (วันที่เดิม):</span>
                    <span className="font-mono text-amber-400">{ot.originalDate}</span>
                    <span className="text-[10px] text-slate-400 block">{ot.hours} hrs ({ot.rate}x)</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Reason (เหตุผล):</span>
                    <span className="truncate block text-[11px]" title={ot.reason}>{ot.reason}</span>
                  </div>
                  <div>
                    <label className="text-slate-400 block text-[10px] font-semibold text-[#00e5e5]">
                      Timesheet Target Date:
                    </label>
                    <input
                      type="date"
                      value={ot.retroactiveTargetDate || `${importMonthYear}-01`}
                      onChange={e => {
                        const val = e.target.value;
                        setRetroactiveOTs(prev => prev.map((item, i) => i === idx ? { ...item, retroactiveTargetDate: val } : item));
                      }}
                      className={`w-full p-1.5 rounded border text-xs font-mono font-bold ${
                        isDark ? 'bg-[#182736] border-[#314a63] text-white' : 'bg-white border-slate-300'
                      }`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-4 border-t border-slate-700 mt-4">
              <button
                onClick={() => setShowRetroModal(false)}
                className="px-4 py-2 rounded text-xs text-slate-300 hover:text-white"
              >
                Cancel (ยกเลิก)
              </button>
              <button
                onClick={handleConfirmRetroactiveOT}
                className="px-5 py-2 rounded text-xs font-semibold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow"
              >
                Approve & Record to Timesheet (อนุมัติและบันทึกลง Time Sheet)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
