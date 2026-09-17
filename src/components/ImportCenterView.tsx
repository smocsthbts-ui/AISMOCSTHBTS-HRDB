import React, { useState, useMemo } from 'react';
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
  RotateCcw,
  Search,
  Filter,
  X
} from 'lucide-react';
import { INITIAL_SHIFT_CODES } from '../data/initialData';
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
  downloadBlob,
  downloadWorkbook
} from '../utils/fileParser';
import { storage, parseBiometricText } from '../utils/storage';
import { firestoreSync } from '../firebase';
import { AttendanceImportPanel } from './AttendanceImportPanel';
import { OTDeduplicationModal } from './OTDeduplicationModal';
import { 
  mergeAndDeduplicateOTRecords, 
  OTMergeMode, 
  OTMergeResult,
  OTMergeDetail 
} from '../utils/otManager';
import { 
  ShieldCheck, 
  RefreshCw, 
  Sparkles, 
  Layers, 
  Check, 
  Info 
} from 'lucide-react';

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

  // OT Rate Selection: Admin must select OT1.5 or OT3.0 prior to importing
  const [selectedOTRate, setSelectedOTRate] = useState<1.5 | 3.0>(1.5);
  const [otRateFilter, setOtRateFilter] = useState<'ALL' | 1.5 | 3.0>('ALL');
  const [otSearchQuery, setOtSearchQuery] = useState<string>('');
  const [deleteOTConfirmId, setDeleteOTConfirmId] = useState<string | null>(null);

  // OT Deduplication & Re-Import Strategy State
  const [otMergeMode, setOtMergeMode] = useState<OTMergeMode>('smart_merge');
  const [latestOTMergeResult, setLatestOTMergeResult] = useState<OTMergeResult | null>(null);
  const [showOTMergeModal, setShowOTMergeModal] = useState<boolean>(false);

  // Shift Code Search & Filter
  const [shiftCodeDeptFilter, setShiftCodeDeptFilter] = useState<string>('SHOW_ALL');
  const [shiftCodeSearchQuery, setShiftCodeSearchQuery] = useState<string>('');
  const [shiftCodeTypeFilter, setShiftCodeTypeFilter] = useState<'ALL' | 'WORKING' | 'OFF'>('ALL');

  const filteredShiftCodes = useMemo(() => {
    return shiftCodes.filter(sc => {
      // 1. Dept filter
      if (shiftCodeDeptFilter !== 'SHOW_ALL') {
        if (sc.department !== shiftCodeDeptFilter && (shiftCodeDeptFilter === 'ALL' || sc.department !== 'ALL')) {
          return false;
        }
      }
      // 2. Type filter
      if (shiftCodeTypeFilter === 'WORKING' && !sc.isWorkingDay) return false;
      if (shiftCodeTypeFilter === 'OFF' && sc.isWorkingDay) return false;

      // 3. Search query
      if (shiftCodeSearchQuery.trim()) {
        const q = shiftCodeSearchQuery.trim().toLowerCase();
        const codeStr = sc.code.toLowerCase();
        const nameStr = sc.name.toLowerCase();
        const deptStr = sc.department.toLowerCase();
        const descStr = (sc.description || '').toLowerCase();
        const timeStr = `${sc.startTime} ${sc.endTime}`;
        const typeStr = sc.isWorkingDay ? 'working กะทำงาน ทำงาน' : 'off leave วันหยุด วันลา หยุด';

        const isMatch = codeStr.includes(q) ||
                        nameStr.includes(q) ||
                        deptStr.includes(q) ||
                        descStr.includes(q) ||
                        timeStr.includes(q) ||
                        typeStr.includes(q);
        if (!isMatch) return false;
      }

      return true;
    });
  }, [shiftCodes, shiftCodeDeptFilter, shiftCodeTypeFilter, shiftCodeSearchQuery]);

  // Current month OT records and stats
  const [confirmClearMonthOT, setConfirmClearMonthOT] = useState<boolean>(false);

  const allOTRecords = useMemo(() => {
    return storage.getOTRecords();
  }, [statusMessage]);

  const monthOTRecords = useMemo(() => {
    return allOTRecords.filter(ot => {
      const d = ot.retroactiveTargetDate || ot.date;
      return d.startsWith(importMonthYear);
    });
  }, [allOTRecords, importMonthYear]);

  const otStats = useMemo(() => {
    let count1_5 = 0;
    let hours1_5 = 0;
    let count3_0 = 0;
    let hours3_0 = 0;

    monthOTRecords.forEach(ot => {
      if (ot.rate === 3.0) {
        count3_0++;
        hours3_0 += ot.hours;
      } else {
        count1_5++;
        hours1_5 += ot.hours;
      }
    });

    return {
      totalCount: monthOTRecords.length,
      totalHours: hours1_5 + hours3_0,
      count1_5,
      hours1_5,
      count3_0,
      hours3_0,
    };
  }, [monthOTRecords]);

  const filteredMonthOTRecords = useMemo(() => {
    return monthOTRecords.filter(ot => {
      if (otRateFilter !== 'ALL' && ot.rate !== otRateFilter) return false;
      if (otSearchQuery.trim()) {
        const q = otSearchQuery.trim().toLowerCase();
        const emp = employees.find(e => e.empNo === ot.empNo || e.gid === ot.gid);
        const nameStr = (emp?.name || '').toLowerCase();
        const empNoStr = (ot.empNo || '').toLowerCase();
        const gidStr = (ot.gid || '').toLowerCase();
        const reasonStr = (ot.reason || '').toLowerCase();
        const dateStr = (ot.date || '').toLowerCase();
        return empNoStr.includes(q) || gidStr.includes(q) || nameStr.includes(q) || reasonStr.includes(q) || dateStr.includes(q);
      }
      return true;
    });
  }, [monthOTRecords, otRateFilter, otSearchQuery, employees]);

  // Edit/Delete Shift Code Admin Mode States
  const [editingShiftCodeKey, setEditingShiftCodeKey] = useState<string | null>(null);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);

  const handleStartEditShiftCode = (sc: ShiftCode) => {
    setEditingShiftCodeKey(`${sc.code.toUpperCase()}_${sc.department.toUpperCase()}`);
    setManualCode(sc.code);
    setManualName(sc.name);
    setManualDept(sc.department);
    setManualStartTime(sc.isWorkingDay ? (sc.startTime || '08:00') : '00:00');
    setManualEndTime(sc.isWorkingDay ? (sc.endTime || '17:00') : '00:00');
    setManualBreak(sc.isWorkingDay ? (sc.breakMinutes ?? 60).toString() : '0');
    setManualWorkingHours(sc.isWorkingDay ? (sc.workingHours ?? 8).toString() : '0');
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

    let finalStartTime = manualStartTime.trim();
    let finalEndTime = manualEndTime.trim();
    let breakMin = parseInt(manualBreak) || 0;
    let workHrs = parseFloat(manualWorkingHours) || 0;

    if (!manualIsWorkingDay) {
      // Auto-set 00:00 - 00:00 and 0 hours for Day Off / Holiday / Leave without requiring user input or failing validation
      finalStartTime = '00:00';
      finalEndTime = '00:00';
      breakMin = 0;
      workHrs = 0;
    } else {
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (!timeRegex.test(finalStartTime) || !timeRegex.test(finalEndTime)) {
        setStatusMessage({ type: 'error', text: 'กรุณากรอกรูปแบบเวลาให้ถูกต้อง เช่น 08:00 หรือ 17:00' });
        return;
      }
    }

    const newCodeObj: ShiftCode = {
      code,
      name: manualName.trim(),
      department: manualDept,
      startTime: finalStartTime,
      endTime: finalEndTime,
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

  // 4. Approved OT File Handler (From Power BI) with Deduplication & Non-Doubling Guarantee
  const handleOTFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setStatusMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const rawRows = parseSheetToRows(buffer);
      const parseResult = parseApprovedOTFile(rawRows, importMonthYear, selectedOTRate);

      if (parseResult.records.length === 0) {
        setStatusMessage({
          type: 'error',
          text: 'ไม่พบรายการ Approved OT ในไฟล์ หรือข้อมูลแถวไม่สมบูรณ์',
        });
        return;
      }

      const existingOT = storage.getOTRecords();

      // Check retroactive records (Rule 5)
      const allRetro = parseResult.records.filter(r => r.isRetroactive);
      const unassignedRetro: OTRecord[] = [];
      const autoPreservedRetro: OTRecord[] = [];

      allRetro.forEach(r => {
        // If this exact retroactive record was already assigned in existing records, preserve its target date
        const matchedExisting = existingOT.find(ex =>
          (ex.empNo === r.empNo || ex.gid === r.gid) &&
          ex.originalDate === r.originalDate &&
          ex.rate === r.rate &&
          ex.retroactiveTargetDate
        );

        if (matchedExisting) {
          autoPreservedRetro.push({
            ...r,
            retroactiveTargetDate: matchedExisting.retroactiveTargetDate,
            date: matchedExisting.retroactiveTargetDate,
            status: 'Approved',
          });
        } else {
          unassignedRetro.push(r);
        }
      });

      if (unassignedRetro.length > 0) {
        setRetroactiveOTs(unassignedRetro);
        setShowRetroModal(true);
      }

      // Valid records to merge immediately: current month records + auto-preserved retroactive records
      const validCurrentRecords = parseResult.records.filter(r => !r.isRetroactive);
      const recordsToMerge = [...validCurrentRecords, ...autoPreservedRetro];

      // Execute Deduplication & Safe Merge according to selected strategy
      const mergeResult = mergeAndDeduplicateOTRecords(
        existingOT,
        recordsToMerge,
        importMonthYear,
        selectedOTRate,
        otMergeMode,
        employees
      );

      // Persist to storage & Firestore sync
      await storage.setOTRecords(mergeResult.merged);
      setLatestOTMergeResult(mergeResult);
      setShowOTMergeModal(true);

      const rateLabel = selectedOTRate === 3.0 ? 'OT 3.0 (อัตรา 3 เท่า)' : 'OT 1.5 (อัตรา 1.5 เท่า)';
      const targetCol = selectedOTRate === 3.0 ? 'Working Hours: OT 3.0' : 'Working Hours: OT 1.5';

      setStatusMessage({
        type: unassignedRetro.length > 0 ? 'warning' : 'success',
        text: `นำเข้าข้อมูล ${rateLabel} เรียบร้อยแล้ว! ระบบตรวจสอบและป้องกันข้อมูลซ้ำอัตโนมัติ (เพิ่มใหม่: ${mergeResult.addedCount} รายการ, ป้องกันการเบิ้ลข้อมูลซ้ำ: ${mergeResult.duplicatePreventedCount} รายการ, อัปเดต: ${mergeResult.updatedCount} รายการ)`,
        details: [
          `ระบุข้อมูลลงช่อง ${targetCol} และคำนวณรวมใน Total ของพนักงานเรียบร้อย`,
          `ยอดชั่วโมง OT รวมรอบเดือน ${importMonthYear}: ${mergeResult.totalHoursAfter.toFixed(1)} ชม. (ก่อนนำเข้า: ${mergeResult.totalHoursBefore.toFixed(1)} ชม.)`,
          ...(unassignedRetro.length > 0
            ? [`พบโอทีล่าช้าของเดือนก่อนหน้าที่ยังไม่ได้กำหนดวันลงบันทึก ${unassignedRetro.length} รายการ กรุณากำหนดวันในหน้าต่างตรวจสอบ`]
            : [])
        ],
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

  // Handle saving retroactive OT target dates with Deduplication
  const handleConfirmRetroactiveOT = async () => {
    const existing = storage.getOTRecords();
    const approvedRetro: OTRecord[] = retroactiveOTs.map(r => ({
      ...r,
      rate: r.rate || selectedOTRate,
      status: 'Approved' as const,
      date: r.retroactiveTargetDate || r.date,
    }));

    const mergeResult = mergeAndDeduplicateOTRecords(
      existing,
      approvedRetro,
      importMonthYear,
      selectedOTRate,
      'smart_merge',
      employees
    );

    await storage.setOTRecords(mergeResult.merged);
    setShowRetroModal(false);
    setRetroactiveOTs([]);
    setLatestOTMergeResult(mergeResult);
    setShowOTMergeModal(true);

    const rateLabel = selectedOTRate === 3.0 ? 'OT 3.0' : 'OT 1.5';
    setStatusMessage({
      type: 'success',
      text: `บันทึกโอทีล่าช้าของเดือนก่อนหน้า (${rateLabel}) เรียบร้อยแล้ว (${approvedRetro.length} รายการได้รับการยืนยันวันลงบันทึกใน Time Sheet และป้องกันข้อมูลซ้ำ)`,
    });

    onDataImported();
  };

  // Handle deleting individual OT Record
  const handleDeleteOTRecord = (id: string) => {
    const existing = storage.getOTRecords();
    const updated = existing.filter(r => r.id !== id);
    storage.setOTRecords(updated);
    setDeleteOTConfirmId(null);
    setStatusMessage({
      type: 'success',
      text: 'ลบรายการบันทึก OT เรียบร้อยแล้ว',
    });
    onDataImported();
  };

  // Handle clearing all OT records for current selected month
  const handleClearMonthOTRecords = () => {
    const existing = storage.getOTRecords();
    const remaining = existing.filter(r => {
      const targetDate = r.retroactiveTargetDate || r.date;
      return !targetDate.startsWith(importMonthYear);
    });
    storage.setOTRecords(remaining);
    setStatusMessage({
      type: 'success',
      text: `ล้างรายการ OT ของเดือน ${importMonthYear} ทั้งหมดเรียบร้อยแล้ว (${existing.length - remaining.length} รายการถูกลบ)`,
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

  // Quick download department Excel & CSV templates
  const handleDownloadDeptPlanTemplateExcel = () => {
    try {
      const { workbook } = generateShiftPlanTemplate(importDept, importMonthYear, employees);
      downloadWorkbook(workbook, `Template_ShiftPlan_${importDept}_${importMonthYear}.xlsx`);
    } catch (err) {
      console.error('Download Excel Template Error:', err);
    }
  };

  const handleDownloadDeptPlanTemplate = () => {
    try {
      const { csvContent } = generateShiftPlanTemplate(importDept, importMonthYear, employees);
      downloadBlob(
        csvContent,
        `Template_ShiftPlan_${importDept}_${importMonthYear}.csv`,
        'text/csv;charset=utf-8;'
      );
    } catch (err) {
      console.error('Download CSV Template Error:', err);
    }
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
                <option value="ALL">ALL (ทุกแผนก)</option>
                {storage.getDepartments().map(d => (
                  <option key={d.code} value={d.code} className={isDark ? 'bg-[#0f1722]' : ''}>
                    {d.name && d.name !== d.code ? `${d.code} — ${d.name}` : d.code}
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
                สร้างเทมเพลต Excel/CSV ที่เตรียมรายชื่อพนักงานแผนก <strong>{importDept}</strong> งวด <strong>{importMonthYear}</strong> โดยใช้คอลัมน์อ้างอิง <strong>Emp No</strong>, <strong>Name</strong> และ <strong>Department</strong> เพื่อความถูกต้องในการระบุตัวตนพนักงาน
              </p>

              <div className={`p-3 rounded border text-[11px] space-y-1.5 ${
                isDark ? 'bg-[#0b1219] border-[#1e2e3d]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="font-bold text-slate-300">Validation & Safety Rules (กฎความถูกต้อง):</div>
                <div className="text-teal-400">✓ Auto Link EmpNo & GID: ดึงรหัสจากฐานข้อมูลพนักงานอัตโนมัติ</div>
                <div className="text-teal-400">✓ Department Isolation: ปรับปรุงเฉพาะพนักงานแผนก {importDept}</div>
                <div className="text-amber-400">⚠ แจ้งเตือนทันทีหากพบพนักงานใหม่ที่ยังไม่มีในฐานข้อมูล (Employee Master)</div>
                <div className="text-amber-400">⚠ แจ้งเตือนหากใช้ Shift Code ที่ไม่มีในระบบ</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleDownloadDeptPlanTemplateExcel}
                  className="w-full flex items-center justify-center space-x-1.5 py-2.5 rounded bg-[#008b99] hover:bg-[#00a3a6] text-white font-bold text-xs shadow transition cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Excel (.xlsx)</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadDeptPlanTemplate}
                  className="w-full flex items-center justify-center space-x-1.5 py-2.5 rounded bg-slate-700 hover:bg-slate-600 text-white font-semibold text-xs transition cursor-pointer"
                >
                  <Download className="w-4 h-4 text-teal-400" />
                  <span>Download CSV (.csv)</span>
                </button>
              </div>
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

                {editingShiftCodeKey && (
                  <div className="p-3 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="font-bold flex items-center gap-1.5 text-amber-200">
                        <Edit2 className="w-4 h-4 text-amber-400 animate-pulse" />
                        <span>โหมดแก้ไขรหัสกะ: <span className="font-mono text-white text-xs bg-amber-500/30 px-1.5 py-0.5 rounded font-extrabold">{manualCode}</span> ({manualDept})</span>
                      </div>
                      <p className="text-[11px] text-amber-200/90 leading-relaxed">
                        หากต้องการเปลี่ยนกะนี้จากกะทำงานเป็น<strong>วันหยุด/วันลา (Day Off)</strong> ให้เลือกคำตอบด้านล่างเป็น <strong>"ไม่ใช่ (Day Off / วันหยุด)"</strong> ระบบจะตั้งเวลา 00:00 - 00:00 ให้อัตโนมัติ แล้วกดปุ่มอัปเดต
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="p-1 hover:bg-amber-500/30 rounded text-amber-200 transition shrink-0 cursor-pointer"
                      title="ยกเลิกการแก้ไข"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

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
                        onChange={e => {
                          const isWorking = e.target.value === 'true';
                          setManualIsWorkingDay(isWorking);
                          if (!isWorking) {
                            setManualStartTime('00:00');
                            setManualEndTime('00:00');
                            setManualBreak('0');
                            setManualWorkingHours('0');
                          } else if (manualStartTime === '00:00' && manualEndTime === '00:00') {
                            setManualStartTime('08:00');
                            setManualEndTime('17:00');
                            setManualBreak('60');
                            setManualWorkingHours('8');
                          }
                        }}
                        className={`w-full p-2 rounded text-xs outline-none font-bold ${
                          isDark 
                            ? (manualIsWorkingDay ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-amber-950/40 text-amber-300 border border-amber-500/40')
                            : (manualIsWorkingDay ? 'bg-slate-50 text-slate-900 border' : 'bg-amber-50 text-amber-800 border border-amber-300')
                        }`}
                      >
                        <option value="true">ใช่ (Working Day - วันทำงาน)</option>
                        <option value="false">ไม่ใช่ (Day Off / Holiday / วันหยุด / วันลา)</option>
                      </select>
                    </div>
                  </div>

                  {!manualIsWorkingDay && (
                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] flex items-center gap-2">
                      <span className="text-sm">🏖️</span>
                      <span>
                        <strong>โหมดวันหยุด/วันลา:</strong> เวลาจะถูกกำหนดเป็น <strong>00:00 - 00:00</strong> (ชม.ทำงาน 0 ชม.) ให้อัตโนมัติ สามารถกดบันทึกได้ทันที
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">
                        เวลาเริ่ม (Start Time) {manualIsWorkingDay ? '*' : <span className="text-amber-400 font-normal">(00:00 อัตโนมัติ)</span>}
                      </label>
                      <input
                        type="text"
                        placeholder={manualIsWorkingDay ? '08:00' : '00:00'}
                        value={manualIsWorkingDay ? manualStartTime : '00:00'}
                        onChange={e => setManualStartTime(e.target.value)}
                        disabled={!manualIsWorkingDay}
                        className={`w-full p-2 rounded text-xs outline-none font-mono ${
                          !manualIsWorkingDay
                            ? 'bg-slate-800/40 text-slate-400 border border-slate-700/50 cursor-not-allowed opacity-80'
                            : isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                        }`}
                        required={manualIsWorkingDay}
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">
                        เวลาเลิก (End Time) {manualIsWorkingDay ? '*' : <span className="text-amber-400 font-normal">(00:00 อัตโนมัติ)</span>}
                      </label>
                      <input
                        type="text"
                        placeholder={manualIsWorkingDay ? '17:00' : '00:00'}
                        value={manualIsWorkingDay ? manualEndTime : '00:00'}
                        onChange={e => setManualEndTime(e.target.value)}
                        disabled={!manualIsWorkingDay}
                        className={`w-full p-2 rounded text-xs outline-none font-mono ${
                          !manualIsWorkingDay
                            ? 'bg-slate-800/40 text-slate-400 border border-slate-700/50 cursor-not-allowed opacity-80'
                            : isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                        }`}
                        required={manualIsWorkingDay}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">
                        เวลาพัก (Break Min) {!manualIsWorkingDay && <span className="text-slate-400 font-normal">(0 นาที)</span>}
                      </label>
                      <input
                        type="number"
                        placeholder="60"
                        value={manualIsWorkingDay ? manualBreak : '0'}
                        onChange={e => setManualBreak(e.target.value)}
                        disabled={!manualIsWorkingDay}
                        className={`w-full p-2 rounded text-xs outline-none font-mono ${
                          !manualIsWorkingDay
                            ? 'bg-slate-800/40 text-slate-400 border border-slate-700/50 cursor-not-allowed opacity-80'
                            : isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                        }`}
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">
                        ชม.ทำงาน (Hours) {!manualIsWorkingDay && <span className="text-slate-400 font-normal">(0 ชม.)</span>}
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        placeholder="8"
                        value={manualIsWorkingDay ? manualWorkingHours : '0'}
                        onChange={e => setManualWorkingHours(e.target.value)}
                        disabled={!manualIsWorkingDay}
                        className={`w-full p-2 rounded text-xs outline-none font-mono ${
                          !manualIsWorkingDay
                            ? 'bg-slate-800/40 text-slate-400 border border-slate-700/50 cursor-not-allowed opacity-80'
                            : isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
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
              <div className="flex flex-col gap-3 mb-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                    <span>Registered Shift Codes (รหัสกะในระบบทั้งหมด {shiftCodes.length} รหัส):</span>
                  </h3>
                  
                  {/* Search Input Box */}
                  <div className="relative w-full sm:w-80">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-teal-400" />
                    <input
                      type="text"
                      placeholder="พิมพ์ค้นหารหัสกะ เช่น W, OFF, D, N, เช้า, ดึก..."
                      value={shiftCodeSearchQuery}
                      onChange={e => setShiftCodeSearchQuery(e.target.value)}
                      className={`w-full pl-8 pr-7 py-1.5 rounded text-xs outline-none transition ${
                        isDark 
                          ? 'bg-[#0f1722] text-slate-100 border border-[#23384c] placeholder-slate-500 focus:border-teal-400' 
                          : 'bg-slate-50 text-slate-900 border border-slate-300 placeholder-slate-400'
                      }`}
                    />
                    {shiftCodeSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setShiftCodeSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5"
                        title="ล้างคำค้นหา"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Filter Controls Row: Type Filter Pills & Dept Dropdown */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-700/30">
                  {/* Type Filter Pills */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                      <Filter className="w-3 h-3 text-teal-400" />
                      <span>ประเภท:</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShiftCodeTypeFilter('ALL')}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
                        shiftCodeTypeFilter === 'ALL'
                          ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                          : 'bg-slate-800/40 text-slate-400 hover:text-slate-200 border border-transparent'
                      }`}
                    >
                      ทั้งหมด
                    </button>
                    <button
                      type="button"
                      onClick={() => setShiftCodeTypeFilter('WORKING')}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
                        shiftCodeTypeFilter === 'WORKING'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                          : 'bg-slate-800/40 text-slate-400 hover:text-slate-200 border border-transparent'
                      }`}
                    >
                      💼 กะทำงาน (Working)
                    </button>
                    <button
                      type="button"
                      onClick={() => setShiftCodeTypeFilter('OFF')}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold transition cursor-pointer ${
                        shiftCodeTypeFilter === 'OFF'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-slate-800/40 text-slate-400 hover:text-slate-200 border border-transparent'
                      }`}
                    >
                      🏖️ วันหยุด/วันลา (OFF)
                    </button>
                  </div>

                  {/* Filter Section Dropdown */}
                  <div className="flex items-center space-x-1.5 ml-auto">
                    <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5 text-teal-400" />
                      <span>แผนก:</span>
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
                        <option key={d.code} value={d.code}>{d.name && d.name !== d.code ? `${d.code} — ${d.name}` : d.code}</option>
                      ))}
                    </select>
                  </div>
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
                    {filteredShiftCodes.length === 0 ? (
                      <tr>
                        <td colSpan={isAdmin ? 8 : 7} className="text-center p-8 text-slate-400">
                          ไม่พบข้อมูลรหัสกะที่ตรงกับคำค้นหา &quot;{shiftCodeSearchQuery}&quot; หรือตัวกรองที่เลือก
                          {(shiftCodeSearchQuery || shiftCodeTypeFilter !== 'ALL' || shiftCodeDeptFilter !== 'SHOW_ALL') && (
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setShiftCodeSearchQuery('');
                                  setShiftCodeTypeFilter('ALL');
                                  setShiftCodeDeptFilter('SHOW_ALL');
                                }}
                                className="px-3 py-1 rounded bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 font-bold text-xs cursor-pointer inline-flex items-center gap-1"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>ล้างตัวกรองทั้งหมด</span>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : (
                      filteredShiftCodes.map(sc => {
                        const key = `${sc.code.toUpperCase()}_${sc.department.toUpperCase()}`;
                        const isConfirming = deleteConfirmKey === key;
                        const isBeingEdited = editingShiftCodeKey === key;
                        return (
                          <tr 
                            key={key} 
                            className={`border-b border-slate-700/30 hover:bg-slate-800/10 transition-colors ${
                              isBeingEdited ? 'bg-amber-500/10 border-l-4 border-l-amber-400 font-semibold' : ''
                            }`}
                          >
                            <td className="p-2 font-mono font-bold">
                              <span 
                                className="px-2 py-0.5 rounded text-white text-[11px]"
                                style={{ backgroundColor: sc.color }}
                              >
                                {sc.code}
                              </span>
                            </td>
                            <td className="p-2 font-medium">
                              <div className="flex items-center gap-1.5">
                                <span>{sc.name}</span>
                                {isBeingEdited && (
                                  <span className="px-1.5 py-0.2 text-[9px] font-bold bg-amber-500 text-[#09151e] rounded animate-pulse">
                                    กำลังแก้ไข
                                  </span>
                                )}
                              </div>
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
                                  ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20' 
                                  : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                              }`}>
                                {sc.isWorkingDay ? '💼 Working' : '🏖️ OFF/Leave'}
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
                                      type="button"
                                      onClick={() => handleDeleteShiftCode(sc)}
                                      className="px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-bold cursor-pointer"
                                    >
                                      Yes
                                    </button>
                                    <button 
                                      type="button"
                                      onClick={() => setDeleteConfirmKey(null)}
                                      className="px-1.5 py-0.5 bg-slate-600 hover:bg-slate-700 text-white rounded text-[10px] font-bold cursor-pointer"
                                    >
                                      No
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center space-x-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditShiftCode(sc)}
                                      className={`p-1 rounded transition cursor-pointer ${
                                        isBeingEdited
                                          ? 'bg-amber-500 text-[#09151e] font-bold shadow'
                                          : 'hover:bg-amber-500/20 text-amber-400 hover:text-amber-300'
                                      }`}
                                      title="แก้ไขข้อมูลกะ (เช่น เปลี่ยนจากกะทำงานเป็นวันหยุด)"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
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
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Biometric Attendance Import (Company-Wide ALL & Bulk/Folder Support) */}
      {activeImportTab === 'attendance' && (
        <AttendanceImportPanel
          currentUser={currentUser}
          theme={theme}
          selectedMonthYear={selectedMonthYear}
          selectedDepartment={selectedDepartment}
          employees={employees}
          shiftCodes={shiftCodes}
          onDataImported={onDataImported}
        />
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
                  Power BI reports contain approved OT records across all departments. The system automatically links each record to the appropriate employee Timesheet via GID/EmpNo.
                </p>
              </div>
              <div className="p-2.5 rounded bg-black/20 border border-white/5 space-y-1">
                <span className="font-bold text-amber-300">2. Dual OT Rate & Timesheet Mapping (แยกระหว่าง OT 1.5 และ OT 3.0):</span>
                <p className="text-slate-400">
                  ก่อนทำการ Import Admin จะต้องเลือกว่าเป็น <strong>OT 1.5</strong> หรือ <strong>OT 3.0</strong> เพื่อระบุชั่วโมงทำงาน (Working Hours) ลงในช่องที่ถูกต้องใน Time Sheet และคำนวณรวมในช่อง <strong>Total</strong> ของพนักงานแต่ละคนโดยอัตโนมัติ
                </p>
              </div>
            </div>
          </div>

          {/* STEP 1: Mandatory OT Rate Selection */}
          <div className={`p-4 rounded border text-xs space-y-3 ${
            isDark ? 'bg-[#0f1924] border-[#243a50]' : 'bg-white border-slate-300 shadow-xs'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#008b99] text-white font-bold text-xs">
                  1
                </span>
                <h3 className="font-bold text-sm text-slate-100">
                  กำหนดอัตราการทำงานล่วงเวลา (OT Rate Selection) <span className="text-red-400">*จำเป็นต้องระบุ</span>
                </h3>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-mono font-bold border ${
                selectedOTRate === 3.0
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-[#00e5e5]/20 text-[#00e5e5] border-[#00e5e5]/40'
              }`}>
                อัตราที่เลือก: OT {selectedOTRate === 3.0 ? '3.0 (3.0 เท่า)' : '1.5 (1.5 เท่า)'}
              </span>
            </div>

            <p className="text-slate-400 text-xs">
              กำหนดอัตราค่าล่วงเวลาของไฟล์ที่ต้องการนำเข้า เพื่อบันทึกชั่วโมงทำงานลงในช่อง <strong>OT 1.5</strong> หรือ <strong>OT 3.0</strong> และคำนวณสะสมในช่อง <strong>Total</strong> ของ Time Sheet อย่างถูกต้อง:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              {/* Option 1: OT 1.5 */}
              <div
                onClick={() => setSelectedOTRate(1.5)}
                className={`p-3.5 rounded border cursor-pointer transition-all relative flex flex-col justify-between ${
                  selectedOTRate === 1.5
                    ? 'bg-teal-500/15 border-[#00e5e5] shadow-md ring-1 ring-[#00e5e5]/50'
                    : isDark
                      ? 'bg-[#142230] border-[#203448] hover:border-slate-500 opacity-75'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-400'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <input
                        type="radio"
                        id="radio-ot-rate-1-5"
                        name="import-ot-rate"
                        checked={selectedOTRate === 1.5}
                        onChange={() => setSelectedOTRate(1.5)}
                        className="w-4 h-4 text-teal-500 accent-teal-500 cursor-pointer"
                      />
                      <label htmlFor="radio-ot-rate-1-5" className="font-bold text-sm text-[#00e5e5] cursor-pointer">
                        OT 1.5 เท่า (Normal Working Day OT)
                      </label>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
                      วันทำงานปกติ
                    </span>
                  </div>
                  <div className="mt-2.5 text-[11px] text-slate-300 space-y-1.5 pl-6">
                    <div className="text-slate-400">• ค่าล่วงเวลาในวันทำงานปกติ (อัตรา 1.5 เท่า)</div>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-slate-400">• บันทึกลง Time Sheet:</span>
                      <span className="font-mono font-bold text-[#00e5e5] bg-[#00e5e5]/10 px-1.5 py-0.5 rounded border border-[#00e5e5]/20">
                        Working Hours: OT 1.5
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-slate-400">• คำนวณสะสมใน:</span>
                      <span className="font-mono font-bold text-white bg-white/10 px-1.5 py-0.5 rounded border border-white/20">
                        Total Working Hours
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Option 2: OT 3.0 */}
              <div
                onClick={() => setSelectedOTRate(3.0)}
                className={`p-3.5 rounded border cursor-pointer transition-all relative flex flex-col justify-between ${
                  selectedOTRate === 3.0
                    ? 'bg-amber-500/15 border-amber-400 shadow-md ring-1 ring-amber-400/50'
                    : isDark
                      ? 'bg-[#142230] border-[#203448] hover:border-slate-500 opacity-75'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-400'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <input
                        type="radio"
                        id="radio-ot-rate-3-0"
                        name="import-ot-rate"
                        checked={selectedOTRate === 3.0}
                        onChange={() => setSelectedOTRate(3.0)}
                        className="w-4 h-4 text-amber-500 accent-amber-500 cursor-pointer"
                      />
                      <label htmlFor="radio-ot-rate-3-0" className="font-bold text-sm text-amber-300 cursor-pointer">
                        OT 3.0 เท่า (Holiday / Special Day OT)
                      </label>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      วันหยุด / นักขัตฤกษ์
                    </span>
                  </div>
                  <div className="mt-2.5 text-[11px] text-slate-300 space-y-1.5 pl-6">
                    <div className="text-slate-400">• ค่าล่วงเวลาในวันหยุดประจำสัปดาห์หรือวันหยุดนักขัตฤกษ์ (อัตรา 3.0 เท่า)</div>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-slate-400">• บันทึกลง Time Sheet:</span>
                      <span className="font-mono font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                        Working Hours: OT 3.0
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-slate-400">• คำนวณสะสมใน:</span>
                      <span className="font-mono font-bold text-white bg-white/10 px-1.5 py-0.5 rounded border border-white/20">
                        Total Working Hours
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Deduplication & Re-Import Control Section */}
          <div className={`p-4 rounded border space-y-3 ${
            isDark ? 'bg-[#101c28] border-[#223548]' : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/50 pb-2.5">
              <div className="flex items-center space-x-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-teal-600 text-white font-bold text-xs">
                  <ShieldCheck className="w-3.5 h-3.5" />
                </span>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <span>ระบบตรวจสอบและป้องกันข้อมูลซ้ำ (Deduplication & Re-Import Control)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
                    Active Protection
                  </span>
                </h3>
              </div>

              {latestOTMergeResult && (
                <button
                  onClick={() => setShowOTMergeModal(true)}
                  className="flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-bold bg-teal-600/30 hover:bg-teal-600/50 text-[#00e5e5] border border-teal-500/40 transition"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>รายงานการตรวจสอบข้อมูลซ้ำล่าสุด</span>
                </button>
              )}
            </div>

            <p className="text-slate-400 text-xs">
              กรณีนำเข้าไฟล์ที่มีรายการอนุมัติย้อนหลัง หรือนำเข้าข้อมูลซ้ำทั้งรอบเดือน (Re-Import): <strong>ระบบจะตรวจสอบข้อมูลรายบุคคลและรายวันโดยอัตโนมัติ เพื่อป้องกันการบันทึกชั่วโมงซ้ำซ้อนใน Time Sheet</strong>
            </p>

            {/* 3 Strategy Options */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
              {/* Strategy 1: Smart Merge (Recommended) */}
              <div
                onClick={() => setOtMergeMode('smart_merge')}
                className={`p-3 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                  otMergeMode === 'smart_merge'
                    ? 'bg-teal-500/15 border-[#00e5e5] shadow-md ring-1 ring-[#00e5e5]/50'
                    : isDark
                      ? 'bg-[#142230] border-[#203448] hover:border-slate-500 opacity-75'
                      : 'bg-white border-slate-200 hover:border-slate-400'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="radio-merge-smart"
                        name="ot-merge-mode"
                        checked={otMergeMode === 'smart_merge'}
                        onChange={() => setOtMergeMode('smart_merge')}
                        className="w-3.5 h-3.5 text-teal-500 accent-teal-500 cursor-pointer"
                      />
                      <label htmlFor="radio-merge-smart" className="font-bold text-xs text-[#00e5e5] cursor-pointer">
                        Smart Merge & Deduplicate
                      </label>
                    </div>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
                      แนะนำ
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 pl-5 leading-relaxed">
                    ตรวจสอบตามรหัสพนักงาน วันที่ และอัตราโอที: หากข้อมูลตรงกันจะไม่บันทึกซ้ำ หากชั่วโมงเปลี่ยนแปลงจะปรับปรุงเป็นค่าล่าสุด และเพิ่มเฉพาะรายการใหม่
                  </p>
                </div>
                <div className="pt-2 pl-5 text-[10px] text-teal-400 font-medium">
                  ✓ ป้องกันการบันทึกชั่วโมงซ้ำซ้อน 100%
                </div>
              </div>

              {/* Strategy 2: Replace Entire Month */}
              <div
                onClick={() => setOtMergeMode('replace_month')}
                className={`p-3 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                  otMergeMode === 'replace_month'
                    ? 'bg-blue-500/15 border-blue-400 shadow-md ring-1 ring-blue-400/50'
                    : isDark
                      ? 'bg-[#142230] border-[#203448] hover:border-slate-500 opacity-75'
                      : 'bg-white border-slate-200 hover:border-slate-400'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="radio-merge-replace"
                        name="ot-merge-mode"
                        checked={otMergeMode === 'replace_month'}
                        onChange={() => setOtMergeMode('replace_month')}
                        className="w-3.5 h-3.5 text-blue-500 accent-blue-500 cursor-pointer"
                      />
                      <label htmlFor="radio-merge-replace" className="font-bold text-xs text-blue-300 cursor-pointer">
                        Replace Entire Month
                      </label>
                    </div>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                      แทนที่ข้อมูลทั้งเดือน
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 pl-5 leading-relaxed">
                    แทนที่ข้อมูลของรอบเดือน {importMonthYear} สำหรับอัตรานี้ด้วยข้อมูลจากไฟล์ล่าสุด เหมาะสำหรับไฟล์รายงานสรุปที่ครบถ้วนทั้งเดือน
                  </p>
                </div>
                <div className="pt-2 pl-5 text-[10px] text-blue-400 font-medium">
                  ✓ สอดคล้องกับรายงาน Power BI ล่าสุด
                </div>
              </div>

              {/* Strategy 3: Append All */}
              <div
                onClick={() => setOtMergeMode('append_all')}
                className={`p-3 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                  otMergeMode === 'append_all'
                    ? 'bg-amber-500/15 border-amber-400 shadow-md ring-1 ring-amber-400/50'
                    : isDark
                      ? 'bg-[#142230] border-[#203448] hover:border-slate-500 opacity-75'
                      : 'bg-white border-slate-200 hover:border-slate-400'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="radio-merge-append"
                        name="ot-merge-mode"
                        checked={otMergeMode === 'append_all'}
                        onChange={() => setOtMergeMode('append_all')}
                        className="w-3.5 h-3.5 text-amber-500 accent-amber-500 cursor-pointer"
                      />
                      <label htmlFor="radio-merge-append" className="font-bold text-xs text-amber-300 cursor-pointer">
                        Append All Records
                      </label>
                    </div>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      นำเข้าต่อท้ายทั้งหมด
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 pl-5 leading-relaxed">
                    นำเข้าทุกรายการโดยไม่ผ่านการตรวจสอบความซ้ำซ้อน (แนะนำเฉพาะไฟล์ที่มีเฉพาะรายการที่อนุมัติใหม่เท่านั้น)
                  </p>
                </div>
                <div className="pt-2 pl-5 text-[10px] text-amber-400 font-medium">
                  ⚠ อาจเกิดข้อมูลซ้ำซ้อนหากไฟล์มีรายการเดิม
                </div>
              </div>
            </div>
          </div>

          {/* STEP 2 & 3: Template & Upload */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Step 2: Download Template */}
            <div className={`p-4 rounded border space-y-3 text-xs ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
            }`}>
              <div className="flex items-center space-x-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-700 text-slate-300 font-bold text-xs">
                  2
                </span>
                <h3 className="font-bold text-sm text-[#00e5e5] flex items-center gap-1.5">
                  <FileCheck2 className="w-4 h-4" />
                  <span>Download Template</span>
                </h3>
              </div>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                ดาวน์โหลดเทมเพลตมาตรฐาน (Excel/CSV) สำหรับจัดเตรียมข้อมูลตามอัตรา OT {selectedOTRate === 3.0 ? '3.0' : '1.5'}:
              </p>

              <div className="space-y-2 pt-1">
                <button
                  onClick={() => {
                    const { csvContent } = generateOTApprovedTemplate(selectedOTRate);
                    downloadBlob(csvContent, `Template_Approved_OT_${selectedOTRate === 3.0 ? '3_0' : '1_5'}.csv`, 'text/csv;charset=utf-8;');
                  }}
                  className="w-full flex items-center justify-center space-x-1.5 py-2 rounded border border-slate-600 text-slate-300 hover:text-white text-xs bg-slate-800/60 hover:bg-slate-800 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Template (OT {selectedOTRate === 3.0 ? '3.0' : '1.5'})</span>
                </button>
              </div>

              <div className={`p-2.5 rounded border text-[10px] space-y-1 ${
                isDark ? 'bg-[#0a1118] border-[#1e2e3d]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="font-bold text-slate-300">OT Processing Rules:</div>
                <div className="text-teal-400">✓ รวมระยะเวลาอัตโนมัติ กรณีมีการทำงานล่วงเวลาหลายช่วงในวันเดียวกัน</div>
                <div className="text-amber-400">⚠ รายการย้อนหลัง (ต่างเดือน) ต้องได้รับการยืนยันวันที่บันทึกจากผู้ดูแลระบบ</div>
              </div>
            </div>

            {/* Step 3: Upload File */}
            <div className={`md:col-span-2 p-6 rounded border flex flex-col items-center justify-center text-center space-y-4 border-dashed ${
              isDark ? 'bg-[#121c27] border-[#2f4358]' : 'bg-white border-slate-300'
            }`}>
              <div className="p-3.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/30">
                <FileCheck2 className="w-8 h-8" />
              </div>
              <div>
                <div className="flex items-center justify-center space-x-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#008b99] text-white font-bold text-xs">
                    3
                  </span>
                  <h3 className="font-bold text-base text-slate-100">
                    Upload Approved OT File (นำเข้าไฟล์รายงานการทำงานล่วงเวลา)
                  </h3>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded font-bold border ${
                    selectedOTRate === 3.0 
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                      : 'bg-[#00e5e5]/20 text-[#00e5e5] border-[#00e5e5]/40'
                  }`}>
                    อัตราที่นำเข้า: OT {selectedOTRate === 3.0 ? '3.0 (บันทึกลงช่อง Working Hours: OT 3.0)' : '1.5 (บันทึกลงช่อง Working Hours: OT 1.5)'}
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded font-bold bg-teal-500/20 text-[#00e5e5] border border-teal-500/40 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>โหมดป้องกันข้อมูลซ้ำ: {otMergeMode === 'smart_merge' ? 'Smart Deduplication' : otMergeMode === 'replace_month' ? 'Replace Month' : 'Append'}</span>
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  ขอบเขต: <strong>ทุกแผนก (All Departments)</strong> • เชื่อมโยงข้อมูลพนักงานอัตโนมัติด้วย GID / EmpNo
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-3">
                <label className="cursor-pointer px-6 py-3 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-lg transition flex items-center space-x-2">
                  <Upload className="w-4 h-4" />
                  <span>เลือกไฟล์รายงาน OT {selectedOTRate === 3.0 ? '3.0' : '1.5'} (.xlsx, .csv)</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleOTFile}
                    className="hidden"
                  />
                </label>

                {latestOTMergeResult && (
                  <button
                    onClick={() => setShowOTMergeModal(true)}
                    className="px-4 py-3 rounded font-bold text-xs border border-teal-500/50 text-[#00e5e5] hover:bg-teal-500/10 transition flex items-center space-x-1.5"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>รายงานการตรวจสอบความซ้ำซ้อน (ป้องกันซ้ำ {latestOTMergeResult.duplicatePreventedCount} รายการ)</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Current Month Imported OT Records Inspection Section */}
          <div className={`p-4 rounded border text-xs space-y-3 ${
            isDark ? 'bg-[#0e1722] border-[#223548]' : 'bg-white border-slate-200'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/60 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#00e5e5]" />
                  <span>รายการบันทึก OT ที่นำเข้าแล้วในระบบ (รอบเดือน {importMonthYear})</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  ตรวจสอบรายการโอทีทั้งหมดที่ระบบบันทึกลงใน Time Sheet ของพนักงานแต่ละคน
                </p>
              </div>

              <div className="flex items-center space-x-2">
                {monthOTRecords.length > 0 && (
                  <>
                    {confirmClearMonthOT ? (
                      <div className="flex items-center space-x-1.5">
                        <span className="text-[11px] text-red-400 font-bold">ยืนยันล้างทั้งหมด?</span>
                        <button
                          onClick={() => {
                            handleClearMonthOTRecords();
                            setConfirmClearMonthOT(false);
                          }}
                          className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-bold text-[11px]"
                        >
                          ใช่, ลบทั้งหมด
                        </button>
                        <button
                          onClick={() => setConfirmClearMonthOT(false)}
                          className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-[11px]"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmClearMonthOT(true)}
                        className="flex items-center space-x-1 px-2.5 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 text-[11px]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>ล้างข้อมูล OT เดือนนี้</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* OT Stats KPI Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <div className={`p-2.5 rounded border ${
                isDark ? 'bg-[#14202c] border-[#22364a]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-[10px] text-slate-400">Total OT Records (ทั้งหมด)</div>
                <div className="text-base font-bold font-mono text-white mt-0.5">
                  {otStats.totalCount} <span className="text-xs font-normal text-slate-400">รายการ</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">
                  รวม {otStats.totalHours.toFixed(1)} ชม.
                </div>
              </div>

              <div className={`p-2.5 rounded border ${
                isDark ? 'bg-teal-950/20 border-teal-800/40' : 'bg-teal-50 border-teal-200'
              }`}>
                <div className="text-[10px] text-teal-400 font-bold">OT 1.5 เท่า (วันทำงานปกติ)</div>
                <div className="text-base font-bold font-mono text-[#00e5e5] mt-0.5">
                  {otStats.count1_5} <span className="text-xs font-normal text-slate-400">รายการ</span>
                </div>
                <div className="text-[10px] text-[#00e5e5] font-mono">
                  รวม {otStats.hours1_5.toFixed(1)} ชม. (ช่อง OT 1.5)
                </div>
              </div>

              <div className={`p-2.5 rounded border ${
                isDark ? 'bg-amber-950/20 border-amber-800/40' : 'bg-amber-50 border-amber-200'
              }`}>
                <div className="text-[10px] text-amber-400 font-bold">OT 3.0 เท่า (วันหยุด/นักขัตฤกษ์)</div>
                <div className="text-base font-bold font-mono text-amber-300 mt-0.5">
                  {otStats.count3_0} <span className="text-xs font-normal text-slate-400">รายการ</span>
                </div>
                <div className="text-[10px] text-amber-300 font-mono">
                  รวม {otStats.hours3_0.toFixed(1)} ชม. (ช่อง OT 3.0)
                </div>
              </div>

              <div className={`p-2.5 rounded border ${
                isDark ? 'bg-[#14202c] border-[#22364a]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-[10px] text-slate-400">Impact on Time Sheet (ช่อง Total)</div>
                <div className="text-base font-bold font-mono text-emerald-400 mt-0.5">
                  {otStats.totalHours.toFixed(1)} <span className="text-xs font-normal text-slate-400">ชั่วโมง</span>
                </div>
                <div className="text-[10px] text-emerald-300/80">
                  รวมเข้าสู่ Total ของทุกคน
                </div>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => setOtRateFilter('ALL')}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
                    otRateFilter === 'ALL'
                      ? 'bg-[#008b99] text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  ทั้งหมด ({otStats.totalCount})
                </button>
                <button
                  onClick={() => setOtRateFilter(1.5)}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
                    otRateFilter === 1.5
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-800 text-teal-400 hover:text-teal-200'
                  }`}
                >
                  เฉพาะ OT 1.5 ({otStats.count1_5})
                </button>
                <button
                  onClick={() => setOtRateFilter(3.0)}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
                    otRateFilter === 3.0
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-800 text-amber-400 hover:text-amber-200'
                  }`}
                >
                  เฉพาะ OT 3.0 ({otStats.count3_0})
                </button>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="ค้นหา EmpNo, GID, ชื่อ, เหตุผล..."
                  value={otSearchQuery}
                  onChange={e => setOtSearchQuery(e.target.value)}
                  className={`w-full pl-8 pr-3 py-1.5 rounded border text-xs ${
                    isDark ? 'bg-[#152332] border-[#29425c] text-white' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>
            </div>

            {/* Records Table */}
            <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-700/50 rounded">
              <table className="w-full text-left text-xs border-collapse">
                <thead className={`sticky top-0 z-10 text-[11px] ${
                  isDark ? 'bg-[#142230] text-slate-300' : 'bg-slate-100 text-slate-700'
                }`}>
                  <tr>
                    <th className="p-2 border-b border-slate-700">วันที่ลงใน Time Sheet</th>
                    <th className="p-2 border-b border-slate-700">พนักงาน</th>
                    <th className="p-2 border-b border-slate-700 text-center">ประเภทอัตรา</th>
                    <th className="p-2 border-b border-slate-700 text-right">จำนวน (ชม.)</th>
                    <th className="p-2 border-b border-slate-700">ระบุลงช่อง Time Sheet</th>
                    <th className="p-2 border-b border-slate-700">เหตุผล / ชื่องาน</th>
                    <th className="p-2 border-b border-slate-700 text-center">จัดการ</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                  {filteredMonthOTRecords.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-400">
                        {monthOTRecords.length === 0
                          ? 'ยังไม่มีข้อมูล Approved OT ในเดือนนี้ (กรุณาเลือก OT 1.5 หรือ OT 3.0 แล้วอัปโหลดไฟล์)'
                          : 'ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา'}
                      </td>
                    </tr>
                  ) : (
                    filteredMonthOTRecords.map(ot => {
                      const emp = employees.find(e => e.empNo === ot.empNo || e.gid === ot.gid);
                      const targetDate = ot.retroactiveTargetDate || ot.date;
                      return (
                        <tr key={ot.id} className={isDark ? 'hover:bg-[#152332]' : 'hover:bg-slate-50'}>
                          <td className="p-2 font-mono text-[11px] whitespace-nowrap">
                            <span className="font-bold text-slate-200">{targetDate}</span>
                            {ot.isRetroactive && (
                              <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                ย้อนหลังจาก {ot.originalDate}
                              </span>
                            )}
                          </td>
                          <td className="p-2 whitespace-nowrap">
                            <div className="font-mono text-teal-300 font-bold">{ot.empNo} / {ot.gid}</div>
                            <div className="text-[10px] text-slate-400 truncate max-w-[140px]">{emp?.name || '-'}</div>
                          </td>
                          <td className="p-2 text-center whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                              ot.rate === 3.0
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-[#00e5e5]/20 text-[#00e5e5] border-[#00e5e5]/40'
                            }`}>
                              OT {ot.rate === 3.0 ? '3.0 (3 เท่า)' : '1.5 (1.5 เท่า)'}
                            </span>
                          </td>
                          <td className="p-2 font-mono font-bold text-right whitespace-nowrap">
                            <span className={ot.rate === 3.0 ? 'text-amber-300' : 'text-[#00e5e5]'}>
                              {ot.hours.toFixed(1)}
                            </span>
                          </td>
                          <td className="p-2 whitespace-nowrap text-[11px]">
                            <span className={`inline-flex items-center space-x-1 font-mono font-bold ${
                              ot.rate === 3.0 ? 'text-amber-400' : 'text-[#00e5e5]'
                            }`}>
                              <span>ช่อง {ot.rate === 3.0 ? 'OT 3.0' : 'OT 1.5'}</span>
                              <span className="text-slate-400">→</span>
                              <span className="text-emerald-400">รวมใน Total</span>
                            </span>
                          </td>
                          <td className="p-2 text-[11px] max-w-xs truncate" title={ot.reason}>
                            <span className="text-slate-300">{ot.reason}</span>
                          </td>
                          <td className="p-2 text-center whitespace-nowrap">
                            {deleteOTConfirmId === ot.id ? (
                              <div className="inline-flex items-center space-x-1">
                                <button
                                  onClick={() => handleDeleteOTRecord(ot.id)}
                                  className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-bold text-[10px]"
                                >
                                  ยืนยัน
                                </button>
                                <button
                                  onClick={() => setDeleteOTConfirmId(null)}
                                  className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 text-[10px]"
                                >
                                  ยกเลิก
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteOTConfirmId(ot.id)}
                                className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition"
                                title="ลบรายการนี้"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
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

      {/* OT Deduplication & Safe Re-import Inspection Modal */}
      <OTDeduplicationModal
        isOpen={showOTMergeModal}
        onClose={() => setShowOTMergeModal(false)}
        result={latestOTMergeResult}
        isDark={isDark}
        selectedMonthYear={importMonthYear}
        selectedRate={selectedOTRate}
      />
    </div>
  );
};
