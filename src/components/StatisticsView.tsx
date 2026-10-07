import React, { useState, useMemo } from 'react';
import { 
  Employee, 
  ShiftCode, 
  DailyShiftPlan, 
  BiometricRawPunch, 
  UserAccount 
} from '../types';
import { 
  resolveShiftInfo, 
  filterDeduplicatedPunches, 
  hhmmToMinutes, 
  minutesToHHMM,
  isEmployeeMatch,
  isEmployeePlanMatch
} from '../utils/timeCalc';
import { 
  isSameDepartment 
} from '../utils/fileParser';
import { 
  storage 
} from '../utils/storage';
import { 
  BarChart3, 
  Clock, 
  HeartPulse, 
  Palmtree, 
  FileText, 
  CalendarOff, 
  UserX, 
  Users,
  Search, 
  Download, 
  ChevronDown, 
  ChevronUp, 
  Building2, 
  Calendar, 
  AlertCircle, 
  CheckCircle2, 
  ArrowUpDown,
  Filter,
  FileSpreadsheet,
  TrendingUp,
  Sparkles,
  Info
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Legend, 
  Cell 
} from 'recharts';
import * as XLSX from 'xlsx';

export type StatCategory = 
  | 'late' 
  | 'sick_leave' 
  | 'annual_leave' 
  | 'other_leave' 
  | 'day_off' 
  | 'no_stamp';

export interface StatCategoryConfig {
  id: StatCategory;
  nameEn: string;
  nameTh: string;
  icon: React.ElementType;
  color: string;
  badgeBg: string;
  unitTh: string;
  descriptionTh: string;
}

export const STAT_CATEGORIES: StatCategoryConfig[] = [
  {
    id: 'late',
    nameEn: 'Late',
    nameTh: 'สถิติมาสาย',
    icon: Clock,
    color: '#f59e0b',
    badgeBg: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    unitTh: 'ครั้ง',
    descriptionTh: 'เทียบเวลาเริ่มต้นตาม Shift Code กับเวลาสแกนนิ้วเข้างานจริง (Time Attendance)',
  },
  {
    id: 'sick_leave',
    nameEn: 'Sick Leave',
    nameTh: 'สถิติลาป่วย',
    icon: HeartPulse,
    color: '#f43f5e',
    badgeBg: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    unitTh: 'วัน',
    descriptionTh: 'บันทึกวันลาป่วยตามรหัสกะ SL, SL2 (ครึ่งวัน), SLO (ไม่มีใบรับรองแพทย์)',
  },
  {
    id: 'annual_leave',
    nameEn: 'Annual Leave',
    nameTh: 'สถิติการลาพักร้อน',
    icon: Palmtree,
    color: '#ec4899',
    badgeBg: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
    unitTh: 'วัน',
    descriptionTh: 'บันทึกวันลาพักร้อนประจำปีตามรหัสกะ AL, AL2, ALU (ไม่รับค่าจ้าง)',
  },
  {
    id: 'other_leave',
    nameEn: 'Other Leave',
    nameTh: 'สถิติรวมวันลาอื่นๆ',
    icon: FileText,
    color: '#8b5cf6',
    badgeBg: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    unitTh: 'วัน',
    descriptionTh: 'รวมวันลาประเภทอื่นๆ เช่น ลากิจ (CL), ลาคลอด, ลาฝึกอบรม, ลาบวช ฯลฯ',
  },
  {
    id: 'day_off',
    nameEn: 'Day OFF',
    nameTh: 'สถิติรวมวันหยุด',
    icon: CalendarOff,
    color: '#008b99',
    badgeBg: 'bg-teal-500/10 text-teal-400 border-teal-500/30',
    unitTh: 'วัน',
    descriptionTh: 'สถิติวันหยุดประจำสัปดาห์ (Shift code OFF) และวันหยุดประเพณี (H)',
  },
  {
    id: 'no_stamp',
    nameEn: 'No Stamp',
    nameTh: 'สถิติไม่มี Time Attendance',
    icon: UserX,
    color: '#ef4444',
    badgeBg: 'bg-red-500/10 text-red-400 border-red-500/30',
    unitTh: 'วัน',
    descriptionTh: 'มีตารางกะที่ต้องมาปฏิบัติงาน แต่วันดังกล่าวไม่มีบันทึกเวลาเข้า-ออกในระบบ',
  },
];

interface EmployeeStatDetail {
  date: string;
  dayOfWeek: string;
  shiftCode: string;
  shiftName: string;
  shiftIn: string;
  shiftOut: string;
  clockIn: string;
  clockOut: string;
  lateMinutes: number;
  leaveDays: number;
  note: string;
}

export interface EmployeeStatRecord {
  employee: Employee;
  empNo: string;
  name: string;
  department: string;
  functionTitle: string;
  totalCount: number;
  totalDays: number;
  totalLateMinutes: number;
  details: EmployeeStatDetail[];
}

interface StatisticsViewProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  employees: Employee[];
  shiftCodes: ShiftCode[];
  shiftPlans: DailyShiftPlan[];
  biometricPunches: BiometricRawPunch[];
  selectedMonthYear: string;
  onSelectMonthYear: (my: string) => void;
  selectedDepartment: string;
  onSelectDepartment: (dept: string) => void;
  onNavigateToUploadShiftPlan?: () => void;
}

export const StatisticsView: React.FC<StatisticsViewProps> = ({
  currentUser,
  theme,
  employees,
  shiftCodes,
  shiftPlans,
  biometricPunches,
  selectedMonthYear,
  onSelectMonthYear,
  selectedDepartment,
  onSelectDepartment,
  onNavigateToUploadShiftPlan,
}) => {
  const isDark = theme === 'dark';

  // Active Category tab
  const [activeCategory, setActiveCategory] = useState<StatCategory>('late');

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showOnlyWithRecords, setShowOnlyWithRecords] = useState<boolean>(true);
  const [sortKey, setSortKey] = useState<'value' | 'empNo' | 'name' | 'department'>('value');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [expandedEmpNo, setExpandedEmpNo] = useState<string | null>(null);

  // 1. Identify which Month-Years and Departments ACTUALLY have Uploaded Shift Plans
  const uploadedPlansInfo = useMemo(() => {
    // Map of monthYear -> Set of departments
    const monthDeptMap = new Map<string, Set<string>>();
    // Set of all uploaded months
    const monthsSet = new Set<string>();
    // Set of all uploaded departments
    const allDeptsSet = new Set<string>();

    shiftPlans.forEach(plan => {
      if (!plan.date || !plan.department) return;
      const my = plan.date.slice(0, 7);
      monthsSet.add(my);
      allDeptsSet.add(plan.department);

      if (!monthDeptMap.has(my)) {
        monthDeptMap.set(my, new Set<string>());
      }
      monthDeptMap.get(my)!.add(plan.department);
    });

    const sortedMonths = Array.from(monthsSet).sort().reverse();
    const sortedAllDepts = Array.from(allDeptsSet).sort();

    return {
      monthDeptMap,
      availableMonths: sortedMonths,
      allUploadedDepts: sortedAllDepts,
    };
  }, [shiftPlans]);

  // Ensure current selectedMonthYear is one of the uploaded months if available
  const effectiveMonthYear = useMemo(() => {
    if (uploadedPlansInfo.availableMonths.length === 0) {
      return selectedMonthYear || '2026-05';
    }
    if (uploadedPlansInfo.availableMonths.includes(selectedMonthYear)) {
      return selectedMonthYear;
    }
    return uploadedPlansInfo.availableMonths[0];
  }, [uploadedPlansInfo.availableMonths, selectedMonthYear]);

  // Available departments for the selected month
  const availableDepartmentsForMonth = useMemo(() => {
    const deptsSet = uploadedPlansInfo.monthDeptMap.get(effectiveMonthYear);
    if (!deptsSet) return [];
    return Array.from(deptsSet).sort();
  }, [uploadedPlansInfo.monthDeptMap, effectiveMonthYear]);

  // Ensure effective department is valid
  const effectiveDepartment = useMemo(() => {
    if (availableDepartmentsForMonth.length === 0) {
      return 'ALL';
    }
    if (selectedDepartment === 'ALL') return 'ALL';
    const found = availableDepartmentsForMonth.find(d => isSameDepartment(d, selectedDepartment));
    return found || (availableDepartmentsForMonth.includes(selectedDepartment) ? selectedDepartment : 'ALL');
  }, [availableDepartmentsForMonth, selectedDepartment]);

  // Active Year for the Yearly Bar Chart Overview
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const y = parseInt(effectiveMonthYear.split('-')[0], 10);
    return isNaN(y) ? 2026 : y;
  });

  // Shift code lookup map
  const shiftCodeMap = useMemo(() => {
    const map = new Map<string, ShiftCode>();
    shiftCodes.forEach(sc => map.set(sc.code.toUpperCase(), sc));
    return map;
  }, [shiftCodes]);

  // Active category config
  const currentCategoryConfig = useMemo(() => {
    return STAT_CATEGORIES.find(c => c.id === activeCategory) || STAT_CATEGORIES[0];
  }, [activeCategory]);

  // Pre-indexed Shift Plans Map (O(1) lookup by empNo/gid + date)
  const planLookupMap = useMemo(() => {
    const map = new Map<string, DailyShiftPlan>();
    for (const sp of shiftPlans) {
      if (!sp || !sp.date) continue;
      if (sp.empNo) {
        const cleanEmp = sp.empNo.trim().toUpperCase();
        map.set(`${cleanEmp}_${sp.date}`, sp);
        map.set(`${cleanEmp.replace(/^0+/, '')}_${sp.date}`, sp);
        map.set(`${cleanEmp.padStart(4, '0')}_${sp.date}`, sp);
      }
      if (sp.gid) {
        map.set(`${sp.gid.trim().toUpperCase()}_${sp.date}`, sp);
      }
    }
    return map;
  }, [shiftPlans]);

  // Pre-indexed Biometric Punches Map (O(1) lookup by empIdentifier + date)
  const punchesByEmpAndDate = useMemo(() => {
    const map = new Map<string, BiometricRawPunch[]>();
    for (const p of (biometricPunches || [])) {
      if (!p || !p.empIdentifier || !p.date || !p.time) continue;
      const rawId = p.empIdentifier.trim().toUpperCase();
      const strippedId = rawId.replace(/^0+/, '');
      const paddedId = rawId.padStart(4, '0');
      
      const keys = new Set([
        `${rawId}_${p.date}`,
        `${strippedId}_${p.date}`,
        `${paddedId}_${p.date}`,
      ]);

      for (const k of keys) {
        let list = map.get(k);
        if (!list) {
          list = [];
          map.set(k, list);
        }
        list.push(p);
      }
    }
    return map;
  }, [biometricPunches]);

  // 2. Core Statistics Engine: compute records for an employee across a given month (Optimized O(1))
  const calculateEmployeeStatsForMonth = (
    emp: Employee,
    monthStr: string,
    category: StatCategory
  ): EmployeeStatRecord => {
    const [yStr, mStr] = monthStr.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    const daysInMonth = new Date(year, month, 0).getDate();

    const empNoKey = (emp.empNo || '').trim().toUpperCase();
    const gidKey = (emp.gid || '').trim().toUpperCase();

    const details: EmployeeStatDetail[] = [];
    let totalCount = 0;
    let totalDays = 0;
    let totalLateMinutes = 0;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let d = 1; d <= daysInMonth; d++) {
      const dayPadded = String(d).padStart(2, '0');
      const dateStr = `${monthStr}-${dayPadded}`;
      const dateObj = new Date(year, month - 1, d);
      const dayOfWeek = dayNames[dateObj.getDay()];

      // Find shift plan in O(1)
      const plan = (empNoKey ? planLookupMap.get(`${empNoKey}_${dateStr}`) : undefined) ||
                   (gidKey ? planLookupMap.get(`${gidKey}_${dateStr}`) : undefined);

      // If no plan exists for this day, skip or use default
      if (!plan) continue;

      const rawCode = (plan.shiftCode || '').trim();
      if (!rawCode) continue;

      const shiftInfo = resolveShiftInfo(rawCode, shiftCodes, emp);
      const cleanCode = rawCode.toUpperCase().replace(/-X/gi, '').replace(/-ET/gi, '').trim();

      // Find punches for this day in O(1)
      const dayPunches = (empNoKey ? punchesByEmpAndDate.get(`${empNoKey}_${dateStr}`) : undefined) ||
                         (gidKey ? punchesByEmpAndDate.get(`${gidKey}_${dateStr}`) : undefined) || [];
      let clockIn = '';
      let clockOut = '';
      try {
        const res = filterDeduplicatedPunches(dayPunches, shiftInfo);
        clockIn = res.clockIn || '';
        clockOut = res.clockOut || '';
      } catch (err) {
        console.warn('Punch resolution error in StatisticsView:', err);
      }

      const shiftIn = shiftInfo?.isWorkingDay ? (shiftInfo.startTime || '') : '';
      const shiftOut = shiftInfo?.isWorkingDay ? (shiftInfo.endTime || '') : '';

      // Check category conditions
      if (category === 'late') {
        // Condition: Working day, shift has startTime, clockIn exists, and clockIn > shiftIn
        if (shiftInfo?.isWorkingDay && shiftIn && clockIn) {
          const clockInMin = hhmmToMinutes(clockIn);
          const shiftInMin = hhmmToMinutes(shiftIn);
          if (clockInMin > shiftInMin) {
            const lateMin = clockInMin - shiftInMin;
            totalCount += 1;
            totalLateMinutes += lateMin;
            details.push({
              date: dateStr,
              dayOfWeek,
              shiftCode: rawCode,
              shiftName: shiftInfo?.name || rawCode,
              shiftIn,
              shiftOut,
              clockIn,
              clockOut,
              lateMinutes: lateMin,
              leaveDays: 0,
              note: `สาย ${lateMin} นาที (กำหนดเข้า: ${shiftIn}, สแกนจริง: ${clockIn})`,
            });
          }
        }
      } else if (category === 'sick_leave') {
        // Condition: Shift code starts with SL
        if (cleanCode.startsWith('SL')) {
          const isHalfDay = cleanCode === 'SL2';
          const leaveVal = isHalfDay ? 0.5 : 1.0;
          totalCount += 1;
          totalDays += leaveVal;
          details.push({
            date: dateStr,
            dayOfWeek,
            shiftCode: rawCode,
            shiftName: shiftInfo?.name || 'Sick Leave',
            shiftIn: '',
            shiftOut: '',
            clockIn: clockIn || '-',
            clockOut: clockOut || '-',
            lateMinutes: 0,
            leaveDays: leaveVal,
            note: isHalfDay ? 'ลาป่วยครึ่งวัน (0.5 วัน)' : 'ลาป่วยเต็มวัน (1.0 วัน)',
          });
        }
      } else if (category === 'annual_leave') {
        // Condition: Shift code starts with AL
        if (cleanCode.startsWith('AL')) {
          const isHalfDay = cleanCode === 'AL2' || cleanCode === 'AL2U';
          const leaveVal = isHalfDay ? 0.5 : 1.0;
          totalCount += 1;
          totalDays += leaveVal;
          details.push({
            date: dateStr,
            dayOfWeek,
            shiftCode: rawCode,
            shiftName: shiftInfo?.name || 'Annual Leave',
            shiftIn: '',
            shiftOut: '',
            clockIn: clockIn || '-',
            clockOut: clockOut || '-',
            lateMinutes: 0,
            leaveDays: leaveVal,
            note: isHalfDay ? 'ลาพักร้อนครึ่งวัน (0.5 วัน)' : 'ลาพักร้อนเต็มวัน (1.0 วัน)',
          });
        }
      } else if (category === 'other_leave') {
        // Condition: Leaves other than SL and AL and not OFF / H
        const isExcluded = 
          cleanCode === 'OFF' || 
          cleanCode === 'H' || 
          cleanCode.startsWith('SL') || 
          cleanCode.startsWith('AL');

        const isLeaveCode = 
          cleanCode.startsWith('CL') || 
          cleanCode.startsWith('BL') || 
          cleanCode.startsWith('ML') || 
          cleanCode.startsWith('ORD') || 
          cleanCode.startsWith('MIL') || 
          (shiftInfo && !shiftInfo.isWorkingDay && !isExcluded);

        if (isLeaveCode) {
          const isHalfDay = cleanCode.endsWith('2');
          const leaveVal = isHalfDay ? 0.5 : 1.0;
          totalCount += 1;
          totalDays += leaveVal;
          details.push({
            date: dateStr,
            dayOfWeek,
            shiftCode: rawCode,
            shiftName: shiftInfo?.name || cleanCode,
            shiftIn: '',
            shiftOut: '',
            clockIn: clockIn || '-',
            clockOut: clockOut || '-',
            lateMinutes: 0,
            leaveDays: leaveVal,
            note: `วันลาอื่น (${cleanCode}): ${leaveVal} วัน`,
          });
        }
      } else if (category === 'day_off') {
        // Condition: Shift code OFF or H
        if (cleanCode === 'OFF' || cleanCode === 'H') {
          totalCount += 1;
          totalDays += 1;
          details.push({
            date: dateStr,
            dayOfWeek,
            shiftCode: rawCode,
            shiftName: cleanCode === 'H' ? 'Public Holiday (วันหยุดนักขัตฤกษ์)' : 'Day OFF (วันหยุดประจำสัปดาห์)',
            shiftIn: '',
            shiftOut: '',
            clockIn: clockIn || '-',
            clockOut: clockOut || '-',
            lateMinutes: 0,
            leaveDays: 1,
            note: cleanCode === 'H' ? 'วันหยุดนักขัตฤกษ์ (H)' : 'วันหยุดประจำสัปดาห์ (OFF)',
          });
        }
      } else if (category === 'no_stamp') {
        // Condition: Scheduled working day, but NO clockIn and NO clockOut
        const isScheduledWork = shiftInfo?.isWorkingDay === true && 
          cleanCode !== 'OFF' && 
          cleanCode !== 'H' && 
          !cleanCode.startsWith('SL') && 
          !cleanCode.startsWith('AL') && 
          !cleanCode.startsWith('CL');

        if (isScheduledWork && !clockIn && !clockOut) {
          totalCount += 1;
          totalDays += 1;
          details.push({
            date: dateStr,
            dayOfWeek,
            shiftCode: rawCode,
            shiftName: shiftInfo?.name || rawCode,
            shiftIn,
            shiftOut,
            clockIn: '-',
            clockOut: '-',
            lateMinutes: 0,
            leaveDays: 1,
            note: `มีกะปฏิบัติงาน (${rawCode} ${shiftIn}-${shiftOut}) แต่ไม่มีข้อมูลบันทึกเวลาเข้า-ออก`,
          });
        }
      }
    }

    return {
      employee: emp,
      empNo: emp.empNo,
      name: `${emp.firstName || ''} ${emp.familyName || ''}`.trim() || emp.empNo,
      department: emp.department || '',
      functionTitle: emp.functionTitle || '',
      totalCount,
      totalDays,
      totalLateMinutes,
      details,
    };
  };

  // 3. Filter employees matching the department (which has uploaded shift plans)
  const targetEmployees = useMemo(() => {
    const baseEmployees = employees.length > 0 ? employees : storage.getEmployees();
    const list = [...baseEmployees];
    const knownEmpNos = new Set<string>();
    baseEmployees.forEach(e => {
      if (e.empNo) {
        const clean = e.empNo.trim().toUpperCase();
        knownEmpNos.add(clean);
        const digits = clean.replace(/\D/g, '').replace(/^0+/, '');
        if (digits) {
          knownEmpNos.add(digits);
          knownEmpNos.add(digits.padStart(4, '0'));
          knownEmpNos.add(`1000${digits.padStart(4, '0')}`);
        }
      }
      if (e.empCode) knownEmpNos.add(e.empCode.trim().toUpperCase());
      if (e.gid) knownEmpNos.add(e.gid.trim().toUpperCase());
    });
    
    const missingEmpsFromPlans = new Map<string, DailyShiftPlan>();
    shiftPlans.forEach(p => {
      if (!p || !p.date || !p.date.startsWith(effectiveMonthYear)) return;
      const eNo = (p.empNo || '').trim().toUpperCase();
      const digits = eNo.replace(/\D/g, '').replace(/^0+/, '');
      const isKnown = (eNo && knownEmpNos.has(eNo)) || (digits && (knownEmpNos.has(digits) || knownEmpNos.has(digits.padStart(4, '0'))));
      if (eNo && !isKnown && !missingEmpsFromPlans.has(eNo)) {
        missingEmpsFromPlans.set(eNo, p);
      }
    });

    missingEmpsFromPlans.forEach((p, eNo) => {
      const cleanNo = p.empNo || eNo;
      const digits = cleanNo.replace(/\D/g, '');
      const paddedNo = digits && digits.length <= 4 ? digits.padStart(4, '0') : cleanNo;
      list.push({
        id: `synth-${paddedNo}`,
        empNo: paddedNo,
        empCode: digits ? `1000${paddedNo}` : cleanNo,
        gid: p.gid || (digits ? `Z${paddedNo}TH` : `Z${cleanNo}TH`),
        firstName: 'พนักงาน',
        familyName: cleanNo,
        department: p.department || (effectiveDepartment !== 'ALL' ? effectiveDepartment : 'GM'),
        division: 'MO CS BTS',
        functionTitle: 'Service Technician',
        costCenter: 'C93051',
        isShiftWorker: true,
        isActive: true,
      });
    });

    // Collect all employee IDs/empNos who actually have shift plans in this department & month
    const empNosInMonthPlan = new Set<string>();
    shiftPlans.forEach(sp => {
      if (sp.date.startsWith(effectiveMonthYear)) {
        if (effectiveDepartment === 'ALL' || isSameDepartment(sp.department, effectiveDepartment)) {
          if (sp.empNo) {
            const clean = sp.empNo.trim().toUpperCase();
            empNosInMonthPlan.add(clean);
            const digits = clean.replace(/\D/g, '').replace(/^0+/, '');
            if (digits) {
              empNosInMonthPlan.add(digits);
              empNosInMonthPlan.add(digits.padStart(4, '0'));
            }
          }
        }
      }
    });

    return list.filter(emp => {
      // Must match department if specific
      if (effectiveDepartment !== 'ALL' && !isSameDepartment(emp.department, effectiveDepartment)) {
        return false;
      }
      // Must have uploaded shift plan in this month
      const clean = (emp.empNo || '').trim().toUpperCase();
      const digits = clean.replace(/\D/g, '').replace(/^0+/, '');
      return empNosInMonthPlan.has(clean) || (digits && (empNosInMonthPlan.has(digits) || empNosInMonthPlan.has(digits.padStart(4, '0'))));
    });
  }, [employees, shiftPlans, effectiveMonthYear, effectiveDepartment]);

  // 4. Compute monthly table statistics for each employee
  const currentMonthRecords = useMemo(() => {
    return targetEmployees.map(emp => 
      calculateEmployeeStatsForMonth(emp, effectiveMonthYear, activeCategory)
    );
  }, [targetEmployees, effectiveMonthYear, activeCategory, shiftCodes, biometricPunches, shiftPlans]);

  // Filter & Sort table records
  const filteredAndSortedRecords = useMemo(() => {
    let list = [...currentMonthRecords];

    if (showOnlyWithRecords) {
      list = list.filter(r => (activeCategory === 'late' ? r.totalCount > 0 : (r.totalDays > 0 || r.totalCount > 0)));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(r => 
        r.empNo.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.functionTitle.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let comp = 0;
      if (sortKey === 'value') {
        if (activeCategory === 'late') {
          comp = a.totalCount === b.totalCount 
            ? a.totalLateMinutes - b.totalLateMinutes 
            : a.totalCount - b.totalCount;
        } else {
          comp = a.totalDays - b.totalDays;
        }
      } else if (sortKey === 'empNo') {
        comp = a.empNo.localeCompare(b.empNo, undefined, { numeric: true });
      } else if (sortKey === 'name') {
        comp = a.name.localeCompare(b.name);
      } else if (sortKey === 'department') {
        comp = a.department.localeCompare(b.department);
      }
      return sortAsc ? comp : -comp;
    });

    return list;
  }, [currentMonthRecords, showOnlyWithRecords, searchQuery, sortKey, sortAsc, activeCategory]);

  // Summary Metrics for the current category in the active month
  const categorySummaryKPIs = useMemo(() => {
    const totalEmployees = currentMonthRecords.length;
    const affectedEmployees = currentMonthRecords.filter(r => 
      activeCategory === 'late' ? r.totalCount > 0 : r.totalDays > 0
    ).length;

    const totalInstances = currentMonthRecords.reduce((sum, r) => sum + r.totalCount, 0);
    const totalDays = currentMonthRecords.reduce((sum, r) => sum + r.totalDays, 0);
    const totalLateMinutes = currentMonthRecords.reduce((sum, r) => sum + r.totalLateMinutes, 0);

    const averagePerPerson = affectedEmployees > 0 
      ? (activeCategory === 'late' 
          ? (totalInstances / affectedEmployees).toFixed(1) 
          : (totalDays / affectedEmployees).toFixed(1))
      : '0.0';

    return {
      totalEmployees,
      affectedEmployees,
      totalInstances,
      totalDays,
      totalLateMinutes,
      averagePerPerson,
    };
  }, [currentMonthRecords, activeCategory]);

  // 5. Yearly Overview Bar Chart Data across 12 months (Jan - Dec) for the selected Year
  const yearlyChartData = useMemo(() => {
    const monthsData = [];
    const monthNames = [
      'Jan (ม.ค.)', 'Feb (ก.พ.)', 'Mar (มี.ค.)', 'Apr (เม.ย.)',
      'May (พ.ค.)', 'Jun (มิ.ย.)', 'Jul (ก.ค.)', 'Aug (ส.ค.)',
      'Sep (ก.ย.)', 'Oct (ต.ค.)', 'Nov (พ.ย.)', 'Dec (ธ.ค.)'
    ];

    for (let m = 1; m <= 12; m++) {
      const mPadded = String(m).padStart(2, '0');
      const monthKey = `${selectedYear}-${mPadded}`;

      // Check if this month has uploaded shift plans for the department
      const deptsInMonth = uploadedPlansInfo.monthDeptMap.get(monthKey);
      const hasPlan = deptsInMonth && (effectiveDepartment === 'ALL' || deptsInMonth.has(effectiveDepartment));

      if (!hasPlan) {
        monthsData.push({
          monthKey,
          monthLabel: monthNames[m - 1],
          value: 0,
          lateMinutes: 0,
          affectedEmployees: 0,
          hasData: false,
        });
        continue;
      }

      // Calculate for all employees in this department in that month
      let mTotalCount = 0;
      let mTotalDays = 0;
      let mTotalLateMin = 0;
      let mAffectedEmp = 0;

      targetEmployees.forEach(emp => {
        const stat = calculateEmployeeStatsForMonth(emp, monthKey, activeCategory);
        if (activeCategory === 'late') {
          if (stat.totalCount > 0) {
            mAffectedEmp++;
            mTotalCount += stat.totalCount;
            mTotalLateMin += stat.totalLateMinutes;
          }
        } else {
          if (stat.totalDays > 0) {
            mAffectedEmp++;
            mTotalDays += stat.totalDays;
            mTotalCount += stat.totalCount;
          }
        }
      });

      monthsData.push({
        monthKey,
        monthLabel: monthNames[m - 1],
        value: activeCategory === 'late' ? mTotalCount : mTotalDays,
        lateMinutes: mTotalLateMin,
        affectedEmployees: mAffectedEmp,
        hasData: true,
      });
    }

    return monthsData;
  }, [selectedYear, activeCategory, effectiveDepartment, targetEmployees, uploadedPlansInfo.monthDeptMap, planLookupMap, punchesByEmpAndDate]);

  // Export Table to Excel (.xlsx)
  const handleExportExcel = () => {
    const headers = [
      'Emp No',
      'Name',
      'Department',
      'Function Title',
      activeCategory === 'late' ? 'Late Count (ครั้ง)' : 'Total Days (วัน)',
      ...(activeCategory === 'late' ? ['Total Late (HH:mm)', 'Late Minutes'] : []),
      'Details (วันที่มีรายการ)',
    ];

    const rows = filteredAndSortedRecords.map(r => {
      const detailsStr = r.details
        .map(d => `${d.date} [${d.shiftCode}]: ${d.note}`)
        .join('; ');

      const rowData: any = {
        'Emp No': r.empNo,
        Name: r.name,
        Department: r.department,
        'Function Title': r.functionTitle,
      };

      if (activeCategory === 'late') {
        rowData['Late Count (ครั้ง)'] = r.totalCount;
        rowData['Total Late (HH:mm)'] = minutesToHHMM(r.totalLateMinutes);
        rowData['Late Minutes'] = r.totalLateMinutes;
      } else {
        rowData['Total Days (วัน)'] = r.totalDays;
      }

      rowData['Details (วันที่มีรายการ)'] = detailsStr || '-';
      return rowData;
    });

    const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    worksheet['!cols'] = [
      { wch: 12 },
      { wch: 26 },
      { wch: 14 },
      { wch: 22 },
      { wch: 18 },
      { wch: 18 },
      { wch: 60 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `Stats_${currentCategoryConfig.nameEn}`);
    XLSX.writeFile(
      workbook, 
      `Statistics_${currentCategoryConfig.nameEn}_${effectiveDepartment}_${effectiveMonthYear}.xlsx`
    );
  };

  // Export Table to CSV
  const handleExportCSV = () => {
    const headers = [
      'Emp No',
      'Name',
      'Department',
      'Function Title',
      activeCategory === 'late' ? 'Late Count' : 'Total Days',
      ...(activeCategory === 'late' ? ['Total Late Time', 'Total Late Minutes'] : []),
      'Details',
    ];

    const csvLines = [headers.join(',')];

    filteredAndSortedRecords.forEach(r => {
      const detailsStr = (r.details.map(d => `${d.date}: ${d.note}`).join(' | ') || '-')
        .replace(/"/g, '""');

      const cols = [
        `"${r.empNo}"`,
        `"${r.name}"`,
        `"${r.department}"`,
        `"${r.functionTitle}"`,
        activeCategory === 'late' ? r.totalCount : r.totalDays,
        ...(activeCategory === 'late' ? [`"${minutesToHHMM(r.totalLateMinutes)}"`, r.totalLateMinutes] : []),
        `"${detailsStr}"`,
      ];
      csvLines.push(cols.join(','));
    });

    const blob = new Blob([`\uFEFF${csvLines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Statistics_${currentCategoryConfig.nameEn}_${effectiveDepartment}_${effectiveMonthYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`p-4 sm:p-6 space-y-6 min-h-screen ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      {/* 1. Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-teal-500/10 border border-teal-500/30 text-teal-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-teal-400 flex items-center gap-2">
                <span>Statistics & Workforce Analytics</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-teal-500/20 text-teal-300 border border-teal-500/40">
                  สถิติการทำงานและการลา
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                วิเคราะห์สถิติมาสาย วันลาป่วย ลาพักร้อน วันลาอื่นๆ วันหยุด และวันที่ไม่มีบันทึกเวลา เฉพาะแผนกและเดือนที่มีการอัปโหลด Shift Plan
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleExportExcel}
            className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center space-x-1.5 border transition cursor-pointer ${
              isDark 
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/50' 
                : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
            }`}
            title="ส่งออกรายงานตารางสถิติเป็นไฟล์ Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export Excel</span>
          </button>

          <button
            onClick={handleExportCSV}
            className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center space-x-1.5 border transition cursor-pointer ${
              isDark 
                ? 'bg-[#162330] border-[#223547] text-slate-300 hover:bg-[#1e2f42]' 
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
            title="ส่งออกรายงานตารางสถิติเป็นไฟล์ CSV"
          >
            <Download className="w-3.5 h-3.5 text-teal-400" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* 2. Filter Bar: Month-Year & Department (แสดงเฉพาะที่มีการ Upload Shift Plan) */}
      <div className={`p-4 rounded-xl border shadow-sm ${
        isDark ? 'bg-[#0f1722] border-[#1e2d3e]' : 'bg-white border-slate-200'
      }`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Month-Year Filter */}
            <div className="flex items-center space-x-2">
              <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-teal-400" />
                <span>เดือน-ปี (Month):</span>
              </label>
              {uploadedPlansInfo.availableMonths.length > 0 ? (
                <select
                  value={effectiveMonthYear}
                  onChange={e => onSelectMonthYear(e.target.value)}
                  className={`px-3 py-1.5 rounded text-xs font-medium border focus:outline-hidden focus:ring-1 focus:ring-teal-400 ${
                    isDark ? 'bg-[#162230] border-[#25384d] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}
                >
                  {uploadedPlansInfo.availableMonths.map(my => (
                    <option key={my} value={my}>
                      {my} ({uploadedPlansInfo.monthDeptMap.get(my)?.size || 0} แผนกอัปโหลดแล้ว)
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-xs text-amber-400 italic">
                  ยังไม่มี Shift Plan ในระบบ
                </div>
              )}
            </div>

            {/* Department Filter */}
            <div className="flex items-center space-x-2">
              <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-teal-400" />
                <span>แผนก (Department):</span>
              </label>
              {availableDepartmentsForMonth.length > 0 ? (
                <select
                  value={effectiveDepartment}
                  onChange={e => onSelectDepartment(e.target.value)}
                  className={`px-3 py-1.5 rounded text-xs font-medium border focus:outline-hidden focus:ring-1 focus:ring-teal-400 ${
                    isDark ? 'bg-[#162230] border-[#25384d] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}
                >
                  <option value="ALL">
                    ALL (ทุกแผนกที่อัปโหลด - {availableDepartmentsForMonth.length} แผนก)
                  </option>
                  {availableDepartmentsForMonth.map(dept => (
                    <option key={dept} value={dept}>
                      แผนก {dept}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-xs text-slate-400 italic">
                  -
                </div>
              )}
            </div>
          </div>

          {/* Uploaded Shift Plan Status Badge */}
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-slate-400">สถานะ Shift Plan:</span>
            {targetEmployees.length > 0 ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/30 font-medium">
                <CheckCircle2 className="w-3 h-3" />
                <span>อัปโหลดแล้ว ({targetEmployees.length} พนักงานในงวด {effectiveMonthYear})</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-medium">
                <AlertCircle className="w-3 h-3" />
                <span>ยังไม่มีข้อมูล Shift Plan สำหรับตัวเลือกนี้</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Notice if no shift plans exist for this month/dept */}
      {targetEmployees.length === 0 && (
        <div className={`p-6 rounded-xl border text-center space-y-3 ${
          isDark ? 'bg-[#0f1722]/80 border-amber-500/30' : 'bg-amber-50 border-amber-200'
        }`}>
          <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-amber-300">
              ไม่พบข้อมูลตารางกะ (Shift Plan) ในเดือน {effectiveMonthYear} สำหรับแผนก {effectiveDepartment}
            </h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              ระบบสถิติจะคำนวณและแสดงผลเฉพาะแผนกและเดือนที่มีการอัปโหลด Shift Plan แล้วเท่านั้น คุณสามารถดาวน์โหลดเทมเพลตและอัปโหลดตารางกะได้ที่หน้า Upload Shift Plan
            </p>
          </div>
          {onNavigateToUploadShiftPlan && (
            <button
              onClick={onNavigateToUploadShiftPlan}
              className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold shadow-md transition cursor-pointer inline-flex items-center gap-2"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>ไปที่หน้า Upload Shift Plan</span>
            </button>
          )}
        </div>
      )}

      {/* 3. The 6 Category Tabs (แถบแยกภายในเป็นหมวดหมู่) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {STAT_CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;

          // Quick count for badge in active month
          let badgeVal = 0;
          if (cat.id === 'late') {
            badgeVal = currentMonthRecords.reduce((sum, r) => {
              if (activeCategory === 'late') return sum + r.totalCount;
              const s = calculateEmployeeStatsForMonth(r.employee, effectiveMonthYear, 'late');
              return sum + s.totalCount;
            }, 0);
          } else {
            badgeVal = currentMonthRecords.reduce((sum, r) => {
              if (activeCategory === cat.id) return sum + r.totalDays;
              const s = calculateEmployeeStatsForMonth(r.employee, effectiveMonthYear, cat.id);
              return sum + s.totalDays;
            }, 0);
          }

          return (
            <button
              key={cat.id}
              onClick={() => {
                setActiveCategory(cat.id);
                setExpandedEmpNo(null);
              }}
              className={`p-3 rounded-xl border text-left transition relative cursor-pointer ${
                isActive
                  ? isDark 
                    ? 'bg-[#152332] border-teal-400/80 shadow-md shadow-teal-500/5 ring-1 ring-teal-400/40' 
                    : 'bg-white border-teal-500 shadow-md ring-1 ring-teal-500/40'
                  : isDark 
                    ? 'bg-[#0f1722] border-[#1e2d3e] hover:border-[#2b3e54] text-slate-300' 
                    : 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <div 
                  className="p-1.5 rounded-lg border"
                  style={{
                    backgroundColor: `${cat.color}15`,
                    borderColor: `${cat.color}35`,
                    color: cat.color,
                  }}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <span 
                  className="text-xs font-bold px-2 py-0.5 rounded-full font-mono"
                  style={{
                    backgroundColor: `${cat.color}20`,
                    color: cat.color,
                  }}
                >
                  {badgeVal} {cat.unitTh}
                </span>
              </div>
              <div className="font-bold text-xs truncate">
                {cat.nameEn}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {cat.nameTh}
              </div>
            </button>
          );
        })}
      </div>

      {/* 4. Active Category KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={`p-4 rounded-xl border ${
          isDark ? 'bg-[#0f1722] border-[#1e2d3e]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
            <Users className="w-3.5 h-3.5 text-teal-400" />
            <span>พนักงานที่มีสถิติ (Affected)</span>
          </div>
          <div className="text-xl font-black text-slate-100 flex items-baseline gap-1.5">
            <span>{categorySummaryKPIs.affectedEmployees}</span>
            <span className="text-xs font-normal text-slate-400">/ {categorySummaryKPIs.totalEmployees} คน</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {categorySummaryKPIs.totalEmployees > 0 
              ? `${((categorySummaryKPIs.affectedEmployees / categorySummaryKPIs.totalEmployees) * 100).toFixed(0)}% ของพนักงานทั้งหมด` 
              : '0%'}
          </div>
        </div>

        <div className={`p-4 rounded-xl border ${
          isDark ? 'bg-[#0f1722] border-[#1e2d3e]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-teal-400" />
            <span>ยอดรวมประจำงวด (Total in Month)</span>
          </div>
          <div className="text-xl font-black" style={{ color: currentCategoryConfig.color }}>
            {activeCategory === 'late' 
              ? `${categorySummaryKPIs.totalInstances} ครั้ง` 
              : `${categorySummaryKPIs.totalDays} วัน`}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {activeCategory === 'late' 
              ? `คิดเป็นเวลารวม ${minutesToHHMM(categorySummaryKPIs.totalLateMinutes)} ชม.` 
              : `จำนวนรวม ${categorySummaryKPIs.totalInstances} รายการ`}
          </div>
        </div>

        <div className={`p-4 rounded-xl border ${
          isDark ? 'bg-[#0f1722] border-[#1e2d3e]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
            <Sparkles className="w-3.5 h-3.5 text-teal-400" />
            <span>ค่าเฉลี่ยต่อคน (Average)</span>
          </div>
          <div className="text-xl font-black text-slate-100">
            {categorySummaryKPIs.averagePerPerson} <span className="text-xs font-normal text-slate-400">{currentCategoryConfig.unitTh}/คน</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            เฉพาะผู้มีประวัติในหมวดนี้
          </div>
        </div>

        <div className={`p-4 rounded-xl border ${
          isDark ? 'bg-[#0f1722] border-[#1e2d3e]' : 'bg-white border-slate-200 shadow-xs'
        }`}>
          <div className="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
            <Info className="w-3.5 h-3.5 text-teal-400" />
            <span>ขอบเขตข้อมูล (Scope)</span>
          </div>
          <div className="text-sm font-bold text-teal-300 truncate">
            {effectiveDepartment === 'ALL' ? 'ทุกแผนกที่อัปโหลด' : `แผนก ${effectiveDepartment}`}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 truncate">
            งวดประจำเดือน {effectiveMonthYear}
          </div>
        </div>
      </div>

      {/* 5. Yearly Overview Bar Chart ("กราฟแท่งรายปีภาพรวม Overview แต่ละหมวด") */}
      <div className={`p-5 rounded-xl border ${
        isDark ? 'bg-[#0f1722] border-[#1e2d3e]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-teal-400" />
              <span>Yearly Overview Trend: {currentCategoryConfig.nameEn} ({currentCategoryConfig.nameTh})</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              กราฟแท่งแสดงแนวโน้มภาพรวมรายเดือน (ม.ค. - ธ.ค. ปี {selectedYear}) ของแผนก {effectiveDepartment}
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400 font-semibold">เลือกปี (Year):</span>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(parseInt(e.target.value, 10))}
              className={`px-3 py-1 rounded text-xs font-semibold border focus:outline-hidden ${
                isDark ? 'bg-[#162230] border-[#25384d] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'
              }`}
            >
              {[2024, 2025, 2026, 2027].map(y => (
                <option key={y} value={y}>
                  ปี ค.ศ. {y} (พ.ศ. {y + 543})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Chart Container */}
        <div className="h-72 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart 
              data={yearlyChartData} 
              margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
            >
              <CartesianGrid 
                strokeDasharray="3 3" 
                stroke={isDark ? '#1a2736' : '#e2e8f0'} 
                vertical={false} 
              />
              <XAxis 
                dataKey="monthLabel" 
                tick={{ fill: isDark ? '#94a3b8' : '#64748b', fontSize: 11 }}
                axisLine={{ stroke: isDark ? '#223245' : '#cbd5e1' }}
                tickLine={false}
              />
              <YAxis 
                tick={{ fill: isDark ? '#94a3b8' : '#64748b', fontSize: 11 }}
                axisLine={{ stroke: isDark ? '#223245' : '#cbd5e1' }}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className={`p-3 rounded-lg border text-xs shadow-xl space-y-1 ${
                        isDark ? 'bg-[#0b1219] border-[#1e2d3e] text-slate-200' : 'bg-white border-slate-200 text-slate-800'
                      }`}>
                        <div className="font-bold text-teal-400 border-b border-slate-700/50 pb-1">
                          {data.monthLabel} (งวด {data.monthKey})
                        </div>
                        {data.hasData ? (
                          <>
                            <div className="flex justify-between gap-4">
                              <span className="text-slate-400">{currentCategoryConfig.nameTh}:</span>
                              <span className="font-bold font-mono" style={{ color: currentCategoryConfig.color }}>
                                {data.value} {currentCategoryConfig.unitTh}
                              </span>
                            </div>
                            {activeCategory === 'late' && (
                              <div className="flex justify-between gap-4">
                                <span className="text-slate-400">เวลารวมที่สาย:</span>
                                <span className="font-bold font-mono text-amber-400">
                                  {minutesToHHMM(data.lateMinutes)} ชม. ({data.lateMinutes} นาที)
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between gap-4">
                              <span className="text-slate-400">จำนวนพนักงานที่มีสถิติ:</span>
                              <span className="font-bold text-slate-200">
                                {data.affectedEmployees} คน
                              </span>
                            </div>
                            <div className="text-[10px] text-teal-300/80 pt-1 italic">
                              💡 คลิกที่แท่งกราฟเพื่อเลือกดูรายละเอียดงวดนี้
                            </div>
                          </>
                        ) : (
                          <div className="text-slate-500 italic">
                            ไม่มีการอัปโหลด Shift Plan ในงวดนี้
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar 
                dataKey="value" 
                name={currentCategoryConfig.nameEn}
                radius={[4, 4, 0, 0]}
                onClick={(entry: any) => {
                  if (entry && entry.hasData) {
                    onSelectMonthYear(entry.monthKey);
                  }
                }}
                className="cursor-pointer"
              >
                {yearlyChartData.map((entry, index) => {
                  const isCurrentSelected = entry.monthKey === effectiveMonthYear;
                  return (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.hasData 
                        ? (isCurrentSelected ? '#00e5e5' : currentCategoryConfig.color) 
                        : (isDark ? '#1e293b' : '#e2e8f0')}
                      opacity={entry.hasData ? (isCurrentSelected ? 1 : 0.8) : 0.3}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 6. Individual Breakdown Table ("ต่อด้วยตารางข้อมูลรายบุคคลตามหมวด") */}
      <div className={`rounded-xl border overflow-hidden ${
        isDark ? 'bg-[#0f1722] border-[#1e2d3e]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        {/* Table Toolbar */}
        <div className={`p-4 border-b flex flex-col md:flex-row md:items-center justify-between gap-3 ${
          isDark ? 'border-[#1e2d3e] bg-[#0c131c]' : 'border-slate-200 bg-slate-50/50'
        }`}>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span style={{ color: currentCategoryConfig.color }}>●</span>
              <span>ตารางข้อมูลรายบุคคล (Individual Breakdown) — {currentCategoryConfig.nameEn} ({currentCategoryConfig.nameTh})</span>
              <span className="text-xs font-normal text-slate-400">
                ({filteredAndSortedRecords.length} คน{showOnlyWithRecords ? ` จากผู้มีสถิติตามหัวข้อนี้ทั้งหมด ${categorySummaryKPIs.affectedEmployees} คน` : ''})
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {showOnlyWithRecords 
                ? `แสดงเฉพาะพนักงานที่มีสถิติ ${currentCategoryConfig.nameTh} (${currentCategoryConfig.nameEn}) ในงวด ${effectiveMonthYear} (ซ่อนผู้ที่ไม่มีสถิติเกี่ยวข้อง)`
                : `แสดงพนักงานทุกคน พร้อมวันที่และรายละเอียดในงวด ${effectiveMonthYear}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="ค้นหาชื่อ หรือ รหัสพนักงาน..."
                className={`pl-8 pr-3 py-1.5 rounded-lg text-xs border w-48 sm:w-60 focus:outline-hidden focus:ring-1 focus:ring-teal-400 ${
                  isDark ? 'bg-[#162230] border-[#25384d] text-slate-200 placeholder-slate-500' : 'bg-white border-slate-300 text-slate-800'
                }`}
              />
            </div>

            {/* Filter Toggle: Only with records vs Show all */}
            <button
              onClick={() => setShowOnlyWithRecords(prev => !prev)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center space-x-1.5 transition cursor-pointer ${
                showOnlyWithRecords
                  ? 'bg-teal-500/20 border-teal-500/50 text-teal-300 font-semibold'
                  : isDark 
                    ? 'bg-[#162230] border-[#25384d] text-slate-400 hover:text-slate-200' 
                    : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
              title={showOnlyWithRecords ? "คลิกเพื่อแสดงพนักงานทุกคน (รวมผู้ที่ไม่มีสถิติ)" : "คลิกเพื่อซ่อนผู้ที่ไม่มีสถิติ (แสดงเฉพาะผู้มียอด > 0)"}
            >
              <Filter className="w-3.5 h-3.5 text-teal-400" />
              <span>{showOnlyWithRecords ? 'ซ่อนผู้ไม่มีสถิติ (เฉพาะยอด > 0)' : 'แสดงทุกคน (รวม 0 รายการ)'}</span>
            </button>

            {/* Sort Toggle */}
            <div className="flex items-center space-x-1 border rounded-lg p-0.5 text-xs">
              <button
                onClick={() => {
                  if (sortKey === 'value') setSortAsc(prev => !prev);
                  else { setSortKey('value'); setSortAsc(false); }
                }}
                className={`px-2 py-1 rounded transition cursor-pointer ${
                  sortKey === 'value' ? 'bg-teal-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                เรียงตามยอด {sortKey === 'value' ? (sortAsc ? '↑' : '↓') : ''}
              </button>
              <button
                onClick={() => {
                  if (sortKey === 'empNo') setSortAsc(prev => !prev);
                  else { setSortKey('empNo'); setSortAsc(true); }
                }}
                className={`px-2 py-1 rounded transition cursor-pointer ${
                  sortKey === 'empNo' ? 'bg-teal-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                รหัส {sortKey === 'empNo' ? (sortAsc ? '↑' : '↓') : ''}
              </button>
            </div>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className={`border-b text-[11px] font-semibold tracking-wider uppercase ${
                isDark ? 'border-[#1e2d3e] bg-[#0d1520] text-slate-400' : 'border-slate-200 bg-slate-100 text-slate-600'
              }`}>
                <th className="py-3 px-4 w-12 text-center">#</th>
                <th className="py-3 px-4 w-28">Emp No.</th>
                <th className="py-3 px-4">ชื่อ - นามสกุล (Name)</th>
                <th className="py-3 px-4 w-24">แผนก</th>
                <th className="py-3 px-4 w-36">ตำแหน่ง</th>
                <th className="py-3 px-4 w-36 text-center">
                  {activeCategory === 'late' ? 'จำนวนครั้งที่สาย' : `ยอดรวม (${currentCategoryConfig.unitTh})`}
                </th>
                {activeCategory === 'late' && (
                  <th className="py-3 px-4 w-32 text-center">รวมเวลาสาย</th>
                )}
                <th className="py-3 px-4">วันที่มีเหตุการณ์ / รายละเอียด</th>
                <th className="py-3 px-4 w-20 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {filteredAndSortedRecords.length > 0 ? (
                filteredAndSortedRecords.map((rec, idx) => {
                  const isExpanded = expandedEmpNo === rec.empNo;
                  const hasRecords = activeCategory === 'late' ? rec.totalCount > 0 : rec.totalDays > 0;

                  return (
                    <React.Fragment key={rec.empNo}>
                      <tr 
                        className={`transition cursor-pointer ${
                          isExpanded 
                            ? isDark ? 'bg-[#142130]' : 'bg-teal-50/70'
                            : isDark ? 'hover:bg-[#121c28]' : 'hover:bg-slate-50'
                        }`}
                        onClick={() => setExpandedEmpNo(isExpanded ? null : rec.empNo)}
                      >
                        <td className="py-3 px-4 text-center text-slate-500 font-mono">
                          {idx + 1}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-teal-400">
                          {rec.empNo}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-200">
                          {rec.name}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
                            {rec.department}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-400 truncate max-w-[150px]" title={rec.functionTitle}>
                          {rec.functionTitle || '-'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center justify-center font-mono font-bold px-2.5 py-0.5 rounded-full text-xs ${
                            hasRecords 
                              ? currentCategoryConfig.badgeBg 
                              : 'bg-slate-800/50 text-slate-500 border border-slate-700/50'
                          }`}>
                            {activeCategory === 'late' ? rec.totalCount : rec.totalDays} {currentCategoryConfig.unitTh}
                          </span>
                        </td>
                        {activeCategory === 'late' && (
                          <td className="py-3 px-4 text-center font-mono font-semibold text-amber-400">
                            {rec.totalLateMinutes > 0 ? `${minutesToHHMM(rec.totalLateMinutes)} ชม.` : '-'}
                          </td>
                        )}
                        <td className="py-3 px-4 text-slate-300">
                          {rec.details.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-md">
                              {rec.details.slice(0, 4).map((d, i) => (
                                <span 
                                  key={i} 
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60 font-mono"
                                  title={d.note}
                                >
                                  {d.date.slice(8)} ({d.shiftCode})
                                </span>
                              ))}
                              {rec.details.length > 4 && (
                                <span className="text-[10px] text-teal-400 font-semibold self-center">
                                  +{rec.details.length - 4} วัน
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-500 italic">ไม่มีบันทึก</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedEmpNo(isExpanded ? null : rec.empNo);
                            }}
                            className={`p-1.5 rounded transition ${
                              isDark ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-slate-200 text-slate-600'
                            }`}
                            title="ดูรายละเอียดวันที่"
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Date Detail Sub-Table */}
                      {isExpanded && (
                        <tr className={isDark ? 'bg-[#0a121a]' : 'bg-slate-50'}>
                          <td colSpan={activeCategory === 'late' ? 9 : 8} className="p-4">
                            <div className={`rounded-lg border p-3 space-y-3 ${
                              isDark ? 'border-[#1e2d3e] bg-[#0e1722]' : 'border-slate-200 bg-white'
                            }`}>
                              <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                                <div className="font-bold text-xs text-teal-400 flex items-center gap-2">
                                  <span>รายละเอียดเหตุการณ์: {rec.name} (รหัส {rec.empNo})</span>
                                  <span className="text-slate-400 font-normal">
                                    แผนก {rec.department} — ประจำงวด {effectiveMonthYear}
                                  </span>
                                </div>
                                <div className="text-xs font-mono font-bold" style={{ color: currentCategoryConfig.color }}>
                                  รวม {rec.details.length} รายการ
                                </div>
                              </div>

                              {rec.details.length > 0 ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                      <tr className={`border-b text-[10px] uppercase font-semibold ${
                                        isDark ? 'text-slate-400 border-slate-800' : 'text-slate-600 border-slate-200'
                                      }`}>
                                        <th className="py-2 px-3">วันที่ (Date)</th>
                                        <th className="py-2 px-3">วัน</th>
                                        <th className="py-2 px-3">Shift Code</th>
                                        <th className="py-2 px-3">เวลากะที่กำหนด</th>
                                        <th className="py-2 px-3">เวลาสแกนจริง (Punch In)</th>
                                        <th className="py-2 px-3">เวลาสแกนออก (Punch Out)</th>
                                        {activeCategory === 'late' && (
                                          <th className="py-2 px-3 text-center">นาทีที่สาย</th>
                                        )}
                                        <th className="py-2 px-3">หมายเหตุ / คำอธิบาย</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/30">
                                      {rec.details.map((d, i) => (
                                        <tr key={i} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-100/60'}>
                                          <td className="py-2 px-3 font-mono font-bold text-slate-200">
                                            {d.date}
                                          </td>
                                          <td className="py-2 px-3 text-slate-400">
                                            {d.dayOfWeek}
                                          </td>
                                          <td className="py-2 px-3">
                                            <span className="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-slate-800 text-teal-300 border border-slate-700">
                                              {d.shiftCode}
                                            </span>
                                          </td>
                                          <td className="py-2 px-3 font-mono text-slate-400">
                                            {d.shiftIn ? `${d.shiftIn} - ${d.shiftOut}` : '-'}
                                          </td>
                                          <td className="py-2 px-3 font-mono font-semibold text-slate-200">
                                            {d.clockIn || '-'}
                                          </td>
                                          <td className="py-2 px-3 font-mono text-slate-400">
                                            {d.clockOut || '-'}
                                          </td>
                                          {activeCategory === 'late' && (
                                            <td className="py-2 px-3 text-center font-mono font-bold text-amber-400">
                                              +{d.lateMinutes} น.
                                            </td>
                                          )}
                                          <td className="py-2 px-3 text-slate-300 text-[11px]">
                                            {d.note}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="p-4 text-center text-xs text-slate-500 italic">
                                  ไม่มีบันทึกเหตุการณ์ในหมวด {currentCategoryConfig.nameTh} สำหรับพนักงานท่านนี้ในงวด {effectiveMonthYear}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={activeCategory === 'late' ? 9 : 8} className="py-12 text-center text-xs">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <div className="p-2.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <span className="font-semibold text-slate-200 text-sm">
                        ไม่มีพนักงานที่มีสถิติในหมวด {currentCategoryConfig.nameTh} ({currentCategoryConfig.nameEn}) ประจำงวด {effectiveMonthYear}
                      </span>
                      <span className="text-[11px] text-slate-400 max-w-md">
                        {searchQuery 
                          ? `ไม่พบข้อมูลพนักงานที่ตรงกับการค้นหา "${searchQuery}"` 
                          : `ในงวดนี้พนักงานทุกคนใน${effectiveDepartment === 'ALL' ? 'ทุกแผนก' : `แผนก ${effectiveDepartment}`} ไม่มีสถิติเกี่ยวข้องกับหัวข้อนี้ จึงไม่มีข้อมูลแสดงผลในตาราง`}
                      </span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
