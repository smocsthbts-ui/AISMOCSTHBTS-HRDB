import React, { useState, useMemo, useRef } from 'react';
import { 
  Employee, 
  ShiftCode, 
  DailyShiftPlan, 
  UserAccount 
} from '../types';
import { 
  Calendar, 
  Upload, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  AlertTriangle, 
  Building2, 
  Users, 
  Clock, 
  FileSpreadsheet, 
  ArrowRight, 
  ShieldCheck, 
  RefreshCw,
  HelpCircle,
  FileText,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  CalendarDays
} from 'lucide-react';
import { storage } from '../utils/storage';
import { 
  validateAndParseShiftPlan, 
  generateShiftPlanTemplate, 
  downloadBlob, 
  downloadWorkbook,
  parseSheetToRows, 
  readFileAsArrayBuffer 
} from '../utils/fileParser';

const MONTH_NAMES_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];
const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function formatMonthLabel(my: string): { en: string; th: string; full: string; shortTh: string } {
  const parts = my.split('-');
  if (parts.length !== 2) return { en: my, th: my, full: my, shortTh: my };
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return { en: my, th: my, full: my, shortTh: my };
  const thaiYear = year + 543;
  const shortThaiYear = String(thaiYear).slice(-2);
  const shortThMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const en = `${MONTH_NAMES_EN[month - 1]} ${year}`;
  const th = `${MONTH_NAMES_TH[month - 1]} ${thaiYear}`;
  const shortTh = `${shortThMonths[month - 1]} ${shortThaiYear}`;
  return { en, th, full: `${en} (${th})`, shortTh };
}

function shiftMonth(my: string, offset: number): string {
  const parts = my.split('-');
  if (parts.length !== 2) return my;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(y) || isNaN(m)) return my;
  const d = new Date(y, m - 1 + offset, 1);
  const ny = d.getFullYear();
  const nm = String(d.getMonth() + 1).padStart(2, '0');
  return `${ny}-${nm}`;
}

interface UploadShiftPlanViewProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  selectedMonthYear: string;
  onSelectMonthYear: (my: string) => void;
  selectedDepartment: string;
  onSelectDepartment: (dept: string) => void;
  employees: Employee[];
  shiftCodes: ShiftCode[];
  shiftPlans: DailyShiftPlan[];
  onDataImported: () => void;
  onNavigateToRoster: () => void;
}

export const UploadShiftPlanView: React.FC<UploadShiftPlanViewProps> = ({
  currentUser,
  theme,
  selectedMonthYear,
  onSelectMonthYear,
  selectedDepartment,
  onSelectDepartment,
  employees,
  shiftCodes,
  shiftPlans,
  onDataImported,
  onNavigateToRoster,
}) => {
  const isDark = theme === 'dark';
  const isAdmin = currentUser.role === 'Admin';

  // Target Department for Shift Plan Upload
  // Default to user's assigned department if not Admin, or currently selected department
  const [targetDept, setTargetDept] = useState<string>(() => {
    if (!isAdmin && currentUser.department && currentUser.department !== 'ALL') {
      return currentUser.department;
    }
    return selectedDepartment !== 'ALL' ? selectedDepartment : 'RS';
  });

  // Target Month-Year for upload
  const [targetMonthYear, setTargetMonthYear] = useState<string>(selectedMonthYear);

  const monthInputRef = useRef<HTMLInputElement>(null);

  // Keep targetMonthYear synchronized if selectedMonthYear changes externally
  const handleSelectPeriod = (newMY: string) => {
    setTargetMonthYear(newMY);
    onSelectMonthYear(newMY);
  };

  // Base current month reference
  const baseMonth = '2026-05';

  // Drag & drop highlight state
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Status and validation feedback
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
    details?: string[];
  } | null>(null);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Active employees in target department
  const targetEmployees = useMemo(() => {
    if (targetDept === 'ALL') {
      return employees.filter(e => e.isActive !== false);
    }
    return employees.filter(e => e.department === targetDept && e.isActive !== false);
  }, [employees, targetDept]);

  // Shift codes available for target department
  const applicableShiftCodes = useMemo(() => {
    return shiftCodes.filter(sc => sc.department === 'ALL' || sc.department === targetDept);
  }, [shiftCodes, targetDept]);

  // Summary of uploaded months specifically for the target department
  const deptExistingMonthCounts = useMemo(() => {
    const empNos = new Set(targetEmployees.map(e => e.empNo));
    const counts: Record<string, number> = {};
    shiftPlans.forEach(p => {
      if (empNos.has(p.empNo) && p.date && p.date.length >= 7) {
        const my = p.date.substring(0, 7);
        counts[my] = (counts[my] || 0) + 1;
      }
    });
    return counts;
  }, [shiftPlans, targetEmployees]);

  // All unique months present across the system
  const allCompanyMonths = useMemo(() => {
    const set = new Set<string>();
    shiftPlans.forEach(p => {
      if (p.date && p.date.length >= 7) {
        set.add(p.date.substring(0, 7));
      }
    });
    return set;
  }, [shiftPlans]);

  // Construct comprehensive list of period options
  const periodOptions = useMemo(() => {
    const monthsSet = new Set<string>();

    // Advance planning future months (up to +7 months)
    for (let i = 7; i >= 1; i--) {
      monthsSet.add(shiftMonth(baseMonth, i));
    }
    // Base month
    monthsSet.add(baseMonth);
    // Past months (up to -6 months)
    for (let i = 1; i <= 6; i++) {
      monthsSet.add(shiftMonth(baseMonth, -i));
    }

    // Add any months that exist in shiftPlans or currently selected
    allCompanyMonths.forEach(m => monthsSet.add(m));
    if (targetMonthYear) monthsSet.add(targetMonthYear);
    if (selectedMonthYear) monthsSet.add(selectedMonthYear);

    const sorted = Array.from(monthsSet).sort().reverse();

    return sorted.map(my => {
      const { full, en, shortTh } = formatMonthLabel(my);
      const shiftCount = deptExistingMonthCounts[my] || 0;
      let isAdvance = my > baseMonth;

      let dataTag = '';
      if (shiftCount > 0) {
        dataTag = ` ✓ (มีข้อมูลแล้ว ${shiftCount} กะ)`;
      }

      return {
        value: my,
        label: `${full}${dataTag}`,
        shortLabel: en,
        shortTh,
        shiftCount,
        isAdvance,
      };
    });
  }, [baseMonth, allCompanyMonths, targetMonthYear, selectedMonthYear, deptExistingMonthCounts]);

  // Pre-uploaded advance periods (months > baseMonth that have shiftCount > 0)
  const advanceUploadedMonths = useMemo(() => {
    return periodOptions.filter(o => o.isAdvance && o.shiftCount > 0);
  }, [periodOptions]);

  // Existing plans for target department & month
  const targetExistingPlans = useMemo(() => {
    const empNos = new Set(targetEmployees.map(e => e.empNo));
    return shiftPlans.filter(p => empNos.has(p.empNo) && p.date.startsWith(targetMonthYear));
  }, [shiftPlans, targetEmployees, targetMonthYear]);

  // Stats calculation
  const planStats = useMemo(() => {
    const scheduledEmpNos = new Set(targetExistingPlans.map(p => p.empNo));
    const codeCounts: Record<string, number> = {};
    targetExistingPlans.forEach(p => {
      codeCounts[p.shiftCode] = (codeCounts[p.shiftCode] || 0) + 1;
    });

    return {
      totalEmployees: targetEmployees.length,
      scheduledEmployees: scheduledEmpNos.size,
      totalShiftDays: targetExistingPlans.length,
      codeCounts,
    };
  }, [targetEmployees, targetExistingPlans]);

  // Handler to download Excel (.xlsx) Template
  const handleDownloadExcelTemplate = () => {
    const { workbook } = generateShiftPlanTemplate(targetDept, targetMonthYear, employees);
    downloadWorkbook(workbook, `ShiftPlan_${targetDept}_${targetMonthYear}.xlsx`);
  };

  // Handler to download CSV Template
  const handleDownloadCsvTemplate = () => {
    const { csvContent } = generateShiftPlanTemplate(targetDept, targetMonthYear, employees);
    downloadBlob(csvContent, `ShiftPlan_${targetDept}_${targetMonthYear}.csv`, 'text/csv;charset=utf-8;');
  };

  // Process File
  const processUploadedFile = async (file: File) => {
    setStatusMessage(null);
    setIsProcessing(true);

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const rawRows = parseSheetToRows(buffer);

      const result = validateAndParseShiftPlan(
        rawRows,
        targetMonthYear,
        targetDept,
        employees,
        shiftCodes,
        currentUser.email
      );

      if (!result.valid) {
        setStatusMessage({
          type: 'error',
          text: `Validation Failed (พบข้อผิดพลาดในการตรวจสอบไฟล์ ${result.errors.length} รายการ)`,
          details: result.errors,
        });
        setIsProcessing(false);
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

      // Keep global month-year and department in sync
      onSelectMonthYear(targetMonthYear);
      if (targetDept !== 'ALL') {
        onSelectDepartment(targetDept);
      }

      setStatusMessage({
        type: result.warnings.length > 0 ? 'warning' : 'success',
        text: `Upload Successful (อัปโหลดตารางกะสำเร็จ)! Imported ${result.plans.length} shift entries for ${result.matchedEmployeesCount} employees in department ${targetDept} (${targetMonthYear}).`,
        details: result.warnings.length > 0 ? result.warnings : undefined,
      });

      onDataImported();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `Upload failed (ไม่สามารถประมวลผลไฟล์ได้): ${err.message || 'File format invalid'}`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processUploadedFile(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processUploadedFile(file);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* 1. Header Banner */}
      <div className={`p-4 sm:p-5 rounded-lg border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
        isDark ? 'bg-[#0f1722] border-[#223548]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="flex items-start space-x-3.5">
          <div className="p-3 rounded-lg bg-teal-500/10 text-[#00e5e5] border border-teal-500/30 shrink-0">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-bold text-slate-100">
                Upload Shift Plan (อัปโหลดตารางกะรายแผนก)
              </h1>
              <span className="text-[11px] px-2 py-0.5 rounded font-mono font-bold bg-[#008b99]/20 text-[#00e5e5] border border-[#008b99]/30">
                Excel / CSV
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-3xl">
              Dedicated module for department planners to upload monthly shift rosters. Every upload is department-isolated and can be revised continuously throughout the month without affecting other divisions.
            </p>
          </div>
        </div>

        <button
          id="btn-goto-roster"
          onClick={onNavigateToRoster}
          className="flex items-center space-x-2 px-3.5 py-2 rounded text-xs font-semibold bg-[#1a2838] hover:bg-[#223549] text-teal-300 border border-teal-500/30 transition shadow-xs shrink-0"
        >
          <Calendar className="w-4 h-4 text-teal-400" />
          <span>View Shift Roster (ดูตารางกะ)</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 2. Department & Period Target Configuration */}
      <div className={`p-4 rounded-lg border space-y-3 ${
        isDark ? 'bg-[#131f2d] border-[#25394d]' : 'bg-slate-50 border-slate-300 shadow-xs'
      }`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-teal-400 flex items-center gap-1.5">
            <Building2 className="w-4 h-4" />
            <span>Target Department & Period Configuration (กำหนดแผนกและงวดเดือนที่ต้องการอัปโหลด)</span>
          </span>
          {!isAdmin && (
            <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-teal-500/10 text-teal-300 border border-teal-500/30 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Authorized Department: {currentUser.department}</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
          {/* Department Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1">
              <span>Department (แผนก):</span>
              <span className="text-red-400">*</span>
            </label>
            <select
              id="select-upload-target-dept"
              value={targetDept}
              onChange={(e) => setTargetDept(e.target.value)}
              disabled={!isAdmin && currentUser.department !== 'ALL'}
              className={`w-full px-3 py-2 rounded border text-xs font-medium focus:ring-1 focus:ring-teal-400 outline-none ${
                isDark 
                  ? 'bg-[#0a121a] border-[#29425c] text-white' 
                  : 'bg-white border-slate-300 text-slate-900'
              } ${!isAdmin && currentUser.department !== 'ALL' ? 'opacity-80 cursor-not-allowed' : ''}`}
            >
              {isAdmin && <option value="ALL">ALL Departments (ทุกแผนก)</option>}
              {storage.getDepartments().map(d => (
                <option key={d.code} value={d.code}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Target active staff: <strong className="text-teal-400">{targetEmployees.length} employees</strong> in {targetDept}
            </p>
          </div>

          {/* Period Selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1">
                <span>Target Period (งวดเดือน):</span>
                <span className="text-red-400">*</span>
              </label>
            </div>

            {/* Easy-to-click Period Control Bar */}
            <div className="flex items-center space-x-1">
              <button
                type="button"
                id="btn-prev-month"
                onClick={() => handleSelectPeriod(shiftMonth(targetMonthYear, -1))}
                title="เลือกเดือนก่อนหน้า"
                className={`p-2 rounded border transition cursor-pointer flex items-center justify-center shrink-0 ${
                  isDark 
                    ? 'bg-[#0a121a] hover:bg-[#1a2838] border-[#29425c] text-slate-300' 
                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="relative flex-1 min-w-0">
                <select
                  id="select-upload-target-period"
                  value={targetMonthYear}
                  onChange={(e) => handleSelectPeriod(e.target.value)}
                  className={`w-full px-2.5 py-2 rounded border text-xs font-semibold focus:ring-1 focus:ring-teal-400 outline-none cursor-pointer truncate ${
                    isDark 
                      ? 'bg-[#0a121a] border-[#29425c] text-white' 
                      : 'bg-white border-slate-300 text-slate-900'
                  }`}
                >
                  {periodOptions.map(p => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                id="btn-next-month"
                onClick={() => handleSelectPeriod(shiftMonth(targetMonthYear, 1))}
                title="เลือกเดือนถัดไป ()"
                className={`p-2 rounded border transition cursor-pointer flex items-center justify-center shrink-0 ${
                  isDark 
                    ? 'bg-[#0a121a] hover:bg-[#1a2838] border-[#29425c] text-slate-300' 
                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                }`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                id="btn-open-native-calendar"
                onClick={() => {
                  try {
                    monthInputRef.current?.showPicker();
                  } catch {
                    monthInputRef.current?.focus();
                  }
                }}
                title="เปิดปฏิทินเลือกงวดเดือน (Calendar Picker)"
                className={`p-2 rounded border transition cursor-pointer flex items-center justify-center shrink-0 ${
                  isDark
                    ? 'bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border-teal-500/30'
                    : 'bg-teal-50 hover:bg-teal-100 text-teal-700 border-teal-300'
                }`}
              >
                <CalendarDays className="w-4 h-4 text-teal-400" />
              </button>

              <input
                ref={monthInputRef}
                id="input-upload-target-month-hidden"
                type="month"
                value={targetMonthYear}
                onChange={(e) => e.target.value && handleSelectPeriod(e.target.value)}
                className="sr-only"
                tabIndex={-1}
              />
            </div>

            <p className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
              <span>เลือกจากรายการ หรือกด ◀ ▶</span>
              <span className="font-mono text-teal-400 font-bold">{targetMonthYear}</span>
            </p>
          </div>

          {/* Roster Status Summary for Target Selection */}
          <div className={`p-2.5 rounded border flex flex-col justify-center text-xs ${
            isDark ? 'bg-[#0c1520] border-[#1d2d3e]' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between text-slate-300 mb-1">
              <span>Scheduled Staff (จัดกะแล้ว):</span>
              <span className="font-mono font-bold text-teal-400">
                {planStats.scheduledEmployees} / {planStats.totalEmployees} คน
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span>Total Shift Days (จำนวนกะในเดือนนี้):</span>
              <span className="font-mono font-bold text-emerald-400">
                {planStats.totalShiftDays} รายการ
              </span>
            </div>
          </div>
        </div>

        {/* Quick Jump Pills & Pre-Uploaded Advance Months */}
        <div className={`pt-3 border-t flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 ${
          isDark ? 'border-[#1f3144]' : 'border-slate-200'
        }`}>
          {/* Quick Select Buttons */}
          <div className="flex items-center flex-wrap gap-1.5 text-xs">
            <span className="text-[11px] font-semibold text-slate-400 mr-1 flex items-center gap-1">
              <Clock className="w-3 h-3 text-teal-400" />
              <span>ปุ่มเลือกด่วน:</span>
            </span>

            <button
              type="button"
              id="btn-quick-prev"
              onClick={() => handleSelectPeriod(shiftMonth(targetMonthYear, -1))}
              className={`px-2 py-1 rounded text-[11px] font-medium border transition cursor-pointer flex items-center gap-0.5 ${
                isDark ? 'bg-[#0f1722] hover:bg-[#1a2838] border-[#29425c] text-slate-300' : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
              }`}
            >
              <ChevronLeft className="w-3 h-3" />
              <span>เดือนก่อนหน้า</span>
            </button>

            <button
              type="button"
              id="btn-quick-current"
              onClick={() => handleSelectPeriod('2026-05')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold border transition cursor-pointer ${
                targetMonthYear === '2026-05'
                  ? 'bg-[#008b99] text-white border-teal-400 shadow-xs'
                  : isDark
                    ? 'bg-[#0f1722] hover:bg-[#1a2838] border-[#29425c] text-teal-300'
                    : 'bg-white hover:bg-slate-100 border-slate-300 text-teal-700'
              }`}
            >
              <span>งวดปัจจุบัน (พ.ค. 69)</span>
            </button>

            <button
              type="button"
              id="btn-quick-plus1"
              onClick={() => handleSelectPeriod('2026-06')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium border transition cursor-pointer flex items-center gap-1 ${
                targetMonthYear === '2026-06'
                  ? 'bg-[#008b99] text-white border-teal-400 shadow-xs font-bold'
                  : isDark
                    ? 'bg-[#0f1722] hover:bg-[#1a2838] border-[#29425c] text-slate-300'
                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
              }`}
            >
              <Sparkles className="w-2.5 h-2.5 text-amber-400" />
              <span>+1 เดือนหน้า (มิ.ย. 69)</span>
              {deptExistingMonthCounts['2026-06'] ? (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="มีข้อมูลแล้ว" />
              ) : null}
            </button>

            <button
              type="button"
              id="btn-quick-plus2"
              onClick={() => handleSelectPeriod('2026-07')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium border transition cursor-pointer flex items-center gap-1 ${
                targetMonthYear === '2026-07'
                  ? 'bg-[#008b99] text-white border-teal-400 shadow-xs font-bold'
                  : isDark
                    ? 'bg-[#0f1722] hover:bg-[#1a2838] border-[#29425c] text-slate-300'
                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
              }`}
            >
              <span>+2 เดือน (ก.ค. 69)</span>
              {deptExistingMonthCounts['2026-07'] ? (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="มีข้อมูลแล้ว" />
              ) : null}
            </button>

            <button
              type="button"
              id="btn-quick-plus3"
              onClick={() => handleSelectPeriod('2026-08')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium border transition cursor-pointer ${
                targetMonthYear === '2026-08'
                  ? 'bg-[#008b99] text-white border-teal-400 shadow-xs font-bold'
                  : isDark
                    ? 'bg-[#0f1722] hover:bg-[#1a2838] border-[#29425c] text-slate-300'
                    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
              }`}
            >
              <span>+3 เดือน (ส.ค. 69)</span>
            </button>

            <button
              type="button"
              id="btn-quick-next"
              onClick={() => handleSelectPeriod(shiftMonth(targetMonthYear, 1))}
              className={`px-2 py-1 rounded text-[11px] font-medium border transition cursor-pointer flex items-center gap-0.5 ${
                isDark ? 'bg-[#0f1722] hover:bg-[#1a2838] border-[#29425c] text-slate-300' : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
              }`}
            >
              <span>เดือนถัดไป</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {/* Pre-uploaded advance periods chips */}
          {advanceUploadedMonths.length > 0 && (
            <div className="flex items-center flex-wrap gap-1.5 text-xs">
              <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>งวดล่วงหน้าที่มีข้อมูลแล้ว:</span>
              </span>
              {advanceUploadedMonths.map(m => (
                <button
                  key={m.value}
                  type="button"
                  id={`btn-uploaded-advance-${m.value}`}
                  onClick={() => handleSelectPeriod(m.value)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border transition cursor-pointer flex items-center gap-1 ${
                    targetMonthYear === m.value
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-xs'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                  }`}
                  title={`คลิกเพื่อดูหรืออัปโหลดข้อมูลงวด ${m.value} (จัดกะแล้ว ${m.shiftCount} รายการ)`}
                >
                  <span>{m.value}</span>
                  <span className="text-[10px] font-normal opacity-90">({m.shiftCount} กะ)</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. Two-Step Workflow: Step 1 Template & Step 2 Upload */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* STEP 1: Download Standard Template */}
        <div className={`p-5 rounded-lg border space-y-4 flex flex-col justify-between ${
          isDark ? 'bg-[#111b27] border-[#213345]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-teal-400">
              <span className="w-6 h-6 rounded-full bg-teal-500/20 border border-teal-500/30 flex items-center justify-center font-bold text-xs">
                1
              </span>
              <h2 className="font-bold text-sm text-slate-100">
                Download Department Template (ดาวน์โหลดเทมเพลตแผนก)
              </h2>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Downloads a customized template pre-filled with active employees from <strong>{targetDept}</strong> ({targetEmployees.length} people) for period <strong>{targetMonthYear}</strong>. Includes employee columns (EmpNo, GID, Name) and date columns (01 to {new Date(parseInt(targetMonthYear.split('-')[0]), parseInt(targetMonthYear.split('-')[1]), 0).getDate()}).
            </p>

            {/* Shift Codes Legend */}
            <div className={`p-3 rounded border text-xs space-y-2 ${
              isDark ? 'bg-[#0a121a] border-[#1d2d3e]' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="font-semibold text-slate-300 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-teal-400" />
                <span>Available Shift Codes for {targetDept} (รหัสกะที่ใช้ได้ในแผนก):</span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto scrollbar-thin pr-1">
                {applicableShiftCodes.map(sc => (
                  <span
                    key={sc.code}
                    className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium border"
                    style={{
                      backgroundColor: `${sc.color}15`,
                      color: sc.color,
                      borderColor: `${sc.color}40`,
                    }}
                    title={`${sc.name} (${sc.startTime}-${sc.endTime})`}
                  >
                    <strong>{sc.code}</strong>
                    <span className="opacity-75 text-[10px]">({sc.startTime}-{sc.endTime})</span>
                  </span>
                ))}
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono bg-slate-700/30 text-slate-300 border border-slate-600/40">
                  <strong>OFF</strong> <span className="text-[10px]">(วันหยุด)</span>
                </span>
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono bg-blue-500/10 text-blue-300 border border-blue-500/30">
                  <strong>H</strong> <span className="text-[10px]">(นักขัตฤกษ์)</span>
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                id="btn-download-dept-excel"
                onClick={handleDownloadExcelTemplate}
                className="w-full flex items-center justify-center space-x-2 py-2.5 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Excel (.xlsx)</span>
              </button>

              <button
                id="btn-download-dept-csv"
                onClick={handleDownloadCsvTemplate}
                className="w-full flex items-center justify-center space-x-2 py-2.5 rounded font-semibold text-xs border border-slate-600 hover:border-teal-400 text-slate-300 hover:text-white transition cursor-pointer"
              >
                <FileText className="w-4 h-4 text-teal-400" />
                <span>Download CSV (.csv)</span>
              </button>
            </div>
            <p className="text-[10px] text-center text-slate-400">
              * Fill in shift codes for each day and proceed to Step 2
            </p>
          </div>
        </div>

        {/* STEP 2: Upload Shift Plan File */}
        <div className={`p-5 rounded-lg border space-y-4 flex flex-col justify-between ${
          isDark ? 'bg-[#111b27] border-[#213345]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-teal-400">
              <span className="w-6 h-6 rounded-full bg-teal-500/20 border border-teal-500/30 flex items-center justify-center font-bold text-xs">
                2
              </span>
              <h2 className="font-bold text-sm text-slate-100">
                Upload Shift Plan (อัปโหลดไฟล์ตารางกะ)
              </h2>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Upload completed Excel (.xlsx) or CSV shift schedule for <strong>{targetDept}</strong>. The system verifies employee assignments and shift codes instantly.
            </p>

            {/* Drag and drop upload zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center transition ${
                isDragging
                  ? 'border-teal-400 bg-teal-500/10 scale-[1.01]'
                  : isDark
                    ? 'border-[#2d4257] bg-[#0c141e] hover:border-teal-500/50'
                    : 'border-slate-300 bg-slate-50 hover:border-teal-400'
              }`}
            >
              <div className="p-3 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/30 mb-2">
                <Upload className="w-6 h-6" />
              </div>

              <div className="text-xs font-bold text-slate-200 mb-1">
                Drag and drop your file here, or click to browse
              </div>
              <p className="text-[11px] text-slate-400 mb-3">
                Supports Excel (.xlsx, .xls) and CSV (.csv)
              </p>

              <label className="cursor-pointer px-5 py-2.5 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition flex items-center space-x-2">
                <Upload className="w-3.5 h-3.5" />
                <span>{isProcessing ? 'Processing File...' : 'Select Shift Plan File'}</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileInputChange}
                  disabled={isProcessing}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Safety rules pills */}
          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-1">
            <div className="flex items-center space-x-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              <span>Department Isolated (ปลอดภัย)</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              <span>Re-uploadable anytime</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Processing Status Notification Banner */}
      {statusMessage && (
        <div className={`p-4 rounded-lg border text-xs space-y-2 animate-in fade-in slide-in-from-top-2 duration-200 ${
          statusMessage.type === 'success' 
            ? 'bg-teal-950/40 border-teal-500 text-teal-200' 
            : statusMessage.type === 'warning'
              ? 'bg-amber-950/40 border-amber-500 text-amber-200'
              : 'bg-red-950/40 border-red-500 text-red-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 font-bold text-sm">
              {statusMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 text-teal-400 shrink-0" />}
              {statusMessage.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />}
              {statusMessage.type === 'error' && <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />}
              <span>{statusMessage.text}</span>
            </div>
            {statusMessage.type === 'success' && (
              <button
                onClick={onNavigateToRoster}
                className="px-3 py-1.5 rounded text-xs font-bold bg-[#008b99] hover:bg-[#00a3a6] text-white transition flex items-center space-x-1"
              >
                <span>Go to Shift Roster (ดูตารางกะ)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {statusMessage.details && statusMessage.details.length > 0 && (
            <div className="mt-2 pl-7 space-y-1 max-h-40 overflow-y-auto font-mono text-[11px] opacity-90">
              {statusMessage.details.map((d, i) => (
                <div key={i} className="flex items-start space-x-1.5">
                  <span className="opacity-50">•</span>
                  <span>{d}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. Live Roster Snapshot for Selected Department & Period */}
      <div className={`p-5 rounded-lg border space-y-4 ${
        isDark ? 'bg-[#0e1620] border-[#1e2f42]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center space-x-2">
            <Users className="w-4 h-4 text-teal-400" />
            <h3 className="font-bold text-sm text-slate-100">
              Current Roster Summary for {targetDept} — {targetMonthYear} (สถานะการจัดกะปัจจุบัน)
            </h3>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400">
              Total Roster Records: <strong className="text-teal-300 font-mono">{targetExistingPlans.length}</strong>
            </span>
            <button
              onClick={onNavigateToRoster}
              className="text-xs font-semibold text-[#00e5e5] hover:underline flex items-center gap-1"
            >
              <span>Full Calendar Grid</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Shift Code Distribution Chips */}
        {Object.keys(planStats.codeCounts).length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] text-slate-400 font-medium">Shift Distribution:</span>
            {Object.entries(planStats.codeCounts).map(([code, count]) => {
              const codeInfo = shiftCodes.find(c => c.code === code);
              const color = codeInfo?.color || '#00e5e5';
              return (
                <span
                  key={code}
                  className="px-2.5 py-1 rounded text-xs font-mono font-medium border flex items-center space-x-1.5"
                  style={{
                    backgroundColor: `${color}15`,
                    color: color,
                    borderColor: `${color}40`,
                  }}
                >
                  <span className="font-bold">{code}</span>
                  <span className="text-[11px] opacity-80">({count} days)</span>
                </span>
              );
            })}
          </div>
        ) : (
          <div className="p-4 rounded border border-dashed text-center text-xs text-slate-400">
            No shift plans have been uploaded yet for {targetDept} in {targetMonthYear}. Download the template above, fill in your staff shifts, and upload!
          </div>
        )}

        {/* Quick Staff Roster List */}
        <div className="overflow-x-auto max-h-64 scrollbar-thin border border-slate-700/50 rounded">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className={isDark ? 'bg-[#142232] text-slate-300' : 'bg-slate-100 text-slate-700'}>
                <th className="p-2.5 font-semibold border-b border-slate-700">EmpNo</th>
                <th className="p-2.5 font-semibold border-b border-slate-700">GID</th>
                <th className="p-2.5 font-semibold border-b border-slate-700">Name (ชื่อ-นามสกุล)</th>
                <th className="p-2.5 font-semibold border-b border-slate-700">Department</th>
                <th className="p-2.5 font-semibold border-b border-slate-700 text-center">Status in {targetMonthYear}</th>
              </tr>
            </thead>
            <tbody>
              {targetEmployees.map(emp => {
                const empPlans = targetExistingPlans.filter(p => p.empNo === emp.empNo);
                const hasPlan = empPlans.length > 0;

                return (
                  <tr
                    key={emp.empNo}
                    className={`border-b border-slate-800/50 hover:bg-white/5 transition ${
                      isDark ? 'text-slate-300' : 'text-slate-800'
                    }`}
                  >
                    <td className="p-2.5 font-mono font-bold text-teal-400">{emp.empNo}</td>
                    <td className="p-2.5 font-mono">{emp.gid}</td>
                    <td className="p-2.5 font-medium">{emp.firstName} {emp.familyName}</td>
                    <td className="p-2.5 font-mono text-teal-300">{emp.department}</td>
                    <td className="p-2.5 text-center">
                      {hasPlan ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Scheduled ({empPlans.length} days)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          <AlertCircle className="w-3 h-3" />
                          <span>No Schedule</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
