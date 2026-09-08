import React, { useState, useMemo, useEffect } from 'react';
import { 
  Employee, 
  ShiftCode, 
  DailyShiftPlan, 
  UserAccount 
} from '../types';
import { 
  Search, 
  Lock, 
  Download, 
  Upload, 
  CalendarCheck,
  Building2,
  Briefcase,
  X,
  Paintbrush,
  Sparkles,
  Info,
  CheckCircle2
} from 'lucide-react';
import { storage } from '../utils/storage';
import { generateShiftPlanTemplate, downloadBlob } from '../utils/fileParser';
import { MonthYearFilter } from './MonthYearFilter';
import { ShiftPickerModal } from './ShiftPickerModal';

interface ShiftRosterViewProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  selectedMonthYear: string;
  onSelectMonthYear: (my: string) => void;
  selectedDepartment: string;
  onSelectDepartment: (dept: string) => void;
  employees: Employee[];
  shiftCodes: ShiftCode[];
  shiftPlans: DailyShiftPlan[];
  onNavigateToImport: () => void;
}

export const ShiftRosterView: React.FC<ShiftRosterViewProps> = ({
  currentUser,
  theme,
  selectedMonthYear,
  onSelectMonthYear,
  selectedDepartment,
  onSelectDepartment,
  employees,
  shiftCodes,
  shiftPlans,
  onNavigateToImport,
}) => {
  const isDark = theme === 'dark';
  const [searchTerm, setSearchTerm] = useState('');
  const [shiftFilter, setShiftFilter] = useState<'ALL' | 'SHIFT' | 'OFFICE'>('ALL');

  // Smart Shift Picker Modal State
  const [pickerModal, setPickerModal] = useState<{
    isOpen: boolean;
    employee: Employee | null;
    dateStr: string;
    currentShiftCode: string;
  }>({
    isOpen: false,
    employee: null,
    dateStr: '',
    currentShiftCode: '',
  });

  // Quick Shift Painter / Stamp Mode
  const [isPainterActive, setIsPainterActive] = useState<boolean>(false);
  const [selectedPainterCode, setSelectedPainterCode] = useState<string>('D');

  // Toast feedback notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2800);
  };

  // Keyboard shortcut to exit painter mode with ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPainterActive) {
        setIsPainterActive(false);
        showToast('ปิดโหมดจัดกะด่วนแล้ว');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPainterActive]);

  const [yearStr, monthStr] = selectedMonthYear.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const daysInMonth = new Date(year, month, 0).getDate();

  // Create array of days 1..daysInMonth
  const daysArray = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dateObj = new Date(year, month - 1, day);
      const dayNames = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
      const dayNamesEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dow = dateObj.getDay();
      return {
        day,
        dateStr: `${selectedMonthYear}-${String(day).padStart(2, '0')}`,
        dow,
        dowTh: dayNames[dow],
        dowEn: dayNamesEn[dow],
        isWeekend: dow === 0 || dow === 6,
      };
    });
  }, [year, month, daysInMonth, selectedMonthYear]);

  // Compute department counts for dropdown
  const departmentCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: employees.length };
    employees.forEach(emp => {
      counts[emp.department] = (counts[emp.department] || 0) + 1;
    });
    return counts;
  }, [employees]);

  // Filter employees by Department, Shift Type, and Name/GID search
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      // 1. Department filter (Dropdown)
      if (selectedDepartment !== 'ALL' && emp.department !== selectedDepartment) {
        return false;
      }

      // 2. Shift worker type filter
      if (shiftFilter === 'SHIFT' && !emp.isShiftWorker) return false;
      if (shiftFilter === 'OFFICE' && emp.isShiftWorker) return false;

      // 3. Search specifically by Employee Name and GID (and EmpNo)
      if (searchTerm.trim()) {
        const query = searchTerm.trim().toLowerCase();
        const fullName = `${emp.firstName} ${emp.familyName}`.toLowerCase();
        const reverseName = `${emp.familyName} ${emp.firstName}`.toLowerCase();
        const matchesName = fullName.includes(query) || reverseName.includes(query);
        const matchesGid = emp.gid.toLowerCase().includes(query);
        const matchesEmpNo = emp.empNo.toLowerCase().includes(query);
        return matchesName || matchesGid || matchesEmpNo;
      }
      return true;
    });
  }, [employees, selectedDepartment, shiftFilter, searchTerm]);

  // Shift code mapping
  const shiftMap = useMemo(() => {
    const map = new Map<string, ShiftCode>();
    shiftCodes.forEach(sc => map.set(sc.code, sc));
    return map;
  }, [shiftCodes]);

  // Quick check if current user can edit this employee's schedule
  const canEditEmployee = (emp: Employee): boolean => {
    if (currentUser.role === 'Admin') return true;
    if (currentUser.department === 'ALL') return true;
    return currentUser.department === emp.department;
  };

  // Get shift code for employee on date
  const getShiftForDate = (empNo: string, gid: string, dateStr: string): string => {
    const plan = shiftPlans.find(
      p => (p.empNo === empNo || p.gid === gid) && p.date === dateStr
    );
    if (plan) return plan.shiftCode;
    // Fallback: Day shift for weekday, OFF for weekend
    const dow = new Date(dateStr).getDay();
    return dow === 0 || dow === 6 ? 'OFF' : 'D';
  };

  // Batch or single shift apply logic
  const handleApplyShift = (
    emp: Employee,
    startDateStr: string,
    newCode: string,
    rangeType: 'single' | 'weekday' | 'next7' | 'endOfMonth'
  ) => {
    if (!canEditEmployee(emp)) return;

    // Calculate dates to update
    const targetDates: string[] = [];
    const [y, m, d] = startDateStr.split('-').map(v => parseInt(v, 10));

    if (rangeType === 'single') {
      targetDates.push(startDateStr);
    } else if (rangeType === 'weekday') {
      // Find Monday..Friday in the current week of startDateStr
      const currentDayDate = new Date(y, m - 1, d);
      const dayOfWeek = currentDayDate.getDay(); // 0 is Sun, 1 is Mon...
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      for (let i = 0; i < 5; i++) {
        const dOffset = mondayOffset + i;
        const targetDayNum = d + dOffset;
        if (targetDayNum >= 1 && targetDayNum <= daysInMonth) {
          targetDates.push(`${selectedMonthYear}-${String(targetDayNum).padStart(2, '0')}`);
        }
      }
    } else if (rangeType === 'next7') {
      // 7 consecutive days starting from d
      for (let i = 0; i < 7; i++) {
        const targetDayNum = d + i;
        if (targetDayNum <= daysInMonth) {
          targetDates.push(`${selectedMonthYear}-${String(targetDayNum).padStart(2, '0')}`);
        }
      }
    } else if (rangeType === 'endOfMonth') {
      // All remaining days in month
      for (let dayNum = d; dayNum <= daysInMonth; dayNum++) {
        targetDates.push(`${selectedMonthYear}-${String(dayNum).padStart(2, '0')}`);
      }
    }

    const currentPlans = storage.getShiftPlans();

    targetDates.forEach(dStr => {
      const existingIndex = currentPlans.findIndex(
        p => (p.empNo === emp.empNo || p.gid === emp.gid) && p.date === dStr
      );

      if (existingIndex >= 0) {
        currentPlans[existingIndex].shiftCode = newCode;
        currentPlans[existingIndex].updatedBy = currentUser.email;
        currentPlans[existingIndex].updatedAt = new Date().toISOString();
      } else {
        currentPlans.push({
          id: `plan-${emp.empNo}-${dStr}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          empNo: emp.empNo,
          gid: emp.gid,
          date: dStr,
          shiftCode: newCode,
          department: emp.department,
          updatedBy: currentUser.email,
          updatedAt: new Date().toISOString(),
        });
      }
    });

    storage.setShiftPlans(currentPlans);

    const shiftInfo = shiftMap.get(newCode);
    const rangeName = rangeType === 'single' ? '1 วัน' : rangeType === 'weekday' ? 'ทั้งสัปดาห์ (จ.-ศ.)' : rangeType === 'next7' ? '7 วัน' : 'ถึงสิ้นเดือน';
    showToast(`เปลี่ยนกะ ${newCode} (${shiftInfo?.name || ''}) ให้ ${emp.firstName} ${rangeName} เรียบร้อยแล้ว`);

    // Close modal if open
    setPickerModal({
      isOpen: false,
      employee: null,
      dateStr: '',
      currentShiftCode: '',
    });
  };

  // Handle cell click: painter vs modal
  const handleCellClick = (emp: Employee, d: { dateStr: string; day: number }) => {
    if (!canEditEmployee(emp)) return;

    if (isPainterActive) {
      // Instant paint
      handleApplyShift(emp, d.dateStr, selectedPainterCode, 'single');
    } else {
      // Open Smart Picker Modal
      const currentCode = getShiftForDate(emp.empNo, emp.gid, d.dateStr);
      setPickerModal({
        isOpen: true,
        employee: emp,
        dateStr: d.dateStr,
        currentShiftCode: currentCode,
      });
    }
  };

  // Quick download blank/pre-filled template for current department
  const handleDownloadTemplate = () => {
    const targetDept = selectedDepartment === 'ALL' ? 'GM' : selectedDepartment;
    const { csvContent } = generateShiftPlanTemplate(targetDept, selectedMonthYear, employees);
    downloadBlob(
      csvContent,
      `ShiftPlan_Template_${targetDept}_${selectedMonthYear}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  const selectedPainterShift = shiftMap.get(selectedPainterCode);

  return (
    <div className={`p-4 flex flex-col space-y-3 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center space-x-2 px-4 py-2.5 rounded-lg shadow-xl bg-teal-600 text-white text-xs font-semibold animate-in fade-in slide-in-from-bottom-2 duration-150">
          <CheckCircle2 className="w-4 h-4 text-teal-200 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Banner & Control Bar */}
      <div className={`p-4 rounded border flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 ${
        isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/30">
            <CalendarCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold flex items-center gap-2">
              ตารางการทำงานของพนักงาน (Monthly Shift Roster)
              <span className="text-xs font-mono font-normal px-2 py-0.5 rounded bg-teal-500/15 text-teal-300 border border-teal-500/30">
                {selectedMonthYear}
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              {currentUser.role === 'Admin' 
                ? 'ผู้ดูแลระบบ (Admin): มีสิทธิ์แก้ไขและจัดตารางกะได้ทุกแผนก • คลิกช่องวันที่เพื่อเปิดหน้าต่างเลือกกะแบบละเอียด หรือใช้โหมดจัดกะด่วน' 
                : `ผู้ใช้งาน (${currentUser.name}): สิทธิ์แก้ไขเฉพาะแผนก ${currentUser.department} เท่านั้น (แผนกอื่นเป็นแบบ View Only)`
              }
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center space-x-2 flex-wrap gap-2">
          {/* Quick Shift Painter Mode Toggle */}
          <button
            id="btn-toggle-shift-painter"
            onClick={() => {
              setIsPainterActive(prev => !prev);
              if (!isPainterActive) {
                showToast(`เปิดโหมดจัดกะด่วน: กะ ${selectedPainterCode}`);
              }
            }}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs border font-semibold transition cursor-pointer ${
              isPainterActive
                ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md ring-2 ring-amber-400/50'
                : isDark
                  ? 'bg-[#1a2838] border-[#2e4257] text-amber-400 hover:bg-[#233549]'
                  : 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
            }`}
            title="คลิกช่องในตารางเพื่อเปลี่ยนเป็นกะที่เลือกทันทีโดยไม่ต้องเปิดหน้าต่าง"
          >
            <Paintbrush className="w-3.5 h-3.5" />
            <span>{isPainterActive ? 'กำลังแต้มกะ (คลิกเพื่อปิด)' : 'โหมดจัดกะด่วน (Painter)'}</span>
          </button>

          <button
            id="btn-download-shift-template"
            onClick={handleDownloadTemplate}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs border font-medium transition ${
              isDark 
                ? 'bg-[#1a2838] border-[#2e4257] text-slate-200 hover:bg-[#233549]' 
                : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Download className="w-3.5 h-3.5 text-teal-400" />
            <span>ดาวน์โหลดเทมเพลต</span>
          </button>

          <button
            id="btn-goto-upload-plan"
            onClick={onNavigateToImport}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-sm transition cursor-pointer"
            title="Upload Department Shift Plan (อัปโหลดตารางกะรายแผนก)"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Shift Plan (อัปโหลดกะ)</span>
          </button>
        </div>
      </div>

      {/* QUICK SHIFT PAINTER TOOLBAR (Visible when Painter mode is active or user wants quick access) */}
      {isPainterActive && (
        <div className={`p-3 rounded-lg border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-md animate-in fade-in slide-in-from-top-2 duration-150 ${
          isDark ? 'bg-[#172535] border-amber-500/50' : 'bg-amber-50/80 border-amber-300'
        }`}>
          <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
            <div className="flex items-center space-x-1.5 text-xs font-bold text-amber-400">
              <Paintbrush className="w-4 h-4 text-amber-400 animate-pulse" />
              <span>กะที่ต้องการแต้ม:</span>
            </div>

            {/* Quick Shift Chips for Painting */}
            <div className="flex items-center space-x-1.5 flex-wrap gap-1">
              {['D', 'D1', 'M', 'A', 'N', 'S1', 'OFF', 'H'].map(code => {
                const sc = shiftMap.get(code);
                if (!sc) return null;
                const isSelected = selectedPainterCode === code;
                return (
                  <button
                    key={code}
                    onClick={() => setSelectedPainterCode(code)}
                    className={`flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-mono font-bold transition cursor-pointer ${
                      isSelected
                        ? 'ring-2 ring-white ring-offset-1 ring-offset-slate-900 scale-105 shadow-sm'
                        : 'opacity-85 hover:opacity-100 hover:scale-102'
                    }`}
                    style={{ backgroundColor: sc.color, color: '#ffffff' }}
                    title={`${sc.code}: ${sc.name} (${sc.startTime}-${sc.endTime})`}
                  >
                    <span>{code}</span>
                    <span className="text-[10px] font-normal hidden sm:inline opacity-90">
                      {code === 'OFF' ? 'หยุด' : sc.startTime}
                    </span>
                  </button>
                );
              })}

              {/* Selector for any other shift code */}
              <select
                aria-label="เลือกกะอื่นเพื่อแต้ม"
                value={selectedPainterCode}
                onChange={e => setSelectedPainterCode(e.target.value)}
                className={`ml-1 px-2 py-1 rounded text-xs border font-mono outline-none cursor-pointer ${
                  isDark 
                    ? 'bg-[#0f1722] border-slate-700 text-white' 
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              >
                {shiftCodes.map(sc => (
                  <option key={sc.code} value={sc.code}>
                    {sc.code} - {sc.name} ({sc.department})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs text-slate-300 shrink-0">
            <span className="text-amber-400 font-medium text-[11px] hidden lg:inline">
              👉 เพียงคลิกช่องวันที่ของพนักงานคนใดก็ได้ เพื่อใส่กะ {selectedPainterCode} ทันที
            </span>
            <button
              onClick={() => setIsPainterActive(false)}
              className="px-2 py-1 rounded text-[11px] bg-slate-700/60 hover:bg-slate-700 text-slate-200 border border-slate-600 transition cursor-pointer"
            >
              ปิดโหมดแต้มกะ (ESC)
            </button>
          </div>
        </div>
      )}

      {/* FILTER BAR: Month-Year Filter (ดูย้อนหลัง) + Department Dropdown + Name/GID Search + Shift Type Filter */}
      <div className={`p-3 rounded border ${
        isDark ? 'bg-[#0f1722] border-[#203244]' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
          {/* Left Group: Month-Year Filter + Department Dropdown + Search */}
          <div className="flex flex-wrap items-center gap-3 flex-1">
            {/* 1. Month-Year Filter with Historical navigation (ดูย้อนหลัง) */}
            <MonthYearFilter
              selectedMonthYear={selectedMonthYear}
              onChange={onSelectMonthYear}
              theme={theme}
              label="เดือน-ปี:"
              idPrefix="roster-month-filter"
            />

            {/* 2. Department Dropdown */}
            <div className="flex items-center space-x-2 shrink-0">
              <div className="p-1 rounded bg-teal-500/10 text-teal-400 shrink-0">
                <Building2 className="w-3.5 h-3.5" />
              </div>
              <label htmlFor="dept-filter-select" className="text-xs font-semibold text-slate-300 whitespace-nowrap">
                แผนก:
              </label>
              <select
                id="dept-filter-select"
                aria-label="เลือกแผนก"
                value={selectedDepartment}
                onChange={e => onSelectDepartment(e.target.value)}
                className={`px-2.5 py-1.5 rounded border text-xs font-medium cursor-pointer outline-none transition min-w-[170px] ${
                  isDark 
                    ? 'bg-[#14202c] border-[#273a4e] text-white focus:border-[#00e5e5]' 
                    : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-[#008b99]'
                }`}
              >
                <option value="ALL">
                  ทุกแผนก (All Departments) ({employees.length} คน)
                </option>
                {storage.getDepartments().map(d => (
                  <option key={d.code} value={d.code}>
                    {d.code} - {d.name} ({departmentCounts[d.code] || 0} คน)
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Search by Employee Name and GID */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                id="input-search-name-gid"
                placeholder="ค้นหาชื่อพนักงาน หรือ GID..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className={`w-full pl-9 pr-7 py-1.5 rounded border text-xs outline-none transition ${
                  isDark 
                    ? 'bg-[#14202c] border-[#273a4e] text-white placeholder-slate-500 focus:border-[#00e5e5]' 
                    : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-[#008b99]'
                }`}
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm('')} 
                  title="ล้างคำค้นหา"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Right Group: Shift Type Filter (All / Shift / Office) & Count */}
          <div className="flex items-center space-x-2 shrink-0 justify-between sm:justify-end border-t xl:border-t-0 pt-2 xl:pt-0 border-slate-700/40">
            <div className="flex items-center space-x-1">
              <span className="text-slate-400 text-[11px] mr-1 hidden sm:inline flex items-center gap-1">
                <Briefcase className="w-3 h-3" />
                ประเภท:
              </span>
              <button
                onClick={() => setShiftFilter('ALL')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition ${
                  shiftFilter === 'ALL'
                    ? 'bg-teal-600 text-white font-semibold shadow-xs'
                    : isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                ทั้งหมด
              </button>
              <button
                onClick={() => setShiftFilter('SHIFT')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition ${
                  shiftFilter === 'SHIFT'
                    ? 'bg-teal-600 text-white font-semibold shadow-xs'
                    : isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                เข้ากะ
              </button>
              <button
                onClick={() => setShiftFilter('OFFICE')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition ${
                  shiftFilter === 'OFFICE'
                    ? 'bg-teal-600 text-white font-semibold shadow-xs'
                    : isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                ออฟฟิศ
              </button>
            </div>

            <div className="text-[11px] text-slate-400 pl-2">
              แสดง <strong className="text-[#00e5e5]">{filteredEmployees.length}</strong> จาก {employees.length} คน
            </div>
          </div>
        </div>
      </div>

      {/* Main Roster Grid */}
      <div className={`rounded border overflow-hidden ${
        isDark ? 'bg-[#121c27] border-[#233548]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="overflow-x-auto max-h-[72vh] scrollbar-thin">
          <table className="w-full text-xs border-collapse">
            {/* Header Row */}
            <thead className={`sticky top-0 z-20 ${
              isDark ? 'bg-[#0d151f] text-slate-200' : 'bg-slate-100 text-slate-700'
            }`}>
              <tr>
                <th className="p-2.5 text-left border-r border-b border-slate-700/50 min-w-[200px] sticky left-0 z-30 bg-inherit font-semibold">
                  พนักงาน (Employee / GID)
                </th>
                <th className="p-2 text-center border-r border-b border-slate-700/50 min-w-[65px] font-semibold">
                  แผนก
                </th>
                {daysArray.map(d => (
                  <th
                    key={d.day}
                    className={`p-1 text-center border-r border-b border-slate-700/50 min-w-[32px] ${
                      d.isWeekend ? (isDark ? 'bg-slate-800/60 text-amber-300' : 'bg-slate-200 text-amber-800') : ''
                    }`}
                  >
                    <div className="font-mono font-bold text-xs">{d.day}</div>
                    <div className="text-[9px] font-normal opacity-80">{d.dowEn}</div>
                  </th>
                ))}
                <th className="p-2 text-center border-b border-slate-700/50 min-w-[80px] font-semibold">
                  รวมวันทำงาน
                </th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={daysInMonth + 3} className="p-8 text-center text-slate-400">
                    ไม่พบข้อมูลพนักงานตามเงื่อนไขที่เลือก (แผนก หรือ ชื่อ/GID) สำหรับงวดเดือน {selectedMonthYear}
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(emp => {
                  const hasPermission = canEditEmployee(emp);
                  let workingDaysCount = 0;

                  return (
                    <tr 
                      key={emp.empNo} 
                      className={`border-b transition hover:bg-teal-500/5 ${
                        isDark ? 'border-slate-800' : 'border-slate-100'
                      }`}
                    >
                      {/* Employee Info Frozen Column */}
                      <td className={`p-2.5 border-r border-slate-700/40 sticky left-0 z-10 font-medium ${
                        isDark ? 'bg-[#121c27]' : 'bg-white'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                              {emp.firstName} {emp.familyName}
                              {!hasPermission && (
                                <span title="สิทธิ์เฉพาะแผนก (View Only)" className="text-amber-400">
                                  <Lock className="w-3 h-3 inline" />
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 flex items-center gap-2">
                              <span>No: {emp.empNo}</span>
                              <span>GID: {emp.gid}</span>
                            </div>
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                            emp.isShiftWorker 
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' 
                              : 'bg-slate-700/30 text-slate-400'
                          }`}>
                            {emp.isShiftWorker ? 'Shift' : 'Office'}
                          </span>
                        </div>
                      </td>

                      {/* Department */}
                      <td className="p-2 text-center border-r border-slate-700/40 font-mono text-xs font-semibold text-[#00e5e5]">
                        {emp.department}
                      </td>

                      {/* Day Shift Cells */}
                      {daysArray.map(d => {
                        const code = getShiftForDate(emp.empNo, emp.gid, d.dateStr);
                        const shiftInfo = shiftMap.get(code);
                        if (shiftInfo?.isWorkingDay) {
                          workingDaysCount++;
                        }

                        return (
                          <td
                            key={d.day}
                            onClick={() => handleCellClick(emp, d)}
                            className={`p-0.5 text-center border-r border-slate-700/30 relative select-none transition-colors ${
                              d.isWeekend ? (isDark ? 'bg-slate-800/30' : 'bg-slate-50') : ''
                            } ${
                              hasPermission 
                                ? isPainterActive
                                  ? 'cursor-crosshair hover:ring-2 hover:ring-amber-400 hover:bg-amber-400/20'
                                  : 'cursor-pointer hover:ring-1 hover:ring-teal-400 hover:bg-teal-500/10' 
                                : 'cursor-not-allowed opacity-90'
                            }`}
                            title={
                              hasPermission
                                ? isPainterActive
                                  ? `คลิกเพื่อแต้มกะ ${selectedPainterCode} ให้กับ ${emp.firstName} (วันที่ ${d.day})`
                                  : `คลิกเพื่อเลือกหรือค้นหากะ: ${emp.firstName} (${d.dateStr})`
                                : `ไม่มีสิทธิ์แก้ไข (${emp.department})`
                            }
                          >
                            <span 
                              className="inline-block w-6 h-6 leading-6 rounded text-[10px] font-mono font-bold text-white shadow-xs transition-transform hover:scale-110 active:scale-95"
                              style={{ backgroundColor: shiftInfo?.color || '#4b5563' }}
                            >
                              {code}
                            </span>
                          </td>
                        );
                      })}

                      {/* Working Days Total */}
                      <td className="p-2 text-center font-mono font-bold text-xs text-teal-400">
                        {workingDaysCount} วัน
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Smart Shift Picker Modal with Instant Search, Favorites, Categories & Batch Range */}
      <ShiftPickerModal
        isOpen={pickerModal.isOpen}
        onClose={() => setPickerModal(prev => ({ ...prev, isOpen: false }))}
        employee={pickerModal.employee}
        dateStr={pickerModal.dateStr}
        currentShiftCode={pickerModal.currentShiftCode}
        shiftCodes={shiftCodes}
        theme={theme}
        onApplyShift={(newCode, rangeType) => {
          if (pickerModal.employee) {
            handleApplyShift(pickerModal.employee, pickerModal.dateStr, newCode, rangeType);
          }
        }}
      />
    </div>
  );
};

