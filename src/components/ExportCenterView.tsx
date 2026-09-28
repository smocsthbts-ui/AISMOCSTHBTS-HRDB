import React, { useState, useMemo, useRef } from 'react';
import { 
  Employee, 
  ShiftCode, 
  DailyShiftPlan, 
  BiometricRawPunch, 
  OTRecord, 
  OtherAllowance, 
  TimeSheetSummary, 
  UserAccount 
} from '../types';
import { buildTimeSheetForEmployee, buildTimeSheetsInBatch } from '../utils/timeCalc';
import { exportTimeSheetsToPDF, PDFExportProgress } from '../utils/pdfExport';
import { 
  generatePayrollCSV, 
  generatePayrollExcel, 
  generatePayrollTSV, 
  filterPayrollEligibleSummaries, 
  downloadBlob,
  escapeCSV 
} from '../utils/fileParser';
import { storage } from '../utils/storage';
import { MonthYearFilter } from './MonthYearFilter';
import { 
  FileDown, 
  FileSpreadsheet, 
  FileText, 
  Building2, 
  Users, 
  CheckCircle2, 
  Layers,
  History,
  Info,
  Copy,
  Check,
  Filter,
  DollarSign,
  Clock,
  Calendar,
  Search,
  ChevronLeft,
  ChevronRight,
  Printer,
  ListFilter,
  CheckSquare,
  Square,
  Loader2,
  X,
  AlertCircle
} from 'lucide-react';

interface ExportCenterViewProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  selectedMonthYear: string;
  onSelectMonthYear: (my: string) => void;
  selectedDepartment: string;
  onSelectDepartment?: (dept: string) => void;
  employees: Employee[];
  shiftCodes: ShiftCode[];
  shiftPlans: DailyShiftPlan[];
  biometricPunches: BiometricRawPunch[];
  otRecords: OTRecord[];
  otherAllowances: OtherAllowance[];
}

type MainTab = 'payroll' | 'pdf' | 'attendance' | 'roster';

export const ExportCenterView: React.FC<ExportCenterViewProps> = ({
  currentUser,
  theme,
  selectedMonthYear,
  onSelectMonthYear,
  selectedDepartment,
  onSelectDepartment,
  employees,
  shiftCodes,
  shiftPlans,
  biometricPunches,
  otRecords,
  otherAllowances,
}) => {
  const isDark = theme === 'dark';

  // Active Main Tab
  const [activeTab, setActiveTab] = useState<MainTab>('payroll');

  // Scope Settings
  const [exportScope, setExportScope] = useState<'all' | 'dept' | 'single'>('dept');
  const [targetDept, setTargetDept] = useState<string>(
    selectedDepartment !== 'ALL' ? selectedDepartment : (employees[0]?.department || 'GM')
  );
  const [targetEmpNo, setTargetEmpNo] = useState<string>(employees[0]?.empNo || '');

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterOnlyExtraIncome, setFilterOnlyExtraIncome] = useState<boolean>(true);
  const [copiedNotification, setCopiedNotification] = useState<boolean>(false);
  const [isExportingPDF, setIsExportingPDF] = useState<boolean>(false);

  // Pagination for high performance
  const [page, setPage] = useState<number>(1);
  const PAGE_SIZE = 20;

  // Multi-select for PDF batch
  const [selectedEmpNosForPDF, setSelectedEmpNosForPDF] = useState<Set<string>>(() => new Set());

  // PDF Export Progress State
  const [pdfProgress, setPdfProgress] = useState<PDFExportProgress | null>(null);
  const cancelPDFExportRef = useRef<boolean>(false);

  const manualOverrides = useMemo(() => storage.getManualOverrides(), []);
  const departments = useMemo(() => storage.getDepartments(), []);

  // Filter employees according to chosen scope
  const targetEmployees = useMemo(() => {
    let list: Employee[] = [];
    if (exportScope === 'single') {
      list = employees.filter(e => e.empNo === targetEmpNo);
    } else if (exportScope === 'dept') {
      list = employees.filter(e => e.department === targetDept);
    } else {
      list = employees;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(e => 
        (e.empNo && e.empNo.toLowerCase().includes(q)) ||
        (e.empCode && e.empCode.toLowerCase().includes(q)) ||
        (e.gid && e.gid.toLowerCase().includes(q)) ||
        (e.firstName && e.firstName.toLowerCase().includes(q)) ||
        (e.familyName && e.familyName.toLowerCase().includes(q)) ||
        (e.department && e.department.toLowerCase().includes(q))
      );
    }
    return list;
  }, [exportScope, targetDept, targetEmpNo, employees, searchQuery]);

  // Compute summaries on-demand for target employees in ultra-fast batch mode (<10ms)
  const computedSummaries: TimeSheetSummary[] = useMemo(() => {
    // If on roster tab, summaries are not needed, saving heavy computation
    if (activeTab === 'roster') return [];

    return buildTimeSheetsInBatch(
      targetEmployees,
      selectedMonthYear,
      shiftCodes,
      shiftPlans,
      biometricPunches,
      otRecords,
      otherAllowances,
      manualOverrides
    );
  }, [activeTab, targetEmployees, selectedMonthYear, shiftCodes, shiftPlans, biometricPunches, otRecords, otherAllowances, manualOverrides]);

  // Filter only employees with extra income (OT > 0 or Allowance > 0)
  const eligibleSummaries = useMemo(() => {
    return filterPayrollEligibleSummaries(computedSummaries);
  }, [computedSummaries]);

  // Summaries to display in the preview table
  const displayedSummaries = useMemo(() => {
    if (activeTab === 'payroll') {
      return filterOnlyExtraIncome ? eligibleSummaries : computedSummaries;
    }
    return computedSummaries;
  }, [activeTab, filterOnlyExtraIncome, eligibleSummaries, computedSummaries]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(displayedSummaries.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedSummaries = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return displayedSummaries.slice(start, start + PAGE_SIZE);
  }, [displayedSummaries, currentPage]);

  // Grand totals across displayed summaries
  const payrollTotals = useMemo(() => {
    return displayedSummaries.reduce(
      (acc, s) => {
        const ot1_5 = Number(s.totalOT1_5 || 0);
        const ot3_0 = Number(s.totalOT3_0 || 0);
        const ot1_0 = Number(s.totalOT1_0 || 0);
        const totalOT = Number((ot1_5 + ot3_0 + ot1_0).toFixed(2));
        const emergency = Number(s.totalEmergency || 0);
        const standby = Number(s.totalStandby || 0);
        const totalAllowance = emergency + standby;
        return {
          totalOT: Number((acc.totalOT + totalOT).toFixed(2)),
          ot1_5: Number((acc.ot1_5 + ot1_5).toFixed(2)),
          ot3_0: Number((acc.ot3_0 + ot3_0).toFixed(2)),
          emergency: acc.emergency + emergency,
          standby: acc.standby + standby,
          totalAllowance: acc.totalAllowance + totalAllowance,
        };
      },
      { totalOT: 0, ot1_5: 0, ot3_0: 0, emergency: 0, standby: 0, totalAllowance: 0 }
    );
  }, [displayedSummaries]);

  // Handle PDF Export with async progress updates & cancellation support
  const handleExportPDF = async (useSelectedChecklist = false) => {
    let toExport: TimeSheetSummary[] = computedSummaries;
    if (useSelectedChecklist && selectedEmpNosForPDF.size > 0) {
      toExport = computedSummaries.filter(s => selectedEmpNosForPDF.has(s.empNo));
    }
    if (toExport.length === 0) return;

    cancelPDFExportRef.current = false;
    setIsExportingPDF(true);
    setPdfProgress({
      current: 0,
      total: toExport.length,
      percent: 0,
      currentEmpName: 'กำลังเตรียมข้อมูลพนักงาน...',
      department: '',
      status: 'processing',
    });

    try {
      const scopeLabel = exportScope === 'all' ? 'All_Depts' : exportScope === 'dept' ? targetDept : targetEmpNo;
      await exportTimeSheetsToPDF(
        toExport,
        `Siemens_TimeSheet_${scopeLabel}_${selectedMonthYear}`,
        (progress) => {
          setPdfProgress(progress);
        },
        () => cancelPDFExportRef.current
      );
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setTimeout(() => {
        setIsExportingPDF(false);
        setPdfProgress(null);
      }, 1000);
    }
  };

  const handleCancelPDFExport = () => {
    cancelPDFExportRef.current = true;
    if (pdfProgress) {
      setPdfProgress(prev => prev ? { ...prev, status: 'cancelled', currentEmpName: 'ยกเลิกการส่งออกแล้ว' } : null);
    }
    setTimeout(() => {
      setIsExportingPDF(false);
      setPdfProgress(null);
    }, 600);
  };

  // Handle Payroll CSV Export
  const handleExportPayrollCSV = () => {
    const csvData = generatePayrollCSV(computedSummaries, selectedMonthYear, filterOnlyExtraIncome);
    const scopeLabel = exportScope === 'all' ? 'All' : exportScope === 'dept' ? targetDept : targetEmpNo;
    downloadBlob(
      csvData,
      `Siemens_Payroll_Summary_${scopeLabel}_${selectedMonthYear}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  // Handle Payroll Excel (.xlsx) Export
  const handleExportPayrollExcel = () => {
    const excelBytes = generatePayrollExcel(computedSummaries, selectedMonthYear, filterOnlyExtraIncome);
    const scopeLabel = exportScope === 'all' ? 'All' : exportScope === 'dept' ? targetDept : targetEmpNo;
    downloadBlob(
      excelBytes,
      `Siemens_Payroll_Summary_${scopeLabel}_${selectedMonthYear}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  };

  // Handle Copy TSV to clipboard
  const handleCopyTSV = async () => {
    const tsvData = generatePayrollTSV(computedSummaries, filterOnlyExtraIncome);
    try {
      await navigator.clipboard.writeText(tsvData);
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 2500);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };

  // Handle Attendance Log Export
  const handleExportAttendanceCSV = () => {
    const BOM = '\uFEFF';
    const headers = ['EmpCode', 'GID', 'Department', 'Name', 'WorkDays', 'TotalHours', 'OT1_5', 'OT3_0', 'LateTime', 'PunchCount'];
    const lines = [headers.join(',')];
    displayedSummaries.forEach(s => {
      const empCode = s.employee?.empCode || s.empNo || '';
      lines.push([
        escapeCSV(empCode),
        escapeCSV(s.gid || s.employee?.gid || ''),
        escapeCSV(s.employee?.department || ''),
        escapeCSV(`${s.employee?.firstName || ''} ${s.employee?.familyName || ''}`),
        s.totalWorkDays,
        s.totalWorkHours,
        s.totalOT1_5,
        s.totalOT3_0,
        escapeCSV(s.totalLateTime),
        s.rows.filter(r => r.actualIn || r.actualOut).length
      ].join(','));
    });
    downloadBlob(
      BOM + lines.join('\r\n'),
      `Siemens_Attendance_Summary_${selectedMonthYear}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  // Days in month for Shift Matrix tab
  const [yearStr, monthStr] = selectedMonthYear.split('-');
  const daysInMonth = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0).getDate();
  const daysList = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Fast map for Shift Matrix tab
  const shiftPlanMap = useMemo(() => {
    const map = new Map<string, string>();
    shiftPlans.forEach(p => {
      if (!p || !p.date || !p.shiftCode) return;
      if (p.empNo) {
        map.set(`${p.empNo.trim().toUpperCase()}_${p.date}`, p.shiftCode);
      }
      if (p.gid) {
        map.set(`${p.gid.trim().toUpperCase()}_${p.date}`, p.shiftCode);
      }
    });
    return map;
  }, [shiftPlans]);

  // Handle Shift Matrix CSV Export
  const handleExportRosterCSV = () => {
    const BOM = '\uFEFF';
    const headerCols = ['EmpCode', 'GID', 'Department', 'Name', ...daysList.map(d => `Day_${d}`), 'Total_Work_Shifts', 'Total_OFF'];
    const lines = [headerCols.join(',')];
    targetEmployees.forEach(emp => {
      const empKey = (emp.empNo || '').trim().toUpperCase();
      let workCount = 0;
      let offCount = 0;
      const dayCodes = daysList.map(d => {
        const dStr = `${selectedMonthYear}-${String(d).padStart(2, '0')}`;
        const code = shiftPlanMap.get(`${empKey}_${dStr}`) || '-';
        if (code === 'OFF') offCount++;
        else if (code !== '-') workCount++;
        return escapeCSV(code);
      });
      lines.push([
        escapeCSV(emp.empCode || emp.empNo),
        escapeCSV(emp.gid || ''),
        escapeCSV(emp.department || ''),
        escapeCSV(`${emp.firstName || ''} ${emp.familyName || ''}`),
        ...dayCodes,
        workCount,
        offCount
      ].join(','));
    });
    downloadBlob(
      BOM + lines.join('\r\n'),
      `Siemens_Shift_Matrix_${selectedMonthYear}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  // PDF Multi-Select Helpers
  const toggleEmpSelectForPDF = (empNo: string) => {
    const next = new Set(selectedEmpNosForPDF);
    if (next.has(empNo)) next.delete(empNo);
    else next.add(empNo);
    setSelectedEmpNosForPDF(next);
  };

  const selectAllForPDF = () => {
    setSelectedEmpNosForPDF(new Set(targetEmployees.map(e => e.empNo)));
  };

  const deselectAllForPDF = () => {
    setSelectedEmpNosForPDF(new Set());
  };

  return (
    <div className={`p-4 md:p-6 flex flex-col space-y-4 min-h-full ${
      isDark ? 'bg-[#091017] text-slate-100' : 'bg-[#f4f7f9] text-slate-800'
    }`}>
      {/* Header Banner */}
      <div className={`p-4 rounded border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
        isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/30">
            <FileDown className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-base font-bold flex items-center gap-2">
              ศูนย์การส่งออกข้อมูลและรายงาน (Reports & Export Center)
            </h1>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              แยกการทำงานเป็นหมวดหมู่เพื่อความรวดเร็ว ไม่สะดุด รองรับ Payroll, PDF Batch, สรุปเวลาทำงาน และตารางกะ
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs font-mono font-medium">
          <span className={`px-2.5 py-1 rounded border flex items-center gap-1.5 ${
            isDark ? 'bg-teal-900/30 text-teal-300 border-teal-500/30' : 'bg-teal-50 text-teal-700 border-teal-200'
          }`}>
            <History className="w-3.5 h-3.5 text-teal-400" />
            <span>งวดข้อมูล: {selectedMonthYear}</span>
          </span>
        </div>
      </div>

      {/* Top Filter Bar: Month & Scope */}
      <div className={`p-3.5 rounded border flex flex-wrap items-center justify-between gap-3 ${
        isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex items-center space-x-3 flex-wrap gap-y-2">
          <MonthYearFilter
            selectedMonthYear={selectedMonthYear}
            onChange={onSelectMonthYear}
            theme={theme}
            idPrefix="export-month-filter"
          />

          <div className="h-5 w-[1px] bg-slate-700/50 hidden sm:block" />

          {/* Scope Radio Pill */}
          <div className="flex items-center space-x-1.5 text-xs">
            <span className={`text-[11px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>ขอบเขต:</span>
            {[
              { id: 'dept', label: 'รายแผนก', icon: Building2 },
              { id: 'all', label: 'ทุกแผนก', icon: Layers },
              { id: 'single', label: 'รายบุคคล', icon: Users },
            ].map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setExportScope(s.id as any);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded border flex items-center gap-1 transition cursor-pointer text-xs ${
                  exportScope === s.id
                    ? isDark 
                      ? 'bg-teal-600 text-white font-bold border-teal-500' 
                      : 'bg-teal-600 text-white font-bold border-teal-600'
                    : isDark
                      ? 'bg-[#0f1722] text-slate-300 border-[#223344] hover:bg-[#182635]'
                      : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                }`}
              >
                <s.icon className="w-3 h-3" />
                <span>{s.label}</span>
              </button>
            ))}
          </div>

          {/* Dept Dropdown */}
          {exportScope === 'dept' && (
            <select
              value={targetDept}
              onChange={e => {
                setTargetDept(e.target.value);
                if (onSelectDepartment) onSelectDepartment(e.target.value);
                setPage(1);
              }}
              className={`p-1.5 rounded border text-xs font-semibold font-mono transition ${
                isDark ? 'bg-[#0f1722] border-[#273a4e] text-teal-300 focus:border-teal-400' : 'bg-slate-50 border-slate-300 text-teal-800 focus:border-teal-500'
              }`}
            >
              {departments.map(d => (
                <option key={d.code} value={d.code} className={isDark ? 'bg-[#141f2c] text-white' : ''}>
                  แผนก {d.code} ({d.name && d.name !== d.code ? d.name : ''})
                </option>
              ))}
            </select>
          )}

          {/* Single Emp Dropdown */}
          {exportScope === 'single' && (
            <select
              value={targetEmpNo}
              onChange={e => {
                setTargetEmpNo(e.target.value);
                setPage(1);
              }}
              className={`p-1.5 rounded border text-xs font-mono transition max-w-[220px] ${
                isDark ? 'bg-[#0f1722] border-[#273a4e] text-teal-300 focus:border-teal-400' : 'bg-slate-50 border-slate-300 text-slate-800 focus:border-teal-500'
              }`}
            >
              {employees.map(emp => (
                <option key={emp.empNo} value={emp.empNo} className={isDark ? 'bg-[#141f2c] text-white' : ''}>
                  {emp.empNo} - {emp.firstName} ({emp.department})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Quick Search */}
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-48">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาชื่อ/รหัส/GID..."
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className={`w-full pl-8 pr-2.5 py-1.5 rounded border text-xs transition ${
                isDark ? 'bg-[#0f1722] border-[#273a4e] text-white placeholder-slate-500' : 'bg-slate-50 border-slate-300 text-slate-800 placeholder-slate-400'
              }`}
            />
          </div>
          <span className={`text-[11px] font-mono shrink-0 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            ({targetEmployees.length} คน)
          </span>
        </div>
      </div>

      {/* Main Feature Tabs (Separated Functionality to eliminate lag) */}
      <div className="flex items-center space-x-1.5 border-b border-slate-700/40 pb-1 overflow-x-auto scrollbar-thin">
        {[
          { id: 'payroll', label: '1. สรุปฝ่ายการเงิน (Payroll 14 Columns)', icon: DollarSign, badge: 'SAP Ready' },
          { id: 'pdf', label: '2. พิมพ์ Time Sheet เป็นชุด (Batch PDF)', icon: Printer, badge: 'Official Form' },
          { id: 'attendance', label: '3. สรุปเวลาเข้า-ออก & รูดบัตร', icon: Clock, badge: 'Time Log' },
          { id: 'roster', label: '4. ตารางกะประจำเดือน (Shift Matrix)', icon: Calendar, badge: 'Matrix View' },
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id as MainTab);
              setPage(1);
            }}
            className={`flex items-center space-x-2 py-2.5 px-3.5 rounded-t font-semibold text-xs transition cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === tab.id
                ? isDark
                  ? 'border-[#00e5e5] text-teal-300 bg-[#142230]'
                  : 'border-teal-600 text-teal-800 bg-white shadow-sm'
                : isDark
                  ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#111c27]'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <tab.icon className="w-4 h-4 shrink-0" />
            <span>{tab.label}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
              activeTab === tab.id
                ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                : 'bg-slate-700/30 text-slate-400'
            }`}>
              {tab.badge}
            </span>
          </button>
        ))}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: PAYROLL SUMMARY (14 COLUMNS SAP FORMAT) */}
      {/* ========================================================================= */}
      {activeTab === 'payroll' && (
        <div className="flex flex-col space-y-3">
          {/* Action Bar & Stats */}
          <div className={`p-3.5 rounded border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            {/* KPI Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs w-full md:w-auto">
              <div className={`p-2 rounded border ${isDark ? 'bg-[#0e1620] border-[#223344]' : 'bg-slate-50 border-slate-200'}`}>
                <div className="text-[10px] text-slate-400">ผู้มีรายได้เสริม</div>
                <div className="font-bold text-sm text-teal-400 font-mono">
                  {eligibleSummaries.length} <span className="text-[10px] font-normal text-slate-400">/ {computedSummaries.length} คน</span>
                </div>
              </div>

              <div className={`p-2 rounded border ${isDark ? 'bg-[#0e1620] border-[#223344]' : 'bg-slate-50 border-slate-200'}`}>
                <div className="text-[10px] text-slate-400">รวม OT ทั้งหมด</div>
                <div className="font-bold text-sm text-[#00e5e5] font-mono">
                  {payrollTotals.totalOT} <span className="text-[10px] font-normal text-slate-400">ชม.</span>
                </div>
              </div>

              <div className={`p-2 rounded border ${isDark ? 'bg-[#0e1620] border-[#223344]' : 'bg-slate-50 border-slate-200'}`}>
                <div className="text-[10px] text-slate-400">Emergency (-ET)</div>
                <div className="font-bold text-sm text-amber-400 font-mono">
                  {payrollTotals.emergency.toLocaleString()} <span className="text-[10px] font-normal text-slate-400">฿</span>
                </div>
              </div>

              <div className={`p-2 rounded border ${isDark ? 'bg-[#0e1620] border-[#223344]' : 'bg-slate-50 border-slate-200'}`}>
                <div className="text-[10px] text-slate-400">Total Allowance (-ET/-X)</div>
                <div className="font-bold text-sm text-emerald-400 font-mono">
                  {payrollTotals.totalAllowance.toLocaleString()} <span className="text-[10px] font-normal text-slate-400">฿</span>
                </div>
              </div>
            </div>

            {/* Export Buttons */}
            <div className="flex items-center flex-wrap gap-2 w-full md:w-auto justify-end">
              <label className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-xs cursor-pointer select-none transition ${
                filterOnlyExtraIncome
                  ? isDark
                    ? 'bg-amber-400/10 border-amber-400/40 text-amber-300 font-semibold'
                    : 'bg-amber-50 border-amber-300 text-amber-800 font-semibold'
                  : isDark
                    ? 'bg-[#16212e] border-[#2b3c4f] text-slate-400'
                    : 'bg-slate-100 border-slate-300 text-slate-600'
              }`}>
                <Filter className="w-3.5 h-3.5 text-amber-400" />
                <input
                  type="checkbox"
                  checked={filterOnlyExtraIncome}
                  onChange={e => {
                    setFilterOnlyExtraIncome(e.target.checked);
                    setPage(1);
                  }}
                  className="accent-amber-400 cursor-pointer"
                />
                <span>กรองเฉพาะผู้มีรายได้เสริม</span>
              </label>

              <button
                type="button"
                id="btn-export-payroll-excel"
                onClick={handleExportPayrollExcel}
                disabled={displayedSummaries.length === 0}
                className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-semibold text-xs bg-teal-600 hover:bg-teal-500 text-white shadow transition disabled:opacity-50 cursor-pointer"
                title="ดาวน์โหลดไฟล์ Excel .xlsx 14 คอลัมน์"
              >
                <FileSpreadsheet className="w-4 h-4 shrink-0 text-amber-300" />
                <span>Export Excel (.xlsx)</span>
              </button>

              <button
                type="button"
                id="btn-export-payroll-csv"
                onClick={handleExportPayrollCSV}
                disabled={displayedSummaries.length === 0}
                className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow transition disabled:opacity-50 cursor-pointer"
                title="ดาวน์โหลดไฟล์ CSV 14 คอลัมน์"
              >
                <FileSpreadsheet className="w-4 h-4 shrink-0" />
                <span>Export CSV</span>
              </button>

              <button
                type="button"
                id="btn-copy-payroll-tsv"
                onClick={handleCopyTSV}
                disabled={displayedSummaries.length === 0}
                className={`flex items-center space-x-1.5 py-1.5 px-2.5 rounded font-semibold text-xs border transition cursor-pointer ${
                  copiedNotification
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                    : isDark
                      ? 'bg-[#1a2736] hover:bg-[#223347] border-[#2c3f55] text-slate-200'
                      : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                }`}
                title="คัดลอกตารางไปวางใน Excel ทันที"
              >
                {copiedNotification ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>คัดลอกแล้ว</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy TSV</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 14-Column Table */}
          <div className={`rounded border overflow-hidden ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="overflow-x-auto max-h-[56vh] scrollbar-thin">
              <table className="w-full border-collapse text-center text-xs">
                <thead className={`sticky top-0 shadow-sm z-10 ${
                  isDark ? 'bg-[#0a1118] text-slate-200 border-b border-[#223344]' : 'bg-slate-100 text-slate-800 border-b border-slate-300'
                }`}>
                  <tr>
                    <th className="p-2.5 border-r border-inherit text-left font-mono whitespace-nowrap">EmpCode</th>
                    <th className="p-2.5 border-r border-inherit font-mono whitespace-nowrap">GID</th>
                    <th className="p-2.5 border-r border-inherit font-mono whitespace-nowrap">Department</th>
                    <th className="p-2.5 border-r border-inherit text-left whitespace-nowrap">FirstName</th>
                    <th className="p-2.5 border-r border-inherit text-left whitespace-nowrap">FamilyName</th>
                    <th className="p-2.5 border-r border-inherit font-mono whitespace-nowrap text-[#00e5e5]">TotalOT</th>
                    <th className="p-2.5 border-r border-inherit font-mono whitespace-nowrap text-teal-300">2010/2000 (1.5)</th>
                    <th className="p-2.5 border-r border-inherit font-mono whitespace-nowrap text-amber-400">2010/2001 (3.0)</th>
                    <th className="p-2.5 border-r border-inherit font-mono whitespace-nowrap text-slate-400">2010/2002</th>
                    <th className="p-2.5 border-r border-inherit font-mono whitespace-nowrap text-slate-400">0015/5016</th>
                    <th className="p-2.5 border-r border-inherit font-mono whitespace-nowrap text-slate-400">0015/5019</th>
                    <th className="p-2.5 border-r border-inherit font-mono whitespace-nowrap text-amber-300">0015/5000 (-ET)</th>
                    <th className="p-2.5 border-r border-inherit font-mono whitespace-nowrap text-cyan-300">0015/5022 (-X)</th>
                    <th className="p-2.5 font-mono whitespace-nowrap font-bold text-emerald-400">TotalAllowance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-inherit font-mono">
                  {pagedSummaries.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="p-8 text-center text-slate-400 font-sans">
                        {filterOnlyExtraIncome
                          ? 'ไม่พบพนักงานที่มีรายได้เสริมจาก OT หรือ Emergency/OnCall ในงวดเดือนที่เลือก'
                          : `ไม่พบข้อมูลตามขอบเขตและเงื่อนไขการค้นหา (${selectedMonthYear})`}
                      </td>
                    </tr>
                  ) : (
                    pagedSummaries.map(s => {
                      const ot1_5 = Number(s.totalOT1_5 || 0);
                      const ot3_0 = Number(s.totalOT3_0 || 0);
                      const ot1_0 = Number(s.totalOT1_0 || 0);
                      const totalOT = Number((ot1_5 + ot3_0 + ot1_0).toFixed(2));
                      const emergency = Number(s.totalEmergency || 0);
                      const standby = Number(s.totalStandby || 0);
                      const totalAllowance = emergency + standby;
                      const empCode = s.employee?.empCode || s.empCode || s.empNo || '';

                      return (
                        <tr key={s.empNo} className={`transition ${
                          isDark ? 'hover:bg-teal-500/5' : 'hover:bg-slate-50'
                        }`}>
                          <td className="p-2 text-left font-semibold text-amber-300 border-r border-inherit whitespace-nowrap">
                            {empCode}
                          </td>
                          <td className="p-2 text-slate-300 border-r border-inherit whitespace-nowrap">
                            {s.gid || s.employee?.gid || ''}
                          </td>
                          <td className="p-2 font-bold text-teal-300 border-r border-inherit whitespace-nowrap">
                            {s.employee?.department || ''}
                          </td>
                          <td className="p-2 text-left font-sans text-slate-100 border-r border-inherit whitespace-nowrap">
                            {s.employee?.firstName || ''}
                          </td>
                          <td className="p-2 text-left font-sans text-slate-100 border-r border-inherit whitespace-nowrap">
                            {s.employee?.familyName || ''}
                          </td>
                          <td className={`p-2 font-bold border-r border-inherit ${totalOT > 0 ? 'text-[#00e5e5]' : 'text-slate-500'}`}>
                            {totalOT}
                          </td>
                          <td className={`p-2 border-r border-inherit ${ot1_5 > 0 ? 'text-teal-300 font-bold' : 'text-slate-500'}`}>
                            {ot1_5}
                          </td>
                          <td className={`p-2 border-r border-inherit ${ot3_0 > 0 ? 'text-amber-400 font-bold' : 'text-slate-500'}`}>
                            {ot3_0}
                          </td>
                          <td className="p-2 text-slate-500 border-r border-inherit">0</td>
                          <td className="p-2 text-slate-500 border-r border-inherit">0</td>
                          <td className="p-2 text-slate-500 border-r border-inherit">0</td>
                          <td className={`p-2 border-r border-inherit ${emergency > 0 ? 'text-amber-300 font-bold' : 'text-slate-500'}`}>
                            {emergency}
                          </td>
                          <td className={`p-2 border-r border-inherit ${standby > 0 ? 'text-cyan-300 font-bold' : 'text-slate-500'}`}>
                            {standby}
                          </td>
                          <td className={`p-2 font-bold ${totalAllowance > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {totalAllowance}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {/* Grand totals row */}
                {displayedSummaries.length > 0 && (
                  <tfoot className={`font-bold font-mono border-t-2 sticky bottom-0 ${
                    isDark ? 'bg-[#091119] text-white border-slate-600' : 'bg-slate-100 text-slate-900 border-slate-300'
                  }`}>
                    <tr>
                      <td colSpan={5} className="p-2.5 text-left pl-3 font-sans border-r border-inherit">
                        รวมทั้งหมด ({displayedSummaries.length} คน)
                      </td>
                      <td className="p-2.5 text-[#00e5e5] border-r border-inherit">{payrollTotals.totalOT}</td>
                      <td className="p-2.5 text-teal-300 border-r border-inherit">{payrollTotals.ot1_5}</td>
                      <td className="p-2.5 text-amber-400 border-r border-inherit">{payrollTotals.ot3_0}</td>
                      <td className="p-2.5 text-slate-500 border-r border-inherit">0</td>
                      <td className="p-2.5 text-slate-500 border-r border-inherit">0</td>
                      <td className="p-2.5 text-slate-500 border-r border-inherit">0</td>
                      <td className="p-2.5 text-amber-300 border-r border-inherit">{payrollTotals.emergency}</td>
                      <td className="p-2.5 text-cyan-300 border-r border-inherit">{payrollTotals.standby}</td>
                      <td className="p-2.5 text-emerald-400">{payrollTotals.totalAllowance}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Pagination Controls */}
            <div className={`p-2.5 border-t flex items-center justify-between text-xs ${
              isDark ? 'bg-[#0d151e] border-[#223344] text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
            }`}>
              <div>
                แสดงแถว {(currentPage - 1) * PAGE_SIZE + 1} - {Math.min(currentPage * PAGE_SIZE, displayedSummaries.length)} จาก {displayedSummaries.length} คน
              </div>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="p-1 rounded border border-inherit disabled:opacity-40 hover:bg-slate-700/20 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 font-mono font-semibold">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="p-1 rounded border border-inherit disabled:opacity-40 hover:bg-slate-700/20 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: BATCH PDF EXPORT CENTER */}
      {/* ========================================================================= */}
      {activeTab === 'pdf' && (
        <div className="flex flex-col space-y-4">
          <div className={`p-4 rounded border grid grid-cols-1 md:grid-cols-3 gap-4 ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="md:col-span-2 space-y-2">
              <h2 className="text-sm font-bold flex items-center gap-2 text-teal-300">
                <Printer className="w-4 h-4" />
                ส่งออกเอกสาร Time Sheet เป็นไฟล์ PDF รวม (Official Monthly Form)
              </h2>
              <p className={`text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                เอกสารจะถูกจัดรูปแบบตามมาตรฐานของ Siemens พร้อมตารางสรุปการลงเวลาทำงาน, การคำนวณ OT และช่องลงนามสำหรับส่งอนุมัติ
              </p>
              <div className={`text-xs p-2.5 rounded border mt-2 flex items-center gap-2 ${
                isDark ? 'bg-[#0f1722] border-teal-500/30 text-teal-300' : 'bg-teal-50 border-teal-200 text-teal-900'
              }`}>
                <Info className="w-4 h-4 shrink-0" />
                <span>
                  เลือกพนักงานที่ต้องการพิมพ์ หรือกดปุ่ม <strong>เลือกทั้งหมด ({targetEmployees.length} คน)</strong> เพื่อส่งออกในคลิกเดียว
                </span>
              </div>
            </div>

            {/* Download Buttons */}
            <div className="flex flex-col justify-center space-y-2">
              <button
                type="button"
                id="btn-export-pdf-batch-all"
                onClick={() => handleExportPDF(false)}
                disabled={isExportingPDF || targetEmployees.length === 0}
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-md transition disabled:opacity-50 cursor-pointer"
              >
                <FileText className="w-4 h-4 shrink-0" />
                <span>
                  {isExportingPDF ? 'กำลังสร้างไฟล์ PDF...' : `ดาวน์โหลด PDF ทั้งหมด (${targetEmployees.length} คน)`}
                </span>
              </button>

              {selectedEmpNosForPDF.size > 0 && (
                <button
                  type="button"
                  id="btn-export-pdf-selected"
                  onClick={() => handleExportPDF(true)}
                  disabled={isExportingPDF}
                  className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow transition cursor-pointer"
                >
                  <CheckSquare className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isExportingPDF ? 'กำลังสร้างไฟล์ PDF...' : `ดาวน์โหลดเฉพาะที่เลือก (${selectedEmpNosForPDF.size} คน)`}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Employee Checklist for Customized PDF Selection */}
          <div className={`p-4 rounded border ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="flex items-center justify-between mb-3 border-b pb-2 border-inherit">
              <div className="flex items-center space-x-2">
                <ListFilter className="w-4 h-4 text-teal-400" />
                <span className="font-bold text-xs">รายชื่อพนักงานสำหรับออกเอกสาร</span>
                <span className="text-xs font-mono text-slate-400">
                  (เลือก {selectedEmpNosForPDF.size} จาก {targetEmployees.length} คน)
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={selectAllForPDF}
                  className="text-xs text-teal-400 hover:underline cursor-pointer"
                >
                  เลือกทั้งหมด
                </button>
                <span className="text-slate-600">|</span>
                <button
                  type="button"
                  onClick={deselectAllForPDF}
                  className="text-xs text-slate-400 hover:underline cursor-pointer"
                >
                  ล้างการเลือก
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[48vh] overflow-y-auto scrollbar-thin pr-1">
              {targetEmployees.map(emp => {
                const isSelected = selectedEmpNosForPDF.has(emp.empNo);
                return (
                  <div
                    key={emp.empNo}
                    onClick={() => toggleEmpSelectForPDF(emp.empNo)}
                    className={`p-2 rounded border flex items-center space-x-2.5 cursor-pointer transition select-none ${
                      isSelected
                        ? isDark
                          ? 'bg-teal-500/10 border-teal-500/50 text-teal-300'
                          : 'bg-teal-50 border-teal-500 text-teal-900 font-semibold'
                        : isDark
                          ? 'bg-[#0e1620] border-[#223344] text-slate-300 hover:bg-[#16212e]'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-teal-400 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-500 shrink-0" />
                    )}
                    <div className="truncate text-xs">
                      <div className="font-medium truncate">{emp.firstName} {emp.familyName}</div>
                      <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                        <span>{emp.empNo}</span>
                        {emp.empCode && <span className="text-amber-300 font-bold">[{emp.empCode}]</span>}
                        <span>• {emp.department}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: ATTENDANCE & BIOMETRIC LOGS */}
      {/* ========================================================================= */}
      {activeTab === 'attendance' && (
        <div className="flex flex-col space-y-3">
          <div className={`p-3.5 rounded border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div>
              <h2 className="text-sm font-bold flex items-center gap-2 text-teal-300">
                <Clock className="w-4 h-4" />
                รายงานการลงเวลาทำงาน & สถิติสาย (Attendance & Work Hours)
              </h2>
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                สรุปวันทำงานจริง, จำนวนชั่วโมง, สถิติการเข้าสาย และจำนวนครั้งที่สแกนลายนิ้วมือ
              </p>
            </div>

            <button
              type="button"
              onClick={handleExportAttendanceCSV}
              className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-semibold text-xs bg-teal-600 hover:bg-teal-500 text-white shadow transition cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export สรุปเวลา (CSV)</span>
            </button>
          </div>

          <div className={`rounded border overflow-hidden ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="overflow-x-auto max-h-[56vh] scrollbar-thin">
              <table className="w-full border-collapse text-center text-xs">
                <thead className={`sticky top-0 shadow-sm z-10 ${
                  isDark ? 'bg-[#0a1118] text-slate-200 border-b border-[#223344]' : 'bg-slate-100 text-slate-800 border-b border-slate-300'
                }`}>
                  <tr>
                    <th className="p-2.5 border-r border-inherit text-left">พนักงาน (EmpCode / GID)</th>
                    <th className="p-2.5 border-r border-inherit">แผนก</th>
                    <th className="p-2.5 border-r border-inherit font-mono">วันทำงาน</th>
                    <th className="p-2.5 border-r border-inherit font-mono text-teal-300">ชั่วโมงรวม</th>
                    <th className="p-2.5 border-r border-inherit font-mono text-[#00e5e5]">OT 1.5 (ชม.)</th>
                    <th className="p-2.5 border-r border-inherit font-mono text-amber-400">OT 3.0 (ชม.)</th>
                    <th className="p-2.5 border-r border-inherit font-mono text-red-400">เวลาสาย (HH:mm)</th>
                    <th className="p-2.5 border-r border-inherit font-mono">Emergency (-ET)</th>
                    <th className="p-2.5 border-r border-inherit font-mono">OnCall (-X)</th>
                    <th className="p-2.5 font-bold font-mono text-emerald-400">รวมเบี้ยเลี้ยง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-inherit">
                  {pagedSummaries.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-8 text-center text-slate-400">
                        ไม่พบข้อมูลตามเงื่อนไขที่ระบุ
                      </td>
                    </tr>
                  ) : (
                    pagedSummaries.map(s => {
                      const totalAllw = s.totalEmergency + s.totalShiftAllowance + s.totalStandby;
                      const hasLate = s.totalLateTime && s.totalLateTime !== '00:00';
                      return (
                        <tr key={s.empNo} className={`transition ${
                          isDark ? 'hover:bg-teal-500/5' : 'hover:bg-slate-50'
                        }`}>
                          <td className="p-2.5 text-left font-medium border-r border-inherit">
                            <div className="font-semibold text-slate-100">{s.employee?.firstName} {s.employee?.familyName}</div>
                            <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1.5 flex-wrap mt-0.5">
                              <span>{s.empNo} / {s.gid}</span>
                              {s.employee?.empCode && (
                                <span className="text-amber-300 font-bold bg-amber-400/10 px-1 py-0.5 rounded border border-amber-400/30 text-[9px]">
                                  {s.employee.empCode}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-2.5 font-mono font-bold text-teal-300 border-r border-inherit">{s.employee?.department}</td>
                          <td className="p-2.5 font-mono border-r border-inherit">{s.totalWorkDays}</td>
                          <td className="p-2.5 font-mono border-r border-inherit text-teal-300 font-bold">{s.totalWorkHours}</td>
                          <td className="p-2.5 font-mono font-bold text-[#00e5e5] border-r border-inherit">{s.totalOT1_5}</td>
                          <td className="p-2.5 font-mono font-bold text-amber-400 border-r border-inherit">{s.totalOT3_0}</td>
                          <td className={`p-2.5 font-mono border-r border-inherit ${hasLate ? 'text-red-400 font-bold bg-red-500/10' : 'text-slate-400'}`}>
                            {s.totalLateTime}
                          </td>
                          <td className="p-2.5 font-mono border-r border-inherit">{s.totalEmergency}</td>
                          <td className="p-2.5 font-mono border-r border-inherit">{s.totalStandby}</td>
                          <td className="p-2.5 font-mono font-bold text-emerald-400">{totalAllw.toLocaleString()} ฿</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className={`p-2.5 border-t flex items-center justify-between text-xs ${
              isDark ? 'bg-[#0d151e] border-[#223344] text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
            }`}>
              <div>
                แสดงแถว {(currentPage - 1) * PAGE_SIZE + 1} - {Math.min(currentPage * PAGE_SIZE, displayedSummaries.length)} จาก {displayedSummaries.length} คน
              </div>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="p-1 rounded border border-inherit disabled:opacity-40 hover:bg-slate-700/20 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 font-mono font-semibold">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="p-1 rounded border border-inherit disabled:opacity-40 hover:bg-slate-700/20 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: SHIFT ROSTER MATRIX */}
      {/* ========================================================================= */}
      {activeTab === 'roster' && (
        <div className="flex flex-col space-y-3">
          <div className={`p-3.5 rounded border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div>
              <h2 className="text-sm font-bold flex items-center gap-2 text-teal-300">
                <Calendar className="w-4 h-4" />
                รายงานตารางกะประจำเดือน (Monthly Shift Plan Matrix)
              </h2>
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                ดูภาพรวมรหัสกะการทำงานตลอดทั้งเดือน 1..{daysInMonth} แยกตามบุคคลและแผนก
              </p>
            </div>

            <button
              type="button"
              onClick={handleExportRosterCSV}
              className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-semibold text-xs bg-teal-600 hover:bg-teal-500 text-white shadow transition cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export ตารางกะ (CSV)</span>
            </button>
          </div>

          <div className={`rounded border overflow-hidden ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="overflow-x-auto max-h-[56vh] scrollbar-thin">
              <table className="w-full border-collapse text-center text-xs">
                <thead className={`sticky top-0 shadow-sm z-10 ${
                  isDark ? 'bg-[#0a1118] text-slate-200 border-b border-[#223344]' : 'bg-slate-100 text-slate-800 border-b border-slate-300'
                }`}>
                  <tr>
                    <th className="p-2.5 border-r border-inherit text-left sticky left-0 z-20 bg-inherit whitespace-nowrap">
                      พนักงาน
                    </th>
                    <th className="p-2.5 border-r border-inherit whitespace-nowrap">แผนก</th>
                    {daysList.map(d => {
                      const dObj = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, d);
                      const isWeekend = dObj.getDay() === 0 || dObj.getDay() === 6;
                      return (
                        <th 
                          key={d} 
                          className={`p-1.5 border-r border-inherit font-mono min-w-[32px] ${
                            isWeekend ? (isDark ? 'text-amber-400 bg-amber-500/10' : 'text-amber-700 bg-amber-50') : ''
                          }`}
                        >
                          {d}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-inherit font-mono">
                  {targetEmployees.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(emp => {
                    const empKey = (emp.empNo || '').trim().toUpperCase();
                    return (
                      <tr key={emp.empNo} className={`transition ${
                        isDark ? 'hover:bg-teal-500/5' : 'hover:bg-slate-50'
                      }`}>
                        <td className="p-2 text-left font-sans font-medium border-r border-inherit sticky left-0 z-10 bg-inherit whitespace-nowrap">
                          <span className="font-semibold text-slate-100">{emp.firstName} {emp.familyName}</span>
                          <span className="text-[10px] font-mono text-slate-400 ml-1.5">({emp.empNo})</span>
                        </td>
                        <td className="p-2 font-bold text-teal-300 border-r border-inherit whitespace-nowrap">
                          {emp.department}
                        </td>
                        {daysList.map(d => {
                          const dStr = `${selectedMonthYear}-${String(d).padStart(2, '0')}`;
                          const code = shiftPlanMap.get(`${empKey}_${dStr}`) || '-';
                          const isOff = code === 'OFF';
                          return (
                            <td 
                              key={d} 
                              className={`p-1 text-[11px] border-r border-inherit ${
                                isOff 
                                  ? 'text-slate-500' 
                                  : code !== '-' 
                                    ? 'text-teal-300 font-bold bg-teal-500/5' 
                                    : 'text-slate-600'
                              }`}
                            >
                              {code}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className={`p-2.5 border-t flex items-center justify-between text-xs ${
              isDark ? 'bg-[#0d151e] border-[#223344] text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
            }`}>
              <div>
                แสดงแถว {(currentPage - 1) * PAGE_SIZE + 1} - {Math.min(currentPage * PAGE_SIZE, targetEmployees.length)} จาก {targetEmployees.length} คน
              </div>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="p-1 rounded border border-inherit disabled:opacity-40 hover:bg-slate-700/20 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 font-mono font-semibold">
                  {currentPage} / {Math.max(1, Math.ceil(targetEmployees.length / PAGE_SIZE))}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= Math.ceil(targetEmployees.length / PAGE_SIZE)}
                  onClick={() => setPage(p => Math.min(Math.ceil(targetEmployees.length / PAGE_SIZE), p + 1))}
                  className="p-1 rounded border border-inherit disabled:opacity-40 hover:bg-slate-700/20 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ASYNC PDF GENERATION PROGRESS MODAL & OVERLAY */}
      {/* ========================================================================= */}
      {isExportingPDF && pdfProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`w-full max-w-lg rounded-2xl border shadow-2xl p-6 relative overflow-hidden ${
            isDark ? 'bg-[#0f1722] border-[#223344] text-white' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            {/* Ambient background glow */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 space-y-5">
              {/* Header with Icon */}
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-600 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-teal-500/20">
                    <Printer className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base flex items-center gap-2">
                      กำลังสร้างและส่งออกไฟล์ PDF Time Sheet
                    </h3>
                    <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {pdfProgress.status === 'saving' 
                        ? 'กำลังรวบรวมหน้าเอกสารและเริ่มดาวน์โหลด...' 
                        : pdfProgress.status === 'cancelled'
                        ? 'กำลังยกเลิกการทำงาน...'
                        : 'กำลังประมวลผลข้อมูลและจัดเรียงหน้าตามมาตรฐาน Siemens'}
                    </p>
                  </div>
                </div>

                {pdfProgress.status === 'processing' && (
                  <button
                    type="button"
                    onClick={handleCancelPDFExport}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                    title="ยกเลิกการส่งออก"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Progress Percentage Badge & Counter */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Loader2 className="w-4 h-4 text-teal-400 animate-spin" />
                  <span className="text-xs font-semibold">
                    ความคืบหน้า: <strong className="text-teal-400 font-mono text-sm">{pdfProgress.current}</strong> / {pdfProgress.total} คน
                  </span>
                </div>
                <div className="font-mono text-lg font-bold text-teal-400">
                  {pdfProgress.percent}%
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-700/40 rounded-full h-3.5 p-0.5 overflow-hidden border border-slate-700/50">
                <div 
                  className="bg-gradient-to-r from-teal-500 via-cyan-400 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out shadow-sm"
                  style={{ width: `${Math.max(4, pdfProgress.percent)}%` }}
                />
              </div>

              {/* Current Employee Info Card */}
              <div className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                isDark ? 'bg-[#14202d] border-[#223547]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex items-center justify-between text-slate-400 text-[11px]">
                  <span>พนักงานที่กำลังจัดทำหน้าเอกสาร:</span>
                  {pdfProgress.department && (
                    <span className="px-1.5 py-0.5 rounded font-mono bg-teal-500/20 text-teal-300 font-semibold">
                      แผนก {pdfProgress.department}
                    </span>
                  )}
                </div>
                <div className="font-semibold text-sm truncate text-teal-300">
                  {pdfProgress.currentEmpName || 'กำลังเตรียมข้อมูล...'}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-700/30">
                <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-teal-400" />
                  <span>ระบบทำงานแบบ Asynchronous ช่วยให้เบราว์เซอร์ไม่ค้าง</span>
                </div>

                {pdfProgress.status === 'processing' && (
                  <button
                    type="button"
                    onClick={handleCancelPDFExport}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 transition cursor-pointer"
                  >
                    ยกเลิก (Cancel)
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
