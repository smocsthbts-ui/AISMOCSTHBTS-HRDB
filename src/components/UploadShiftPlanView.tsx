import React, { useState, useMemo, useRef, useEffect } from 'react';
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
  CalendarDays,
  X,
  Layers,
  Check,
  CheckSquare,
  Square
} from 'lucide-react';
import { storage } from '../utils/storage';
import { 
  validateAndParseShiftPlan, 
  generateShiftPlanTemplate, 
  generateAnnualShiftPlanTemplate,
  inspectShiftPlanWorkbook,
  parseSpecificSheetToRows,
  WorkbookSheetDetail,
  ShiftPlanSkippedRow,
  downloadBlob, 
  downloadWorkbook,
  parseSheetToRows, 
  readFileAsArrayBuffer 
} from '../utils/fileParser';
import { firestoreSync } from '../firebase';

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

interface UploadConfirmationState {
  file: File;
  buffer: ArrayBuffer;
  sheets: WorkbookSheetDetail[];
  isAnnual: boolean;
  detectedYear: number;
  selectedSheetName: string;
  selectedMonthYear: string;
  selectedDept: string;
  importMode: 'SINGLE_MONTH' | 'ALL_MONTHS';
  previewRows: any[];
}

export interface ShiftPlanUploadSummary {
  totalRows: number;
  totalPlansCount: number;
  totalEmployeesCount: number;
  newEmployees: Employee[];
  newShiftCodes: ShiftCode[];
  skippedRows: ShiftPlanSkippedRow[];
  processedMonths: string[];
  department: string;
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
  onNavigateToShiftCodes?: () => void;
  onNavigateToEmployees?: () => void;
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
  onNavigateToShiftCodes,
  onNavigateToEmployees,
}) => {
  const isDark = theme === 'dark';
  const isAdmin = currentUser.role === 'Admin';
  const userDept = (currentUser.department || 'GM').trim().toUpperCase();

  // Target Department for Shift Plan Upload
  // Role User is strictly locked to their own assigned department
  const [targetDept, setTargetDept] = useState<string>(() => {
    if (!isAdmin) {
      return userDept;
    }
    const depts = storage.getDepartments();
    if (selectedDepartment !== 'ALL' && depts.some(d => d.code === selectedDepartment)) {
      return selectedDepartment;
    }
    return depts.length > 0 ? depts[0].code : 'RST';
  });

  // Ensure Role User is always locked to their own department
  useEffect(() => {
    if (!isAdmin && targetDept !== userDept) {
      setTargetDept(userDept);
    }
  }, [isAdmin, userDept, targetDept]);

  // Target Month-Year for upload
  const [targetMonthYear, setTargetMonthYear] = useState<string>(selectedMonthYear || '2026-05');

  // Year for Annual 12-Month Template Generation
  const [annualTemplateYear, setAnnualTemplateYear] = useState<number>(() => {
    const p = (selectedMonthYear || '2026-05').split('-');
    return parseInt(p[0], 10) || new Date().getFullYear();
  });

  // Interactive Upload & Month Confirmation Modal State
  const [uploadConfirmation, setUploadConfirmation] = useState<UploadConfirmationState | null>(null);
  const [isExecutingImport, setIsExecutingImport] = useState<boolean>(false);

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

  const [newlyAddedShiftCodes, setNewlyAddedShiftCodes] = useState<ShiftCode[]>([]);
  const [newlyAddedEmployees, setNewlyAddedEmployees] = useState<Employee[]>([]);
  const [uploadSummaryModal, setUploadSummaryModal] = useState<ShiftPlanUploadSummary | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Active employees in target department
  const targetEmployees = useMemo(() => {
    const effectiveDept = !isAdmin ? userDept : targetDept;
    if (effectiveDept === 'ALL') {
      return employees.filter(e => e.isActive !== false);
    }
    return employees.filter(e => e.department === effectiveDept && e.isActive !== false);
  }, [employees, targetDept, isAdmin, userDept]);

  // Shift codes available for target department
  const applicableShiftCodes = useMemo(() => {
    const effectiveDept = !isAdmin ? userDept : targetDept;
    return shiftCodes.filter(sc => sc.department === 'ALL' || sc.department === effectiveDept);
  }, [shiftCodes, targetDept, isAdmin, userDept]);

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

  // Construct comprehensive list of period options dynamically
  const periodOptions = useMemo(() => {
    const monthsSet = new Set<string>();
    const now = new Date();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth() + 1;

    // Limit future options to strictly 12 months in advance from current date (or next year)
    const maxFutureObj = new Date(nowYear, nowMonth - 1 + 12, 1);
    const maxFutureYear = maxFutureObj.getFullYear();
    const maxFutureMonth = maxFutureObj.getMonth() + 1;
    const maxFutureVal = `${maxFutureYear}-${String(maxFutureMonth).padStart(2, '0')}`;

    const curYear = parseInt((targetMonthYear || '2026-05').split('-')[0], 10) || nowYear;
    const maxYear = Math.max(maxFutureYear, curYear);
    const minYear = 2024;

    // Dynamically generate all months up to max 12 months in advance
    for (let y = maxYear; y >= minYear; y--) {
      for (let m = 12; m >= 1; m--) {
        const val = `${y}-${String(m).padStart(2, '0')}`;
        if (val <= maxFutureVal || val === targetMonthYear || val === selectedMonthYear) {
          monthsSet.add(val);
        }
      }
    }

    // Add any months that exist in shiftPlans or currently selected
    allCompanyMonths.forEach(m => {
      if (m <= maxFutureVal || m === targetMonthYear || m === selectedMonthYear) {
        monthsSet.add(m);
      }
    });
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

  // Handler to download Annual 12-Month Excel (.xlsx) Template with 12 Sheets (JAN-YYYY to DEC-YYYY)
  const handleDownloadAnnualExcelTemplate = () => {
    try {
      const deptToUse = !isAdmin ? userDept : targetDept;
      const { workbook, filename } = generateAnnualShiftPlanTemplate(
        deptToUse,
        annualTemplateYear,
        employees,
        applicableShiftCodes
      );
      downloadWorkbook(workbook, filename);
      setStatusMessage({
        type: 'success',
        text: `ดาวน์โหลดเทมเพลตรายปี 12 เดือนสำเร็จ: ${filename} (แผนก ${deptToUse}, ปี ${annualTemplateYear} ครบ 12 Sheets JAN-${annualTemplateYear} ถึง DEC-${annualTemplateYear})`,
      });
    } catch (err: any) {
      console.error('Error downloading annual Excel template:', err);
      setStatusMessage({
        type: 'error',
        text: `ไม่สามารถสร้างเทมเพลตรายปีได้: ${err.message || String(err)}`,
      });
    }
  };

  // Handler to download Single Month Excel (.xlsx) Template
  const handleDownloadExcelTemplate = () => {
    try {
      const deptToUse = !isAdmin ? userDept : targetDept;
      const { workbook } = generateShiftPlanTemplate(deptToUse, targetMonthYear, employees);
      const filename = `ShiftPlan_Template_${deptToUse}_${targetMonthYear}.xlsx`;
      downloadWorkbook(workbook, filename);
      setStatusMessage({
        type: 'success',
        text: `ดาวน์โหลดไฟล์เทมเพลต Excel สำเร็จ: ${filename} (แผนก ${deptToUse}, งวด ${targetMonthYear})`,
      });
    } catch (err: any) {
      console.error('Error downloading Excel template:', err);
      setStatusMessage({
        type: 'error',
        text: `ไม่สามารถดาวน์โหลดไฟล์ Excel ได้: ${err.message || String(err)}`,
      });
    }
  };

  // Handler to download CSV Template
  const handleDownloadCsvTemplate = () => {
    try {
      const deptToUse = !isAdmin ? userDept : targetDept;
      const { csvContent } = generateShiftPlanTemplate(deptToUse, targetMonthYear, employees);
      const filename = `ShiftPlan_Template_${deptToUse}_${targetMonthYear}.csv`;
      downloadBlob(csvContent, filename, 'text/csv;charset=utf-8;');
      setStatusMessage({
        type: 'success',
        text: `ดาวน์โหลดไฟล์เทมเพลต CSV สำเร็จ: ${filename} (แผนก ${deptToUse}, งวด ${targetMonthYear})`,
      });
    } catch (err: any) {
      console.error('Error downloading CSV template:', err);
      setStatusMessage({
        type: 'error',
        text: `ไม่สามารถดาวน์โหลดไฟล์ CSV ได้: ${err.message || String(err)}`,
      });
    }
  };

  // Process File: Analyze workbook sheets and open Month/Sheet confirmation modal
  const processUploadedFile = async (file: File) => {
    setStatusMessage(null);
    setIsProcessing(true);

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const targetYear = parseInt(targetMonthYear.split('-')[0], 10) || new Date().getFullYear();
      const inspection = inspectShiftPlanWorkbook(buffer, targetYear);

      // Select initial sheet to preview
      let initialSheet = inspection.sheets.find(s => s.detectedMonthYear === targetMonthYear && s.isMonthSheet);
      if (!initialSheet) {
        initialSheet = inspection.sheets.find(s => s.isMonthSheet) || inspection.sheets[0];
      }

      const initialSheetName = initialSheet ? initialSheet.sheetName : '';
      const initialMY = initialSheet?.detectedMonthYear || targetMonthYear;
      const initialPreviewRows = parseSpecificSheetToRows(buffer, initialSheetName).slice(0, 6);

      const activeDept = !isAdmin ? userDept : targetDept;

      // Early security check for Role User: inspect sheet rows to detect foreign department violation early
      if (!isAdmin) {
        const sampleRows = parseSpecificSheetToRows(buffer, initialSheetName);
        for (const row of sampleRows) {
          const rowDept = String(row['Department'] || row['department'] || row['Dept'] || row['dept'] || row['แผนก'] || '').trim().toUpperCase();
          if (rowDept && rowDept !== 'ALL' && rowDept !== userDept) {
            setStatusMessage({
              type: 'error',
              text: `สิทธิ์ไม่เพียงพอ: คุณมีสิทธิ์ Role User สามารถอัปโหลดตารางกะได้เฉพาะแผนกตนเอง (${userDept}) เท่านั้น แต่ในไฟล์พบข้อมูลระบุแผนก "${rowDept}" ระบบจึงไม่อนุญาตให้อัปโหลด`,
            });
            setIsProcessing(false);
            return;
          }
        }
      }

      setUploadConfirmation({
        file,
        buffer,
        sheets: inspection.sheets,
        isAnnual: inspection.isAnnualWorkbook || inspection.hasMultipleMonthSheets,
        detectedYear: inspection.detectedYear,
        selectedSheetName: initialSheetName,
        selectedMonthYear: initialMY,
        selectedDept: activeDept,
        importMode: inspection.isAnnualWorkbook ? 'ALL_MONTHS' : 'SINGLE_MONTH',
        previewRows: initialPreviewRows,
      });
    } catch (err: any) {
      console.error('File parsing error:', err);
      setStatusMessage({
        type: 'error',
        text: `Upload failed (ไม่สามารถประมวลผลไฟล์ได้): ${err.message || 'File format invalid'}`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Switch preview sheet inside confirmation modal
  const handleModalSelectSheet = (sheetDetail: WorkbookSheetDetail) => {
    if (!uploadConfirmation) return;
    try {
      const rows = parseSpecificSheetToRows(uploadConfirmation.buffer, sheetDetail.sheetName).slice(0, 6);
      setUploadConfirmation({
        ...uploadConfirmation,
        selectedSheetName: sheetDetail.sheetName,
        selectedMonthYear: sheetDetail.detectedMonthYear,
        previewRows: rows,
      });
    } catch (err) {
      console.error('Error switching sheet in modal preview:', err);
    }
  };

  // Execute Confirmed Shift Plan Import
  const executeConfirmationImport = async () => {
    if (!uploadConfirmation) return;
    setIsExecutingImport(true);

    try {
      const { buffer, importMode, selectedSheetName, selectedMonthYear: chosenMY, selectedDept: rawChosenDept, sheets } = uploadConfirmation;
      const chosenDept = !isAdmin ? userDept : rawChosenDept;

      // Security check: Role User can only upload shift plans for their own department
      if (!isAdmin && chosenDept !== userDept) {
        setStatusMessage({
          type: 'error',
          text: `สิทธิ์ไม่เพียงพอ: คุณมีสิทธิ์ Role User สามารถอัปโหลดตารางกะได้เฉพาะแผนก ${userDept} เท่านั้น`,
        });
        setUploadConfirmation(null);
        setIsExecutingImport(false);
        return;
      }

      let aggregatedPlans: DailyShiftPlan[] = [];
      let aggregatedNewEmployees: Employee[] = [];
      let aggregatedNewShiftCodes: ShiftCode[] = [];
      let aggregatedSkippedRows: ShiftPlanSkippedRow[] = [];
      let aggregatedWarnings: string[] = [];
      let totalMatchedEmployees = 0;
      let totalRawRowsCount = 0;
      let processedMonthsList: string[] = [];

      if (importMode === 'ALL_MONTHS') {
        // Process all detected monthly sheets
        const monthSheets = sheets.filter(s => s.isMonthSheet);
        if (monthSheets.length === 0) {
          throw new Error('ไม่พบ Sheet ตารางกะรายเดือน (JAN-DEC) ในไฟล์');
        }

        let empWorkingList = [...employees];
        let codeWorkingList = [...shiftCodes];

        for (const s of monthSheets) {
          const rawRows = parseSpecificSheetToRows(buffer, s.sheetName);
          if (rawRows.length === 0) continue;
          totalRawRowsCount += rawRows.length;

          const result = validateAndParseShiftPlan(
            rawRows,
            s.detectedMonthYear,
            chosenDept,
            empWorkingList,
            codeWorkingList,
            currentUser.email
          );

          if (!result.valid) {
            throw new Error(`ข้อผิดพลาดใน Sheet "${s.sheetName}" (${s.detectedMonthYear}): ${result.errors.join(', ')}`);
          }

          // Strict Security Check for Role User inside each sheet
          if (!isAdmin) {
            const foreignDeptPlans = result.plans.filter(p => {
              const emp = employees.find(e => e.empNo.trim().toUpperCase() === p.empNo.trim().toUpperCase());
              if (emp && emp.department && emp.department.trim().toUpperCase() !== userDept) return true;
              if (p.department && p.department.trim().toUpperCase() !== userDept) return true;
              return false;
            });
            if (foreignDeptPlans.length > 0) {
              const foreignEmps = Array.from(new Set(foreignDeptPlans.map(p => p.empNo)));
              throw new Error(`สิทธิ์ไม่เพียงพอ: พบข้อมูลพนักงานสังกัดแผนกอื่นใน Sheet "${s.sheetName}" จำนวน ${foreignEmps.length} คน (รหัส: ${foreignEmps.slice(0, 3).join(', ')}) ผู้ใช้สิทธิ์ User สามารถอัปโหลดตารางกะได้เฉพาะแผนก ${userDept} เท่านั้น`);
            }
            if (result.newEmployees && result.newEmployees.some(ne => ne.department && ne.department.trim().toUpperCase() !== userDept)) {
              throw new Error(`สิทธิ์ไม่เพียงพอ: ใน Sheet "${s.sheetName}" พบพนักงานใหม่ที่ไม่ได้สังกัดแผนก ${userDept}`);
            }
          }

          aggregatedPlans = aggregatedPlans.concat(result.plans);
          aggregatedWarnings = aggregatedWarnings.concat(result.warnings.map(w => `[Sheet ${s.sheetName}]: ${w}`));
          if (result.skippedRows && result.skippedRows.length > 0) {
            aggregatedSkippedRows = aggregatedSkippedRows.concat(result.skippedRows);
          }
          totalMatchedEmployees = Math.max(totalMatchedEmployees, result.matchedEmployeesCount);
          processedMonthsList.push(s.detectedMonthYear);

          // Update working employee list if new discovered
          if (result.newEmployees && result.newEmployees.length > 0) {
            aggregatedNewEmployees = aggregatedNewEmployees.concat(result.newEmployees);
            empWorkingList = empWorkingList.concat(result.newEmployees);
          }
          if (result.newShiftCodes && result.newShiftCodes.length > 0) {
            aggregatedNewShiftCodes = aggregatedNewShiftCodes.concat(result.newShiftCodes);
            codeWorkingList = codeWorkingList.concat(result.newShiftCodes);
          }
        }
      } else {
        // Single Sheet / Single Month Mode
        const rawRows = parseSpecificSheetToRows(buffer, selectedSheetName);
        totalRawRowsCount = rawRows.length;
        const result = validateAndParseShiftPlan(
          rawRows,
          chosenMY,
          chosenDept,
          employees,
          shiftCodes,
          currentUser.email
        );

        if (!result.valid) {
          setStatusMessage({
            type: 'error',
            text: `Validation Failed (พบข้อผิดพลาดในการตรวจสอบไฟล์ Sheet "${selectedSheetName}" ${result.errors.length} รายการ)`,
            details: result.errors,
          });
          setUploadConfirmation(null);
          setIsExecutingImport(false);
          return;
        }

        // Strict Security Check for Role User
        if (!isAdmin) {
          const foreignDeptPlans = result.plans.filter(p => {
            const emp = employees.find(e => e.empNo.trim().toUpperCase() === p.empNo.trim().toUpperCase());
            if (emp && emp.department && emp.department.trim().toUpperCase() !== userDept) return true;
            if (p.department && p.department.trim().toUpperCase() !== userDept) return true;
            return false;
          });
          if (foreignDeptPlans.length > 0) {
            const foreignEmps = Array.from(new Set(foreignDeptPlans.map(p => p.empNo)));
            setStatusMessage({
              type: 'error',
              text: `สิทธิ์ไม่เพียงพอ: คุณมีสิทธิ์ Role User สามารถอัปโหลดตารางกะได้เฉพาะแผนก ${userDept} เท่านั้น แต่ในไฟล์มีข้อมูลพนักงานสังกัดแผนกอื่นจำนวน ${foreignEmps.length} คน (รหัส: ${foreignEmps.slice(0, 5).join(', ')})`,
              details: foreignDeptPlans.slice(0, 5).map(p => `EmpNo: ${p.empNo} (แผนก: ${p.department})`),
            });
            setUploadConfirmation(null);
            setIsExecutingImport(false);
            return;
          }
          if (result.newEmployees && result.newEmployees.some(ne => ne.department && ne.department.trim().toUpperCase() !== userDept)) {
            setStatusMessage({
              type: 'error',
              text: `สิทธิ์ไม่เพียงพอ: พบพนักงานใหม่ในไฟล์ที่ไม่ได้สังกัดแผนก ${userDept}`,
            });
            setUploadConfirmation(null);
            setIsExecutingImport(false);
            return;
          }
        }

        aggregatedPlans = result.plans;
        aggregatedWarnings = result.warnings;
        if (result.skippedRows) aggregatedSkippedRows = result.skippedRows;
        totalMatchedEmployees = result.matchedEmployeesCount;
        processedMonthsList.push(chosenMY);
        if (result.newEmployees) aggregatedNewEmployees = result.newEmployees;
        if (result.newShiftCodes) aggregatedNewShiftCodes = result.newShiftCodes;
      }

      // Merge into stored shift plans: overwrite matching empNo & date
      const currentPlans = storage.getShiftPlans();
      const newPlanMap = new Map<string, DailyShiftPlan>();

      currentPlans.forEach(p => {
        const key = `${p.empNo}_${p.date}`;
        newPlanMap.set(key, p);
      });

      aggregatedPlans.forEach(p => {
        const key = `${p.empNo}_${p.date}`;
        newPlanMap.set(key, p);
      });

      const updatedPlans = Array.from(newPlanMap.values());
      storage.setShiftPlans(updatedPlans);
      // Sync with Firestore
      await firestoreSync.syncShiftPlans(updatedPlans);

      // If new Employees were discovered, persist them into Employee Master Database
      if (aggregatedNewEmployees.length > 0) {
        const currentEmployees = storage.getEmployees();
        const empMap = new Map<string, Employee>();
        currentEmployees.forEach(e => empMap.set(e.empNo, e));

        aggregatedNewEmployees.forEach(ne => {
          if (!empMap.has(ne.empNo)) {
            empMap.set(ne.empNo, ne);
          }
        });

        const newEmpList = Array.from(empMap.values());
        await storage.setEmployees(newEmpList);
        await firestoreSync.syncEmployees(newEmpList);
        setNewlyAddedEmployees(aggregatedNewEmployees);
      } else {
        setNewlyAddedEmployees([]);
      }

      // If new Shift Codes were discovered, persist them
      if (aggregatedNewShiftCodes.length > 0) {
        const currentCodes = storage.getShiftCodes();
        const codeMap = new Map<string, ShiftCode>();
        currentCodes.forEach(c => {
          codeMap.set(`${c.code.toUpperCase()}_${c.department.toUpperCase()}`, c);
        });

        aggregatedNewShiftCodes.forEach(nc => {
          const key = `${nc.code.toUpperCase()}_${nc.department.toUpperCase()}`;
          if (!codeMap.has(key)) {
            codeMap.set(key, nc);
          }
        });

        const newCodeList = Array.from(codeMap.values());
        await storage.setShiftCodes(newCodeList);
        await firestoreSync.syncShiftCodes(newCodeList);
        setNewlyAddedShiftCodes(aggregatedNewShiftCodes);
      } else {
        setNewlyAddedShiftCodes([]);
      }

      // Keep target month and department in sync
      if (importMode === 'SINGLE_MONTH') {
        onSelectMonthYear(chosenMY);
        setTargetMonthYear(chosenMY);
      } else if (processedMonthsList.length > 0) {
        onSelectMonthYear(processedMonthsList[0]);
        setTargetMonthYear(processedMonthsList[0]);
      }

      if (chosenDept !== 'ALL') {
        onSelectDepartment(chosenDept);
        setTargetDept(chosenDept);
      }

      const extraNotices: string[] = [];
      if (aggregatedNewEmployees.length > 0) {
        extraNotices.push(`เพิ่มพนักงานใหม่เข้าสู่ Employee Master ${aggregatedNewEmployees.length} คน`);
      }
      if (aggregatedNewShiftCodes.length > 0) {
        extraNotices.push(`เพิ่ม Shift Code ใหม่ในระบบ ${aggregatedNewShiftCodes.length} รหัส (08:00 - 17:00)`);
      }

      const modeText = importMode === 'ALL_MONTHS' 
        ? `นำเข้าครบทั้งปี (${processedMonthsList.length} เดือน)`
        : `งวดเดือน ${chosenMY}`;

      setStatusMessage({
        type: aggregatedWarnings.length > 0 ? 'warning' : 'success',
        text: `Upload Successful (นำเข้าข้อมูลตารางกะสำเร็จ)! [${modeText}] รวม ${aggregatedPlans.length} วันทำงาน สำหรับพนักงาน ${totalMatchedEmployees} คน แผนก ${chosenDept}` +
          (extraNotices.length > 0 ? ` [${extraNotices.join(' | ')}]` : ''),
        details: aggregatedWarnings.length > 0 ? aggregatedWarnings.slice(0, 15) : undefined,
      });

      setUploadConfirmation(null);
      setUploadSummaryModal({
        totalRows: totalRawRowsCount,
        totalPlansCount: aggregatedPlans.length,
        totalEmployeesCount: totalMatchedEmployees,
        newEmployees: aggregatedNewEmployees,
        newShiftCodes: aggregatedNewShiftCodes,
        skippedRows: aggregatedSkippedRows,
        processedMonths: processedMonthsList,
        department: chosenDept,
      });
      onDataImported();
    } catch (err: any) {
      console.error('Import execution error:', err);
      setStatusMessage({
        type: 'error',
        text: `การนำเข้าข้อมูลล้มเหลว: ${err.message || String(err)}`,
      });
    } finally {
      setIsExecutingImport(false);
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
    <div className={`p-4 md:p-6 flex flex-col space-y-6 w-full min-h-full ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
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
                Upload Shift Plan (อัปโหลดตารางกะรายแผนก & รายปี 12 เดือน)
              </h1>
              <span className="text-[11px] px-2 py-0.5 rounded font-mono font-bold bg-[#008b99]/20 text-[#00e5e5] border border-[#008b99]/30">
                Excel / CSV
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-3xl">
              โมดูลสำหรับผู้จัดตารางกะประจำแผนก: รองรับการดาวน์โหลดเทมเพลตทั้งแบบ<strong>รายปี 12 เดือน (12 Sheets JAN-DEC)</strong> และแบบรายเดือน พร้อมระบบเลือก Sheet และเดือนเพื่อยืนยันการ Upload เข้าระบบ
            </p>
          </div>
        </div>

        <button
          id="btn-goto-roster"
          onClick={onNavigateToRoster}
          className="flex items-center space-x-2 px-3.5 py-2 rounded text-xs font-semibold bg-[#1a2838] hover:bg-[#223549] text-teal-300 border border-teal-500/30 transition shadow-xs shrink-0 cursor-pointer"
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
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1">
                <span>Department (แผนกเป้าหมาย):</span>
                <span className="text-red-400">*</span>
              </label>
              {!isAdmin && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
                  Role User: แผนกตนเอง ({currentUser.department})
                </span>
              )}
            </div>
            <select
              id="select-upload-target-dept"
              value={targetDept}
              onChange={(e) => setTargetDept(e.target.value)}
              disabled={!isAdmin}
              className={`w-full px-3 py-2 rounded border text-xs font-medium focus:ring-1 focus:ring-teal-400 outline-none ${
                isDark 
                  ? 'bg-[#0a121a] border-[#29425c] text-white' 
                  : 'bg-white border-slate-300 text-slate-900'
              } ${!isAdmin ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {isAdmin && <option value="ALL">ALL Departments (ทุกแผนก)</option>}
              {storage.getDepartments().map(d => (
                <option key={d.code} value={d.code}>
                  {d.name && d.name !== d.code ? `${d.code} - ${d.name}` : d.code}
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
                title="เลือกเดือนถัดไป"
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
      </div>

      {/* 3. Two-Step Workflow: Step 1 Template & Step 2 Upload */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* STEP 1: Download Standard & Annual 12-Month Template */}
        <div className={`p-5 rounded-lg border space-y-4 flex flex-col justify-between ${
          isDark ? 'bg-[#111b27] border-[#213345]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-teal-400">
              <span className="w-6 h-6 rounded-full bg-teal-500/20 border border-teal-500/30 flex items-center justify-center font-bold text-xs">
                1
              </span>
              <h2 className="font-bold text-sm text-slate-100">
                Download Shift Plan Templates (ดาวน์โหลดเทมเพลตแผนก)
              </h2>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              เตรียมตารางกะสำหรับแผนก <strong>{targetDept}</strong> ({targetEmployees.length} คน) โดยระบุข้อมูลตามคอลัมน์ <strong>Emp No</strong>, <strong>Name</strong>, <strong>Department</strong> และวันที่ 01 ถึง 31
            </p>

            {/* Annual 12-Sheet Template Section */}
            <div className={`p-3 rounded border space-y-2 ${
              isDark ? 'bg-[#0e1823] border-teal-500/40' : 'bg-teal-50/60 border-teal-300'
            }`}>
              <div className="flex items-center justify-between">
                <div className="font-bold text-xs text-teal-300 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-teal-400" />
                  <span>Annual Template: เทมเพลตรายปี (12 Sheets JAN-DEC)</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-[11px] text-slate-300 font-semibold">ปี:</span>
                  <select
                    id="select-annual-template-year"
                    value={annualTemplateYear}
                    onChange={(e) => setAnnualTemplateYear(parseInt(e.target.value, 10))}
                    className={`px-2 py-0.5 rounded text-xs font-mono font-bold outline-none border cursor-pointer ${
                      isDark ? 'bg-[#0a121a] border-teal-500/40 text-teal-300' : 'bg-white border-teal-300 text-teal-800'
                    }`}
                  >
                    {[2025, 2026, 2027, 2028, 2029, 2030].map(y => (
                      <option key={y} value={y}>
                        {y} (พ.ศ. {y + 543})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                สร้างไฟล์ Excel 1 ไฟล์ ประกอบด้วย 12 Sheets (เช่น <code>JAN-{annualTemplateYear}</code> ถึง <code>DEC-{annualTemplateYear}</code>) พร้อมชีตคำแนะนำ Shift Codes
              </p>

              <button
                id="btn-download-annual-excel"
                type="button"
                onClick={handleDownloadAnnualExcelTemplate}
                className="w-full flex items-center justify-center space-x-2 py-2.5 rounded font-bold text-xs bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white shadow transition cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>ดาวน์โหลดเทมเพลตรายปี 12 เดือน (ปี {annualTemplateYear})</span>
              </button>
            </div>

            {/* Shift Codes Legend */}
            <div className={`p-3 rounded border text-xs space-y-2 ${
              isDark ? 'bg-[#0a121a] border-[#1d2d3e]' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="font-semibold text-slate-300 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-teal-400" />
                <span>Available Shift Codes for {targetDept} (รหัสกะที่ใช้ได้ในแผนก):</span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto scrollbar-thin pr-1">
                {applicableShiftCodes.map((sc, idx) => (
                  <span
                    key={`${sc.code}_${sc.department}_${idx}`}
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

              {/* Allowance Suffix Guide (-X and -ET) */}
              <div className="pt-2 border-t border-slate-700/40 space-y-1">
                <div className="font-semibold text-[11px] text-amber-400 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>เงื่อนไขเบี้ยเลี้ยงอัตโนมัติประจำกะ (Shift Allowance Suffix):</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px] text-slate-300">
                  <div className="p-1.5 rounded bg-amber-500/10 border border-amber-500/30">
                    <span className="font-mono font-bold text-amber-300">-X</span> : ใส่ <strong>300 บาท</strong> ในคอลัมน์ <em>Stand by Allowance</em>
                  </div>
                  <div className="p-1.5 rounded bg-rose-500/10 border border-rose-500/30">
                    <span className="font-mono font-bold text-rose-300">-ET</span> : ใส่ <strong>300 บาท</strong> ในคอลัมน์ <em>Emergency Allowance</em>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Single Month Templates */}
          <div className="space-y-2 pt-2">
            <div className="text-[11px] text-slate-300 font-semibold flex items-center justify-between">
              <span>ดาวน์โหลดเฉพาะงวดเดือน {targetMonthYear}:</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                id="btn-download-dept-excel"
                onClick={handleDownloadExcelTemplate}
                className="w-full flex items-center justify-center space-x-2 py-2 rounded font-semibold text-xs bg-[#1a2c3d] hover:bg-[#22394f] text-teal-300 border border-teal-500/40 shadow transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Month Excel ({targetMonthYear})</span>
              </button>

              <button
                id="btn-download-dept-csv"
                onClick={handleDownloadCsvTemplate}
                className="w-full flex items-center justify-center space-x-2 py-2 rounded font-semibold text-xs border border-slate-600 hover:border-teal-400 text-slate-300 hover:text-white transition cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-teal-400" />
                <span>Download Month CSV</span>
              </button>
            </div>
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
                Upload Shift Plan (อัปโหลดและเลือกเดือนเพื่อยืนยัน)
              </h2>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              อัปโหลดไฟล์ Excel (แบบรายปี 12 Sheets หรือไฟล์รายเดือน) สำหรับแผนก <strong>{targetDept}</strong> โดยระบบจะเปิดหน้าต่างให้เลือกเดือนและตรวจสอบข้อมูลก่อนยืนยันนำเข้า
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
                รองรับไฟล์ตารางกะรายปี (12 Sheets) และไฟล์รายเดือน (.xlsx, .xls, .csv)
              </p>

              <label className="cursor-pointer px-5 py-2.5 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition flex items-center space-x-2">
                <Upload className="w-3.5 h-3.5" />
                <span>{isProcessing ? 'Inspecting File...' : 'Select Shift Plan File'}</span>
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
              <span>Multi-Sheet / Annual Ready</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              <span>Department Isolated (ปลอดภัย)</span>
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
                className="px-3 py-1.5 rounded text-xs font-bold bg-[#008b99] hover:bg-[#00a3a6] text-white transition flex items-center space-x-1 cursor-pointer"
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

      {/* 4.1. Notice for Newly Auto-Added Shift Codes with direct verify link */}
      {newlyAddedShiftCodes.length > 0 && (
        <div className="p-4 rounded-lg border border-amber-500/60 bg-amber-950/40 text-amber-200 text-xs space-y-3 animate-in fade-in slide-in-from-top-2 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start space-x-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-sm text-amber-300">
                  ตรวจพบและเพิ่ม Shift Code ใหม่เข้าระบบ ({newlyAddedShiftCodes.length} รหัส)
                </div>
                <div className="text-amber-200/90 text-xs mt-0.5">
                  ระบบได้เพิ่มรหัสกะใหม่เข้าสู่ฐานข้อมูลแผนก {targetDept} โดยกำหนดเวลาทำงานปกติเริ่มต้นเป็น <strong>08:00 - 17:00</strong> แล้ว <span className="font-semibold underline">โปรดตรวจสอบหรือปรับเปลี่ยนเวลาเข้า-ออกงานให้ตรงตามจริง</span>
                </div>
              </div>
            </div>
            {onNavigateToShiftCodes && (
              <button
                type="button"
                id="btn-goto-verify-new-shiftcodes"
                onClick={onNavigateToShiftCodes}
                className="px-3 py-1.5 rounded text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition flex items-center justify-center space-x-1.5 shrink-0 shadow-xs cursor-pointer"
              >
                <span>ตรวจสอบเวลา Shift Codes</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1 border-t border-amber-500/20">
            {newlyAddedShiftCodes.map((sc, idx) => (
              <div
                key={`${sc.code}_${idx}`}
                className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded bg-black/30 border border-amber-500/30 text-xs font-mono"
              >
                <span className="font-bold text-amber-300">{sc.code}</span>
                <span className="text-[10px] text-amber-200/70">({sc.department}): {sc.startTime} - {sc.endTime}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4.2. Notice for Newly Auto-Added Employees with direct link to Employee Master */}
      {newlyAddedEmployees.length > 0 && (
        <div className="p-4 rounded-lg border border-teal-500/60 bg-teal-950/40 text-teal-200 text-xs space-y-3 animate-in fade-in slide-in-from-top-2 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start space-x-2.5">
              <Users className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-sm text-teal-300">
                  ตรวจพบและเพิ่มพนักงานใหม่เข้าสู่ฐานข้อมูลพนักงาน (Employee Master Database) อัตโนมัติ ({newlyAddedEmployees.length} คน)
                </div>
                <div className="text-teal-200/90 text-xs mt-0.5">
                  ระบบได้ดึงข้อมูล Emp No, Name และ Department จากไฟล์ตารางกะ บันทึกเข้าสู่ Employee Master ให้อัตโนมัติเพื่อให้การอัปโหลดสำเร็จเรียบร้อย — <span className="font-semibold underline">Admin สามารถเข้าไปตรวจสอบและอัปเดตข้อมูลตำแหน่ง (Function Title) และ Cost Center เพิ่มเติมได้</span>
                </div>
              </div>
            </div>
            {onNavigateToEmployees && (
              <button
                type="button"
                id="btn-goto-employee-master"
                onClick={onNavigateToEmployees}
                className="px-3 py-1.5 rounded text-xs font-bold bg-teal-500 hover:bg-teal-400 text-slate-950 transition flex items-center justify-center space-x-1.5 shrink-0 shadow-xs cursor-pointer"
              >
                <span>ไปที่เมนู Employee Master</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1 border-t border-teal-500/20">
            {newlyAddedEmployees.map((emp, idx) => (
              <div
                key={`${emp.empNo}_${idx}`}
                className="inline-flex items-center space-x-2 px-2.5 py-1 rounded bg-black/30 border border-teal-500/30 text-xs"
              >
                <span className="font-bold text-teal-300 font-mono">#{emp.empNo}</span>
                <span className="text-[11px] text-slate-200">{emp.firstName} {emp.familyName}</span>
                <span className="text-[10px] text-teal-400/80 font-mono">({emp.department})</span>
              </div>
            ))}
          </div>
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
              className="text-xs font-semibold text-[#00e5e5] hover:underline flex items-center gap-1 cursor-pointer"
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

      {/* 6. MODAL: Select Month & Confirm Shift Plan Upload */}
      {uploadConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
          <div className={`relative w-full max-w-3xl rounded-xl border shadow-2xl flex flex-col max-h-[90vh] overflow-hidden ${
            isDark ? 'bg-[#0f1924] border-[#253d56] text-slate-100' : 'bg-white border-slate-300 text-slate-900'
          }`}>
            {/* Modal Header */}
            <div className={`p-4 sm:p-5 border-b flex items-start justify-between gap-3 ${
              isDark ? 'border-[#22384e] bg-[#142333]' : 'border-slate-200 bg-slate-50'
            }`}>
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-lg bg-teal-500/20 text-teal-300 border border-teal-500/40 shrink-0">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                    <span>ยืนยันการนำเข้าตารางกะ (Confirm Shift Plan Upload)</span>
                    {uploadConfirmation.isAnnual && (
                      <span className="text-[11px] px-2 py-0.5 rounded font-mono font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
                        ไฟล์รายปี (Annual 12-Month)
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    ไฟล์: <strong className="text-teal-300 font-mono">{uploadConfirmation.file.name}</strong> • ตรวจพบ {uploadConfirmation.sheets.length} Sheets
                  </p>
                </div>
              </div>

              <button
                type="button"
                id="btn-close-upload-modal"
                onClick={() => setUploadConfirmation(null)}
                disabled={isExecutingImport}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 scrollbar-thin">
              {/* Department selection verification */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg border border-slate-700/60 bg-black/20 text-xs">
                <div>
                  <label className="font-semibold text-slate-300 block mb-1">
                    แผนกเป้าหมาย (Target Department):
                  </label>
                  {!isAdmin ? (
                    <div className="font-mono font-bold text-teal-300 px-2.5 py-1.5 rounded bg-teal-500/10 border border-teal-500/30 flex items-center justify-between">
                      <span>{currentUser.department}</span>
                      <span className="text-[10px] text-teal-400 font-normal">แผนกที่ได้รับสิทธิ์</span>
                    </div>
                  ) : (
                    <select
                      value={uploadConfirmation.selectedDept}
                      onChange={(e) => setUploadConfirmation({ ...uploadConfirmation, selectedDept: e.target.value })}
                      className={`w-full px-2.5 py-1.5 rounded border font-mono font-bold text-xs outline-none ${
                        isDark ? 'bg-[#0a121a] border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
                      }`}
                    >
                      <option value="ALL">ALL Departments (ทุกแผนก)</option>
                      {storage.getDepartments().map(d => (
                        <option key={d.code} value={d.code}>
                          {d.name && d.name !== d.code ? `${d.code} - ${d.name}` : d.code}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="font-semibold text-slate-300 block mb-1">
                    โหมดการนำเข้า (Import Scope):
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setUploadConfirmation({ ...uploadConfirmation, importMode: 'SINGLE_MONTH' })}
                      className={`px-2 py-1.5 rounded text-xs font-semibold border flex items-center justify-center space-x-1 transition cursor-pointer ${
                        uploadConfirmation.importMode === 'SINGLE_MONTH'
                          ? 'bg-teal-600 text-white border-teal-400 shadow-xs'
                          : 'bg-black/20 text-slate-400 border-slate-700 hover:text-white'
                      }`}
                    >
                      <span>เฉพาะเดือนที่เลือก</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setUploadConfirmation({ ...uploadConfirmation, importMode: 'ALL_MONTHS' })}
                      disabled={!uploadConfirmation.isAnnual && uploadConfirmation.sheets.filter(s => s.isMonthSheet).length <= 1}
                      className={`px-2 py-1.5 rounded text-xs font-semibold border flex items-center justify-center space-x-1 transition cursor-pointer ${
                        uploadConfirmation.importMode === 'ALL_MONTHS'
                          ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white border-teal-400 shadow-xs'
                          : 'bg-black/20 text-slate-400 border-slate-700 hover:text-white'
                      } ${(!uploadConfirmation.isAnnual && uploadConfirmation.sheets.filter(s => s.isMonthSheet).length <= 1) ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>ทุกเดือนในไฟล์</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Month / Sheet selector pills */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-teal-300 flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    <span>เลือก Sheet / เดือนที่ต้องการตรวจสอบ & นำเข้า:</span>
                  </span>
                  <span className="text-[11px] text-slate-400">
                    เลือกเดือน: <strong className="text-teal-400 font-mono">{uploadConfirmation.selectedMonthYear}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
                  {uploadConfirmation.sheets.map((s, idx) => {
                    const isSelected = uploadConfirmation.selectedSheetName === s.sheetName;
                    return (
                      <button
                        key={`${s.sheetName}_${idx}`}
                        type="button"
                        onClick={() => handleModalSelectSheet(s)}
                        className={`p-2 rounded border text-left transition flex flex-col justify-between cursor-pointer ${
                          isSelected
                            ? 'bg-teal-500/20 border-teal-400 text-teal-200 ring-1 ring-teal-400'
                            : isDark
                              ? 'bg-[#121f2c] border-[#22364a] text-slate-300 hover:bg-[#1a2c3e]'
                              : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs truncate" title={s.sheetName}>
                            {s.sheetName}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-teal-400 shrink-0" />}
                        </div>
                        <div className="text-[10px] opacity-75 mt-1 font-mono truncate">
                          {s.detectedMonthYear} ({s.rowCount} rows)
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Preview Table of Selected Sheet */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <span>ตัวอย่างข้อมูลใน Sheet <strong>"{uploadConfirmation.selectedSheetName}"</strong>:</span>
                  </span>
                  <span className="text-[11px] text-slate-400">
                    แสดงตัวอย่าง 5 แถวแรก
                  </span>
                </div>

                <div className="overflow-x-auto max-h-48 border border-slate-700 rounded bg-black/30 scrollbar-thin">
                  {uploadConfirmation.previewRows && uploadConfirmation.previewRows.length > 0 ? (
                    <table className="w-full text-left text-[11px] font-mono border-collapse">
                      <thead>
                        <tr className="bg-slate-800/80 text-slate-300 border-b border-slate-700">
                          {Object.keys(uploadConfirmation.previewRows[0]).slice(0, 10).map((colKey, i) => (
                            <th key={i} className="p-2 font-semibold border-r border-slate-700/50 whitespace-nowrap">
                              {colKey}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {uploadConfirmation.previewRows.map((row, rIdx) => (
                          <tr key={rIdx} className="border-b border-slate-800 hover:bg-white/5">
                            {Object.keys(uploadConfirmation.previewRows[0]).slice(0, 10).map((colKey, cIdx) => (
                              <td key={cIdx} className="p-1.5 border-r border-slate-800 whitespace-nowrap text-slate-200">
                                {String(row[colKey] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-4 text-center text-xs text-slate-400">
                      ไม่มีข้อมูลหรือ Sheet ว่างเปล่า
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className={`p-4 sm:p-5 border-t flex flex-col sm:flex-row items-center justify-between gap-3 ${
              isDark ? 'border-[#22384e] bg-[#142333]' : 'border-slate-200 bg-slate-50'
            }`}>
              <div className="text-xs text-slate-400 text-center sm:text-left">
                {uploadConfirmation.importMode === 'ALL_MONTHS' ? (
                  <span>
                    จะนำเข้าข้อมูลตารางกะ <strong>{uploadConfirmation.sheets.filter(s => s.isMonthSheet).length} เดือน</strong> สำหรับแผนก <strong>{uploadConfirmation.selectedDept}</strong>
                  </span>
                ) : (
                  <span>
                    จะนำเข้าเฉพาะเดือน <strong>{uploadConfirmation.selectedMonthYear}</strong> สำหรับแผนก <strong>{uploadConfirmation.selectedDept}</strong>
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <button
                  type="button"
                  id="btn-cancel-upload-modal"
                  onClick={() => setUploadConfirmation(null)}
                  disabled={isExecutingImport}
                  className="w-full sm:w-auto px-4 py-2 rounded text-xs font-semibold border border-slate-600 hover:bg-slate-700/50 text-slate-300 transition cursor-pointer"
                >
                  ยกเลิก (Cancel)
                </button>

                <button
                  type="button"
                  id="btn-confirm-execute-import"
                  onClick={executeConfirmationImport}
                  disabled={isExecutingImport}
                  className="w-full sm:w-auto px-5 py-2 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  {isExecutingImport ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>กำลังประมวลผล...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>ยืนยันการนำเข้าเข้าระบบ (Confirm Upload)</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. Comprehensive Post-Upload Summary Report Modal */}
      {uploadSummaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`w-full max-w-3xl max-h-[90vh] rounded-xl border flex flex-col shadow-2xl overflow-hidden ${
            isDark ? 'bg-[#101b27] border-[#22384e] text-slate-100' : 'bg-white border-slate-200 text-slate-900'
          }`}>
            {/* Modal Header */}
            <div className={`p-4 sm:p-5 border-b flex items-center justify-between ${
              isDark ? 'bg-[#142333] border-[#22384e]' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center space-x-3">
                <div className={`p-2.5 rounded-lg border ${
                  uploadSummaryModal.skippedRows.length > 0
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-teal-500/10 text-teal-400 border-teal-500/30'
                }`}>
                  {uploadSummaryModal.skippedRows.length > 0 ? (
                    <AlertTriangle className="w-5 h-5" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <span>สรุปผลการนำเข้าตารางกะ (Shift Plan Upload Summary)</span>
                    <span className="text-xs font-mono font-normal px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
                      แผนก {uploadSummaryModal.department}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {uploadSummaryModal.processedMonths.length > 1
                      ? `นำเข้าตารางกะรายปี (${uploadSummaryModal.processedMonths.length} เดือน: ${uploadSummaryModal.processedMonths[0]} ถึง ${uploadSummaryModal.processedMonths[uploadSummaryModal.processedMonths.length - 1]})`
                      : `นำเข้าตารางกะงวดเดือน ${uploadSummaryModal.processedMonths[0] || targetMonthYear}`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setUploadSummaryModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition cursor-pointer"
                title="ปิด"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 overflow-y-auto max-h-[70vh] space-y-5 scrollbar-thin">
              {/* 1. Quick KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className={`p-3 rounded-lg border ${
                  isDark ? 'bg-[#152332] border-[#223a50]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="text-[11px] text-slate-400">วันทำงานที่จัดกะสำเร็จ</div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-teal-400 mt-1">
                    {uploadSummaryModal.totalPlansCount}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">วันทำงาน (Work shifts)</div>
                </div>

                <div className={`p-3 rounded-lg border ${
                  isDark ? 'bg-[#152332] border-[#223a50]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="text-[11px] text-slate-400">พนักงานที่จัดกะสำเร็จ</div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-teal-300 mt-1">
                    {uploadSummaryModal.totalEmployeesCount}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">คน (Scheduled staff)</div>
                </div>

                <div className={`p-3 rounded-lg border ${
                  uploadSummaryModal.skippedRows.length > 0
                    ? isDark ? 'bg-amber-950/30 border-amber-500/50 text-amber-300' : 'bg-amber-50 border-amber-300 text-amber-900'
                    : isDark ? 'bg-[#152332] border-[#223a50]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="text-[11px] font-semibold opacity-90">ข้ามรายการไม่สมบูรณ์</div>
                  <div className={`text-lg sm:text-xl font-bold font-mono mt-1 ${
                    uploadSummaryModal.skippedRows.length > 0 ? 'text-amber-400' : 'text-slate-400'
                  }`}>
                    {uploadSummaryModal.skippedRows.length}
                  </div>
                  <div className="text-[10px] opacity-75 mt-0.5">รายการ (Skipped GID)</div>
                </div>

                <div className={`p-3 rounded-lg border ${
                  isDark ? 'bg-[#152332] border-[#223a50]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="text-[11px] text-slate-400">พนักงานใหม่ / Auto-Assign</div>
                  <div className="text-lg sm:text-xl font-bold font-mono text-cyan-300 mt-1">
                    {uploadSummaryModal.newEmployees.length}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">ตำแหน่ง & Cost Center</div>
                </div>
              </div>

              {/* 2. Skipped / Incomplete Rows Section (เฉพาะส่วนที่ยังไม่สมบูรณ์) */}
              {uploadSummaryModal.skippedRows.length > 0 && (
                <div className={`p-4 rounded-lg border space-y-3 ${
                  isDark ? 'bg-amber-950/30 border-amber-500/60 text-amber-100' : 'bg-amber-50/80 border-amber-300 text-amber-950'
                }`}>
                  <div className="flex items-start space-x-2.5">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-sm text-amber-300">
                        รายการที่ไม่สมบูรณ์และระบบไม่อนุญาตให้นำเข้า ({uploadSummaryModal.skippedRows.length} รายการ)
                      </h4>
                      <p className="text-xs opacity-90 mt-0.5">
                        ระบบไม่อนุญาตให้นำเข้าเฉพาะรายการที่<strong>ไม่มีข้อมูล GID</strong> หรือ<strong>ระบุ GID ไม่ถูกต้อง/เป็นตัวอย่าง</strong> (เช่น <code>XXX</code>, <code>000</code>, <code>N/A</code>, <code>-</code>) โดยระบบได้นำเข้าเฉพาะพนักงานที่มีข้อมูลสมบูรณ์เรียบร้อยแล้ว
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto max-h-48 rounded border border-amber-500/30 bg-black/30 scrollbar-thin">
                    <table className="w-full text-left text-xs border-collapse font-mono">
                      <thead>
                        <tr className="bg-amber-900/40 text-amber-200 border-b border-amber-500/30">
                          <th className="p-2 whitespace-nowrap">แถว</th>
                          <th className="p-2 whitespace-nowrap">รหัสพนักงาน</th>
                          <th className="p-2 whitespace-nowrap">ชื่อพนักงาน</th>
                          <th className="p-2 whitespace-nowrap">GID ที่ระบุ</th>
                          <th className="p-2 whitespace-nowrap">แผนก</th>
                          <th className="p-2 whitespace-nowrap">สาเหตุที่ไม่นำเข้า</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadSummaryModal.skippedRows.map((sr, idx) => (
                          <tr key={idx} className="border-b border-amber-500/20 hover:bg-amber-500/10">
                            <td className="p-2 font-bold text-amber-300">#{sr.row}</td>
                            <td className="p-2 text-slate-200">{sr.empNo || '-'}</td>
                            <td className="p-2 text-white font-sans">{sr.name || '-'}</td>
                            <td className="p-2 font-bold text-rose-400">{sr.gid || '(ว่าง)'}</td>
                            <td className="p-2 text-slate-300">{sr.department || '-'}</td>
                            <td className="p-2 text-amber-200/90 font-sans text-[11px]">{sr.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="text-[11px] text-amber-300/80 italic flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>คำแนะนำ: กรุณาเปิดไฟล์ Excel แก้ไข GID ของพนักงานรายการข้างต้นให้ถูกต้อง จากนั้นสามารถอัปโหลดไฟล์ใหม่อีกครั้งเพื่อเติมข้อมูลให้ครบถ้วน</span>
                  </div>
                </div>
              )}

              {/* 3. Auto-assigned Function & Cost Center Section */}
              {uploadSummaryModal.newEmployees.length > 0 && (
                <div className={`p-4 rounded-lg border space-y-3 ${
                  isDark ? 'bg-teal-950/30 border-teal-500/50 text-teal-100' : 'bg-teal-50/80 border-teal-300 text-teal-950'
                }`}>
                  <div className="flex items-start space-x-2.5">
                    <Users className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-sm text-teal-300">
                        พนักงานใหม่และรายการที่กำหนด Function เป็น "Service Technician" & Cost Center อัตโนมัติ ({uploadSummaryModal.newEmployees.length} คน)
                      </h4>
                      <p className="text-xs opacity-90 mt-0.5">
                        ระบบได้บันทึกพนักงานใหม่เข้าสู่ <strong>Employee Master Database</strong> โดยกำหนดตำแหน่งเป็น <code>Service Technician</code> และตั้งค่า Cost Center ตามแผนกให้อัตโนมัติเรียบร้อยแล้ว
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto max-h-48 rounded border border-teal-500/30 bg-black/30 scrollbar-thin">
                    <table className="w-full text-left text-xs border-collapse font-mono">
                      <thead>
                        <tr className="bg-teal-900/40 text-teal-200 border-b border-teal-500/30">
                          <th className="p-2 whitespace-nowrap">Emp No</th>
                          <th className="p-2 whitespace-nowrap">GID</th>
                          <th className="p-2 whitespace-nowrap">ชื่อ-นามสกุล</th>
                          <th className="p-2 whitespace-nowrap">แผนก</th>
                          <th className="p-2 whitespace-nowrap">ตำแหน่ง (Function)</th>
                          <th className="p-2 whitespace-nowrap">Cost Center</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadSummaryModal.newEmployees.map((emp, idx) => (
                          <tr key={idx} className="border-b border-teal-500/20 hover:bg-teal-500/10">
                            <td className="p-2 font-bold text-teal-300">{emp.empNo}</td>
                            <td className="p-2 text-slate-200 font-bold">{emp.gid}</td>
                            <td className="p-2 text-white font-sans">{emp.firstName} {emp.familyName}</td>
                            <td className="p-2 text-teal-300">{emp.department}</td>
                            <td className="p-2 font-sans font-semibold text-cyan-300">{emp.functionTitle || 'Service Technician'}</td>
                            <td className="p-2 font-bold text-amber-300">{emp.costCenter}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 4. Newly Auto-Added Shift Codes Section */}
              {uploadSummaryModal.newShiftCodes.length > 0 && (
                <div className={`p-4 rounded-lg border space-y-3 ${
                  isDark ? 'bg-amber-950/25 border-amber-500/40 text-amber-100' : 'bg-amber-50/70 border-amber-200 text-amber-950'
                }`}>
                  <div className="flex items-start space-x-2.5">
                    <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-sm text-amber-300">
                        Shift Code ใหม่ที่ตรวจพบและบันทึกอัตโนมัติ ({uploadSummaryModal.newShiftCodes.length} รหัส)
                      </h4>
                      <p className="text-xs opacity-90 mt-0.5">
                        ระบบตั้งค่าเวลาเริ่มต้นเป็น <strong>08:00 - 17:00</strong> กรุณาตรวจสอบหรือปรับเปลี่ยนเวลาให้ตรงตามจริง
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {uploadSummaryModal.newShiftCodes.map((sc, idx) => (
                      <div
                        key={idx}
                        className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-black/40 border border-amber-500/30 text-xs font-mono"
                      >
                        <span className="font-bold text-amber-300">{sc.code}</span>
                        <span className="text-[11px] text-slate-300">({sc.department}): {sc.startTime} - {sc.endTime}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className={`p-4 sm:p-5 border-t flex flex-col sm:flex-row items-center justify-between gap-3 ${
              isDark ? 'border-[#22384e] bg-[#142333]' : 'border-slate-200 bg-slate-50'
            }`}>
              <div className="text-xs text-slate-400 text-center sm:text-left">
                นำเข้าข้อมูลเสร็จสมบูรณ์และซิงค์ขึ้น Cloud เรียบร้อยแล้ว
              </div>

              <div className="flex items-center space-x-2 w-full sm:w-auto justify-end flex-wrap gap-2">
                {onNavigateToEmployees && uploadSummaryModal.newEmployees.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadSummaryModal(null);
                      onNavigateToEmployees();
                    }}
                    className="px-3 py-2 rounded text-xs font-semibold border border-teal-500/50 hover:bg-teal-500/10 text-teal-300 transition cursor-pointer flex items-center space-x-1.5"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>ไปที่ Employee Master</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setUploadSummaryModal(null);
                    onNavigateToRoster();
                  }}
                  className="px-4 py-2 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition flex items-center space-x-1.5 cursor-pointer"
                >
                  <span>ไปที่ตารางการทำงาน (Shift Roster)</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setUploadSummaryModal(null)}
                  className="px-3.5 py-2 rounded text-xs font-semibold border border-slate-600 hover:bg-slate-700/50 text-slate-300 transition cursor-pointer"
                >
                  ปิด (Close)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

