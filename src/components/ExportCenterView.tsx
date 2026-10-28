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
import { buildTimeSheetForEmployee, buildTimeSheetsInBatch, getEmployeeLookupKeys, getRecordLookupKeys } from '../utils/timeCalc';
import { exportTimeSheetsToPDF, PDFExportProgress } from '../utils/pdfExport';
import { 
  generatePayrollCSV, 
  generatePayrollExcel, 
  generatePayrollTSV, 
  generateProductivityExcel,
  generateProductivityCSV,
  ProductivityRowData,
  filterPayrollEligibleSummaries, 
  downloadBlob,
  downloadWorkbook,
  escapeCSV,
  ANNUAL_TEMPLATE_MONTH_NAMES,
  isSameDepartment,
  isMLRDepartment,
  isMRLDepartment
} from '../utils/fileParser';
import { 
  exportAllExceptMLRPayrollPDF, 
  exportMLROnlyPayrollPDF, 
  exportBothSeparatedPayrollPDF, 
  generatePayrollSummaryReportPDF 
} from '../utils/payrollSummaryReportPdf';
import * as XLSX from 'xlsx';
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
  AlertCircle,
  Download,
  Eye,
  TrendingUp,
  BarChart3,
  Briefcase
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

type MainTab = 'payroll' | 'productivity' | 'pdf' | 'attendance' | 'roster';

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

  // Scope Settings - Defaults to 'dept' for General, 'all' for others
  const [exportScope, setExportScope] = useState<'all' | 'dept' | 'single'>(() => {
    return currentUser.role === 'General' ? 'dept' : 'all';
  });
  const [targetDept, setTargetDept] = useState<string>(() => {
    if (currentUser.role === 'General' && currentUser.department && currentUser.department !== 'ALL') {
      return currentUser.department;
    }
    return selectedDepartment !== 'ALL' ? selectedDepartment : (employees[0]?.department || 'GM');
  });
  const [targetEmpNo, setTargetEmpNo] = useState<string>(employees[0]?.empNo || '');

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterOnlyExtraIncome, setFilterOnlyExtraIncome] = useState<boolean>(true);
  const [separateMLRExport, setSeparateMLRExport] = useState<boolean>(false);
  const [mlrViewFilter, setMlrViewFilter] = useState<'mlr' | 'other'>('mlr');
  const [copiedNotification, setCopiedNotification] = useState<boolean>(false);
  const [isExportingPDF, setIsExportingPDF] = useState<boolean>(false);
  const [isGeneratingPayrollPDF, setIsGeneratingPayrollPDF] = useState<boolean>(false);
  const [payrollToast, setPayrollToast] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);

  const showPayrollToast = (text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setPayrollToast({ text, type });
    setTimeout(() => {
      setPayrollToast(null);
    }, 4500);
  };

  // Productivity Tab State
  const [productivityDeptFilter, setProductivityDeptFilter] = useState<string>('ALL');
  const [productivitySearch, setProductivitySearch] = useState<string>('');
  const [productivityShiftFilter, setProductivityShiftFilter] = useState<'all' | 'shift' | 'office'>('all');
  const [productivityPage, setProductivityPage] = useState<number>(1);

  // Pagination for high performance
  const [page, setPage] = useState<number>(1);
  const PAGE_SIZE = 20;

  // Multi-select for PDF batch
  const [selectedEmpNosForPDF, setSelectedEmpNosForPDF] = useState<Set<string>>(() => new Set());

  // PDF Export Progress State
  const [pdfProgress, setPdfProgress] = useState<PDFExportProgress | null>(null);
  const cancelPDFExportRef = useRef<boolean>(false);

  const manualOverrides = useMemo(() => storage.getManualOverrides(), []);
  const departments = useMemo(() => storage.getDepartments(), [employees]);

  // Active shift plans: authoritative storage data fallback to ensure complete shift plan data on export
  const activeShiftPlans = useMemo(() => {
    const stored = storage.getShiftPlans();
    if (stored && stored.length > 0) return stored;
    return shiftPlans || [];
  }, [shiftPlans]);

  // Authoritative employee master list for Export Center (strictly from Employee Master)
  const effectiveEmployees = useMemo(() => {
    const baseEmployees = employees.length > 0 ? employees : storage.getEmployees();
    return baseEmployees.filter(e => Boolean(e && e.empNo && e.isActive !== false));
  }, [employees]);

  // Filter employees according to chosen scope
  const targetEmployees = useMemo(() => {
    let list: Employee[] = [];
    if (currentUser.role === 'General' && currentUser.department && currentUser.department !== 'ALL') {
      list = effectiveEmployees.filter(e => isSameDepartment(e.department, currentUser.department));
      if (exportScope === 'single') {
        const selKeys = getEmployeeLookupKeys({ empNo: targetEmpNo, gid: targetEmpNo, empCode: targetEmpNo });
        list = list.filter(e => {
          const empKeys = getEmployeeLookupKeys(e);
          for (const k of selKeys) {
            if (empKeys.has(k)) return true;
          }
          return false;
        });
      }
    } else if (exportScope === 'single') {
      const selKeys = getEmployeeLookupKeys({ empNo: targetEmpNo, gid: targetEmpNo, empCode: targetEmpNo });
      list = effectiveEmployees.filter(e => {
        const empKeys = getEmployeeLookupKeys(e);
        for (const k of selKeys) {
          if (empKeys.has(k)) return true;
        }
        return false;
      });
    } else if (exportScope === 'dept') {
      list = effectiveEmployees.filter(e => isSameDepartment(e.department, targetDept));
    } else {
      list = effectiveEmployees;
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
  }, [exportScope, targetDept, targetEmpNo, effectiveEmployees, searchQuery]);

  // Compute summaries on-demand for target employees in ultra-fast batch mode (<10ms)
  const computedSummaries: TimeSheetSummary[] = useMemo(() => {
    // If on roster tab, summaries are not needed, saving heavy computation
    if (activeTab === 'roster') return [];

    return buildTimeSheetsInBatch(
      targetEmployees,
      selectedMonthYear,
      shiftCodes,
      activeShiftPlans,
      biometricPunches,
      otRecords,
      otherAllowances,
      manualOverrides
    );
  }, [activeTab, targetEmployees, selectedMonthYear, shiftCodes, activeShiftPlans, biometricPunches, otRecords, otherAllowances, manualOverrides]);

  // Pre-computed summaries for all departments (used for full-company, MRL separation, and Productivity)
  const allDeptsSummaries = useMemo(() => {
    if (activeTab !== 'payroll' && activeTab !== 'productivity') return [];
    if (exportScope === 'all' && !searchQuery.trim() && computedSummaries.length > 0) return computedSummaries;
    return buildTimeSheetsInBatch(
      effectiveEmployees,
      selectedMonthYear,
      shiftCodes,
      activeShiftPlans,
      biometricPunches,
      otRecords,
      otherAllowances,
      manualOverrides
    );
  }, [activeTab, exportScope, searchQuery, computedSummaries, effectiveEmployees, selectedMonthYear, shiftCodes, activeShiftPlans, biometricPunches, otRecords, otherAllowances, manualOverrides]);

  // Comprehensive company-wide Productivity data for all departments
  const allProductivityRows = useMemo<ProductivityRowData[]>(() => {
    if (activeTab !== 'productivity') return [];

    const [yStr, mStr] = selectedMonthYear.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    const daysInMonth = new Date(year, month, 0).getDate();

    // Map summaries by employee lookup keys
    const summaryByKey = new Map<string, TimeSheetSummary>();
    allDeptsSummaries.forEach(s => {
      const keys = getEmployeeLookupKeys(s.employee || { empNo: s.empNo, gid: s.gid });
      keys.forEach(k => summaryByKey.set(k, s));
    });

    // Map plans by key_date for instant O(1) lookup
    const planByKeyDate = new Map<string, DailyShiftPlan>();
    (activeShiftPlans || []).forEach(p => {
      if (!p.date || !p.date.startsWith(selectedMonthYear)) return;
      const recKeys = getRecordLookupKeys(p);
      recKeys.forEach(k => {
        planByKeyDate.set(`${k}_${p.date}`, p);
      });
    });

    return effectiveEmployees.map(emp => {
      const empKeys = getEmployeeLookupKeys(emp);
      let summary: TimeSheetSummary | undefined;
      for (const k of empKeys) {
        summary = summaryByKey.get(k);
        if (summary) break;
      }

      let scheduledWorkDays = 0;
      let annualLeaveDays = 0;
      let sickLeaveDays = 0;
      let otherLeaveDays = 0;

      if (summary && summary.rows && summary.rows.length > 0) {
        summary.rows.forEach(r => {
          const rawCode = (r.shiftCode || '').trim();
          const cleanCode = rawCode.toUpperCase().replace(/[-_].*$/, '');
          const codeLeave = (r.codeLeave || '').trim().toUpperCase();

          const isAL = codeLeave === 'A' || cleanCode.startsWith('AL') || cleanCode === 'VAC';
          const isSL = codeLeave === 'S' || cleanCode.startsWith('SL') || cleanCode === 'SICK';
          const isOther = codeLeave === 'C' || codeLeave === 'O' || codeLeave === 'BL' || 
            cleanCode.startsWith('CL') || cleanCode.startsWith('BL') || cleanCode.startsWith('ML') || 
            cleanCode.startsWith('PL') || cleanCode.startsWith('UL') || cleanCode.startsWith('EL') || 
            cleanCode.startsWith('FL') || cleanCode.startsWith('ORD') || cleanCode.startsWith('MIL');

          if (isAL) {
            const isHalf = cleanCode === 'AL2' || cleanCode === 'AL2U';
            annualLeaveDays += isHalf ? 0.5 : 1.0;
          } else if (isSL) {
            const isHalf = cleanCode === 'SL2' || cleanCode === 'SL2U';
            sickLeaveDays += isHalf ? 0.5 : 1.0;
          } else if (isOther) {
            const isHalf = cleanCode.endsWith('2');
            otherLeaveDays += isHalf ? 0.5 : 1.0;
          }

          const isOff = cleanCode === 'OFF' || cleanCode === 'H' || cleanCode === 'PH' || cleanCode === 'HOL';
          const isWeekend = r.dayOfWeek === 'Sat' || r.dayOfWeek === 'Sun';

          if (!isOff) {
            if (isAL || isSL || isOther) {
              scheduledWorkDays += 1;
            } else {
              const sc = shiftCodes.find(c => c.code.toUpperCase() === cleanCode);
              if (sc) {
                if (sc.isWorkingDay) scheduledWorkDays += 1;
              } else if (!emp.isShiftWorker) {
                if (!isWeekend) scheduledWorkDays += 1;
              } else {
                scheduledWorkDays += 1;
              }
            }
          }
        });
      } else {
        // Fallback: scan all days of selectedMonthYear
        for (let d = 1; d <= daysInMonth; d++) {
          const dayPadded = String(d).padStart(2, '0');
          const dateStr = `${selectedMonthYear}-${dayPadded}`;
          const dateObj = new Date(year, month - 1, d);
          const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

          let plan: DailyShiftPlan | undefined;
          for (const k of empKeys) {
            plan = planByKeyDate.get(`${k}_${dateStr}`);
            if (plan) break;
          }

          const rawCode = plan ? plan.shiftCode.trim() : (isWeekend ? 'OFF' : 'D');
          const cleanCode = rawCode.toUpperCase().replace(/[-_].*$/, '');

          const isAL = cleanCode.startsWith('AL') || cleanCode === 'VAC';
          const isSL = cleanCode.startsWith('SL') || cleanCode === 'SICK';
          const isOther = cleanCode.startsWith('CL') || cleanCode.startsWith('BL') || cleanCode.startsWith('ML') || cleanCode.startsWith('PL') || cleanCode.startsWith('UL') || cleanCode.startsWith('EL') || cleanCode.startsWith('FL');

          if (isAL) {
            const isHalf = cleanCode === 'AL2' || cleanCode === 'AL2U';
            annualLeaveDays += isHalf ? 0.5 : 1.0;
          } else if (isSL) {
            const isHalf = cleanCode === 'SL2' || cleanCode === 'SL2U';
            sickLeaveDays += isHalf ? 0.5 : 1.0;
          } else if (isOther) {
            const isHalf = cleanCode.endsWith('2');
            otherLeaveDays += isHalf ? 0.5 : 1.0;
          }

          const isOff = cleanCode === 'OFF' || cleanCode === 'H' || cleanCode === 'PH';
          if (!isOff) {
            if (isAL || isSL || isOther) {
              scheduledWorkDays += 1;
            } else {
              const sc = shiftCodes.find(c => c.code.toUpperCase() === cleanCode);
              if (sc ? sc.isWorkingDay : (!emp.isShiftWorker ? !isWeekend : true)) {
                scheduledWorkDays += 1;
              }
            }
          }
        }
      }

      // Ensure office workers have default Mon-Fri working days if no roster
      if (scheduledWorkDays === 0 && !emp.isShiftWorker) {
        for (let d = 1; d <= daysInMonth; d++) {
          const dateObj = new Date(year, month - 1, d);
          if (dateObj.getDay() !== 0 && dateObj.getDay() !== 6) {
            scheduledWorkDays += 1;
          }
        }
      }

      const otHours = summary 
        ? Number(((summary.totalOT1_5 || 0) + (summary.totalOT3_0 || 0)).toFixed(2))
        : 0;

      let fName = emp.firstName || '';
      let lName = emp.familyName || '';
      if (!fName && !lName && (emp as any).name) {
        const parts = String((emp as any).name).trim().split(/\s+/);
        fName = parts[0] || '';
        lName = parts.slice(1).join(' ') || '';
      }

      // Requirement: L Productivity Count = ถ้าเป็น Office = 0 และ Shift work = Y
      const productivityCount: string | number = emp.isShiftWorker ? 'Y' : 0;

      return {
        monthYear: selectedMonthYear,
        department: emp.department || '',
        personnelNumber: emp.empNo || emp.empCode || emp.gid || '',
        firstName: fName,
        lastName: lName,
        functionTitle: emp.functionTitle || (emp as any).position || (emp as any).role || '',
        costCenter: emp.costCenter || 'C93056',
        availableDays: scheduledWorkDays,
        annualLeaveDays,
        sickLeaveDays,
        otherLeaveDays,
        productivityCount,
        otHours
      };
    });
  }, [activeTab, selectedMonthYear, allDeptsSummaries, effectiveEmployees, shiftCodes, activeShiftPlans]);

  // Displayed productivity rows filtered by department and search
  const displayedProductivityRows = useMemo(() => {
    let list = allProductivityRows;

    if (productivityDeptFilter !== 'ALL') {
      list = list.filter(r => isSameDepartment(r.department, productivityDeptFilter));
    }

    if (productivityShiftFilter === 'shift') {
      list = list.filter(r => r.productivityCount === 'Y');
    } else if (productivityShiftFilter === 'office') {
      list = list.filter(r => r.productivityCount === 0 || r.productivityCount === '0');
    }

    if (productivitySearch.trim()) {
      const q = productivitySearch.trim().toLowerCase();
      list = list.filter(r => 
        (r.personnelNumber && r.personnelNumber.toLowerCase().includes(q)) ||
        (r.firstName && r.firstName.toLowerCase().includes(q)) ||
        (r.lastName && r.lastName.toLowerCase().includes(q)) ||
        (r.department && r.department.toLowerCase().includes(q)) ||
        (r.functionTitle && r.functionTitle.toLowerCase().includes(q)) ||
        (r.costCenter && r.costCenter.toLowerCase().includes(q))
      );
    }

    return list;
  }, [allProductivityRows, productivityDeptFilter, productivityShiftFilter, productivitySearch]);

  // Productivity Totals KPI
  const productivityTotals = useMemo(() => {
    let totalAvailable = 0;
    let totalAL = 0;
    let totalSL = 0;
    let totalOther = 0;
    let totalOT = 0;
    let shiftCount = 0;
    let officeCount = 0;

    displayedProductivityRows.forEach(r => {
      totalAvailable += Number(r.availableDays || 0);
      totalAL += Number(r.annualLeaveDays || 0);
      totalSL += Number(r.sickLeaveDays || 0);
      totalOther += Number(r.otherLeaveDays || 0);
      totalOT += Number(r.otHours || 0);
      if (r.productivityCount === 'Y') shiftCount++;
      else officeCount++;
    });

    return {
      totalEmployees: displayedProductivityRows.length,
      shiftCount,
      officeCount,
      totalAvailable: Number(totalAvailable.toFixed(1)),
      totalAL: Number(totalAL.toFixed(1)),
      totalSL: Number(totalSL.toFixed(1)),
      totalOther: Number(totalOther.toFixed(1)),
      totalLeave: Number((totalAL + totalSL + totalOther).toFixed(1)),
      totalOT: Number(totalOT.toFixed(2))
    };
  }, [displayedProductivityRows]);

  // MLR department-specific summaries (across company or filtered by search if present)
  const mlrSummaries = useMemo(() => {
    const base = (exportScope === 'all' && searchQuery.trim()) ? computedSummaries : allDeptsSummaries;
    return base.filter(s => isMLRDepartment(s.employee?.department));
  }, [exportScope, searchQuery, computedSummaries, allDeptsSummaries]);

  // All other departments (excluding MLR)
  const nonMLRSummaries = useMemo(() => {
    const base = (exportScope === 'all' && searchQuery.trim()) ? computedSummaries : allDeptsSummaries;
    return base.filter(s => !isMLRDepartment(s.employee?.department));
  }, [exportScope, searchQuery, computedSummaries, allDeptsSummaries]);

  // Extra income filters for MLR and Non-MLR
  const mlrEligibleSummaries = useMemo(() => {
    return filterPayrollEligibleSummaries(mlrSummaries);
  }, [mlrSummaries]);

  const nonMLREligibleSummaries = useMemo(() => {
    return filterPayrollEligibleSummaries(nonMLRSummaries);
  }, [nonMLRSummaries]);

  // Filter only employees with extra income (OT > 0 or Allowance > 0)
  const eligibleSummaries = useMemo(() => {
    return filterPayrollEligibleSummaries(computedSummaries);
  }, [computedSummaries]);

  // Summaries to display in the preview table
  const displayedSummaries = useMemo(() => {
    if (activeTab === 'payroll') {
      if (separateMLRExport) {
        if (mlrViewFilter === 'mlr') {
          return filterOnlyExtraIncome ? mlrEligibleSummaries : mlrSummaries;
        } else {
          return filterOnlyExtraIncome ? nonMLREligibleSummaries : nonMLRSummaries;
        }
      }
      return filterOnlyExtraIncome ? eligibleSummaries : computedSummaries;
    }
    return computedSummaries;
  }, [activeTab, separateMLRExport, mlrViewFilter, filterOnlyExtraIncome, mlrEligibleSummaries, mlrSummaries, nonMLREligibleSummaries, nonMLRSummaries, eligibleSummaries, computedSummaries]);

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

  // Helper to obtain all departments payroll summaries
  const getAllDeptsSummaries = () => {
    if (allDeptsSummaries && allDeptsSummaries.length > 0) return allDeptsSummaries;
    if (exportScope === 'all') return computedSummaries;
    return buildTimeSheetsInBatch(
      effectiveEmployees,
      selectedMonthYear,
      shiftCodes,
      activeShiftPlans,
      biometricPunches,
      otRecords,
      otherAllowances,
      manualOverrides
    );
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

  // Dedicated ALL Departments Payroll Excel (.xlsx) Export
  const handleExportAllDeptsPayrollExcel = () => {
    const allSummaries = getAllDeptsSummaries();
    const excelBytes = generatePayrollExcel(allSummaries, selectedMonthYear, filterOnlyExtraIncome);
    downloadBlob(
      excelBytes,
      `Siemens_Payroll_Summary_AllDepts_${selectedMonthYear}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  };

  // Dedicated ALL Departments Payroll CSV Export
  const handleExportAllDeptsPayrollCSV = () => {
    const allSummaries = getAllDeptsSummaries();
    const csvData = generatePayrollCSV(allSummaries, selectedMonthYear, filterOnlyExtraIncome);
    downloadBlob(
      csvData,
      `Siemens_Payroll_Summary_AllDepts_${selectedMonthYear}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  // Dedicated MLR Department Payroll Excel (.xlsx) Export
  const handleExportMLRPayrollExcel = () => {
    const excelBytes = generatePayrollExcel(mlrSummaries, selectedMonthYear, filterOnlyExtraIncome);
    downloadBlob(
      excelBytes,
      `Siemens_Payroll_Summary_MLR_${selectedMonthYear}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  };

  // Dedicated MLR Department Payroll CSV Export
  const handleExportMLRPayrollCSV = () => {
    const csvData = generatePayrollCSV(mlrSummaries, selectedMonthYear, filterOnlyExtraIncome);
    downloadBlob(
      csvData,
      `Siemens_Payroll_Summary_MLR_${selectedMonthYear}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  // Dedicated Non-MLR (Other departments without MLR) Payroll Excel (.xlsx) Export
  const handleExportNonMLRPayrollExcel = () => {
    const excelBytes = generatePayrollExcel(nonMLRSummaries, selectedMonthYear, filterOnlyExtraIncome);
    downloadBlob(
      excelBytes,
      `Siemens_Payroll_Summary_AllExceptMLR_${selectedMonthYear}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  };

  // Dedicated Non-MLR (Other departments without MLR) Payroll CSV Export
  const handleExportNonMLRPayrollCSV = () => {
    const csvData = generatePayrollCSV(nonMLRSummaries, selectedMonthYear, filterOnlyExtraIncome);
    downloadBlob(
      csvData,
      `Siemens_Payroll_Summary_AllExceptMLR_${selectedMonthYear}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  // Automatic Dual-file Export: MLR file + Other Departments file
  const handleExportBothSeparatedPayroll = async () => {
    // 1. Export Other Depts (Exclude MLR)
    handleExportNonMLRPayrollExcel();
    // Brief delay to allow browser to trigger first download cleanly
    await new Promise(r => setTimeout(r, 600));
    // 2. Export MLR separately
    handleExportMLRPayrollExcel();
  };

  // Dedicated PDF Export: All departments except MLR (ผู้มีรายได้เพิ่ม แผนกทั้งหมดยกเว้น MLR)
  const handleExportNonMLRPayrollPDF = async () => {
    try {
      setIsGeneratingPayrollPDF(true);
      showPayrollToast('กำลังสร้าง PDF สรุปผู้มีรายได้เพิ่ม (ทุกแผนก ยกเว้น MLR)...', 'info');
      const allSums = getAllDeptsSummaries();
      const success = await exportAllExceptMLRPayrollPDF(allSums, selectedMonthYear);
      setIsGeneratingPayrollPDF(false);
      if (success) {
        showPayrollToast('ดาวน์โหลด PDF สรุปผู้มีรายได้เพิ่ม (ทุกแผนก ยกเว้น MLR) เรียบร้อยแล้ว', 'success');
      } else {
        showPayrollToast('ไม่พบข้อมูลพนักงานที่มีรายได้เพิ่ม (OT / ค่าเบี้ยเลี้ยง) ในแผนกอื่นๆ ประจำงวดนี้', 'error');
      }
    } catch (err: any) {
      setIsGeneratingPayrollPDF(false);
      showPayrollToast('เกิดข้อผิดพลาดในการสร้าง PDF: ' + (err?.message || 'โปรดลองใหม่'), 'error');
    }
  };

  // Dedicated PDF Export: MLR department only (ผู้มีรายได้เพิ่ม เฉพาะแผนก MLR)
  const handleExportMLRPayrollPDF = async () => {
    try {
      setIsGeneratingPayrollPDF(true);
      showPayrollToast('กำลังสร้าง PDF สรุปผู้มีรายได้เพิ่ม (เฉพาะแผนก MLR)...', 'info');
      const allSums = getAllDeptsSummaries();
      const success = await exportMLROnlyPayrollPDF(allSums, selectedMonthYear);
      setIsGeneratingPayrollPDF(false);
      if (success) {
        showPayrollToast('ดาวน์โหลด PDF สรุปผู้มีรายได้เพิ่ม (เฉพาะแผนก MLR) เรียบร้อยแล้ว', 'success');
      } else {
        showPayrollToast('ไม่พบข้อมูลพนักงานที่มีรายได้เพิ่ม (OT / ค่าเบี้ยเลี้ยง) ในแผนก MLR ประจำงวดนี้', 'error');
      }
    } catch (err: any) {
      setIsGeneratingPayrollPDF(false);
      showPayrollToast('เกิดข้อผิดพลาดในการสร้าง PDF: ' + (err?.message || 'โปรดลองใหม่'), 'error');
    }
  };

  // Dual PDF Export: All departments except MLR + MLR only (ดาวน์โหลดแยก 2 ไฟล์พร้อมกัน)
  const handleExportBothSeparatedPayrollPDF = async () => {
    try {
      setIsGeneratingPayrollPDF(true);
      showPayrollToast('กำลังสร้างไฟล์ PDF ทั้ง 2 ชุด (ยกเว้น MLR + เฉพาะ MLR)...', 'info');
      const allSums = getAllDeptsSummaries();
      const { nonMLROk, mlrOk } = await exportBothSeparatedPayrollPDF(allSums, selectedMonthYear);
      setIsGeneratingPayrollPDF(false);
      if (nonMLROk || mlrOk) {
        showPayrollToast('ดาวน์โหลดแบบฟอร์ม PDF สรุปทั้ง 2 ชุดเรียบร้อยแล้ว', 'success');
      } else {
        showPayrollToast('ไม่พบข้อมูลพนักงานที่มีรายได้เพิ่มประจำงวดนี้', 'error');
      }
    } catch (err: any) {
      setIsGeneratingPayrollPDF(false);
      showPayrollToast('เกิดข้อผิดพลาดในการสร้าง PDF: ' + (err?.message || 'โปรดลองใหม่'), 'error');
    }
  };

  // PDF Export for current displayed summaries
  const handleExportCurrentViewPayrollPDF = async () => {
    try {
      setIsGeneratingPayrollPDF(true);
      showPayrollToast('กำลังสร้าง PDF สรุปผู้มีรายได้เพิ่มตามมุมมองปัจจุบัน...', 'info');
      const scopeLabel = exportScope === 'all' 
        ? 'ทุกแผนก (All Departments)' 
        : exportScope === 'dept' 
        ? `แผนก ${targetDept}` 
        : `พนักงาน ${targetEmpNo}`;
      const success = await generatePayrollSummaryReportPDF({
        summaries: displayedSummaries,
        monthYear: selectedMonthYear,
        scopeType: exportScope === 'all' ? 'all' : 'custom',
        subTitle: scopeLabel,
        fileName: `Siemens_TimeSheet_Summary_Report_${exportScope === 'all' ? 'All' : targetDept}_${selectedMonthYear}.pdf`
      });
      setIsGeneratingPayrollPDF(false);
      if (success) {
        showPayrollToast(`ดาวน์โหลด PDF สรุปผู้มีรายได้เพิ่ม (${scopeLabel}) เรียบร้อยแล้ว`, 'success');
      } else {
        showPayrollToast('ไม่พบข้อมูลพนักงานที่มีรายได้เพิ่มในมุมมองปัจจุบัน', 'error');
      }
    } catch (err: any) {
      setIsGeneratingPayrollPDF(false);
      showPayrollToast('เกิดข้อผิดพลาดในการสร้าง PDF: ' + (err?.message || 'โปรดลองใหม่'), 'error');
    }
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

  // Handle Productivity Excel (.xlsx) Export
  const handleExportProductivityExcel = (customRows?: ProductivityRowData[], suffix?: string) => {
    const data = customRows || allProductivityRows;
    const excelBytes = generateProductivityExcel(data, selectedMonthYear);
    const scopeLabel = suffix || (productivityDeptFilter === 'ALL' ? 'AllDepts' : productivityDeptFilter);
    downloadBlob(
      excelBytes,
      `Siemens_Productivity_${scopeLabel}_${selectedMonthYear}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  };

  // Handle Productivity CSV Export
  const handleExportProductivityCSV = (customRows?: ProductivityRowData[], suffix?: string) => {
    const data = customRows || allProductivityRows;
    const csvData = generateProductivityCSV(data, selectedMonthYear);
    const scopeLabel = suffix || (productivityDeptFilter === 'ALL' ? 'AllDepts' : productivityDeptFilter);
    downloadBlob(
      csvData,
      `Siemens_Productivity_${scopeLabel}_${selectedMonthYear}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  // Handle Copy Productivity CSV to clipboard
  const handleCopyProductivityCSV = async () => {
    const csvData = generateProductivityCSV(displayedProductivityRows, selectedMonthYear);
    try {
      await navigator.clipboard.writeText(csvData);
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

  // Handle Shift Matrix Excel (.xlsx) Export with Sheet name e.g. SEP-2026
  const handleExportRosterExcel = () => {
    const [yStr, mStr] = selectedMonthYear.split('-');
    const yNum = parseInt(yStr, 10) || 2026;
    const mNum = parseInt(mStr, 10) || 9;
    const monthInfo = ANNUAL_TEMPLATE_MONTH_NAMES[mNum - 1] || { short: 'SEP' };
    const sheetName = `${monthInfo.short}-${yNum}`;

    const headers = ['Emp No', 'Name', 'Department', ...daysList.map(d => String(d).padStart(2, '0')), 'Total_Work_Shifts', 'Total_OFF'];
    const rows = targetEmployees.map(emp => {
      const empKey = (emp.empNo || '').trim().toUpperCase();
      let workCount = 0;
      let offCount = 0;
      const rowObj: any = {
        'Emp No': emp.empNo || '',
        'Name': `${emp.firstName || ''} ${emp.familyName || ''}`.trim() || (emp as any).name || emp.empNo,
        'Department': emp.department || '',
      };
      daysList.forEach(d => {
        const dStr = `${selectedMonthYear}-${String(d).padStart(2, '0')}`;
        const code = shiftPlanMap.get(`${empKey}_${dStr}`) || '-';
        if (code === 'OFF') offCount++;
        else if (code !== '-') workCount++;
        rowObj[String(d).padStart(2, '0')] = code;
      });
      rowObj['Total_Work_Shifts'] = workCount;
      rowObj['Total_OFF'] = offCount;
      return rowObj;
    });

    const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    const colWidths = [
      { wch: 14 }, // Emp No
      { wch: 28 }, // Name
      { wch: 16 }, // Department
    ];
    for (let d = 1; d <= daysList.length; d++) {
      colWidths.push({ wch: 6 });
    }
    colWidths.push({ wch: 16 }); // Total_Work_Shifts
    colWidths.push({ wch: 12 }); // Total_OFF
    worksheet['!cols'] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    downloadWorkbook(workbook, `ShiftPlan_Matrix_${selectedDepartment}_${sheetName}.xlsx`);
  };

  // Handle Shift Matrix CSV Export
  const handleExportRosterCSV = () => {
    const BOM = '\uFEFF';
    const headerCols = ['Emp No', 'Name', 'Department', ...daysList.map(d => String(d).padStart(2, '0')), 'Total_Work_Shifts', 'Total_OFF'];
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
        escapeCSV(emp.empNo || ''),
        escapeCSV(`${emp.firstName || ''} ${emp.familyName || ''}`.trim() || (emp as any).name || emp.empNo),
        escapeCSV(emp.department || ''),
        ...dayCodes,
        workCount,
        offCount
      ].join(','));
    });
    const [yStr, mStr] = selectedMonthYear.split('-');
    const mNum = parseInt(mStr, 10) || 9;
    const shortM = ANNUAL_TEMPLATE_MONTH_NAMES[mNum - 1]?.short || 'SEP';
    downloadBlob(
      BOM + lines.join('\r\n'),
      `ShiftPlan_Matrix_${selectedDepartment}_${shortM}-${yStr}.csv`,
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
              ...(currentUser.role !== 'General' ? [{ id: 'all', label: 'ทุกแผนก', icon: Layers }] : []),
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
            currentUser.role === 'General' ? (
              <div className={`px-2.5 py-1.5 rounded border text-xs font-semibold flex items-center gap-1.5 ${
                isDark ? 'bg-[#0f1722] border-purple-500/40 text-purple-300' : 'bg-purple-50 border-purple-300 text-purple-800'
              }`} title={`Role General: สิทธิ์ดูเฉพาะแผนก ${currentUser.department}`}>
                <Eye className="w-3.5 h-3.5 text-purple-400" />
                <span>แผนก {currentUser.department} (View Only)</span>
              </div>
            ) : (
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
            )
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
              {employees
                .filter(emp => currentUser.role !== 'General' || !currentUser.department || currentUser.department === 'ALL' || isSameDepartment(emp.department, currentUser.department))
                .map(emp => (
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
          { id: 'productivity', label: '2. Export Productivity ทุกแผนก (Excel)', icon: TrendingUp, badge: '13 Columns' },
          { id: 'pdf', label: '3. พิมพ์ Time Sheet เป็นชุด (Batch PDF)', icon: Printer, badge: 'Official Form' },
          { id: 'attendance', label: '4. สรุปเวลาเข้า-ออก & รูดบัตร', icon: Clock, badge: 'Time Log' },
          { id: 'roster', label: '5. ตารางกะประจำเดือน (Shift Matrix)', icon: Calendar, badge: 'Matrix View' },
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id as MainTab);
              setPage(1);
              setProductivityPage(1);
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
          {/* Payroll Toast Notification */}
          {payrollToast && (
            <div className={`p-2.5 px-4 rounded border text-xs font-semibold flex items-center justify-between shadow-md transition ${
              payrollToast.type === 'error'
                ? 'bg-rose-950/70 text-rose-200 border-rose-500/60'
                : payrollToast.type === 'success'
                ? 'bg-emerald-950/70 text-emerald-200 border-emerald-500/60'
                : 'bg-sky-950/70 text-sky-200 border-sky-500/60'
            }`}>
              <div className="flex items-center space-x-2.5">
                {payrollToast.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : payrollToast.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                )}
                <span>{payrollToast.text}</span>
              </div>
              <button 
                type="button" 
                onClick={() => setPayrollToast(null)} 
                className="opacity-60 hover:opacity-100 ml-3 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Action Bar & Stats */}
          <div className={`p-3.5 rounded border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            {/* KPI Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs w-full md:w-auto">
              <div className={`p-2 rounded border ${isDark ? 'bg-[#0e1620] border-[#223344]' : 'bg-slate-50 border-slate-200'}`}>
                <div className="text-[10px] text-slate-400">
                  {separateMLRExport 
                    ? (mlrViewFilter === 'mlr' ? 'ผู้มีรายได้เสริม (แผนก MLR)' : 'ผู้มีรายได้เสริม (แผนกอื่นๆ)')
                    : 'ผู้มีรายได้เสริม'}
                </div>
                <div className="font-bold text-sm text-teal-400 font-mono">
                  {displayedSummaries.length} <span className="text-[10px] font-normal text-slate-400">
                    / {separateMLRExport ? (mlrViewFilter === 'mlr' ? mlrSummaries.length : nonMLRSummaries.length) : computedSummaries.length} คน
                  </span>
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

            {/* Export Buttons & Checkboxes */}
            <div className="flex items-center flex-wrap gap-2 w-full md:w-auto justify-end">
              {/* Checkbox 1: กรองเฉพาะผู้มีรายได้เสริม */}
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

              {/* Checkbox 2: แยกเฉพาะแผนก MLR ออกไป Export แยกแผนกเดียว (ไม่รวมกับแผนกอื่น) */}
              <label 
                id="checkbox-separate-mlr"
                className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded border text-xs cursor-pointer select-none transition ${
                  separateMLRExport
                    ? isDark
                      ? 'bg-teal-500/20 border-teal-400 text-teal-200 font-bold ring-1 ring-teal-400/40 shadow-sm'
                      : 'bg-teal-100 border-teal-500 text-teal-900 font-bold ring-1 ring-teal-500/30 shadow-sm'
                    : isDark
                      ? 'bg-[#16212e] border-[#2b3c4f] text-slate-400 hover:text-slate-200 hover:border-slate-500'
                      : 'bg-slate-100 border-slate-300 text-slate-600 hover:text-slate-800 hover:border-slate-400'
                }`}
                title="แยกเฉพาะแผนก MLR ออกไป Export ต่างหากเป็นไฟล์เดี่ยว จะไม่ถูกนำไปรวมกับแผนกอื่นที่มีอยู่ในระบบ"
              >
                <Building2 className={`w-3.5 h-3.5 ${separateMLRExport ? 'text-teal-400' : 'text-slate-400'}`} />
                <input
                  type="checkbox"
                  id="chk-separate-mlr"
                  checked={separateMLRExport}
                  onChange={e => {
                    setSeparateMLRExport(e.target.checked);
                    setPage(1);
                  }}
                  className="accent-teal-500 cursor-pointer"
                />
                <span>แยกเฉพาะแผนก MLR ออกไป Export (ไม่รวมกับแผนกอื่น)</span>
              </label>

              {/* Action Buttons based on separateMLRExport state */}
              {separateMLRExport ? (
                <>
                  <button
                    type="button"
                    id="btn-export-mlr-excel"
                    onClick={handleExportMLRPayrollExcel}
                    disabled={mlrSummaries.length === 0}
                    className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-bold text-xs bg-teal-600 hover:bg-teal-500 text-white shadow transition disabled:opacity-50 cursor-pointer"
                    title={`ดาวน์โหลดไฟล์ Excel .xlsx 14 คอลัมน์ เฉพาะแผนก MLR (${mlrSummaries.length} คน) ประจำงวด ${selectedMonthYear}`}
                  >
                    <FileSpreadsheet className="w-4 h-4 shrink-0 text-amber-300" />
                    <span>Export แผนก MLR (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    id="btn-export-mlr-pdf-quick"
                    onClick={handleExportMLRPayrollPDF}
                    disabled={isGeneratingPayrollPDF || mlrSummaries.length === 0}
                    className="flex items-center space-x-1.5 py-1.5 px-2.5 rounded font-bold text-xs bg-teal-700 hover:bg-teal-600 text-white border border-teal-400/30 shadow transition disabled:opacity-50 cursor-pointer"
                    title={`สร้างแบบฟอร์ม PDF สรุปผู้มีรายได้เพิ่มเฉพาะแผนก MLR สำหรับเซ็นอนุมัติ`}
                  >
                    <FileText className="w-4 h-4 shrink-0 text-amber-300" />
                    <span>PDF แผนก MLR</span>
                  </button>

                  <button
                    type="button"
                    id="btn-export-non-mlr-excel"
                    onClick={handleExportNonMLRPayrollExcel}
                    disabled={nonMLRSummaries.length === 0}
                    className="flex items-center space-x-1.5 py-1.5 px-2.5 rounded font-semibold text-xs bg-indigo-700 hover:bg-indigo-600 text-white shadow transition disabled:opacity-50 cursor-pointer"
                    title={`ดาวน์โหลดไฟล์ Excel .xlsx 14 คอลัมน์ แผนกอื่นๆ ทั้งหมดโดยไม่รวมแผนก MLR (${nonMLRSummaries.length} คน) ประจำงวด ${selectedMonthYear}`}
                  >
                    <Layers className="w-4 h-4 shrink-0 text-indigo-200" />
                    <span>Export แผนกอื่นๆ (ยกเว้น MLR) (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    id="btn-export-non-mlr-pdf-quick"
                    onClick={handleExportNonMLRPayrollPDF}
                    disabled={isGeneratingPayrollPDF || nonMLRSummaries.length === 0}
                    className="flex items-center space-x-1.5 py-1.5 px-2.5 rounded font-bold text-xs bg-indigo-800 hover:bg-indigo-700 text-white border border-indigo-400/30 shadow transition disabled:opacity-50 cursor-pointer"
                    title={`สร้างแบบฟอร์ม PDF สรุปผู้มีรายได้เพิ่มของแผนกอื่นๆ (ยกเว้น MLR) สำหรับเซ็นอนุมัติ`}
                  >
                    <FileText className="w-4 h-4 shrink-0 text-rose-300" />
                    <span>PDF ยกเว้น MLR</span>
                  </button>

                  <button
                    type="button"
                    id="btn-export-both-separated"
                    onClick={handleExportBothSeparatedPayroll}
                    disabled={mlrSummaries.length === 0 && nonMLRSummaries.length === 0}
                    className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-bold text-xs bg-gradient-to-r from-teal-600 to-indigo-600 hover:from-teal-500 hover:to-indigo-500 text-white shadow transition disabled:opacity-50 cursor-pointer"
                    title="ดาวน์โหลดแยก 2 ไฟล์พร้อมกันทันที: ไฟล์แผนก MLR 1 ไฟล์ และไฟล์แผนกอื่นๆ 1 ไฟล์"
                  >
                    <Download className="w-4 h-4 shrink-0 text-amber-300" />
                    <span>⚡ Excel แยก 2 ไฟล์</span>
                  </button>
                </>
              ) : exportScope === 'all' ? (
                <>
                  <button
                    type="button"
                    id="btn-export-payroll-excel"
                    onClick={handleExportPayrollExcel}
                    disabled={displayedSummaries.length === 0}
                    className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-semibold text-xs bg-teal-600 hover:bg-teal-500 text-white shadow transition disabled:opacity-50 cursor-pointer"
                    title={`ดาวน์โหลดไฟล์ Excel .xlsx 14 คอลัมน์ ทุกแผนก ประจำงวด ${selectedMonthYear}`}
                  >
                    <FileSpreadsheet className="w-4 h-4 shrink-0 text-amber-300" />
                    <span>Export ทุกแผนก Excel (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    id="btn-export-payroll-csv"
                    onClick={handleExportPayrollCSV}
                    disabled={displayedSummaries.length === 0}
                    className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow transition disabled:opacity-50 cursor-pointer"
                    title={`ดาวน์โหลดไฟล์ CSV 14 คอลัมน์ ทุกแผนก ประจำงวด ${selectedMonthYear}`}
                  >
                    <FileSpreadsheet className="w-4 h-4 shrink-0" />
                    <span>Export ทุกแผนก CSV</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    id="btn-export-payroll-excel"
                    onClick={handleExportPayrollExcel}
                    disabled={displayedSummaries.length === 0}
                    className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-semibold text-xs bg-teal-700 hover:bg-teal-600 text-white shadow transition disabled:opacity-50 cursor-pointer"
                    title={`ดาวน์โหลดไฟล์ Excel .xlsx เฉพาะแผนก ${targetDept}`}
                  >
                    <FileSpreadsheet className="w-4 h-4 shrink-0 text-amber-300" />
                    <span>Export แผนก {targetDept} (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    id="btn-export-all-depts-payroll-excel"
                    onClick={handleExportAllDeptsPayrollExcel}
                    className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-semibold text-xs bg-teal-600 hover:bg-teal-500 text-white shadow transition cursor-pointer"
                    title={`ดาวน์โหลดไฟล์ Excel รวมทุกแผนกในบริษัท ประจำเดือน ${selectedMonthYear}`}
                  >
                    <Layers className="w-4 h-4 shrink-0 text-amber-300" />
                    <span>Export ทุกแผนกประจำเดือน (.xlsx)</span>
                  </button>
                </>
              )}

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
                title="คัดลอกตารางที่แสดงอยู่ไปวางใน Excel ทันที"
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

          {/* ========================================================================= */}
          {/* PDF REPORT ACTIONS (แบบฟอร์มสรุปผู้มีรายได้เพิ่มประจำเดือน เพื่อเซ็นอนุมัติ) */}
          {/* ========================================================================= */}
          <div className={`p-3 rounded-lg border flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 shadow-xs ${
            isDark ? 'bg-[#14202d] border-[#25394e]' : 'bg-gradient-to-r from-slate-50 via-teal-50/50 to-indigo-50/50 border-teal-200'
          }`}>
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                    แบบฟอร์ม PDF สรุปผู้มีรายได้เพิ่มประจำเดือน (Time Sheet Summary Report)
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    สำหรับเซ็นอนุมัติ
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  แบบฟอร์มมาตรฐาน Siemens A4 แนวนอน (OT 1.5/2.0/3.0, เบี้ยเลี้ยง Standby, Emergency) พร้อมกล่องลายเซ็น Prepared / Checked / Approved
                </div>
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-2 w-full lg:w-auto justify-end">
              {/* 1. PDF ทุกแผนก ยกเว้น MLR */}
              <button
                type="button"
                id="btn-pdf-report-non-mlr"
                onClick={handleExportNonMLRPayrollPDF}
                disabled={isGeneratingPayrollPDF || nonMLRSummaries.length === 0}
                className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-bold text-xs bg-indigo-700 hover:bg-indigo-600 text-white shadow-xs transition disabled:opacity-50 cursor-pointer"
                title={`สร้างแบบฟอร์ม PDF สรุปผู้มีรายได้เพิ่มของทุกแผนกยกเว้น MLR (${nonMLRSummaries.length} คน) เพื่อพิมพ์เซ็นอนุมัติ`}
              >
                <FileText className="w-4 h-4 text-rose-300 shrink-0" />
                <span>PDF สรุปทุกแผนก (ยกเว้น MLR)</span>
              </button>

              {/* 2. PDF เฉพาะแผนก MLR */}
              <button
                type="button"
                id="btn-pdf-report-mlr"
                onClick={handleExportMLRPayrollPDF}
                disabled={isGeneratingPayrollPDF || mlrSummaries.length === 0}
                className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-bold text-xs bg-teal-600 hover:bg-teal-500 text-white shadow-xs transition disabled:opacity-50 cursor-pointer"
                title={`สร้างแบบฟอร์ม PDF สรุปผู้มีรายได้เพิ่มเฉพาะแผนก MLR (${mlrSummaries.length} คน) เพื่อพิมพ์เซ็นอนุมัติ`}
              >
                <FileText className="w-4 h-4 text-amber-300 shrink-0" />
                <span>PDF สรุปเฉพาะแผนก MLR</span>
              </button>

              {/* 3. ดาวน์โหลดทั้ง 2 ชุดพร้อมกัน */}
              <button
                type="button"
                id="btn-pdf-report-both"
                onClick={handleExportBothSeparatedPayrollPDF}
                disabled={isGeneratingPayrollPDF || (nonMLRSummaries.length === 0 && mlrSummaries.length === 0)}
                className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-bold text-xs bg-gradient-to-r from-indigo-700 via-teal-600 to-rose-700 hover:from-indigo-600 hover:to-rose-600 text-white shadow-xs transition disabled:opacity-50 cursor-pointer"
                title="ดาวน์โหลดแบบฟอร์ม PDF สรุปแยก 2 ชุดพร้อมกันทันที: ชุดทุกแผนกยกเว้น MLR 1 ไฟล์ + ชุดเฉพาะแผนก MLR 1 ไฟล์"
              >
                {isGeneratingPayrollPDF ? (
                  <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                ) : (
                  <Download className="w-4 h-4 text-amber-300 shrink-0" />
                )}
                <span>⚡ ดาวน์โหลด PDF ทั้ง 2 ชุด (ยกเว้น MLR + เฉพาะ MLR)</span>
              </button>

              {/* 4. PDF ตามที่แสดงในมุมมองปัจจุบัน (ถ้าเลือกดูเฉพาะแผนกอื่น) */}
              {exportScope !== 'all' && (
                <button
                  type="button"
                  id="btn-pdf-report-current-view"
                  onClick={handleExportCurrentViewPayrollPDF}
                  disabled={isGeneratingPayrollPDF || displayedSummaries.length === 0}
                  className={`flex items-center space-x-1.5 py-1.5 px-2.5 rounded font-semibold text-xs border transition cursor-pointer ${
                    isDark
                      ? 'bg-[#1a2736] hover:bg-[#223347] border-[#2c3f55] text-slate-200'
                      : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                  }`}
                  title={`สร้าง PDF สรุปผู้มีรายได้เพิ่มเฉพาะแผนก ${targetDept}`}
                >
                  <Printer className="w-3.5 h-3.5 text-slate-400" />
                  <span>PDF แผนก {targetDept}</span>
                </button>
              )}
            </div>
          </div>

          {/* MLR Separation Status & View Switcher Bar */}
          {separateMLRExport && (
            <div className={`p-2.5 px-3.5 rounded border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-xs ${
              isDark ? 'bg-teal-950/40 border-teal-500/40 text-teal-200' : 'bg-teal-50/90 border-teal-300 text-teal-900 shadow-sm'
            }`}>
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
                <div>
                  <span className="font-bold">โหมดแยก Export แผนก MLR:</span>
                  <span className="ml-1 opacity-90">
                    แผนก MLR จะถูกแยก Export เป็นไฟล์เดี่ยวต่างหาก ไม่นำไปรวมกับแผนกอื่นที่มีอยู่ในระบบ
                  </span>
                </div>
              </div>

              {/* View Switcher: MLR only vs Other depts */}
              <div className="flex items-center space-x-1.5 shrink-0 self-end sm:self-auto">
                <span className={`text-[11px] font-semibold ${isDark ? 'text-teal-300/80' : 'text-teal-800/80'}`}>แสดงในตาราง:</span>
                <button
                  type="button"
                  id="btn-view-mlr-only"
                  onClick={() => { setMlrViewFilter('mlr'); setPage(1); }}
                  className={`px-2.5 py-1 rounded border text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                    mlrViewFilter === 'mlr'
                      ? 'bg-teal-600 text-white border-teal-500 shadow-sm'
                      : isDark ? 'bg-[#101b26] text-slate-300 border-[#223344] hover:bg-[#182838]' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  <Building2 className="w-3 h-3 text-teal-300" />
                  <span>เฉพาะแผนก MLR ({filterOnlyExtraIncome ? mlrEligibleSummaries.length : mlrSummaries.length} คน)</span>
                </button>

                <button
                  type="button"
                  id="btn-view-other-depts"
                  onClick={() => { setMlrViewFilter('other'); setPage(1); }}
                  className={`px-2.5 py-1 rounded border text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                    mlrViewFilter === 'other'
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                      : isDark ? 'bg-[#101b26] text-slate-300 border-[#223344] hover:bg-[#182838]' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  <Layers className="w-3 h-3 text-indigo-300" />
                  <span>แผนกอื่นๆ (ไม่รวม MLR) ({filterOnlyExtraIncome ? nonMLREligibleSummaries.length : nonMLRSummaries.length} คน)</span>
                </button>
              </div>
            </div>
          )}

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
                        {separateMLRExport && mlrViewFilter === 'mlr' && mlrSummaries.length === 0
                          ? `ยังไม่พบข้อมูลพนักงานสังกัดแผนก MLR ในงวดเดือน ${selectedMonthYear}`
                          : filterOnlyExtraIncome
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
                      const isDeptMLR = isMLRDepartment(s.employee?.department);

                      return (
                        <tr key={s.empNo} className={`transition ${
                          isDeptMLR && separateMLRExport 
                            ? isDark ? 'bg-teal-500/10 hover:bg-teal-500/15' : 'bg-teal-50/50 hover:bg-teal-100/60'
                            : isDark ? 'hover:bg-teal-500/5' : 'hover:bg-slate-50'
                        }`}>
                          <td className="p-2 text-left font-semibold text-amber-300 border-r border-inherit whitespace-nowrap">
                            {empCode}
                          </td>
                          <td className="p-2 text-slate-300 border-r border-inherit whitespace-nowrap">
                            {s.gid || s.employee?.gid || ''}
                          </td>
                          <td className="p-2 font-bold border-r border-inherit whitespace-nowrap">
                            {isDeptMLR ? (
                              <span className="px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/40 font-mono text-[11px] inline-flex items-center gap-1">
                                <Building2 className="w-3 h-3 text-teal-400" />
                                {s.employee?.department || 'MLR'}
                              </span>
                            ) : (
                              <span className="text-teal-300">
                                {s.employee?.department || ''}
                              </span>
                            )}
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
      {/* TAB 2: PRODUCTIVITY EXPORT ALL DEPTS (13 COLUMNS EXCEL)                     */}
      {/* ========================================================================= */}
      {activeTab === 'productivity' && (
        <div className="flex flex-col space-y-4">
          {/* Header Card with Month-Year Selector & Scope */}
          <div className={`p-4 rounded border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="space-y-1">
              <h2 className="text-sm font-bold flex items-center gap-2 text-[#00e5e5]">
                <TrendingUp className="w-4 h-4 text-[#00e5e5]" />
                <span>รายงาน Productivity ทุกแผนก (Company-Wide Productivity Report)</span>
              </h2>
              <p className={`text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                สรุปข้อมูลวันทำงาน, วันลา (พักร้อน, ป่วย, อื่นๆ), อัตราเข้ากะ <strong>(Office = 0, Shift work = Y)</strong> และชั่วโมง OT รวม 13 คอลัมน์ (A ถึง M) ส่งออกไฟล์ Excel
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                <span className={`px-2 py-0.5 rounded font-mono ${isDark ? 'bg-[#162534] text-teal-300 border border-teal-500/30' : 'bg-teal-50 text-teal-700'}`}>
                  รูปแบบไฟล์: Microsoft Excel (.xlsx) 13 คอลัมน์
                </span>
                <span className={`px-2 py-0.5 rounded font-mono ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
                  พนักงานในระบบ: {allProductivityRows.length} คน
                </span>
              </div>
            </div>

            {/* Month-Year Selector */}
            <div className={`p-3 rounded border flex flex-col sm:flex-row items-center gap-3 shrink-0 ${
              isDark ? 'bg-[#0f1722] border-[#203040]' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                <Calendar className="w-3.5 h-3.5 text-teal-400" />
                <span>เลือกราย เดือน-ปี:</span>
              </div>
              <MonthYearFilter 
                selectedMonthYear={selectedMonthYear}
                onChange={onSelectMonthYear}
                theme={theme}
              />
            </div>
          </div>

          {/* 5 KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* Card 1: Total Employees */}
            <div className={`p-3 rounded border space-y-1 ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
            }`}>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>พนักงาน (Total Staff)</span>
                <Users className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className="text-lg font-bold font-mono text-cyan-400">
                {productivityTotals.totalEmployees} <span className="text-xs font-sans text-slate-400">คน</span>
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                Shift: <strong className="text-indigo-300">{productivityTotals.shiftCount}</strong> | Office: <strong className="text-slate-300">{productivityTotals.officeCount}</strong>
              </div>
            </div>

            {/* Card 2: Available Day */}
            <div className={`p-3 rounded border space-y-1 ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
            }`}>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Available day (วันทำงาน)</span>
                <Calendar className="w-3.5 h-3.5 text-teal-400" />
              </div>
              <div className="text-lg font-bold font-mono text-teal-300">
                {productivityTotals.totalAvailable} <span className="text-xs font-sans text-slate-400">วัน</span>
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                เฉลี่ย {productivityTotals.totalEmployees > 0 ? (productivityTotals.totalAvailable / productivityTotals.totalEmployees).toFixed(1) : 0} วัน/คน
              </div>
            </div>

            {/* Card 3: Annual Leave */}
            <div className={`p-3 rounded border space-y-1 ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
            }`}>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Annual Leave (ลาพักร้อน)</span>
                <Clock className="w-3.5 h-3.5 text-pink-400" />
              </div>
              <div className="text-lg font-bold font-mono text-pink-400">
                {productivityTotals.totalAL} <span className="text-xs font-sans text-slate-400">วัน</span>
              </div>
              <div className="text-[10px] text-pink-400/80">
                พักร้อนรวมทั้งสิ้น
              </div>
            </div>

            {/* Card 4: Sick & Other Leave */}
            <div className={`p-3 rounded border space-y-1 ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
            }`}>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Sick & Other (ป่วย/อื่นๆ)</span>
                <Layers className="w-3.5 h-3.5 text-rose-400" />
              </div>
              <div className="text-lg font-bold font-mono text-rose-300">
                {productivityTotals.totalLeave} <span className="text-xs font-sans text-slate-400">วัน</span>
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                ป่วย: <strong className="text-rose-400">{productivityTotals.totalSL}</strong> | อื่นๆ: <strong className="text-purple-400">{productivityTotals.totalOther}</strong>
              </div>
            </div>

            {/* Card 5: Total OT Hours */}
            <div className={`p-3 rounded border space-y-1 ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
            }`}>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>OT Hour (ชั่วโมงโอที)</span>
                <DollarSign className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="text-lg font-bold font-mono text-amber-400">
                {productivityTotals.totalOT} <span className="text-xs font-sans text-slate-400">ชม.</span>
              </div>
              <div className="text-[10px] text-amber-400/80 truncate">
                OT รวมทุกอัตรา (1.5x, 3.0x)
              </div>
            </div>
          </div>

          {/* Action Bar & Table Controls */}
          <div className={`p-3.5 rounded border space-y-3 ${
            isDark ? 'bg-[#101a24] border-[#1e2f40]' : 'bg-white border-slate-200 shadow-sm'
          }`}>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Left: Department & Type Filter */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {/* Department Dropdown */}
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">แผนก:</span>
                  <select
                    value={productivityDeptFilter}
                    onChange={e => {
                      setProductivityDeptFilter(e.target.value);
                      setProductivityPage(1);
                    }}
                    className={`py-1.5 px-2.5 rounded border text-xs font-medium transition cursor-pointer ${
                      isDark ? 'bg-[#0b1219] border-[#243547] text-white' : 'bg-white border-slate-300 text-slate-800'
                    }`}
                  >
                    <option value="ALL">🌟 ทุกแผนก (All Departments) - {allProductivityRows.length} คน</option>
                    {departments.map(d => {
                      const count = allProductivityRows.filter(r => isSameDepartment(r.department, d.code)).length;
                      return (
                        <option key={d.code} value={d.code}>
                          {d.name} ({count} คน)
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Work Type Filter */}
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">ประเภท:</span>
                  <select
                    value={productivityShiftFilter}
                    onChange={e => {
                      setProductivityShiftFilter(e.target.value as any);
                      setProductivityPage(1);
                    }}
                    className={`py-1.5 px-2.5 rounded border text-xs font-medium transition cursor-pointer ${
                      isDark ? 'bg-[#0b1219] border-[#243547] text-white' : 'bg-white border-slate-300 text-slate-800'
                    }`}
                  >
                    <option value="all">ทั้งหมด (All Types)</option>
                    <option value="shift">Shift Work (Productivity = Y)</option>
                    <option value="office">Office (Productivity = 0)</option>
                  </select>
                </div>

                {/* Search Box */}
                <div className="relative min-w-[210px] flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={productivitySearch}
                    onChange={e => {
                      setProductivitySearch(e.target.value);
                      setProductivityPage(1);
                    }}
                    placeholder="ค้นหาชื่อ, รหัส, GID, ตำแหน่ง..."
                    className={`w-full pl-8 pr-2.5 py-1.5 rounded border text-xs transition ${
                      isDark ? 'bg-[#0b1219] border-[#243547] text-white placeholder-slate-500' : 'bg-slate-50 border-slate-300 text-slate-800 placeholder-slate-400'
                    }`}
                  />
                  {productivitySearch && (
                    <button
                      type="button"
                      onClick={() => setProductivitySearch('')}
                      className="absolute right-2 top-2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <span className={`text-[11px] font-mono shrink-0 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  ({displayedProductivityRows.length} คน)
                </span>
              </div>

              {/* Right: Export Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Export All Depts Excel (The primary requested feature) */}
                <button
                  type="button"
                  id="btn-export-productivity-all"
                  onClick={() => handleExportProductivityExcel(allProductivityRows, 'AllDepts')}
                  className="px-3.5 py-1.5 rounded font-bold text-xs bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow transition flex items-center space-x-1.5 cursor-pointer"
                  title={`ดาวน์โหลดไฟล์ Excel .xlsx 13 คอลัมน์ ทุกแผนก (${allProductivityRows.length} คน) ประจำงวด ${selectedMonthYear}`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>⚡ Export Productivity ทุกแผนก (.xlsx)</span>
                  <span className="text-[10px] bg-black/25 px-1.5 py-0.2 rounded font-mono">
                    {allProductivityRows.length} คน
                  </span>
                </button>

                {/* If filtered department, offer export for filtered subset */}
                {productivityDeptFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => handleExportProductivityExcel(displayedProductivityRows, productivityDeptFilter)}
                    className="px-3 py-1.5 rounded font-semibold text-xs border border-teal-500/50 text-teal-300 hover:bg-teal-500/10 transition flex items-center space-x-1.5 cursor-pointer"
                    title={`ดาวน์โหลดไฟล์ Excel เฉพาะแผนก ${productivityDeptFilter} (${displayedProductivityRows.length} คน)`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export แผนก {productivityDeptFilter} (.xlsx)</span>
                  </button>
                )}

                {/* CSV Download */}
                <button
                  type="button"
                  onClick={() => handleExportProductivityCSV(displayedProductivityRows, productivityDeptFilter === 'ALL' ? 'AllDepts' : productivityDeptFilter)}
                  className={`px-3 py-1.5 rounded font-semibold text-xs border transition flex items-center space-x-1.5 cursor-pointer ${
                    isDark ? 'border-slate-600 hover:bg-slate-700/40 text-slate-300' : 'border-slate-300 hover:bg-slate-100 text-slate-700'
                  }`}
                  title="ดาวน์โหลดไฟล์ CSV (UTF-8 with BOM)"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>CSV</span>
                </button>

                {/* Copy to Clipboard */}
                <button
                  type="button"
                  onClick={handleCopyProductivityCSV}
                  className={`p-1.5 rounded border transition cursor-pointer ${
                    isDark ? 'border-slate-600 hover:bg-slate-700/40 text-slate-300' : 'border-slate-300 hover:bg-slate-100 text-slate-700'
                  }`}
                  title="คัดลอกข้อมูลตาราง Productivity ไปยัง Clipboard"
                >
                  {copiedNotification ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-slate-400" />
                  )}
                </button>
              </div>
            </div>

            {/* Notification Bar if copied */}
            {copiedNotification && (
              <div className="p-2 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>คัดลอกข้อมูล Productivity {displayedProductivityRows.length} แถวลง Clipboard สำเร็จ! สามารถนำไปวาง (Ctrl+V) ใน Excel ได้ทันที</span>
              </div>
            )}

            {/* Data Table Preview with 13 Columns (A to M) */}
            <div className={`overflow-x-auto border rounded max-h-[560px] scrollbar-thin ${
              isDark ? 'border-[#223344] bg-[#091119]' : 'border-slate-200 bg-white'
            }`}>
              <table className="w-full text-left border-collapse text-[11px] whitespace-nowrap">
                <thead className={`sticky top-0 z-10 font-bold border-b text-[10px] uppercase tracking-wider ${
                  isDark ? 'bg-[#0f1722] text-slate-300 border-[#223344]' : 'bg-slate-100 text-slate-700 border-slate-300'
                }`}>
                  <tr>
                    <th className="p-2 text-center w-9 border-r border-inherit">#</th>
                    <th className="p-2 border-r border-inherit">A: Month Year<br/><span className="text-[9px] font-normal opacity-75">เดือน-ปี</span></th>
                    <th className="p-2 text-center border-r border-inherit">B: Department<br/><span className="text-[9px] font-normal opacity-75">แผนก</span></th>
                    <th className="p-2 border-r border-inherit">C: Personnel number<br/><span className="text-[9px] font-normal opacity-75">ID No</span></th>
                    <th className="p-2 border-r border-inherit">D: Firstname<br/><span className="text-[9px] font-normal opacity-75">ชื่อ</span></th>
                    <th className="p-2 border-r border-inherit">E: Lastname<br/><span className="text-[9px] font-normal opacity-75">นามสกุล</span></th>
                    <th className="p-2 border-r border-inherit">F: Function<br/><span className="text-[9px] font-normal opacity-75">ตำแหน่ง</span></th>
                    <th className="p-2 text-center border-r border-inherit">G: Cost Center</th>
                    <th className="p-2 text-center border-r border-inherit text-teal-300">H: Available day<br/><span className="text-[9px] font-normal opacity-75">วันทำงานในเดือน</span></th>
                    <th className="p-2 text-center border-r border-inherit text-pink-300">I: Annual Leave day<br/><span className="text-[9px] font-normal opacity-75">ลาพักร้อน</span></th>
                    <th className="p-2 text-center border-r border-inherit text-rose-300">J: Sick Leave day<br/><span className="text-[9px] font-normal opacity-75">ลาป่วย</span></th>
                    <th className="p-2 text-center border-r border-inherit text-purple-300">K: Other Leave day<br/><span className="text-[9px] font-normal opacity-75">ลาอื่นๆ</span></th>
                    <th className="p-2 text-center border-r border-inherit text-indigo-300">L: Productivity Count<br/><span className="text-[9px] font-normal opacity-75">Office = 0 | Shift = Y</span></th>
                    <th className="p-2 text-center text-amber-300">M: OT Hour<br/><span className="text-[9px] font-normal opacity-75">ชั่วโมง OT</span></th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-[#1a2634]' : 'divide-slate-200'}`}>
                  {displayedProductivityRows.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="p-8 text-center text-slate-400">
                        <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-40" />
                        ไม่พบข้อมูลตามเงื่อนไขที่เลือกในงวดเดือน {selectedMonthYear}
                      </td>
                    </tr>
                  ) : (
                    displayedProductivityRows
                      .slice((productivityPage - 1) * PAGE_SIZE, productivityPage * PAGE_SIZE)
                      .map((row, idx) => {
                        const globalIdx = (productivityPage - 1) * PAGE_SIZE + idx + 1;
                        const isShift = row.productivityCount === 'Y';
                        return (
                          <tr
                            key={`${row.personnelNumber}_${idx}`}
                            className={`transition-colors ${
                              isDark ? 'hover:bg-[#14202c]' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="p-2 text-center font-mono text-slate-500 border-r border-inherit">
                              {globalIdx}
                            </td>
                            {/* A: Month Year */}
                            <td className="p-2 font-mono border-r border-inherit text-slate-400">
                              {row.monthYear}
                            </td>
                            {/* B: Department */}
                            <td className="p-2 text-center border-r border-inherit">
                              <span className="font-mono font-bold text-[#00e5e5] px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20">
                                {row.department || '-'}
                              </span>
                            </td>
                            {/* C: Personnel number */}
                            <td className="p-2 font-mono font-bold border-r border-inherit text-white">
                              {row.personnelNumber}
                            </td>
                            {/* D: Firstname */}
                            <td className="p-2 border-r border-inherit">
                              {row.firstName}
                            </td>
                            {/* E: Lastname */}
                            <td className="p-2 border-r border-inherit">
                              {row.lastName}
                            </td>
                            {/* F: Function */}
                            <td className="p-2 border-r border-inherit text-slate-400 text-[10.5px]">
                              {row.functionTitle || '-'}
                            </td>
                            {/* G: Cost Center */}
                            <td className="p-2 text-center font-mono border-r border-inherit text-amber-300">
                              {row.costCenter || 'C93056'}
                            </td>
                            {/* H: Available day */}
                            <td className="p-2 text-center font-mono font-bold border-r border-inherit text-teal-300">
                              {row.availableDays}
                            </td>
                            {/* I: Annual Leave day */}
                            <td className={`p-2 text-center font-mono border-r border-inherit ${
                              row.annualLeaveDays > 0 ? 'font-bold text-pink-400 bg-pink-500/10' : 'text-slate-500'
                            }`}>
                              {row.annualLeaveDays}
                            </td>
                            {/* J: Sick Leave day */}
                            <td className={`p-2 text-center font-mono border-r border-inherit ${
                              row.sickLeaveDays > 0 ? 'font-bold text-rose-400 bg-rose-500/10' : 'text-slate-500'
                            }`}>
                              {row.sickLeaveDays}
                            </td>
                            {/* K: Other Leave day */}
                            <td className={`p-2 text-center font-mono border-r border-inherit ${
                              row.otherLeaveDays > 0 ? 'font-bold text-purple-400 bg-purple-500/10' : 'text-slate-500'
                            }`}>
                              {row.otherLeaveDays}
                            </td>
                            {/* L: Productivity Count (Office = 0, Shift work = Y) */}
                            <td className="p-2 text-center border-r border-inherit">
                              {isShift ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded font-mono font-bold text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                  Y
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded font-mono font-bold text-xs bg-slate-700/30 text-slate-400 border border-slate-600/30">
                                  0
                                </span>
                              )}
                            </td>
                            {/* M: OT Hour */}
                            <td className={`p-2 text-center font-mono ${
                              row.otHours > 0 ? 'font-bold text-amber-400 bg-amber-500/10' : 'text-slate-500'
                            }`}>
                              {row.otHours}
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
                {/* Grand totals row */}
                {displayedProductivityRows.length > 0 && (
                  <tfoot className={`font-bold font-mono border-t-2 sticky bottom-0 ${
                    isDark ? 'bg-[#091119] text-white border-slate-600' : 'bg-slate-100 text-slate-900 border-slate-300'
                  }`}>
                    <tr>
                      <td colSpan={8} className="p-2.5 text-left pl-3 font-sans border-r border-inherit">
                        รวมทั้งหมด ({displayedProductivityRows.length} คน)
                      </td>
                      <td className="p-2.5 text-center text-teal-300 border-r border-inherit">
                        {productivityTotals.totalAvailable}
                      </td>
                      <td className="p-2.5 text-center text-pink-400 border-r border-inherit">
                        {productivityTotals.totalAL}
                      </td>
                      <td className="p-2.5 text-center text-rose-400 border-r border-inherit">
                        {productivityTotals.totalSL}
                      </td>
                      <td className="p-2.5 text-center text-purple-400 border-r border-inherit">
                        {productivityTotals.totalOther}
                      </td>
                      <td className="p-2.5 text-center text-indigo-300 border-r border-inherit text-xs">
                        Shift: {productivityTotals.shiftCount} | Off: {productivityTotals.officeCount}
                      </td>
                      <td className="p-2.5 text-center text-amber-400">
                        {productivityTotals.totalOT}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Pagination Controls */}
            {displayedProductivityRows.length > 0 && (
              <div className={`p-2.5 border-t flex items-center justify-between text-xs ${
                isDark ? 'bg-[#0d151e] border-[#223344] text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}>
                <div>
                  แสดงแถว {(productivityPage - 1) * PAGE_SIZE + 1} - {Math.min(productivityPage * PAGE_SIZE, displayedProductivityRows.length)} จาก {displayedProductivityRows.length} คน
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    disabled={productivityPage <= 1}
                    onClick={() => setProductivityPage(p => Math.max(1, p - 1))}
                    className="p-1 rounded border border-inherit disabled:opacity-40 hover:bg-slate-700/20 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-2 font-mono font-semibold">
                    {productivityPage} / {Math.max(1, Math.ceil(displayedProductivityRows.length / PAGE_SIZE))}
                  </span>
                  <button
                    type="button"
                    disabled={productivityPage >= Math.ceil(displayedProductivityRows.length / PAGE_SIZE)}
                    onClick={() => setProductivityPage(p => Math.min(Math.ceil(displayedProductivityRows.length / PAGE_SIZE), p + 1))}
                    className="p-1 rounded border border-inherit disabled:opacity-40 hover:bg-slate-700/20 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: BATCH PDF EXPORT CENTER */}
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

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleExportRosterExcel}
                className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-semibold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition cursor-pointer"
                title={`Export Excel (Sheet: ${(() => {
                  const [y, m] = selectedMonthYear.split('-');
                  const mNum = parseInt(m, 10) || 9;
                  return `${ANNUAL_TEMPLATE_MONTH_NAMES[mNum - 1]?.short || 'SEP'}-${y}`;
                })()})`}
              >
                <Download className="w-4 h-4" />
                <span>Export Excel (.xlsx) [Sheet: {(() => {
                  const [y, m] = selectedMonthYear.split('-');
                  const mNum = parseInt(m, 10) || 9;
                  return `${ANNUAL_TEMPLATE_MONTH_NAMES[mNum - 1]?.short || 'SEP'}-${y}`;
                })()}]</span>
              </button>

              <button
                type="button"
                onClick={handleExportRosterCSV}
                className="flex items-center space-x-1.5 py-1.5 px-3 rounded font-semibold text-xs bg-slate-700 hover:bg-slate-600 text-teal-300 border border-slate-600 shadow transition cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Export CSV</span>
              </button>
            </div>
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
