import React, { useState, useMemo, useEffect } from 'react';
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
  X,
  Lock,
  ShieldAlert,
  Users
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
  downloadWorkbook,
  parseCSVTextToRows
} from '../utils/fileParser';
import { storage, parseBiometricText } from '../utils/storage';
import { mergeAndDeduplicatePunches } from '../utils/biometricManager';
import { firestoreSync } from '../firebase';
import { AttendanceImportPanel } from './AttendanceImportPanel';
import { OTDeduplicationModal } from './OTDeduplicationModal';
import { 
  mergeAndDeduplicateOTRecords, 
  OTMergeMode, 
  OTMergeResult,
  OTMergeDetail,
  normalizeOTDate,
  detectFileDateFormat
} from '../utils/otManager';
import { normalizeShiftTimeString, calculateTimeDiffMinutes } from '../utils/timeCalc';
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
  onNavigateToRoster?: () => void;
  initialTab?: 'shift-plan' | 'shift-code' | 'attendance' | 'ot' | 'allowances';
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
  onNavigateToRoster,
  initialTab,
}) => {
  const isDark = theme === 'dark';
  const isAdmin = currentUser.role === 'Admin';

  const [activeImportTab, setActiveImportTab] = useState<'shift-plan' | 'shift-code' | 'attendance' | 'ot' | 'allowances'>(initialTab || 'shift-plan');

  useEffect(() => {
    if (initialTab) {
      setActiveImportTab(initialTab);
    }
  }, [initialTab]);

  // Specific Department for Shift Plan Import (Rule 3: บังคับเลือกเดือนปีและแผนกก่อนทุกครั้ง)
  const [importDept, setImportDept] = useState<string>(
    !isAdmin && currentUser.department !== 'ALL'
      ? currentUser.department
      : (selectedDepartment !== 'ALL' ? selectedDepartment : (currentUser.department !== 'ALL' ? currentUser.department : 'GM'))
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

  // Helper to compute previous month (e.g. 2026-09 -> 2026-08)
  const getPrevMonthStr = (ym: string) => {
    const [yStr, mStr] = (ym || '2026-09').split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const prevDate = new Date(y, m - 2, 1);
    return `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  };

  // Dedicated Target Month for OT Import (defaults to previous month because OT is done retroactively)
  const [otTargetMonthYear, setOtTargetMonthYear] = useState<string>(() => {
    return getPrevMonthStr(selectedMonthYear);
  });

  // Pre-import confirmation state
  interface PendingOTImportInfo {
    fileName: string;
    rawRows: any[];
    detectedMonth: string;
    totalRows: number;
    sampleDates: string[];
    dateCountByMonth: Record<string, number>;
  }
  const [pendingOTImport, setPendingOTImport] = useState<PendingOTImportInfo | null>(null);
  const [isExecutingOTImport, setIsExecutingOTImport] = useState<boolean>(false);
  const [otImportMethod, setOtImportMethod] = useState<'file' | 'paste'>('file');
  const [otPastedText, setOtPastedText] = useState<string>('');
  const [autoAssignRetroToTargetMonth, setAutoAssignRetroToTargetMonth] = useState<boolean>(true);

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
  const [otRevision, setOtRevision] = useState<number>(0);

  useEffect(() => {
    const handleUpdate = () => {
      setOtRevision(prev => prev + 1);
    };
    window.addEventListener('siemens_ix_data_changed', handleUpdate);
    return () => {
      window.removeEventListener('siemens_ix_data_changed', handleUpdate);
    };
  }, []);

  const allOTRecords = useMemo(() => {
    return storage.getOTRecords();
  }, [statusMessage, otRevision]);

  const monthOTRecords = useMemo(() => {
    return allOTRecords.filter(ot => {
      const d = ot.retroactiveTargetDate || ot.date || '';
      const normD = normalizeOTDate(d);
      return normD.startsWith(importMonthYear) ||
        (ot.date && normalizeOTDate(ot.date).startsWith(importMonthYear)) ||
        d.startsWith(importMonthYear);
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
        const nameStr = emp ? `${emp.firstName || ''} ${emp.familyName || ''}`.toLowerCase() : '';
        const empNoStr = (ot.empNo || '').toLowerCase();
        const gidStr = (ot.gid || '').toLowerCase();
        const reasonStr = (ot.reason || '').toLowerCase();
        const dateStr = (ot.date || '').toLowerCase();
        return empNoStr.includes(q) || gidStr.includes(q) || nameStr.includes(q) || reasonStr.includes(q) || dateStr.includes(q);
      }
      return true;
    });
  }, [monthOTRecords, otRateFilter, otSearchQuery, employees]);

  // =========================================================================
  // OT EMPLOYEE SUMMARY & SAFETY FIX HANDLERS (Resolves ID 61 & Inflation)
  // =========================================================================
  const [otViewMode, setOtViewMode] = useState<'employee_summary' | 'records'>('employee_summary');
  const [employeeOTToDelete, setEmployeeOTToDelete] = useState<{ empNo: string; name: string } | null>(null);

  // Grouped OT summary per employee for current month
  const otEmployeeSummary = useMemo(() => {
    const map = new Map<string, {
      empNo: string;
      gid: string;
      name: string;
      department: string;
      count1_5: number;
      hours1_5: number;
      count3_0: number;
      hours3_0: number;
      totalHours: number;
      records: OTRecord[];
      hasAnomaly: boolean;
      anomalyReasons: string[];
    }>();

    monthOTRecords.forEach(ot => {
      const key = ot.empNo || ot.gid;
      const emp = employees.find(e => e.empNo === ot.empNo || e.gid === ot.gid);
      const existing = map.get(key) || {
        empNo: ot.empNo,
        gid: ot.gid || (emp ? emp.gid : ''),
        name: emp ? `${emp.firstName || ''} ${emp.familyName || ''}`.trim() : (ot.empNo || '-'),
        department: emp ? emp.department : '-',
        count1_5: 0,
        hours1_5: 0,
        count3_0: 0,
        hours3_0: 0,
        totalHours: 0,
        records: [],
        hasAnomaly: false,
        anomalyReasons: [],
      };

      if (ot.rate === 3.0) {
        existing.count3_0++;
        existing.hours3_0 += ot.hours;
      } else {
        existing.count1_5++;
        existing.hours1_5 += ot.hours;
      }
      existing.totalHours += ot.hours;
      existing.records.push(ot);
      map.set(key, existing);
    });

    return Array.from(map.values()).map(item => {
      const reasons: string[] = [];
      if (item.totalHours > 60) {
        reasons.push(`ชั่วโมงรวมสูงผิดปกติ (${item.totalHours.toFixed(1)} ชม.)`);
      }
      const dateCounts: Record<string, number> = {};
      item.records.forEach(r => {
        const d = r.retroactiveTargetDate || r.date;
        dateCounts[d] = (dateCounts[d] || 0) + 1;
      });
      const dupDates = Object.entries(dateCounts).filter(([_, count]) => count > 1);
      if (dupDates.length > 0) {
        reasons.push(`พบรายการซ้ำในวันเดียวกัน ${dupDates.length} วัน (${dupDates.map(d => d[0]).slice(0, 2).join(', ')})`);
      }
      if (!employees.some(e => e.empNo === item.empNo || e.gid === item.gid)) {
        reasons.push('ไม่พบรหัสในฐานข้อมูล Employee Master');
      }
      return {
        ...item,
        hasAnomaly: reasons.length > 0,
        anomalyReasons: reasons,
      };
    });
  }, [monthOTRecords, employees]);

  const filteredOtEmployeeSummary = useMemo(() => {
    if (!otSearchQuery.trim()) return otEmployeeSummary;
    const q = otSearchQuery.trim().toLowerCase();
    return otEmployeeSummary.filter(item => {
      return (
        item.empNo.toLowerCase().includes(q) ||
        item.gid.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.department.toLowerCase().includes(q)
      );
    });
  }, [otEmployeeSummary, otSearchQuery]);

  // Handler to delete all OT records for a single employee (fixes ID 61 mistake safely)
  const handleDeleteEmployeeOT = async (empNo: string) => {
    if (!isAdmin) {
      setStatusMessage({ type: 'error', text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถลบรายการ OT ได้' });
      return;
    }
    const existing = storage.getOTRecords();
    const remaining = existing.filter(r => {
      const d = r.retroactiveTargetDate || r.date || '';
      const normD = normalizeOTDate(d);
      const isMonth = normD.startsWith(importMonthYear) || (r.date && normalizeOTDate(r.date).startsWith(importMonthYear));
      if (!isMonth) return true;
      return r.empNo !== empNo && r.gid !== empNo;
    });

    const removedCount = existing.length - remaining.length;
    await storage.setOTRecords(remaining);
    setOtRevision(prev => prev + 1);
    setEmployeeOTToDelete(null);
    setStatusMessage({
      type: 'success',
      text: `ลบรายการบันทึก OT ของพนักงานรหัส ${empNo} ในเดือน ${importMonthYear} ทั้งหมด ${removedCount} รายการเรียบร้อยแล้ว`,
    });
    onDataImported();
  };

  // =========================================================================
  // SHIFT PLAN INSPECTION & SAFETY CONTROLS
  // =========================================================================
  const [shiftPlanSearchQuery, setShiftPlanSearchQuery] = useState<string>('');
  const [shiftPlanStatusFilter, setShiftPlanStatusFilter] = useState<'ALL' | 'ASSIGNED' | 'MISSING'>('ALL');
  const [confirmClearDeptShiftPlan, setConfirmClearDeptShiftPlan] = useState<boolean>(false);

  const allShiftPlans = useMemo(() => {
    return storage.getShiftPlans();
  }, [statusMessage, otRevision]);

  const deptMonthShiftPlans = useMemo(() => {
    return allShiftPlans.filter(p => {
      const isMonth = p.date && p.date.startsWith(importMonthYear);
      if (!isMonth) return false;
      if (importDept === 'ALL') return true;
      const emp = employees.find(e => e.empNo === p.empNo || (p.gid && e.gid === p.gid));
      const dept = p.department || (emp ? emp.department : '');
      return dept === importDept;
    });
  }, [allShiftPlans, importDept, importMonthYear, employees]);

  const deptActiveEmployees = useMemo(() => {
    if (importDept === 'ALL') {
      return employees.filter(e => e.isActive !== false);
    }
    return employees.filter(e => e.department === importDept && e.isActive !== false);
  }, [employees, importDept]);

  const deptEmployeeShiftSummary = useMemo(() => {
    const planMap = new Map<string, DailyShiftPlan[]>();
    deptMonthShiftPlans.forEach(p => {
      const existing = planMap.get(p.empNo) || [];
      existing.push(p);
      planMap.set(p.empNo, existing);
    });

    return deptActiveEmployees.map(emp => {
      const plans = planMap.get(emp.empNo) || [];
      let workingDays = 0;
      let offDays = 0;
      const shiftCodesCount: Record<string, number> = {};

      plans.forEach(p => {
        const sc = shiftCodes.find(c => c.code.toUpperCase() === p.shiftCode.toUpperCase());
        const isWork = sc ? sc.isWorkingDay : !['OFF', 'H', 'PH', 'LEAVE', 'VAC', 'SICK', 'L'].includes(p.shiftCode.toUpperCase());
        if (isWork) workingDays++;
        else offDays++;
        shiftCodesCount[p.shiftCode] = (shiftCodesCount[p.shiftCode] || 0) + 1;
      });

      return {
        empNo: emp.empNo,
        gid: emp.gid,
        name: `${emp.firstName || ''} ${emp.familyName || ''}`.trim() || emp.empNo,
        department: emp.department,
        plansCount: plans.length,
        workingDays,
        offDays,
        shiftCodesCount,
        hasPlans: plans.length > 0
      };
    });
  }, [deptActiveEmployees, deptMonthShiftPlans, shiftCodes]);

  const filteredDeptEmployeeShiftSummary = useMemo(() => {
    return deptEmployeeShiftSummary.filter(item => {
      if (shiftPlanStatusFilter === 'ASSIGNED' && !item.hasPlans) return false;
      if (shiftPlanStatusFilter === 'MISSING' && item.hasPlans) return false;
      if (shiftPlanSearchQuery.trim()) {
        const q = shiftPlanSearchQuery.trim().toLowerCase();
        return (
          item.empNo.toLowerCase().includes(q) ||
          item.gid.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.department.toLowerCase().includes(q) ||
          Object.keys(item.shiftCodesCount).some(code => code.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [deptEmployeeShiftSummary, shiftPlanStatusFilter, shiftPlanSearchQuery]);

  const handleClearDeptShiftPlans = async () => {
    if (!isAdmin && currentUser.department !== importDept) {
      setStatusMessage({ type: 'error', text: `คุณไม่มีสิทธิ์ล้างตารางกะของแผนกอื่น (${importDept})` });
      return;
    }
    const currentPlans = storage.getShiftPlans();
    const emps = storage.getEmployees();
    const deptEmps = new Set(
      importDept === 'ALL'
        ? emps.map(e => e.empNo)
        : emps.filter(e => e.department === importDept).map(e => e.empNo)
    );

    const remaining = currentPlans.filter(p => {
      const isTargetMonth = p.date && p.date.startsWith(importMonthYear);
      if (!isTargetMonth) return true;
      const isDept = p.department ? p.department === importDept : deptEmps.has(p.empNo);
      return !isDept;
    });

    const removedCount = currentPlans.length - remaining.length;
    await storage.setShiftPlans(remaining);
    setConfirmClearDeptShiftPlan(false);
    setStatusMessage({
      type: 'success',
      text: `ล้างตารางกะแผนก ${importDept} งวดเดือน ${importMonthYear} ทั้งหมดเรียบร้อยแล้ว (${removedCount} วันทำงานถูกลบ)`,
    });
    onDataImported();
  };

  // Shift Code Usage in Current Month
  const shiftCodeUsageMap = useMemo(() => {
    const map: Record<string, number> = {};
    allShiftPlans.forEach(p => {
      if (p.date && p.date.startsWith(importMonthYear)) {
        const code = p.shiftCode.toUpperCase();
        map[code] = (map[code] || 0) + 1;
      }
    });
    return map;
  }, [allShiftPlans, importMonthYear]);

  // =========================================================================
  // ALLOWANCES INSPECTION & MANAGEMENT
  // =========================================================================
  const [allowanceSearchQuery, setAllowanceSearchQuery] = useState<string>('');
  const [confirmClearMonthAllowances, setConfirmClearMonthAllowances] = useState<boolean>(false);
  const [deleteAllowanceConfirmId, setDeleteAllowanceConfirmId] = useState<string | null>(null);

  const allAllowances = useMemo(() => {
    return storage.getOtherAllowances();
  }, [statusMessage, otRevision]);

  const monthAllowances = useMemo(() => {
    return allAllowances.filter(a => {
      if (!a.monthYear) return true;
      return a.monthYear === importMonthYear;
    });
  }, [allAllowances, importMonthYear]);

  const allowanceStats = useMemo(() => {
    let totalEmergency = 0;
    let totalShift = 0;
    let totalStandby = 0;
    const uniqueEmps = new Set<string>();

    monthAllowances.forEach(a => {
      totalEmergency += a.teamEmergency || 0;
      totalShift += a.shiftAllowance || 0;
      totalStandby += a.standbyAllowance || 0;
      if (a.empNo) uniqueEmps.add(a.empNo);
    });

    return {
      count: monthAllowances.length,
      uniqueEmployeesCount: uniqueEmps.size,
      totalEmergency,
      totalShift,
      totalStandby,
      grandTotal: totalEmergency + totalShift + totalStandby
    };
  }, [monthAllowances]);

  const filteredMonthAllowances = useMemo(() => {
    if (!allowanceSearchQuery.trim()) return monthAllowances;
    const q = allowanceSearchQuery.trim().toLowerCase();
    return monthAllowances.filter(a => {
      const emp = employees.find(e => e.empNo === a.empNo || e.gid === a.gid);
      const name = emp ? `${emp.firstName || ''} ${emp.familyName || ''}`.toLowerCase() : '';
      return (
        (a.empNo || '').toLowerCase().includes(q) ||
        (a.gid || '').toLowerCase().includes(q) ||
        name.includes(q) ||
        (a.remark || '').toLowerCase().includes(q)
      );
    });
  }, [monthAllowances, allowanceSearchQuery, employees]);

  const handleDeleteAllowanceRecord = async (id: string) => {
    if (!isAdmin) {
      setStatusMessage({ type: 'error', text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถลบเบี้ยเลี้ยงได้' });
      return;
    }
    const existing = storage.getOtherAllowances();
    const updated = existing.filter(a => a.id !== id);
    await storage.setOtherAllowances(updated);
    setDeleteAllowanceConfirmId(null);
    setStatusMessage({
      type: 'success',
      text: 'ลบรายการเบี้ยเลี้ยงเรียบร้อยแล้ว',
    });
    onDataImported();
  };

  const handleClearMonthAllowances = async () => {
    if (!isAdmin) {
      setStatusMessage({ type: 'error', text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถล้างเบี้ยเลี้ยงได้' });
      return;
    }
    const existing = storage.getOtherAllowances();
    const remaining = existing.filter(a => a.monthYear !== importMonthYear);
    const removedCount = existing.length - remaining.length;
    await storage.setOtherAllowances(remaining);
    setConfirmClearMonthAllowances(false);
    setStatusMessage({
      type: 'success',
      text: `ล้างรายการเบี้ยเลี้ยงงวดเดือน ${importMonthYear} ทั้งหมดเรียบร้อยแล้ว (${removedCount} รายการถูกลบ)`,
    });
    onDataImported();
  };

  // Biometric raw punches count for sub-sidebar badge
  const biometricPunchesCount = useMemo(() => {
    return storage.getBiometricPunches().length;
  }, [statusMessage, otRevision]);

  // Edit/Delete Shift Code Admin Mode States
  const [editingShiftCodeKey, setEditingShiftCodeKey] = useState<string | null>(null);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);

  const handleStartEditShiftCode = (sc: ShiftCode) => {
    const scDept = (sc.department || 'ALL').trim();
    setEditingShiftCodeKey(`${sc.code.trim().toUpperCase()}_${scDept.toUpperCase()}`);
    setManualCode(sc.code);
    setManualName(sc.name);
    setManualDept(scDept);
    const normStart = normalizeShiftTimeString(sc.startTime) || (sc.isWorkingDay ? '08:00' : '00:00');
    const normEnd = normalizeShiftTimeString(sc.endTime) || (sc.isWorkingDay ? '17:00' : '00:00');
    setManualStartTime(sc.isWorkingDay ? normStart : '00:00');
    setManualEndTime(sc.isWorkingDay ? normEnd : '00:00');
    setManualBreak(sc.isWorkingDay ? (sc.breakMinutes ?? 60).toString() : '0');
    setManualWorkingHours(sc.isWorkingDay ? (sc.workingHours ?? 8).toString() : '0');
    setManualIsWorkingDay(sc.isWorkingDay);
    setManualColor(sc.color || '#008b99');
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
    if (!isAdmin) {
      setStatusMessage({
        type: 'error',
        text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถลบรหัสกะได้',
      });
      return;
    }
    try {
      const scDept = (sc.department || 'ALL').trim();
      const targetKey = `${sc.code.trim().toUpperCase()}_${scDept.toUpperCase()}`;
      const existing = storage.getShiftCodes();
      const filtered = existing.filter(c => {
        const cDept = (c.department || 'ALL').trim();
        return `${c.code.trim().toUpperCase()}_${cDept.toUpperCase()}` !== targetKey;
      });
      await storage.setShiftCodes(filtered);
      // Delete document directly from Firestore too
      await firestoreSync.deleteShiftCode(sc.code, scDept, filtered);
      setStatusMessage({
        type: 'success',
        text: `ลบรหัสกะ "${sc.code}" ของแผนก "${scDept}" เรียบร้อยแล้ว!`,
      });
      setDeleteConfirmKey(null);
      if (editingShiftCodeKey === targetKey) {
        setEditingShiftCodeKey(null);
        setManualCode('');
        setManualName('');
      }
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

  const handleManualAddShiftCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    if (!isAdmin) {
      setStatusMessage({ type: 'error', text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถเพิ่มหรือแก้ไขรหัสกะได้' });
      return;
    }

    const code = manualCode.trim().toUpperCase();
    if (!code) {
      setStatusMessage({ type: 'error', text: 'กรุณากรอกรหัสกะ (Shift Code)' });
      return;
    }

    if (!manualName.trim()) {
      setStatusMessage({ type: 'error', text: 'กรุณากรอกชื่อกะ (Shift Name)' });
      return;
    }

    let finalStartTime = '08:00';
    let finalEndTime = '17:00';
    let breakMin = parseInt(manualBreak, 10);
    if (isNaN(breakMin) || breakMin < 0) breakMin = 0;
    let workHrs = parseFloat(manualWorkingHours);
    if (isNaN(workHrs) || workHrs < 0) workHrs = 0;

    if (!manualIsWorkingDay) {
      // Auto-set 00:00 - 00:00 and 0 hours for Day Off / Holiday / Leave without requiring user input or failing validation
      finalStartTime = '00:00';
      finalEndTime = '00:00';
      breakMin = 0;
      workHrs = 0;
    } else {
      const normStart = normalizeShiftTimeString(manualStartTime);
      const normEnd = normalizeShiftTimeString(manualEndTime);

      if (!normStart || !normEnd) {
        setStatusMessage({ 
          type: 'error', 
          text: `กรุณากรอกรูปแบบเวลาให้ถูกต้อง เช่น 08:00 หรือ 17:00 (ระบบรองรับ 8:00, 08:00, 8.00, 08:00:00)` 
        });
        return;
      }
      finalStartTime = normStart;
      finalEndTime = normEnd;

      // If working hours was 0 or empty, auto-compute from start, end, and break
      if (workHrs <= 0) {
        const diffMins = calculateTimeDiffMinutes(finalStartTime, finalEndTime);
        workHrs = Math.max(0, Math.round(((diffMins - breakMin) / 60) * 10) / 10);
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
      const wasEditing = Boolean(editingShiftCodeKey);

      // Reset editing state and form fields immediately for crisp UX
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

      await storage.setShiftCodes(updated);

      setStatusMessage({
        type: 'success',
        text: wasEditing 
          ? `แก้ไขข้อมูลรหัสกะ "${code}" ของแผนก "${manualDept}" เรียบร้อยแล้ว!` 
          : `เพิ่ม/อัปเดตรหัสกะ "${code}" เรียบร้อยแล้ว!`,
      });

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

      const targetDept = !isAdmin ? (currentUser.department || 'GM') : importDept;

      const result = validateAndParseShiftPlan(
        rawRows,
        importMonthYear,
        targetDept,
        employees,
        shiftCodes,
        currentUser.email
      );

      // Security check: Role User can only upload shift plans for their own department
      if (!isAdmin) {
        const foreignDeptPlans = result.plans.filter(p => p.department && p.department !== currentUser.department);
        if (foreignDeptPlans.length > 0) {
          setStatusMessage({
            type: 'error',
            text: `สิทธิ์ไม่เพียงพอ: คุณมีสิทธิ์ Role User สามารถอัปโหลดตารางกะได้เฉพาะแผนก ${currentUser.department} เท่านั้น (พบข้อมูลพนักงานสังกัดแผนกอื่นในไฟล์จำนวน ${foreignDeptPlans.length} รายการ)`,
            details: foreignDeptPlans.slice(0, 5).map(p => `EmpNo: ${p.empNo} แผนก: ${p.department}`),
          });
          return;
        }
      }

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

      // If new Employees were discovered & auto-created from template, persist them into Employee Master Database
      if (result.newEmployees && result.newEmployees.length > 0) {
        const currentEmployees = storage.getEmployees();
        const empMap = new Map<string, Employee>();
        currentEmployees.forEach(e => empMap.set(e.empNo, e));

        result.newEmployees.forEach(ne => {
          if (!empMap.has(ne.empNo)) {
            empMap.set(ne.empNo, ne);
          }
        });

        await storage.setEmployees(Array.from(empMap.values()));
      }

      // If new Shift Codes were discovered & generated, persist them into storage
      if (result.newShiftCodes && result.newShiftCodes.length > 0) {
        const currentCodes = storage.getShiftCodes();
        const codeMap = new Map<string, ShiftCode>();
        currentCodes.forEach(c => {
          codeMap.set(`${c.code.toUpperCase()}_${c.department.toUpperCase()}`, c);
        });

        result.newShiftCodes.forEach(nc => {
          const key = `${nc.code.toUpperCase()}_${nc.department.toUpperCase()}`;
          if (!codeMap.has(key)) {
            codeMap.set(key, nc);
          }
        });

        await storage.setShiftCodes(Array.from(codeMap.values()));
      }

      const importNotices: string[] = [];
      if (result.newEmployees && result.newEmployees.length > 0) {
        importNotices.push(`เพิ่มพนักงานใหม่เข้าสู่ Employee Master พร้อมกำหนดตำแหน่ง "Service Technician" & Cost Center ตามแผนก ${result.newEmployees.length} คน`);
      }
      if (result.newShiftCodes && result.newShiftCodes.length > 0) {
        importNotices.push(`เพิ่ม Shift Code ใหม่ ${result.newShiftCodes.length} รายการ (08:00 - 17:00)`);
      }
      if (result.skippedRows && result.skippedRows.length > 0) {
        importNotices.push(`ข้ามรายการที่ไม่สมบูรณ์/ไม่มี GID จริง ${result.skippedRows.length} รายการ`);
      }

      const allDetails: string[] = [];
      if (result.skippedRows && result.skippedRows.length > 0) {
        result.skippedRows.forEach(sr => {
          allDetails.push(`[ข้ามแถวที่ ${sr.row}] พนักงาน: ${sr.name || sr.empNo || '-'} (GID: ${sr.gid || 'ว่าง'}) — ${sr.reason}`);
        });
      }
      if (result.warnings && result.warnings.length > 0) {
        allDetails.push(...result.warnings);
      }

      setStatusMessage({
        type: (result.skippedRows && result.skippedRows.length > 0) ? 'warning' : (result.warnings.length > 0 ? 'warning' : 'success'),
        text: `อัปโหลดตารางกะสำเร็จ! นำเข้าข้อมูล ${result.plans.length} วันทำงาน (พนักงาน ${result.matchedEmployeesCount} คน แผนก ${targetDept})` +
          (importNotices.length > 0 ? ` [${importNotices.join(' | ')}]` : ''),
        details: allDetails.length > 0 ? allDetails : undefined,
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
    if (!isAdmin) {
      setStatusMessage({
        type: 'error',
        text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถนำเข้ารหัสกะได้',
      });
      return;
    }
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
    if (!isAdmin) {
      setStatusMessage({
        type: 'error',
        text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถนำเข้าเวลาสแกนนิ้วได้',
      });
      return;
    }
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
      // Merge with existing raw punches using smart deduplication
      const existing = storage.getBiometricPunches();
      const mergeRes = mergeAndDeduplicatePunches(existing, punches, 'smart-merge');
      await storage.setBiometricPunches(mergeRes.merged);

      setStatusMessage({
        type: 'success',
        text: `นำเข้าข้อมูลลงเวลาสำเร็จ! (${punches.length} รายการ punch records, เพิ่มใหม่ +${mergeRes.newAddedCount}, อัปเดตข้อมูลล่าสุด ${mergeRes.updatedCount} รายการ)`,
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

  // 4. Approved OT File Handler (From Power BI) - Step 1: Scan & Open Month Confirmation Dialog
  const handleOTFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setStatusMessage(null);
    if (!isAdmin) {
      setStatusMessage({
        type: 'error',
        text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถนำเข้าข้อมูล OT ได้',
      });
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const rawRows = parseSheetToRows(buffer);

      if (!rawRows || rawRows.length === 0) {
        setStatusMessage({
          type: 'error',
          text: 'ไม่พบรายการข้อมูลในไฟล์ที่เลือก หรือไฟล์ว่างเปล่า',
        });
        return;
      }

      // Detect date convention across file rows (MDY vs DMY)
      const fileDateFormat = detectFileDateFormat(rawRows);

      // Scan and detect months in file
      const monthCount: Record<string, number> = {};
      const sampleDates: string[] = [];

      rawRows.forEach(row => {
        const rawDate = row['Date'] || row['OT Date'] || row['OTDate'] || row['Work Date'] ||
          row['WorkDate'] || row['วันที่'] || row['วันที่ทำโอที'] || '';
        const dStr = normalizeOTDate(rawDate, fileDateFormat, otTargetMonthYear);
        if (dStr && /^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
          const ym = dStr.substring(0, 7);
          monthCount[ym] = (monthCount[ym] || 0) + 1;
          if (sampleDates.length < 5 && !sampleDates.includes(dStr)) {
            sampleDates.push(dStr);
          }
        }
      });

      // Determine dominant month from file dates (must strictly match YYYY-MM)
      let dominantMonth = /^\d{4}-\d{2}$/.test(otTargetMonthYear) ? otTargetMonthYear : selectedMonthYear;
      let maxCount = 0;
      Object.entries(monthCount).forEach(([ym, count]) => {
        if (/^\d{4}-\d{2}$/.test(ym) && count > maxCount) {
          maxCount = count;
          dominantMonth = ym;
        }
      });

      // If dates in file match a specific month, pre-select it
      if (dominantMonth && /^\d{4}-\d{2}$/.test(dominantMonth)) {
        setOtTargetMonthYear(dominantMonth);
      }

      // Open pre-import confirmation modal so the user explicitly approves the target month
      setPendingOTImport({
        fileName: file.name,
        rawRows,
        detectedMonth: dominantMonth,
        totalRows: rawRows.length,
        sampleDates,
        dateCountByMonth: monthCount,
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `เกิดข้อผิดพลาดในการเปิดไฟล์: ${err.message}`,
      });
    } finally {
      e.target.value = '';
    }
  };

  // Process pasted CSV/TSV text directly
  const handleOTTextSubmit = () => {
    setStatusMessage(null);
    if (!isAdmin) {
      setStatusMessage({
        type: 'error',
        text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถนำเข้าข้อมูล OT ได้',
      });
      return;
    }
    if (!otPastedText.trim()) {
      setStatusMessage({
        type: 'error',
        text: 'กรุณาวางข้อความ CSV หรือข้อมูลตารางในช่องข้อความก่อนกดนำเข้า',
      });
      return;
    }

    try {
      const rawRows = parseCSVTextToRows(otPastedText);
      if (!rawRows || rawRows.length === 0) {
        setStatusMessage({
          type: 'error',
          text: 'ไม่พบรายการข้อมูลในข้อความที่วาง หรือรูปแบบหัวคอลัมน์ไม่ถูกต้อง (ต้องมี EmpNo/GID, Date, Hours)',
        });
        return;
      }

      const fileDateFormat = detectFileDateFormat(rawRows);
      const monthCount: Record<string, number> = {};
      const sampleDates: string[] = [];

      rawRows.forEach(row => {
        const rawDate = row['Date'] || row['OT Date'] || row['OTDate'] || row['Work Date'] ||
          row['WorkDate'] || row['วันที่'] || row['วันที่ทำโอที'] || '';
        const dStr = normalizeOTDate(rawDate, fileDateFormat, otTargetMonthYear);
        if (dStr && /^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
          const ym = dStr.substring(0, 7);
          monthCount[ym] = (monthCount[ym] || 0) + 1;
          if (sampleDates.length < 5 && !sampleDates.includes(dStr)) {
            sampleDates.push(dStr);
          }
        }
      });

      let dominantMonth = /^\d{4}-\d{2}$/.test(otTargetMonthYear) ? otTargetMonthYear : selectedMonthYear;
      let maxCount = 0;
      Object.entries(monthCount).forEach(([ym, count]) => {
        if (/^\d{4}-\d{2}$/.test(ym) && count > maxCount) {
          maxCount = count;
          dominantMonth = ym;
        }
      });

      if (dominantMonth && /^\d{4}-\d{2}$/.test(dominantMonth)) {
        setOtTargetMonthYear(dominantMonth);
      }

      setPendingOTImport({
        fileName: 'Pasted CSV Data (วางข้อความ)',
        rawRows,
        detectedMonth: dominantMonth,
        totalRows: rawRows.length,
        sampleDates,
        dateCountByMonth: monthCount,
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `เกิดข้อผิดพลาดในการประมวลผลข้อความ: ${err.message}`,
      });
    }
  };

  // Execute OT Import with the confirmed target month
  const executeOTImport = async (targetMonth: string) => {
    if (!pendingOTImport) return;
    setIsExecutingOTImport(true);
    setStatusMessage(null);

    try {
      const rawRows = pendingOTImport.rawRows;
      const parseResult = parseApprovedOTFile(rawRows, targetMonth, selectedOTRate);

      if (parseResult.records.length === 0) {
        setStatusMessage({
          type: 'error',
          text: 'ไม่พบรายการ Approved OT ที่สมบูรณ์ในไฟล์ หรือไม่มีแถวที่ระบุรหัสพนักงานและชั่วโมง',
        });
        setPendingOTImport(null);
        return;
      }

      const existingOT = storage.getOTRecords();

      // All records are strictly bound and forced into targetMonth as requested by Admin
      const recordsToMerge = parseResult.records;

      // Execute Deduplication & Safe Merge for targetMonth
      const mergeResult = mergeAndDeduplicateOTRecords(
        existingOT,
        recordsToMerge,
        targetMonth,
        selectedOTRate,
        otMergeMode,
        employees
      );

      // Persist to storage & Firestore sync
      await storage.setOTRecords(mergeResult.merged);
      setOtRevision(prev => prev + 1);
      setLatestOTMergeResult(mergeResult);
      setShowOTMergeModal(true);
      setPendingOTImport(null);
      setOtPastedText('');

      // Sync importMonthYear so that the inspection table below immediately shows the newly imported records
      setImportMonthYear(targetMonth);

      const rateLabel = selectedOTRate === 3.0 ? 'OT 3.0 (อัตรา 3 เท่า)' : 'OT 1.5 (อัตรา 1.5 เท่า)';
      const targetCol = selectedOTRate === 3.0 ? 'Working Hours: OT 3.0' : 'Working Hours: OT 1.5';

      setStatusMessage({
        type: 'success',
        text: `นำเข้า Approved OT สำเร็จ: บังคับบันทึกข้อมูลทั้งหมด ${mergeResult.totalIncoming} รายการ ลงในงวดเดือน ${targetMonth} เรียบร้อยแล้ว (เพิ่มใหม่: ${mergeResult.addedCount}, อัปเดตชั่วโมง: ${mergeResult.updatedCount}, ข้ามซ้ำ: ${mergeResult.duplicatePreventedCount}) ยอดรวมสะสม ${mergeResult.totalHoursAfter.toFixed(1)} ชม.`,
        details: [
          `บันทึกข้อมูลลงช่อง ${targetCol} ในรอบเดือน ${targetMonth} และคำนวณสะสมใน Time Sheet เรียบร้อย`,
          `ยอดชั่วโมง OT รวมรอบเดือน ${targetMonth}: ${mergeResult.totalHoursAfter.toFixed(1)} ชม. (ก่อนนำเข้า: ${mergeResult.totalHoursBefore.toFixed(1)} ชม.)`,
        ],
      });

      onDataImported();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `เกิดข้อผิดพลาดในการนำเข้า OT: ${err.message}`,
      });
    } finally {
      setIsExecutingOTImport(false);
    }
  };

  // Handle saving retroactive OT target dates with Deduplication
  const handleConfirmRetroactiveOT = async () => {
    if (!isAdmin) {
      setStatusMessage({
        type: 'error',
        text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถจัดการ OT ได้',
      });
      return;
    }
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

    // Close modal immediately so UI does not hang during cloud sync
    setShowRetroModal(false);
    setRetroactiveOTs([]);

    await storage.setOTRecords(mergeResult.merged);
    setOtRevision(prev => prev + 1);
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
  const handleDeleteOTRecord = async (id: string) => {
    if (!isAdmin) {
      setStatusMessage({
        type: 'error',
        text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถลบรายการ OT ได้',
      });
      return;
    }
    const existing = storage.getOTRecords();
    const updated = existing.filter(r => r.id !== id);
    await storage.setOTRecords(updated);
    setOtRevision(prev => prev + 1);
    setDeleteOTConfirmId(null);
    setStatusMessage({
      type: 'success',
      text: 'ลบรายการบันทึก OT เรียบร้อยแล้ว',
    });
    onDataImported();
  };

  // Handle clearing all OT records for current selected month
  const handleClearMonthOTRecords = async () => {
    if (!isAdmin) {
      setStatusMessage({
        type: 'error',
        text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถล้างข้อมูล OT ได้',
      });
      return;
    }
    const existing = storage.getOTRecords();
    const remaining = existing.filter(r => {
      const d = r.retroactiveTargetDate || r.date || '';
      const normD = normalizeOTDate(d);
      const isMatch = normD.startsWith(importMonthYear) ||
        (r.date && normalizeOTDate(r.date).startsWith(importMonthYear)) ||
        d.startsWith(importMonthYear) ||
        (r.originalDate && normalizeOTDate(r.originalDate).startsWith(importMonthYear));
      return !isMatch;
    });
    await storage.setOTRecords(remaining);
    setOtRevision(prev => prev + 1);
    setStatusMessage({
      type: 'success',
      text: `ล้างรายการ OT ของเดือน ${importMonthYear} ทั้งหมดเรียบร้อยแล้ว (${existing.length - remaining.length} รายการถูกลบ)`,
    });
    onDataImported();
  };

  // 5. Other Allowances File Handler
  const handleAllowancesFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setStatusMessage(null);
    if (!isAdmin) {
      setStatusMessage({
        type: 'error',
        text: 'สิทธิ์ไม่เพียงพอ: เฉพาะ Role Admin เท่านั้นที่สามารถนำเข้าเบี้ยเลี้ยงได้',
      });
      return;
    }
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

  const renderAdminOnlyRestriction = (title: string, subtitle: string) => (
    <div className={`p-8 rounded-lg border text-center space-y-4 ${
      isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
    }`}>
      <div className="w-14 h-14 mx-auto rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
        <ShieldAlert className="w-7 h-7" />
      </div>
      <div className="max-w-md mx-auto space-y-2">
        <h3 className="text-base font-bold text-slate-100">
          สิทธิ์การเข้าถึงถูกจำกัด (Admin Access Only)
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          ผู้ใช้งานสิทธิ์ User ({currentUser.name} - แผนก {currentUser.department || 'ไม่ระบุ'}) ได้รับสิทธิ์เฉพาะการอัปโหลดตารางกะ (Shift Plan) ประจำแผนกตนเองเท่านั้น
        </p>
        <div className={`p-3 rounded border text-xs font-medium ${
          isDark ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-amber-50 border-amber-300 text-amber-900'
        }`}>
          หมวดหมู่ <strong>"{title}"</strong> ({subtitle}) สงวนไว้สำหรับการจัดการและนำเข้าข้อมูลโดยผู้ดูแลระบบ (Role Admin)
        </div>
      </div>
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setActiveImportTab('shift-plan')}
          className="px-4 py-2 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition flex items-center space-x-1.5 mx-auto cursor-pointer"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>ไปยังหน้าอัปโหลด Shift Plan (ตารางกะแผนก)</span>
        </button>
      </div>
    </div>
  );

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
              {!isAdmin 
                ? `นำเข้า Shift Plan ประจำแผนก ${currentUser.department || 'GM'} (สิทธิ์ User เฉพาะตารางกะ)`
                : 'Import Shift Plans, Shift Codes, Biometric Raw Punches, Approved OT (Power BI), and Other Allowances'
              }
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

      {/* User Role Access Notice Banner for Non-Admins */}
      {!isAdmin && (
        <div className={`p-3 rounded-lg border flex items-center justify-between text-xs ${
          isDark ? 'bg-[#141e2b] border-[#24374c] text-slate-300' : 'bg-amber-50 border-amber-300 text-amber-900'
        }`}>
          <div className="flex items-center space-x-2">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>สิทธิ์การใช้งาน (User Role):</strong> คุณสามารถดำเนินการได้เฉพาะการอัปโหลด <strong>Shift Plan (ตารางกะ)</strong> ประจำแผนก <strong>{currentUser.department || 'GM'}</strong> เท่านั้น เมนูนำเข้าข้อมูลอื่นสงวนสิทธิ์สำหรับ Admin
            </span>
          </div>
          <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
            User Restricted Mode
          </span>
        </div>
      )}

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
              {!isAdmin ? '1 เมนูที่ได้รับสิทธิ์' : '5 หมวดหมู่'}
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
                badge: deptMonthShiftPlans.length > 0 ? `${deptMonthShiftPlans.length} กะ` : `Dept: ${importDept}`, 
                isDeptSpecific: true,
                allowed: true,
              },
              { 
                id: 'shift-code' as const, 
                title: '2. Shift Codes', 
                subtitle: 'รหัสกะการทำงาน (ใช้ร่วมกัน)', 
                icon: Clock, 
                badge: `${shiftCodes.length} รหัส`, 
                isDeptSpecific: false,
                allowed: isAdmin,
              },
              { 
                id: 'attendance' as const, 
                title: '3. Biometric Attendance', 
                subtitle: 'เวลาสแกนนิ้วเข้า-ออก (Text/CSV)', 
                icon: FileText, 
                badge: !isAdmin ? 'Admin Only' : (biometricPunchesCount > 0 ? `${biometricPunchesCount.toLocaleString()} รายการ` : 'All Depts'), 
                isDeptSpecific: false,
                allowed: isAdmin,
              },
              { 
                id: 'ot' as const, 
                title: '4. Approved OT', 
                subtitle: 'โอทีที่อนุมัติแล้ว (Power BI)', 
                icon: FileCheck2, 
                badge: !isAdmin ? 'Admin Only' : (otStats.totalCount > 0 ? `${otStats.totalCount} รายการ (${otStats.totalHours.toFixed(1)}h)` : 'All Depts'), 
                isDeptSpecific: false,
                allowed: isAdmin,
              },
              { 
                id: 'allowances' as const, 
                title: '5. Other Allowances', 
                subtitle: 'เบี้ยเลี้ยงและรายได้เสริม', 
                icon: DollarSign, 
                badge: !isAdmin ? 'Admin Only' : (monthAllowances.length > 0 ? `${monthAllowances.length} รายการ` : 'All Depts'), 
                isDeptSpecific: false,
                allowed: isAdmin,
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
                      <div className="flex items-center space-x-1.5 truncate">
                        <span className={`text-xs font-bold truncate ${isActive ? isDark ? 'text-[#00e5e5]' : 'text-teal-800' : ''}`}>
                          {tab.title}
                        </span>
                        {!tab.allowed && (
                          <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                        )}
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono shrink-0 font-semibold ${
                        !tab.allowed
                          ? isDark ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-amber-100 text-amber-800'
                          : tab.isDeptSpecific
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
              <li>นำเข้า <strong>Biometric</strong> สแกนนิ้วรวม (Admin)</li>
              <li>นำเข้า <strong>Approved OT</strong> & <strong>Allowances</strong> (Admin)</li>
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
                  {!isAdmin 
                    ? `คุณสังกัดแผนก ${currentUser.department || 'GM'} ระบบล็อกแผนกเป้าหมายให้อัตโนมัติตามสิทธิ์`
                    : 'Shift Plans are managed per department. Uploading will ONLY update employees in the selected department.'
                  }
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <span className="text-xs text-slate-400 font-medium">Department:</span>
              {!isAdmin ? (
                <div className={`px-3 py-1.5 rounded font-mono font-bold text-xs flex items-center space-x-1.5 ${
                  isDark ? 'bg-[#0f1722] text-teal-300 border border-teal-500/40' : 'bg-white text-slate-900 border border-teal-300'
                }`}>
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>{currentUser.department || 'GM'} (แผนกตนเอง)</span>
                </div>
              ) : (
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
              )}
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

          {/* ========================================================================= */}
          {/* IMPORTED SHIFT PLAN INSPECTION & SUMMARY TABLE */}
          {/* ========================================================================= */}
          <div className={`p-4 rounded border text-xs space-y-3.5 ${
            isDark ? 'bg-[#0e1722] border-[#223548]' : 'bg-white border-slate-200'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/60 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-[#00e5e5]" />
                  <span>รายการตารางกะที่บันทึกแล้วในระบบ — แผนก {importDept} (งวด {importMonthYear})</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  ตรวจสอบรายชื่อพนักงาน วันทำงาน และวันหยุดที่ได้นำเข้าสู่ระบบแล้วสำหรับแผนกนี้
                </p>
              </div>

              <div className="flex items-center space-x-2">
                {onNavigateToRoster && (
                  <button
                    type="button"
                    onClick={onNavigateToRoster}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded font-bold text-xs bg-slate-700 hover:bg-slate-600 text-teal-300 border border-slate-600 transition cursor-pointer"
                  >
                    <span>ดูตารางกะรวม (Shift Roster)</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}

                {deptMonthShiftPlans.length > 0 && (
                  <>
                    {confirmClearDeptShiftPlan ? (
                      <div className="flex items-center space-x-1.5 p-1 rounded bg-red-950/40 border border-red-500/40">
                        <span className="text-[11px] text-red-300 font-bold px-1">ยืนยันล้างตารางกะแผนก {importDept}?</span>
                        <button
                          type="button"
                          onClick={handleClearDeptShiftPlans}
                          className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-bold text-[11px] cursor-pointer"
                        >
                          ใช่, ลบทั้งหมด
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmClearDeptShiftPlan(false)}
                          className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-[11px] cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmClearDeptShiftPlan(true)}
                        className="flex items-center space-x-1 px-2.5 py-1.5 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 text-[11px] cursor-pointer transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>ล้างตารางกะแผนกนี้ ({deptMonthShiftPlans.length} วัน)</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* KPI Summary Cards */}
            {(() => {
              const assignedCount = deptEmployeeShiftSummary.filter(e => e.hasPlans).length;
              const totalEmps = deptActiveEmployees.length;
              const missingCount = totalEmps - assignedCount;
              const totalWorkDays = deptEmployeeShiftSummary.reduce((acc, curr) => acc + curr.workingDays, 0);
              const totalOffDays = deptEmployeeShiftSummary.reduce((acc, curr) => acc + curr.offDays, 0);

              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className={`p-2.5 rounded border ${
                    isDark ? 'bg-[#14202c] border-[#22364a]' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="text-[10px] text-slate-400">พนักงานที่มีตารางกะ (Assigned)</div>
                    <div className="text-base font-bold font-mono text-[#00e5e5] mt-0.5">
                      {assignedCount} / {totalEmps} <span className="text-xs font-normal text-slate-400">คน</span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      ครอบคลุม {totalEmps > 0 ? Math.round((assignedCount / totalEmps) * 100) : 0}% ของแผนก
                    </div>
                  </div>

                  <div className={`p-2.5 rounded border ${
                    isDark ? 'bg-teal-950/20 border-teal-800/40' : 'bg-teal-50 border-teal-200'
                  }`}>
                    <div className="text-[10px] text-teal-400 font-bold">วันทำงาน (Working Days)</div>
                    <div className="text-base font-bold font-mono text-teal-300 mt-0.5">
                      {totalWorkDays} <span className="text-xs font-normal text-slate-400">วัน</span>
                    </div>
                    <div className="text-[10px] text-teal-400/80">
                      กะทำงานปกติ / ดึก
                    </div>
                  </div>

                  <div className={`p-2.5 rounded border ${
                    isDark ? 'bg-[#14202c] border-[#22364a]' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="text-[10px] text-slate-400">วันหยุด / วันลา (Off Days)</div>
                    <div className="text-base font-bold font-mono text-amber-300 mt-0.5">
                      {totalOffDays} <span className="text-xs font-normal text-slate-400">วัน</span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      OFF, LEAVE, HOLIDAY
                    </div>
                  </div>

                  <div className={`p-2.5 rounded border ${
                    missingCount > 0
                      ? isDark ? 'bg-amber-950/20 border-amber-500/40' : 'bg-amber-50 border-amber-300'
                      : isDark ? 'bg-emerald-950/20 border-emerald-800/40' : 'bg-emerald-50 border-emerald-200'
                  }`}>
                    <div className={`text-[10px] font-bold ${missingCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {missingCount > 0 ? '⚠️ ยังไม่มีตารางกะ (Missing)' : '✓ สถานะความครบถ้วน'}
                    </div>
                    <div className={`text-base font-bold font-mono mt-0.5 ${missingCount > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {missingCount > 0 ? `${missingCount} คน` : 'ครบ 100%'}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {missingCount > 0 ? 'จำเป็นต้องนำเข้าตารางกะเพิ่ม' : 'พนักงานทุกคนมีตารางกะแล้ว'}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => setShiftPlanStatusFilter('ALL')}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                    shiftPlanStatusFilter === 'ALL'
                      ? 'bg-[#008b99] text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  ทั้งหมด ({deptEmployeeShiftSummary.length})
                </button>
                <button
                  type="button"
                  onClick={() => setShiftPlanStatusFilter('ASSIGNED')}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                    shiftPlanStatusFilter === 'ASSIGNED'
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-800 text-teal-400 hover:text-teal-200'
                  }`}
                >
                  มีตารางกะแล้ว ({deptEmployeeShiftSummary.filter(e => e.hasPlans).length})
                </button>
                <button
                  type="button"
                  onClick={() => setShiftPlanStatusFilter('MISSING')}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                    shiftPlanStatusFilter === 'MISSING'
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-800 text-amber-400 hover:text-amber-200'
                  }`}
                >
                  ยังไม่มีตารางกะ ({deptEmployeeShiftSummary.filter(e => !e.hasPlans).length})
                </button>
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="ค้นหา EmpNo, GID, ชื่อ, รหัสกะ..."
                  value={shiftPlanSearchQuery}
                  onChange={e => setShiftPlanSearchQuery(e.target.value)}
                  className={`w-full pl-8 pr-3 py-1.5 rounded border text-xs outline-none ${
                    isDark ? 'bg-[#152332] border-[#29425c] text-white' : 'bg-slate-50 border-slate-300'
                  }`}
                />
                {shiftPlanSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setShiftPlanSearchQuery('')}
                    className="absolute right-2 top-2 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Shift Plans Employee Table */}
            <div className="overflow-x-auto max-h-80 overflow-y-auto border border-slate-700/50 rounded">
              <table className="w-full text-left text-xs border-collapse">
                <thead className={`sticky top-0 z-10 text-[11px] ${
                  isDark ? 'bg-[#142230] text-slate-300' : 'bg-slate-100 text-slate-700'
                }`}>
                  <tr>
                    <th className="p-2 border-b border-slate-700">รหัสพนักงาน / GID</th>
                    <th className="p-2 border-b border-slate-700">ชื่อ - สกุล</th>
                    <th className="p-2 border-b border-slate-700">แผนก</th>
                    <th className="p-2 border-b border-slate-700 text-center">วันทำงาน</th>
                    <th className="p-2 border-b border-slate-700 text-center">วันหยุด/ลา</th>
                    <th className="p-2 border-b border-slate-700 text-center">รวมวัน</th>
                    <th className="p-2 border-b border-slate-700">กะที่กำหนด (Shift Codes)</th>
                    <th className="p-2 border-b border-slate-700 text-center">สถานะ</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                  {filteredDeptEmployeeShiftSummary.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-slate-400">
                        {deptMonthShiftPlans.length === 0
                          ? `ยังไม่มีข้อมูลตารางกะสำหรับแผนก ${importDept} ในงวด ${importMonthYear} (กรุณาดาวน์โหลด Template และอัปโหลดไฟล์ในขั้นตอนด้านบน)`
                          : 'ไม่พบพนักงานที่ตรงกับเงื่อนไขการค้นหา'}
                      </td>
                    </tr>
                  ) : (
                    filteredDeptEmployeeShiftSummary.map(item => (
                      <tr key={item.empNo} className={isDark ? 'hover:bg-[#152332]' : 'hover:bg-slate-50'}>
                        <td className="p-2 whitespace-nowrap font-mono font-bold text-teal-300">
                          {item.empNo} {item.gid && <span className="text-slate-400 font-normal">/ {item.gid}</span>}
                        </td>
                        <td className="p-2 whitespace-nowrap text-slate-200 font-medium">
                          {item.name}
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                            {item.department || importDept}
                          </span>
                        </td>
                        <td className="p-2 text-center whitespace-nowrap font-mono font-bold text-teal-400">
                          {item.workingDays} วัน
                        </td>
                        <td className="p-2 text-center whitespace-nowrap font-mono text-amber-300">
                          {item.offDays} วัน
                        </td>
                        <td className="p-2 text-center whitespace-nowrap font-mono font-bold text-slate-200">
                          {item.plansCount} วัน
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {Object.entries(item.shiftCodesCount).map(([code, count]) => (
                              <span
                                key={code}
                                className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-slate-800/80 text-teal-300 border border-slate-700"
                              >
                                {code} ({count})
                              </span>
                            ))}
                            {item.plansCount === 0 && (
                              <span className="text-slate-500 text-[10px] italic">ไม่มีข้อมูล</span>
                            )}
                          </div>
                        </td>
                        <td className="p-2 text-center whitespace-nowrap">
                          {item.hasPlans ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
                              <CheckCircle2 className="w-3 h-3 text-teal-400" />
                              <span>บันทึกแล้ว ({item.plansCount} วัน)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              <AlertCircle className="w-3 h-3 text-amber-400" />
                              <span>ยังไม่มีตารางกะ</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Shift Code Manager & Import */}
      {activeImportTab === 'shift-code' && (
        !isAdmin ? (
          renderAdminOnlyRestriction('2. Shift Codes', 'รหัสกะการทำงาน')
        ) : (
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
                        placeholder={manualIsWorkingDay ? '08:00 หรือ 8:00' : '00:00'}
                        value={manualIsWorkingDay ? manualStartTime : '00:00'}
                        onChange={e => setManualStartTime(e.target.value)}
                        onBlur={() => {
                          if (manualIsWorkingDay && manualStartTime) {
                            const norm = normalizeShiftTimeString(manualStartTime);
                            if (norm) {
                              setManualStartTime(norm);
                              // Auto calculate hours if end time exists
                              if (manualEndTime) {
                                const endNorm = normalizeShiftTimeString(manualEndTime);
                                if (endNorm) {
                                  const diff = calculateTimeDiffMinutes(norm, endNorm);
                                  const brk = parseInt(manualBreak, 10) || 0;
                                  const calcHrs = Math.max(0, Math.round(((diff - brk) / 60) * 10) / 10);
                                  if (calcHrs > 0 && (!manualWorkingHours || manualWorkingHours === '0' || manualWorkingHours === '8')) {
                                    setManualWorkingHours(calcHrs.toString());
                                  }
                                }
                              }
                            }
                          }
                        }}
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
                        placeholder={manualIsWorkingDay ? '17:00 หรือ 17.00' : '00:00'}
                        value={manualIsWorkingDay ? manualEndTime : '00:00'}
                        onChange={e => setManualEndTime(e.target.value)}
                        onBlur={() => {
                          if (manualIsWorkingDay && manualEndTime) {
                            const norm = normalizeShiftTimeString(manualEndTime);
                            if (norm) {
                              setManualEndTime(norm);
                              // Auto calculate hours if start time exists
                              if (manualStartTime) {
                                const startNorm = normalizeShiftTimeString(manualStartTime);
                                if (startNorm) {
                                  const diff = calculateTimeDiffMinutes(startNorm, norm);
                                  const brk = parseInt(manualBreak, 10) || 0;
                                  const calcHrs = Math.max(0, Math.round(((diff - brk) / 60) * 10) / 10);
                                  if (calcHrs > 0 && (!manualWorkingHours || manualWorkingHours === '0' || manualWorkingHours === '8')) {
                                    setManualWorkingHours(calcHrs.toString());
                                  }
                                }
                              }
                            }
                          }
                        }}
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
                        onChange={e => {
                          const val = e.target.value;
                          setManualBreak(val);
                          if (manualIsWorkingDay && manualStartTime && manualEndTime) {
                            const startNorm = normalizeShiftTimeString(manualStartTime);
                            const endNorm = normalizeShiftTimeString(manualEndTime);
                            if (startNorm && endNorm) {
                              const diff = calculateTimeDiffMinutes(startNorm, endNorm);
                              const brk = parseInt(val, 10) || 0;
                              const calcHrs = Math.max(0, Math.round(((diff - brk) / 60) * 10) / 10);
                              setManualWorkingHours(calcHrs.toString());
                            }
                          }
                        }}
                        disabled={!manualIsWorkingDay}
                        className={`w-full p-2 rounded text-xs outline-none font-mono ${
                          !manualIsWorkingDay
                            ? 'bg-slate-800/40 text-slate-400 border border-slate-700/50 cursor-not-allowed opacity-80'
                            : isDark ? 'bg-[#0f1722] text-slate-100 border border-[#23384c]' : 'bg-slate-50 text-slate-900 border'
                        }`}
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-bold text-slate-300">
                          ชม.ทำงาน (Hours) {!manualIsWorkingDay && <span className="text-slate-400 font-normal">(0 ชม.)</span>}
                        </label>
                        {manualIsWorkingDay && (
                          <button
                            type="button"
                            onClick={() => {
                              const startNorm = normalizeShiftTimeString(manualStartTime);
                              const endNorm = normalizeShiftTimeString(manualEndTime);
                              if (startNorm && endNorm) {
                                const diff = calculateTimeDiffMinutes(startNorm, endNorm);
                                const brk = parseInt(manualBreak, 10) || 0;
                                const calcHrs = Math.max(0, Math.round(((diff - brk) / 60) * 10) / 10);
                                setManualWorkingHours(calcHrs.toString());
                              }
                            }}
                            className="text-[9px] text-teal-400 hover:text-teal-300 underline cursor-pointer"
                            title="คำนวณชั่วโมงตามเวลาเริ่ม-เลิกและเวลาพักอัตโนมัติ"
                          >
                            คำนวณอัตโนมัติ
                          </button>
                        )}
                      </div>
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
                            style={{ backgroundColor: c, outline: manualColor === c ? '2px solid white' : 'none' }}
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
                              {(() => {
                                const usageInMonth = shiftCodeUsageMap[sc.code.toUpperCase()] || 0;
                                return (
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-slate-100 font-bold">{sc.name}</span>
                                      {isBeingEdited && (
                                        <span className="px-1.5 py-0.2 text-[9px] font-bold bg-amber-500 text-[#09151e] rounded animate-pulse">
                                          กำลังแก้ไข
                                        </span>
                                      )}
                                      {usageInMonth > 0 && (
                                        <span className="px-1.5 py-0.2 text-[9px] font-mono font-bold bg-teal-500/20 text-teal-300 rounded border border-teal-500/30" title="จำนวนวันที่พนักงานใช้รหัสกะนี้ในตารางกะรอบเดือนปัจจุบัน">
                                          ใช้ในเดือนนี้ {usageInMonth} วัน
                                        </span>
                                      )}
                                    </div>
                                    {sc.description && <div className="text-[10px] text-slate-400 font-normal">{sc.description}</div>}
                                  </div>
                                );
                              })()}
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
        )
      )}

      {/* TAB 3: Biometric Attendance Import (Company-Wide ALL & Bulk/Folder Support) */}
      {activeImportTab === 'attendance' && (
        !isAdmin ? (
          renderAdminOnlyRestriction('3. Biometric Attendance', 'เวลาสแกนนิ้วเข้า-ออก Text/CSV')
        ) : (
        <AttendanceImportPanel
          currentUser={currentUser}
          theme={theme}
          selectedMonthYear={selectedMonthYear}
          selectedDepartment={selectedDepartment}
          employees={employees}
          shiftCodes={shiftCodes}
          onDataImported={onDataImported}
        />
        )
      )}

      {/* TAB 4: Approved OT Import (Company-Wide from Power BI) */}
      {activeImportTab === 'ot' && (
        !isAdmin ? (
          renderAdminOnlyRestriction('4. Approved OT', 'โอทีที่อนุมัติแล้ว Power BI')
        ) : (
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

          {/* STEP 1: Target Month Selection for Retroactive OT Import */}
          <div className={`p-4 rounded border text-xs space-y-3.5 ${
            isDark ? 'bg-[#0e1a26] border-[#1f374e]' : 'bg-white border-slate-300 shadow-xs'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#008b99] text-white font-bold text-xs">
                  1
                </span>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <span>เลือกงวดเดือนสำหรับการนำเข้า OT (Target Month Selection)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    การทำย้อนหลัง (Retroactive)
                  </span>
                </h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-slate-400 text-xs">งวดเดือนเป้าหมาย:</span>
                <span className="px-3 py-1 rounded-full font-mono font-bold text-sm bg-teal-500/20 text-[#00e5e5] border border-teal-500/40">
                  📅 {otTargetMonthYear}
                </span>
              </div>
            </div>

            {/* Explanatory Notice */}
            <div className={`p-2.5 rounded-lg border text-[11px] leading-relaxed flex items-start space-x-2.5 ${
              isDark ? 'bg-amber-950/20 border-amber-500/30 text-amber-200/90' : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}>
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong>สำคัญมากสำหรับการทำ OT ย้อนหลัง:</strong> การนำเข้าข้อมูล OT จาก Power BI มักเป็นการนำเข้าข้อมูลสรุปของ<strong>เดือนที่ผ่านมา</strong>ทั้งสิ้น (เช่น ทำการนำเข้าในเดือนกันยายนสำหรับงวดเดือนสิงหาคม) ระบบจะใช้เดือนที่เลือกนี้เป็นเกณฑ์หลักในการบันทึกชั่วโมงลงใน Time Sheet ของงวดนั้นๆ โดยตรง
              </div>
            </div>

            {/* Selection Controls: Quick Pickers & Custom Month */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              {/* Quick Choice 1: Previous Month (Recommended) */}
              <button
                type="button"
                onClick={() => {
                  const prev = getPrevMonthStr(selectedMonthYear);
                  setOtTargetMonthYear(prev);
                }}
                className={`p-3 rounded-lg border text-left transition flex flex-col justify-between cursor-pointer ${
                  otTargetMonthYear === getPrevMonthStr(selectedMonthYear)
                    ? 'bg-teal-500/20 border-[#00e5e5] shadow-md ring-1 ring-[#00e5e5]/50 text-white'
                    : isDark
                      ? 'bg-[#142230] border-[#203448] text-slate-300 hover:border-slate-500'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs flex items-center gap-1.5 text-teal-300">
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>งวดเดือนที่แล้ว (Previous)</span>
                  </span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded font-bold bg-teal-500/30 text-teal-200 border border-teal-500/40">
                    แนะนำ
                  </span>
                </div>
                <div className="font-mono font-bold text-base mt-2 text-[#00e5e5]">
                  {getPrevMonthStr(selectedMonthYear)}
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  สำหรับนำเข้าข้อมูลย้อนหลังรอบเดือนที่ผ่านมา
                </span>
              </button>

              {/* Quick Choice 2: Current Selected Month */}
              <button
                type="button"
                onClick={() => setOtTargetMonthYear(selectedMonthYear)}
                className={`p-3 rounded-lg border text-left transition flex flex-col justify-between cursor-pointer ${
                  otTargetMonthYear === selectedMonthYear
                    ? 'bg-blue-500/20 border-blue-400 shadow-md ring-1 ring-blue-400/50 text-white'
                    : isDark
                      ? 'bg-[#142230] border-[#203448] text-slate-300 hover:border-slate-500'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs flex items-center gap-1.5 text-blue-300">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>งวดเดือนปัจจุบัน (Current)</span>
                  </span>
                </div>
                <div className="font-mono font-bold text-base mt-2 text-blue-400">
                  {selectedMonthYear}
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  สำหรับรอบเดือนปัจจุบันที่กำลังดำเนินการ
                </span>
              </button>

              {/* Custom Month Picker */}
              <div className={`p-3 rounded-lg border flex flex-col justify-between ${
                isDark ? 'bg-[#142230] border-[#203448]' : 'bg-slate-50 border-slate-200'
              }`}>
                <span className="font-bold text-xs text-slate-300 flex items-center gap-1.5">
                  <Edit2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>เลือกงวดเดือนอื่น (Custom)</span>
                </span>
                <input
                  type="month"
                  value={otTargetMonthYear}
                  onChange={e => e.target.value && setOtTargetMonthYear(e.target.value)}
                  className={`mt-2 p-2 rounded text-sm font-mono font-bold border outline-none cursor-pointer ${
                    isDark ? 'bg-[#1c2c3d] border-[#2f4862] text-teal-300' : 'bg-white border-slate-300 text-slate-900'
                  }`}
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  ระบุปี-เดือน ที่ต้องการนำเข้าข้อมูล
                </span>
              </div>
            </div>
          </div>

          {/* STEP 2: Mandatory OT Rate Selection */}
          <div className={`p-4 rounded border text-xs space-y-3 ${
            isDark ? 'bg-[#0f1924] border-[#243a50]' : 'bg-white border-slate-300 shadow-xs'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#008b99] text-white font-bold text-xs">
                  2
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

          {/* STEP 3: Deduplication & Re-Import Control Section */}
          <div className={`p-4 rounded border space-y-3 ${
            isDark ? 'bg-[#101c28] border-[#223548]' : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/50 pb-2.5">
              <div className="flex items-center space-x-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#008b99] text-white font-bold text-xs">
                  3
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

          {/* STEP 4: Template & Upload */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Step 4.1: Download Template */}
            <div className={`p-4 rounded border space-y-3 text-xs ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
            }`}>
              <div className="flex items-center space-x-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-700 text-slate-300 font-bold text-xs">
                  4.1
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
                  className="w-full flex items-center justify-center space-x-1.5 py-2 rounded border border-slate-600 text-slate-300 hover:text-white text-xs bg-slate-800/60 hover:bg-slate-800 transition cursor-pointer"
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
                <div className="text-amber-400">⚠ รายการย้อนหลัง (ก่อนงวด {otTargetMonthYear}) ต้องได้รับการยืนยันวันที่บันทึก</div>
              </div>
            </div>

            {/* Step 4.2: Upload File or Paste CSV */}
            <div className={`md:col-span-2 p-5 rounded border flex flex-col space-y-4 ${
              isDark ? 'bg-[#121c27] border-[#2f4358]' : 'bg-white border-slate-300'
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 pb-3">
                <div className="flex items-center space-x-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#008b99] text-white font-bold text-xs">
                    4.2
                  </span>
                  <h3 className="font-bold text-sm text-slate-100">
                    Import Approved OT (นำเข้าข้อมูลการทำงานล่วงเวลา)
                  </h3>
                </div>

                {/* Switcher: File vs Paste */}
                <div className="flex rounded-lg p-0.5 border border-slate-700 bg-slate-900/60 text-xs">
                  <button
                    type="button"
                    onClick={() => setOtImportMethod('file')}
                    className={`px-3 py-1 rounded-md font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      otImportMethod === 'file'
                        ? 'bg-[#008b99] text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>อัปโหลดไฟล์ (.xlsx, .csv)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOtImportMethod('paste')}
                    className={`px-3 py-1 rounded-md font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      otImportMethod === 'paste'
                        ? 'bg-[#008b99] text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>วางข้อความ CSV โดยตรง (Paste CSV)</span>
                  </button>
                </div>
              </div>

              {/* Targets & Scope info */}
              <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
                <span className="px-2.5 py-1 rounded font-bold bg-teal-500/20 text-[#00e5e5] border border-teal-500/40 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>งวดเดือนเป้าหมาย: {otTargetMonthYear}</span>
                </span>
                <span className={`px-2.5 py-1 rounded font-bold border ${
                  selectedOTRate === 3.0 
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                    : 'bg-[#00e5e5]/20 text-[#00e5e5] border-[#00e5e5]/40'
                }`}>
                  อัตรา: OT {selectedOTRate === 3.0 ? '3.0 (Working Hours: OT 3.0)' : '1.5 (Working Hours: OT 1.5)'}
                </span>
                <span className="px-2.5 py-1 rounded font-bold bg-teal-500/20 text-[#00e5e5] border border-teal-500/40 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>โหมด: {otMergeMode === 'smart_merge' ? 'Smart Deduplication' : otMergeMode === 'replace_month' ? 'Replace Month' : 'Append'}</span>
                </span>
              </div>

              {otImportMethod === 'file' ? (
                <div className="flex flex-col items-center justify-center text-center space-y-3 py-4 border border-dashed border-slate-700/80 rounded-lg">
                  <div className="p-3 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/30">
                    <FileCheck2 className="w-7 h-7" />
                  </div>
                  <p className="text-xs text-slate-400 max-w-md">
                    เลือกไฟล์ Excel หรือ CSV ที่มีคอลัมน์ EmpNo, GID, Date, StartTime, EndTime, Hours, Rate, Reason
                  </p>
                  <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
                    <label className="cursor-pointer px-6 py-2.5 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-lg transition flex items-center space-x-2">
                      <Upload className="w-4 h-4" />
                      <span>เลือกไฟล์รายงาน OT {selectedOTRate === 3.0 ? '3.0' : '1.5'} (งวด {otTargetMonthYear})</span>
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
                        className="px-4 py-2.5 rounded font-bold text-xs border border-teal-500/50 text-[#00e5e5] hover:bg-teal-500/10 transition flex items-center space-x-1.5 cursor-pointer"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>รายงานการตรวจสอบ ({latestOTMergeResult.duplicatePreventedCount} รายการ)</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>วางข้อความข้อมูล OT (รูปแบบ CSV หรือคัดลอกจาก Excel / Power BI):</span>
                    <button
                      type="button"
                      onClick={() => {
                        setOtPastedText('EmpNo,GID,Date,StartTime,EndTime,Hours,Rate,Reason,ApprovedBy\n61,Z001RUFB,8/28/2026,17:00,20:30,3.5,1.5,Sample task,Approved');
                      }}
                      className="text-[11px] text-teal-400 hover:underline cursor-pointer"
                    >
                      ใส่ตัวอย่างข้อมูล
                    </button>
                  </div>
                  <textarea
                    rows={6}
                    value={otPastedText}
                    onChange={e => setOtPastedText(e.target.value)}
                    placeholder="วางข้อความที่นี่ เช่น:&#10;EmpNo,GID,Date,StartTime,EndTime,Hours,Rate,Reason,ApprovedBy&#10;61,Z001RUFB,8/28/2026,17:00,20:30,3.5,1.5,W/O: 601768405...,Approved"
                    className={`w-full p-3 rounded-lg font-mono text-xs border outline-none resize-y ${
                      isDark ? 'bg-[#0a121a] border-[#1f3144] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="text-[11px] text-slate-400">
                      {otPastedText.trim() ? `ความยาวข้อความ: ${otPastedText.trim().split('\n').length} แถว` : 'รองรับทั้ง Comma (,) และ Tab (แท็บ) รวมถึงตัวแบ่งวันที่แบบ M/D/YYYY และ D/M/YYYY'}
                    </span>
                    <div className="flex items-center space-x-2">
                      {otPastedText.trim() && (
                        <button
                          type="button"
                          onClick={() => setOtPastedText('')}
                          className="px-3 py-2 rounded text-xs text-slate-400 hover:text-white"
                        >
                          ล้างข้อความ
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleOTTextSubmit}
                        disabled={!otPastedText.trim()}
                        className="px-5 py-2 rounded-lg font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-lg transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-40"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>ตรวจสอบและยืนยันข้อมูล (Parse & Preview)</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
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

            {/* View Mode & Filter & Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-700/40">
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                {/* View Mode Switcher */}
                <div className={`p-0.5 rounded-lg border flex items-center ${
                  isDark ? 'bg-[#0b141d] border-[#223548]' : 'bg-slate-100 border-slate-300'
                }`}>
                  <button
                    type="button"
                    onClick={() => setOtViewMode('employee_summary')}
                    className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                      otViewMode === 'employee_summary'
                        ? 'bg-[#008b99] text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>สรุปรายบุคคล ({otEmployeeSummary.length} คน)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOtViewMode('records')}
                    className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                      otViewMode === 'records'
                        ? 'bg-[#008b99] text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>รายการรายแถว ({otStats.totalCount})</span>
                  </button>
                </div>

                {otViewMode === 'records' && (
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => setOtRateFilter('ALL')}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                        otRateFilter === 'ALL'
                          ? 'bg-[#008b99] text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      ทั้งหมด ({otStats.totalCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setOtRateFilter(1.5)}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                        otRateFilter === 1.5
                          ? 'bg-teal-600 text-white'
                          : 'bg-slate-800 text-teal-400 hover:text-teal-200'
                      }`}
                    >
                      เฉพาะ OT 1.5 ({otStats.count1_5})
                    </button>
                    <button
                      type="button"
                      onClick={() => setOtRateFilter(3.0)}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                        otRateFilter === 3.0
                          ? 'bg-amber-600 text-white'
                          : 'bg-slate-800 text-amber-400 hover:text-amber-200'
                      }`}
                    >
                      เฉพาะ OT 3.0 ({otStats.count3_0})
                    </button>
                  </div>
                )}
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
                {otSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setOtSearchQuery('')}
                    className="absolute right-2 top-2 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Content Table: Employee Summary View OR Raw Records View */}
            {otViewMode === 'employee_summary' ? (
              /* ==================== 1. EMPLOYEE OT SUMMARY TABLE ==================== */
              <div className="overflow-x-auto max-h-80 overflow-y-auto border border-slate-700/50 rounded">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className={`sticky top-0 z-10 text-[11px] ${
                    isDark ? 'bg-[#142230] text-slate-300' : 'bg-slate-100 text-slate-700'
                  }`}>
                    <tr>
                      <th className="p-2 border-b border-slate-700">รหัสพนักงาน / GID</th>
                      <th className="p-2 border-b border-slate-700">ชื่อ - สกุล</th>
                      <th className="p-2 border-b border-slate-700">แผนก</th>
                      <th className="p-2 border-b border-slate-700 text-right">OT 1.5 (ชม.)</th>
                      <th className="p-2 border-b border-slate-700 text-right">OT 3.0 (ชม.)</th>
                      <th className="p-2 border-b border-slate-700 text-right font-bold">รวม OT ทั้งหมด</th>
                      <th className="p-2 border-b border-slate-700 text-center">จำนวนรายการ</th>
                      <th className="p-2 border-b border-slate-700">การตรวจสอบความถูกต้อง (Safety Validation)</th>
                      <th className="p-2 border-b border-slate-700 text-center">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                    {filteredOtEmployeeSummary.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-6 text-center text-slate-400">
                          {monthOTRecords.length === 0
                            ? 'ยังไม่มีข้อมูล Approved OT ในเดือนนี้'
                            : 'ไม่พบพนักงานที่ตรงกับเงื่อนไขการค้นหา'}
                        </td>
                      </tr>
                    ) : (
                      filteredOtEmployeeSummary.map(item => (
                        <tr key={item.empNo} className={`${item.hasAnomaly ? (isDark ? 'bg-amber-950/20' : 'bg-amber-50/60') : ''} ${isDark ? 'hover:bg-[#152332]' : 'hover:bg-slate-50'}`}>
                          <td className="p-2 font-mono font-bold whitespace-nowrap text-teal-300">
                            {item.empNo} {item.gid && <span className="text-slate-400 font-normal">/ {item.gid}</span>}
                          </td>
                          <td className="p-2 whitespace-nowrap text-slate-200 font-medium">
                            {item.name}
                          </td>
                          <td className="p-2 whitespace-nowrap">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                              {item.department}
                            </span>
                          </td>
                          <td className="p-2 text-right font-mono text-[#00e5e5]">
                            {item.hours1_5.toFixed(1)} <span className="text-[10px] text-slate-400 font-normal">({item.count1_5})</span>
                          </td>
                          <td className="p-2 text-right font-mono text-amber-300">
                            {item.hours3_0.toFixed(1)} <span className="text-[10px] text-slate-400 font-normal">({item.count3_0})</span>
                          </td>
                          <td className="p-2 text-right font-mono font-bold whitespace-nowrap">
                            <span className={item.totalHours > 60 ? 'text-amber-400 font-extrabold text-sm' : 'text-emerald-400 text-sm'}>
                              {item.totalHours.toFixed(1)} ชม.
                            </span>
                          </td>
                          <td className="p-2 text-center font-mono whitespace-nowrap">
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                              {item.records.length} รายการ
                            </span>
                          </td>
                          <td className="p-2">
                            {item.hasAnomaly ? (
                              <div className="space-y-0.5">
                                {item.anomalyReasons.map((reason, idx) => (
                                  <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 mr-1 mb-0.5">
                                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                                    <span>{reason}</span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span>ปกติ</span>
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center space-x-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setOtSearchQuery(item.empNo);
                                  setOtViewMode('records');
                                }}
                                className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-teal-300 text-[10px] font-bold transition cursor-pointer"
                                title="ดูรายการย่อยทั้งหมดของพนักงานคนนี้"
                              >
                                ดูรายการ ({item.records.length})
                              </button>
                              <button
                                type="button"
                                onClick={() => setEmployeeOTToDelete({ empNo: item.empNo, name: item.name })}
                                className="p-1 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded transition cursor-pointer"
                                title="ลบข้อมูล OT ทั้งหมดของพนักงานคนนี้ในเดือนนี้ (แก้ปัญหาข้อผิดพลาดรายบุคคล)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              /* ==================== 2. RAW RECORDS TABLE ==================== */
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
                            <div className="text-[10px] text-slate-400 truncate max-w-[140px]">
                              {emp ? `${emp.firstName || ''} ${emp.familyName || ''}`.trim() || '-' : '-'}
                            </div>
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
            )}
          </div>
        </div>
        )
      )}

      {/* TAB 5: Other Allowances (Company-Wide ALL) */}
      {activeImportTab === 'allowances' && (
        !isAdmin ? (
          renderAdminOnlyRestriction('5. Other Allowances', 'เบี้ยเลี้ยงและรายได้เสริม')
        ) : (
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

          {/* ========================================================================= */}
          {/* IMPORTED ALLOWANCES INSPECTION & SUMMARY TABLE */}
          {/* ========================================================================= */}
          <div className={`p-4 rounded border text-xs space-y-3.5 ${
            isDark ? 'bg-[#0e1722] border-[#223548]' : 'bg-white border-slate-200'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/60 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-[#00e5e5]" />
                  <span>รายการเบี้ยเลี้ยงและรายได้เสริมที่บันทึกแล้วในระบบ (งวด {importMonthYear})</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  ตรวจสอบรายการ Team Emergency, Shift Allowance, และ Standby ที่เชื่อมโยงเข้า Time Sheet และ Payroll
                </p>
              </div>

              <div className="flex items-center space-x-2">
                {monthAllowances.length > 0 && (
                  <>
                    {confirmClearMonthAllowances ? (
                      <div className="flex items-center space-x-1.5 p-1 rounded bg-red-950/40 border border-red-500/40">
                        <span className="text-[11px] text-red-300 font-bold px-1">ยืนยันล้างเบี้ยเลี้ยงเดือน {importMonthYear}?</span>
                        <button
                          type="button"
                          onClick={handleClearMonthAllowances}
                          className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-bold text-[11px] cursor-pointer"
                        >
                          ใช่, ลบทั้งหมด
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmClearMonthAllowances(false)}
                          className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-[11px] cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmClearMonthAllowances(true)}
                        className="flex items-center space-x-1 px-2.5 py-1.5 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 text-[11px] cursor-pointer transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>ล้างเบี้ยเลี้ยงเดือนนี้ ({monthAllowances.length} รายการ)</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* KPI Summary Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className={`p-2.5 rounded border ${
                isDark ? 'bg-[#14202c] border-[#22364a]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-[10px] text-slate-400">พนักงานที่มีเบี้ยเลี้ยง</div>
                <div className="text-base font-bold font-mono text-white mt-0.5">
                  {allowanceStats.uniqueEmployeesCount} <span className="text-xs font-normal text-slate-400">คน</span>
                </div>
                <div className="text-[10px] text-slate-400">
                  รวม {allowanceStats.count} รายการ
                </div>
              </div>

              <div className={`p-2.5 rounded border ${
                isDark ? 'bg-teal-950/20 border-teal-800/40' : 'bg-teal-50 border-teal-200'
              }`}>
                <div className="text-[10px] text-teal-400 font-bold">Team Emergency</div>
                <div className="text-base font-bold font-mono text-[#00e5e5] mt-0.5">
                  ฿{allowanceStats.totalEmergency.toLocaleString()}
                </div>
                <div className="text-[10px] text-teal-400/80">
                  เบี้ยเลี้ยงทีมฉุกเฉิน
                </div>
              </div>

              <div className={`p-2.5 rounded border ${
                isDark ? 'bg-blue-950/20 border-blue-800/40' : 'bg-blue-50 border-blue-200'
              }`}>
                <div className="text-[10px] text-blue-400 font-bold">Shift Allowance</div>
                <div className="text-base font-bold font-mono text-blue-300 mt-0.5">
                  ฿{allowanceStats.totalShift.toLocaleString()}
                </div>
                <div className="text-[10px] text-blue-400/80">
                  ค่ากะทำงานพิเศษ
                </div>
              </div>

              <div className={`p-2.5 rounded border ${
                isDark ? 'bg-amber-950/20 border-amber-800/40' : 'bg-amber-50 border-amber-200'
              }`}>
                <div className="text-[10px] text-amber-400 font-bold">Standby Allowance</div>
                <div className="text-base font-bold font-mono text-amber-300 mt-0.5">
                  ฿{allowanceStats.totalStandby.toLocaleString()}
                </div>
                <div className="text-[10px] text-amber-400/80">
                  ค่าเตรียมพร้อมสแตนด์บาย
                </div>
              </div>

              <div className={`p-2.5 rounded border col-span-2 sm:col-span-1 ${
                isDark ? 'bg-emerald-950/20 border-emerald-800/40' : 'bg-emerald-50 border-emerald-200'
              }`}>
                <div className="text-[10px] text-emerald-400 font-bold">ยอดรวมเบี้ยเลี้ยงทั้งสิ้น</div>
                <div className="text-base font-bold font-mono text-emerald-300 mt-0.5">
                  ฿{allowanceStats.grandTotal.toLocaleString()}
                </div>
                <div className="text-[10px] text-emerald-400/80">
                  นำส่งคำนวณใน Payroll
                </div>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-xs text-slate-400">
                แสดงข้อมูล {filteredMonthAllowances.length} จาก {monthAllowances.length} รายการ
              </span>

              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="ค้นหา EmpNo, GID, ชื่อ, หมายเหตุ..."
                  value={allowanceSearchQuery}
                  onChange={e => setAllowanceSearchQuery(e.target.value)}
                  className={`w-full pl-8 pr-3 py-1.5 rounded border text-xs outline-none ${
                    isDark ? 'bg-[#152332] border-[#29425c] text-white' : 'bg-slate-50 border-slate-300'
                  }`}
                />
                {allowanceSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setAllowanceSearchQuery('')}
                    className="absolute right-2 top-2 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Allowances Table */}
            <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-700/50 rounded">
              <table className="w-full text-left text-xs border-collapse">
                <thead className={`sticky top-0 z-10 text-[11px] ${
                  isDark ? 'bg-[#142230] text-slate-300' : 'bg-slate-100 text-slate-700'
                }`}>
                  <tr>
                    <th className="p-2 border-b border-slate-700">รหัสพนักงาน / GID</th>
                    <th className="p-2 border-b border-slate-700">ชื่อ - สกุล</th>
                    <th className="p-2 border-b border-slate-700">แผนก</th>
                    <th className="p-2 border-b border-slate-700 text-right">Team Emergency (฿)</th>
                    <th className="p-2 border-b border-slate-700 text-right">Shift Allowance (฿)</th>
                    <th className="p-2 border-b border-slate-700 text-right">Standby (฿)</th>
                    <th className="p-2 border-b border-slate-700 text-right font-bold">รวม (฿)</th>
                    <th className="p-2 border-b border-slate-700">หมายเหตุ (Remark)</th>
                    <th className="p-2 border-b border-slate-700 text-center">จัดการ</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                  {filteredMonthAllowances.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-6 text-center text-slate-400">
                        {monthAllowances.length === 0
                          ? `ยังไม่มีข้อมูลเบี้ยเลี้ยงในงวด ${importMonthYear} (ดาวน์โหลด Template และอัปโหลดไฟล์ในขั้นตอนด้านบน)`
                          : 'ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา'}
                      </td>
                    </tr>
                  ) : (
                    filteredMonthAllowances.map(a => {
                      const emp = employees.find(e => e.empNo === a.empNo || e.gid === a.gid);
                      const name = emp ? `${emp.firstName || ''} ${emp.familyName || ''}`.trim() : (a.empNo || '-');
                      const dept = emp ? emp.department : '-';
                      const rowTotal = (a.teamEmergency || 0) + (a.shiftAllowance || 0) + (a.standbyAllowance || 0);

                      return (
                        <tr key={a.id} className={isDark ? 'hover:bg-[#152332]' : 'hover:bg-slate-50'}>
                          <td className="p-2 font-mono font-bold whitespace-nowrap text-teal-300">
                            {a.empNo} {a.gid && <span className="text-slate-400 font-normal">/ {a.gid}</span>}
                          </td>
                          <td className="p-2 whitespace-nowrap text-slate-200 font-medium">
                            {name}
                          </td>
                          <td className="p-2 whitespace-nowrap">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                              {dept}
                            </span>
                          </td>
                          <td className="p-2 text-right font-mono text-teal-300">
                            {(a.teamEmergency || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-right font-mono text-blue-300">
                            {(a.shiftAllowance || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-right font-mono text-amber-300">
                            {(a.standbyAllowance || 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                            ฿{rowTotal.toLocaleString()}
                          </td>
                          <td className="p-2 text-[11px] text-slate-300 max-w-xs truncate" title={a.remark}>
                            {a.remark || '-'}
                          </td>
                          <td className="p-2 text-center whitespace-nowrap">
                            {deleteAllowanceConfirmId === a.id ? (
                              <div className="inline-flex items-center space-x-1">
                                <span className="text-[10px] text-red-400 font-bold">ลบ?</span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAllowanceRecord(a.id)}
                                  className="px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-bold"
                                >
                                  ใช่
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteAllowanceConfirmId(null)}
                                  className="px-1.5 py-0.5 bg-slate-600 hover:bg-slate-700 text-white rounded text-[10px] font-bold"
                                >
                                  ยกเลิก
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setDeleteAllowanceConfirmId(a.id)}
                                className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition"
                                title="ลบรายการเบี้ยเลี้ยงนี้"
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
        )
      )}
        </div>
      </div>

      {/* OT Pre-Import Month & Data Verification Modal */}
      {pendingOTImport && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-xs overflow-y-auto">
          <div className={`w-full max-w-xl rounded-xl border shadow-2xl p-5 sm:p-6 ${
            isDark ? 'bg-[#121f2d] border-[#29425c] text-white' : 'bg-white border-slate-300 text-slate-900'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-lg bg-teal-500/20 text-[#00e5e5] border border-teal-500/30">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                    <span>ยืนยันงวดเดือนและการนำเข้าข้อมูล Approved OT</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    โปรดยืนยันงวดเดือนที่จะบันทึกชั่วโมงลงใน Time Sheet สำหรับการทำย้อนหลัง
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setPendingOTImport(null)} 
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                disabled={isExecutingOTImport}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* File & Detection Summary */}
            {(() => {
              const safeTargetMonth = /^\d{4}-\d{2}$/.test(otTargetMonthYear)
                ? otTargetMonthYear
                : (/^\d{4}-\d{2}$/.test(pendingOTImport.detectedMonth) ? pendingOTImport.detectedMonth : selectedMonthYear);

              return (
                <div className="mt-4 space-y-3">
                  <div className={`p-3 rounded-lg border text-xs space-y-2 ${
                    isDark ? 'bg-[#0a121a] border-[#1d2f40]' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-400">ไฟล์ที่เลือก:</span>
                      <span className="font-mono font-bold text-teal-300 truncate max-w-xs">{pendingOTImport.fileName}</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-400">จำนวนแถวข้อมูล:</span>
                      <span className="font-mono font-bold text-slate-200">{pendingOTImport.totalRows} รายการ</span>
                    </div>
                    {pendingOTImport.detectedMonth && /^\d{4}-\d{2}$/.test(pendingOTImport.detectedMonth) && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800">
                        <span className="text-slate-400">งวดเดือนที่ตรวจพบในไฟล์:</span>
                        <span className="font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                          📅 {pendingOTImport.detectedMonth}
                        </span>
                      </div>
                    )}
                    {pendingOTImport.sampleDates.length > 0 && (
                      <div className="text-[10px] text-slate-400">
                        ตัวอย่างวันที่ในไฟล์: <span className="font-mono text-slate-300">{pendingOTImport.sampleDates.slice(0, 4).join(', ')}</span>
                      </div>
                    )}
                  </div>

                  {/* Target Month Selector Box */}
                  <div className={`p-3.5 rounded-lg border space-y-2.5 ${
                    isDark ? 'bg-[#162638] border-teal-500/40' : 'bg-teal-50/70 border-teal-300'
                  }`}>
                    <label className="font-bold text-xs flex items-center justify-between text-[#00e5e5]">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" />
                        <span>เลือกงวดเดือนที่จะบันทึกลง Time Sheet (Target Month):</span>
                      </span>
                      <span className="text-[10px] text-amber-300 font-semibold">*ตรวจสอบให้ตรงกับงวดที่ทำย้อนหลัง</span>
                    </label>

                    <input
                      type="month"
                      value={safeTargetMonth}
                      onChange={e => {
                        if (e.target.value && /^\d{4}-\d{2}$/.test(e.target.value)) {
                          setOtTargetMonthYear(e.target.value);
                        }
                      }}
                      className={`w-full p-2 rounded-lg text-base font-mono font-bold border outline-none cursor-pointer ${
                        isDark ? 'bg-[#0d1620] border-[#29425c] text-[#00e5e5]' : 'bg-white border-slate-300 text-slate-900'
                      }`}
                    />

                    {/* Quick Selection Buttons */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {pendingOTImport.detectedMonth && /^\d{4}-\d{2}$/.test(pendingOTImport.detectedMonth) && pendingOTImport.detectedMonth !== safeTargetMonth && (
                        <button
                          type="button"
                          onClick={() => setOtTargetMonthYear(pendingOTImport.detectedMonth)}
                          className="px-2.5 py-1 rounded text-[11px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition cursor-pointer flex items-center gap-1"
                        >
                          <span>ใช้วันที่ตรวจพบในไฟล์: {pendingOTImport.detectedMonth}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setOtTargetMonthYear(getPrevMonthStr(selectedMonthYear))}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold border transition cursor-pointer flex items-center gap-1 ${
                          safeTargetMonth === getPrevMonthStr(selectedMonthYear)
                            ? 'bg-teal-500/30 text-[#00e5e5] border-[#00e5e5]'
                            : 'bg-slate-700/50 hover:bg-slate-700 text-slate-300 border-slate-600'
                        }`}
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>เดือนที่แล้ว: {getPrevMonthStr(selectedMonthYear)} (แนะนำ)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setOtTargetMonthYear(selectedMonthYear)}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold border transition cursor-pointer flex items-center gap-1 ${
                          safeTargetMonth === selectedMonthYear
                            ? 'bg-blue-500/30 text-blue-300 border-blue-400'
                            : 'bg-slate-700/50 hover:bg-slate-700 text-slate-300 border-slate-600'
                        }`}
                      >
                        <span>เดือนปัจจุบัน: {selectedMonthYear}</span>
                      </button>
                    </div>
                  </div>

                  {/* Rate & Mode Summary */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className={`p-2.5 rounded border ${
                      isDark ? 'bg-[#0e1722] border-[#223548]' : 'bg-slate-50 border-slate-200'
                    }`}>
                      <span className="text-slate-400 block text-[10px]">อัตราค่าล่วงเวลา (Rate):</span>
                      <span className={`font-bold mt-0.5 block ${selectedOTRate === 3.0 ? 'text-amber-300' : 'text-[#00e5e5]'}`}>
                        OT {selectedOTRate === 3.0 ? '3.0 (วันหยุด / 3 เท่า)' : '1.5 (วันปกติ / 1.5 เท่า)'}
                      </span>
                    </div>
                    <div className={`p-2.5 rounded border ${
                      isDark ? 'bg-[#0e1722] border-[#223548]' : 'bg-slate-50 border-slate-200'
                    }`}>
                      <span className="text-slate-400 block text-[10px]">ระบบป้องกันซ้ำ (Deduplication):</span>
                      <span className="font-bold text-teal-300 mt-0.5 block">
                        {otMergeMode === 'smart_merge' ? 'Smart Deduplication' : otMergeMode === 'replace_month' ? 'Replace Month' : 'Append All'}
                      </span>
                    </div>
                  </div>

                  {/* Force Target Month Policy Banner */}
                  <div className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                    isDark ? 'bg-[#0d1722] border-teal-500/40' : 'bg-teal-50/80 border-teal-300'
                  }`}>
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#00e5e5] shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-slate-200 block text-xs">
                          นโยบายบังคับงวดเดือน: นำเข้าข้อมูลทุกรายการในไฟล์ ({pendingOTImport.totalRows} รายการ) ลงในงวด {safeTargetMonth} เท่านั้น 100%
                        </span>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          ข้อมูลทั้งหมดในไฟล์จะถูกจัดเก็บและคำนวณสะสมใน Time Sheet ของงวด <strong>{safeTargetMonth}</strong> โดยตรง (คงวันที่ตามวันของรายการ เช่น วันที่ 30 ลงวันที่ 30-{safeTargetMonth}) พร้อมจัดเก็บประวัติวันที่เดิม (Original Date) ในระบบเพื่อการตรวจสอบ
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className={`p-2.5 rounded border text-[11px] leading-relaxed flex items-start space-x-2 ${
                    isDark ? 'bg-teal-950/20 border-teal-500/30 text-teal-200/90' : 'bg-teal-50 border-teal-200 text-teal-900'
                  }`}>
                    <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                    <div>
                      เมื่อยืนยัน ระบบจะนำเข้ารายการ OT เข้าสู่งวดเดือน <strong>{safeTargetMonth}</strong> ครบทุกรายการทันที พร้อมระบบ Smart Deduplication ป้องกันการบันทึกชั่วโมงซ้ำซ้อน
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Actions */}
            <div className="flex items-center justify-end space-x-2.5 pt-4 border-t border-slate-700/60 mt-4">
              <button
                type="button"
                onClick={() => setPendingOTImport(null)}
                disabled={isExecutingOTImport}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                ยกเลิก (Cancel)
              </button>
              <button
                type="button"
                onClick={() => {
                  const safeTargetMonth = /^\d{4}-\d{2}$/.test(otTargetMonthYear)
                    ? otTargetMonthYear
                    : (/^\d{4}-\d{2}$/.test(pendingOTImport.detectedMonth) ? pendingOTImport.detectedMonth : selectedMonthYear);
                  executeOTImport(safeTargetMonth);
                }}
                disabled={isExecutingOTImport}
                className="px-6 py-2.5 rounded-lg text-xs font-bold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-lg transition flex items-center space-x-2 cursor-pointer disabled:opacity-50"
              >
                {isExecutingOTImport ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>กำลังนำเข้าข้อมูล...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>ยืนยันและนำเข้าข้อมูลสู่งวด {/^\d{4}-\d{2}$/.test(otTargetMonthYear) ? otTargetMonthYear : pendingOTImport.detectedMonth}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
      {showOTMergeModal && latestOTMergeResult && (
        <OTDeduplicationModal
          isOpen={showOTMergeModal}
          onClose={() => setShowOTMergeModal(false)}
          result={latestOTMergeResult}
          isDark={isDark}
          selectedMonthYear={importMonthYear}
          selectedRate={selectedOTRate}
        />
      )}

      {/* Employee Specific OT Deletion Modal (Solves ID 61 mistake safely) */}
      {employeeOTToDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className={`w-full max-w-md rounded-xl border p-5 shadow-2xl space-y-4 ${
            isDark ? 'bg-[#121f2d] border-[#29425c] text-white' : 'bg-white border-slate-300 text-slate-900'
          }`}>
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-red-400">
                  ยืนยันการลบข้อมูล OT รายบุคคล
                </h3>
                <p className="text-xs text-slate-400">
                  ลบเฉพาะพนักงานที่มีปัญหา โดยไม่กระทบพนักงานคนอื่น
                </p>
              </div>
            </div>

            <div className={`p-3 rounded-lg border text-xs space-y-1.5 ${
              isDark ? 'bg-[#0a121a] border-[#1d2f40]' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex justify-between">
                <span className="text-slate-400">รหัสพนักงาน:</span>
                <span className="font-mono font-bold text-teal-300">{employeeOTToDelete.empNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">ชื่อ - นามสกุล:</span>
                <span className="font-bold text-slate-200">{employeeOTToDelete.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">งวดเดือน:</span>
                <span className="font-mono font-bold text-amber-300">{importMonthYear}</span>
              </div>
            </div>

            <p className="text-[11px] text-amber-300/90 leading-relaxed">
              การลบนี้จะล้างรายการ OT ทั้งหมดของพนักงานคนนี้ในงวดเดือน <strong>{importMonthYear}</strong> ออกจากระบบ Time Sheet ทันที หลังจากนั้นท่านสามารถนำเข้าไฟล์ใหม่ที่ถูกต้องได้ตามปกติ
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-700/60">
              <button
                type="button"
                onClick={() => setEmployeeOTToDelete(null)}
                className="px-4 py-2 rounded text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => handleDeleteEmployeeOT(employeeOTToDelete.empNo)}
                className="px-4 py-2 rounded text-xs font-bold bg-red-600 hover:bg-red-500 text-white shadow cursor-pointer"
              >
                ยืนยันลบข้อมูล OT ของคนนี้
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
