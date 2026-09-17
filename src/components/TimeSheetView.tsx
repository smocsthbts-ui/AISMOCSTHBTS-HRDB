import React, { useState, useMemo } from 'react';
import { 
  Employee, 
  ShiftCode, 
  DailyShiftPlan, 
  BiometricRawPunch, 
  OTRecord, 
  OtherAllowance, 
  TimeSheetRow,
  UserAccount 
} from '../types';
import { 
  buildTimeSheetForEmployee 
} from '../utils/timeCalc';
import { 
  storage 
} from '../utils/storage';
import { 
  exportTimeSheetsToPDF 
} from '../utils/pdfExport';
import { 
  FileDown, 
  Edit3, 
  UserCheck, 
  AlertTriangle, 
  Lock, 
  Check, 
  RotateCcw,
  Sparkles,
  Building2,
  Users,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { MonthYearFilter } from './MonthYearFilter';

interface TimeSheetViewProps {
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

export const TimeSheetView: React.FC<TimeSheetViewProps> = ({
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

  // Section / Department filter state
  const [activeDepartment, setActiveDepartment] = useState<string>(selectedDepartment || 'ALL');

  // Synchronize when parent's selectedDepartment changes
  React.useEffect(() => {
    if (selectedDepartment) {
      setActiveDepartment(selectedDepartment);
    }
  }, [selectedDepartment]);

  // Department options with employee counts
  const departmentOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    employees.forEach(e => {
      if (e.department) {
        counts[e.department] = (counts[e.department] || 0) + 1;
      }
    });

    const list: { code: string; name: string; count: number }[] = [];
    storage.getDepartments().forEach(d => {
      list.push({
        code: d.code,
        name: d.name,
        count: counts[d.code] || 0,
      });
    });

    // Any departments in employees not already in predefined list
    Object.keys(counts).forEach(code => {
      if (!list.some(d => d.code === code)) {
        list.push({
          code,
          name: `${code} Department`,
          count: counts[code] || 0,
        });
      }
    });

    return {
      allCount: employees.length,
      departments: list,
    };
  }, [employees]);

  // Filter employees matching active department
  const selectableEmployees = useMemo(() => {
    return employees.filter(e => {
      if (activeDepartment !== 'ALL' && e.department !== activeDepartment) {
        return false;
      }
      return true;
    });
  }, [employees, activeDepartment]);

  // Active employee for timesheet
  const [selectedEmpNo, setSelectedEmpNo] = useState<string>(() => {
    // Default to '0950' (Napassawan) if in current selection, else first selectable
    const napassawan = selectableEmployees.find(e => e.empNo === '0950');
    return napassawan ? napassawan.empNo : (selectableEmployees[0]?.empNo || employees[0]?.empNo || '');
  });

  // Keep selectedEmpNo valid if selectableEmployees changes
  const activeEmployee = useMemo(() => {
    const found = selectableEmployees.find(e => e.empNo === selectedEmpNo);
    return found || selectableEmployees[0] || employees[0];
  }, [selectableEmployees, selectedEmpNo, employees]);

  // If current employee is not in selectableEmployees, automatically pick the first in list
  React.useEffect(() => {
    if (selectableEmployees.length > 0) {
      const exists = selectableEmployees.some(e => e.empNo === selectedEmpNo);
      if (!exists) {
        setSelectedEmpNo(selectableEmployees[0].empNo);
      }
    }
  }, [selectableEmployees, selectedEmpNo]);

  // Department change handler
  const handleDepartmentChange = (dept: string) => {
    setActiveDepartment(dept);
    onSelectDepartment?.(dept);
    const inDept = employees.filter(e => dept === 'ALL' || e.department === dept);
    if (inDept.length > 0) {
      setSelectedEmpNo(inDept[0].empNo);
    }
  };

  // Stepping through individual employees in active department
  const currentEmpIndex = useMemo(() => {
    return selectableEmployees.findIndex(e => e.empNo === activeEmployee?.empNo);
  }, [selectableEmployees, activeEmployee]);

  const handlePrevEmployee = () => {
    if (selectableEmployees.length <= 1) return;
    const prevIndex = currentEmpIndex <= 0 ? selectableEmployees.length - 1 : currentEmpIndex - 1;
    setSelectedEmpNo(selectableEmployees[prevIndex].empNo);
  };

  const handleNextEmployee = () => {
    if (selectableEmployees.length <= 1) return;
    const nextIndex = currentEmpIndex >= selectableEmployees.length - 1 ? 0 : currentEmpIndex + 1;
    setSelectedEmpNo(selectableEmployees[nextIndex].empNo);
  };

  // Check editing permission
  const canEdit = useMemo(() => {
    if (currentUser.role === 'Admin') return true;
    return currentUser.department === activeEmployee?.department;
  }, [currentUser, activeEmployee]);

  // Load manual overrides
  const manualOverrides = storage.getManualOverrides();

  // Compute timesheet summary and rows for active employee
  const timesheetSummary = useMemo(() => {
    if (!activeEmployee) return null;
    return buildTimeSheetForEmployee(
      activeEmployee,
      selectedMonthYear,
      shiftCodes,
      shiftPlans,
      biometricPunches,
      otRecords,
      otherAllowances,
      manualOverrides
    );
  }, [activeEmployee, selectedMonthYear, shiftCodes, shiftPlans, biometricPunches, otRecords, otherAllowances, manualOverrides]);

  // Modal state for editing a specific row
  const [editingRow, setEditingRow] = useState<TimeSheetRow | null>(null);
  const [editForm, setEditForm] = useState<Partial<TimeSheetRow>>({});

  const handleOpenEdit = (row: TimeSheetRow) => {
    if (!canEdit) return;
    setEditingRow(row);
    setEditForm({
      realTime1In: row.realTime1In,
      realTime1Out: row.realTime1Out,
      shiftCode: row.shiftCode,
      ot1_5: row.ot1_5,
      ot3_0: row.ot3_0,
      emergencyAllowance: row.emergencyAllowance,
      shiftAllowance: row.shiftAllowance,
      standbyAllowance: row.standbyAllowance,
      codeLeave: row.codeLeave,
      remark: row.remark,
    });
  };

  const handleSaveEdit = () => {
    if (!editingRow || !activeEmployee) return;

    const key = `${activeEmployee.empNo}_${editingRow.date}`;
    const overrides = { ...manualOverrides };

    // Calculate diff if in and out provided
    let customDiff = editingRow.diff1;
    if (editForm.realTime1In && editForm.realTime1Out) {
      const [h1, m1] = editForm.realTime1In.split(':').map(Number);
      const [h2, m2] = editForm.realTime1Out.split(':').map(Number);
      if (!isNaN(h1) && !isNaN(h2)) {
        let diffMin = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (diffMin < 0) diffMin += 24 * 60;
        const hh = String(Math.floor(diffMin / 60)).padStart(2, '0');
        const mm = String(diffMin % 60).padStart(2, '0');
        customDiff = `${hh}:${mm}`;
      }
    }

    overrides[key] = {
      ...overrides[key],
      ...editForm,
      diff1: customDiff,
    };

    storage.setManualOverrides(overrides);
    setEditingRow(null);
  };

  const handleResetRow = (dateStr: string) => {
    if (!activeEmployee) return;
    const key = `${activeEmployee.empNo}_${dateStr}`;
    const overrides = { ...manualOverrides };
    delete overrides[key];
    storage.setManualOverrides(overrides);
    setEditingRow(null);
  };

  const handleExportPDF = () => {
    if (!timesheetSummary || !activeEmployee) return;
    exportTimeSheetsToPDF([timesheetSummary], `Siemens_TimeSheet_${activeEmployee.empNo}_${selectedMonthYear}`);
  };

  return (
    <div className={`p-4 flex flex-col space-y-4 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
      {/* Top Controls: Month-Year Filter, Department, Employee Selector & PDF Export in Single Row */}
      <div className={`p-3 rounded border flex flex-wrap xl:flex-nowrap items-center justify-between gap-3 ${
        isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        {/* Left Side: Month-Year + Department + Employee Dropdown Chain in Single Flow */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
          {/* 1. Month-Year Filter */}
          <MonthYearFilter
            selectedMonthYear={selectedMonthYear}
            onChange={onSelectMonthYear}
            theme={theme}
            label="งวดเดือน-ปี:"
            idPrefix="timesheet-month-filter"
          />

          <div className="h-5 w-[1px] bg-slate-700/50 hidden md:block" />

          {/* 2. Department Dropdown Section (แผนก / Section) */}
          <div className="flex items-center space-x-1.5 shrink-0">
            <label htmlFor="select-department-timesheet" className="text-xs font-semibold text-slate-300 flex items-center gap-1 whitespace-nowrap">
              <Building2 className="w-3.5 h-3.5 text-teal-400" />
              <span>แผนก:</span>
            </label>
            <select
              id="select-department-timesheet"
              value={activeDepartment}
              onChange={e => handleDepartmentChange(e.target.value)}
              className={`px-2.5 py-1.5 rounded border text-xs font-semibold outline-none cursor-pointer transition ${
                isDark 
                  ? 'bg-[#0e1722] border-[#283d52] text-white focus:border-teal-400 hover:border-slate-500' 
                  : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-teal-600 hover:border-slate-400'
              }`}
            >
              <option value="ALL">
                ทุกแผนก ({departmentOptions.allCount} คน)
              </option>
              {departmentOptions.departments.map(dept => (
                <option key={dept.code} value={dept.code}>
                  {dept.code} - {dept.name} ({dept.count} คน)
                </option>
              ))}
            </select>
          </div>

          <div className="h-5 w-[1px] bg-slate-700/50 hidden md:block" />

          {/* 3. Employee Dropdown Section (พนักงาน ต่อท้ายแผนกใน Row เดียวกัน) */}
          <div className="flex items-center space-x-1.5 shrink-0 flex-wrap sm:flex-nowrap gap-y-1.5">
            <label htmlFor="select-employee-timesheet" className="text-xs font-semibold text-slate-300 flex items-center gap-1 whitespace-nowrap">
              <UserCheck className="w-3.5 h-3.5 text-teal-400" />
              <span>พนักงาน:</span>
            </label>

            {/* Quick Prev Employee Button */}
            <button
              type="button"
              id="btn-prev-employee"
              onClick={handlePrevEmployee}
              disabled={selectableEmployees.length <= 1}
              title="พนักงานคนก่อนหน้า"
              className={`p-1.5 rounded border transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                isDark 
                  ? 'bg-[#0e1722] hover:bg-[#1a2938] border-[#283d52] text-slate-300' 
                  : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
              }`}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            {/* Employee Dropdown Selection */}
            <select
              id="select-employee-timesheet"
              value={activeEmployee?.empNo || ''}
              onChange={e => setSelectedEmpNo(e.target.value)}
              className={`px-2.5 py-1.5 rounded border text-xs font-medium outline-none cursor-pointer max-w-[200px] sm:max-w-[240px] md:max-w-[260px] truncate transition ${
                isDark 
                  ? 'bg-[#0e1722] border-[#283d52] text-white focus:border-teal-400 hover:border-slate-500' 
                  : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-teal-600 hover:border-slate-400'
              }`}
            >
              {selectableEmployees.map((emp, idx) => (
                <option key={emp.empNo} value={emp.empNo}>
                  {idx + 1}. {emp.empNo} / {emp.gid} - {emp.firstName} {emp.familyName}
                </option>
              ))}
            </select>

            {/* Quick Next Employee Button */}
            <button
              type="button"
              id="btn-next-employee"
              onClick={handleNextEmployee}
              disabled={selectableEmployees.length <= 1}
              title="พนักงานคนถัดไป"
              className={`p-1.5 rounded border transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                isDark 
                  ? 'bg-[#0e1722] hover:bg-[#1a2938] border-[#283d52] text-slate-300' 
                  : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
              }`}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            {/* Counter badge within current department */}
            {selectableEmployees.length > 0 && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border whitespace-nowrap font-semibold ${
                isDark ? 'bg-[#0a121a] border-[#24374b] text-teal-300' : 'bg-slate-100 border-slate-300 text-slate-700'
              }`} title={`พนักงานคนที่ ${currentEmpIndex + 1} จากทั้งหมด ${selectableEmployees.length} คนในแผนกที่เลือก`}>
                {currentEmpIndex + 1}/{selectableEmployees.length}
              </span>
            )}

            {/* Edit / View status indicator */}
            {canEdit ? (
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 whitespace-nowrap font-medium">
                <Edit3 className="w-3 h-3 text-emerald-400" />
                <span className="hidden 2xl:inline">พร้อมแก้ไข</span>
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1 whitespace-nowrap font-medium">
                <Lock className="w-3 h-3" />
                <span className="hidden 2xl:inline">View Only</span>
              </span>
            )}
          </div>
        </div>

        {/* Right Side: Export PDF Action Button */}
        <div className="flex items-center space-x-2 shrink-0 self-end xl:self-auto">
          <button
            id="btn-export-pdf-current"
            onClick={handleExportPDF}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-sm transition cursor-pointer whitespace-nowrap"
          >
            <FileDown className="w-4 h-4" />
            <span>Export Time Sheet เป็น PDF</span>
          </button>
        </div>
      </div>

      {/* Official Siemens Time Sheet Card or Empty Selection State */}
      {activeEmployee && timesheetSummary ? (
        <div className={`p-5 rounded border shadow-md font-sans overflow-hidden ${
        isDark 
          ? 'bg-[#101923] border-[#25374a] text-slate-100' 
          : 'bg-white border-slate-300 text-slate-900'
      }`}>
        {/* 1. Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-3 border-b border-teal-700/60 gap-2">
          <div className="flex items-baseline space-x-3">
            <span className="text-2xl font-extrabold tracking-wider text-[#00a3a6]">
              SIEMENS
            </span>
            <span className="text-lg font-bold text-slate-300">
              Time Sheet
            </span>
          </div>

          <div className="text-xs text-red-400 font-medium italic text-center">
            * ถ้ามีเขียนเพิ่มหรือแก้ไขให้ขีดฆ่า(ห้ามลบ) ลงลายเซ็นกำกับทุกจุดด้วย
          </div>

          <div className="text-right font-bold text-base tracking-wide text-[#00e5e5]">
            {activeEmployee.division || 'MO CS BTS'}
          </div>
        </div>

        {/* 2. Employee Metadata Fields Grid */}
        <div className={`my-3 p-3 rounded border text-xs grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-4 ${
          isDark ? 'bg-[#14202c] border-[#213548]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div>
            <span className="text-slate-400">Empno. / GID : </span>
            <span className="font-mono font-bold text-[#00e5e5]">{activeEmployee.empNo} / {activeEmployee.gid}</span>
          </div>
          <div>
            <span className="text-slate-400">Firstname : </span>
            <span className="font-semibold">{activeEmployee.firstName}</span>
          </div>
          <div>
            <span className="text-slate-400">Familyname : </span>
            <span className="font-semibold">{activeEmployee.familyName}</span>
          </div>
          <div>
            <span className="text-slate-400">Department : </span>
            <span className="font-mono font-bold text-teal-300">{activeEmployee.department}</span>
          </div>

          <div>
            <span className="text-slate-400">Division : </span>
            <span className="font-medium">{activeEmployee.division || 'MO CS BTS'}</span>
          </div>
          <div>
            <span className="text-slate-400">Shift Status : </span>
            <span className="font-semibold">{activeEmployee.isShiftWorker ? 'Yes (Shift Worker)' : 'No (Office)'}</span>
          </div>
          <div>
            <span className="text-slate-400">Function : </span>
            <span className="font-medium">{activeEmployee.functionTitle || '-'}</span>
          </div>
          <div>
            <span className="text-slate-400">Cost Center : </span>
            <span className="font-mono font-semibold">{activeEmployee.costCenter || 'C93056'}</span>
          </div>
        </div>

        {/* 3. Main Data Table (Faithful column headers) */}
        <div className="overflow-x-auto border border-slate-700/60 rounded">
          <table className="w-full text-[11px] border-collapse text-center">
            <thead className={`border-b border-slate-700 font-semibold ${
              isDark ? 'bg-[#0a1118] text-slate-200' : 'bg-slate-100 text-slate-800'
            }`}>
              {/* Row 1 Headers */}
              <tr>
                <th rowSpan={2} className="p-1.5 border-r border-b border-slate-700 min-w-[95px]">Date</th>
                <th rowSpan={2} className="p-1 border-r border-b border-slate-700 min-w-[40px]">Shift<br/>Code</th>
                <th rowSpan={2} className="p-1 border-r border-b border-slate-700 min-w-[50px]">Shift<br/>In</th>
                <th colSpan={2} className="p-1 border-r border-b border-slate-700">Real Time I</th>
                <th rowSpan={2} className="p-1 border-r border-b border-slate-700 min-w-[50px]">Diff. I<br/>(H)</th>
                <th rowSpan={2} className="p-1 border-r border-b border-slate-700 min-w-[45px]">Late<br/>(H)</th>
                <th colSpan={2} className="p-1 border-r border-b border-slate-700">Real Time II</th>
                <th rowSpan={2} className="p-1 border-r border-b border-slate-700 min-w-[45px]">Diff. II<br/>(H)</th>
                <th colSpan={3} className="p-1 border-r border-b border-slate-700">Working Hours</th>
                <th rowSpan={2} className="p-1 border-r border-b border-slate-700 min-w-[65px]">Stand by<br/>Allowance</th>
                <th rowSpan={2} className="p-1 border-r border-b border-slate-700 min-w-[70px]">Emergency<br/>Allowance</th>
                <th rowSpan={2} className="p-1 border-r border-b border-slate-700 min-w-[45px]">Code<br/>Leave</th>
                <th rowSpan={2} className="p-1 border-r border-b border-slate-700 min-w-[150px] text-left pl-2">Remark</th>
                {canEdit && (
                  <th rowSpan={2} className="p-1 border-b border-slate-700 min-w-[40px]">Action</th>
                )}
              </tr>
              {/* Row 2 Sub-Headers */}
              <tr>
                <th className="p-1 border-r border-b border-slate-700 min-w-[48px]">In</th>
                <th className="p-1 border-r border-b border-slate-700 min-w-[48px]">Out</th>
                <th className="p-1 border-r border-b border-slate-700 min-w-[48px]">In</th>
                <th className="p-1 border-r border-b border-slate-700 min-w-[48px]">Out</th>
                <th className="p-1 border-r border-b border-slate-700 min-w-[40px]">Total</th>
                <th className="p-1 border-r border-b border-slate-700 min-w-[45px]">OT 1.5</th>
                <th className="p-1 border-r border-b border-slate-700 min-w-[45px]">OT 3.0</th>
              </tr>
            </thead>

            <tbody>
              {timesheetSummary.rows.map((row) => {
                const isWeekend = row.dayOfWeek === 'Sat' || row.dayOfWeek === 'Sun';
                const isHoliday = row.shiftCode === 'H';
                const isOff = row.shiftCode === 'OFF';
                const isLate = row.late && row.late !== '00:00';

                return (
                  <tr 
                    key={row.date} 
                    className={`border-b border-slate-700/40 transition hover:bg-teal-500/10 ${
                      (isWeekend || isHoliday || isOff) 
                        ? (isDark ? 'bg-[#15202c]/50 text-slate-400' : 'bg-slate-100 text-slate-600') 
                        : ''
                    } ${row.isManualOverride ? 'font-medium text-amber-200' : ''}`}
                  >
                    {/* Date */}
                    <td className="p-1 text-left pl-2 font-mono border-r border-slate-700/40 whitespace-nowrap">
                      {row.dayString}
                    </td>

                    {/* Shift Code */}
                    <td className="p-1 font-mono font-bold border-r border-slate-700/40">
                      {row.shiftCode}
                    </td>

                    {/* Shift In */}
                    <td className="p-1 font-mono border-r border-slate-700/40">
                      {row.shiftIn}
                    </td>

                    {/* Real Time I - In */}
                    <td className={`p-1 font-mono border-r border-slate-700/40 ${isLate ? 'text-amber-400 font-bold' : ''}`}>
                      {row.realTime1In}
                    </td>

                    {/* Real Time I - Out */}
                    <td className="p-1 font-mono border-r border-slate-700/40">
                      {row.realTime1Out}
                    </td>

                    {/* Diff I */}
                    <td className="p-1 font-mono font-semibold text-teal-400 border-r border-slate-700/40">
                      {row.diff1}
                    </td>

                    {/* Late */}
                    <td className={`p-1 font-mono border-r border-slate-700/40 ${isLate ? 'text-red-400 font-bold bg-red-500/10' : ''}`}>
                      {row.late !== '00:00' ? row.late : ''}
                    </td>

                    {/* Real Time II - In */}
                    <td className="p-1 font-mono border-r border-slate-700/40">
                      {row.realTime2In}
                    </td>

                    {/* Real Time II - Out */}
                    <td className="p-1 font-mono border-r border-slate-700/40">
                      {row.realTime2Out}
                    </td>

                    {/* Diff II */}
                    <td className="p-1 font-mono border-r border-slate-700/40">
                      {row.diff2}
                    </td>

                    {/* Working Hours Total */}
                    <td className="p-1 font-mono border-r border-slate-700/40 font-semibold">
                      {row.totalWorkHours > 0 ? row.totalWorkHours : '0'}
                    </td>

                    {/* OT 1.5 */}
                    <td className={`p-1 font-mono border-r border-slate-700/40 ${row.ot1_5 > 0 ? 'text-[#00e5e5] font-bold' : ''}`}>
                      {row.ot1_5 > 0 ? row.ot1_5 : '0'}
                    </td>

                    {/* OT 3.0 */}
                    <td className={`p-1 font-mono border-r border-slate-700/40 ${row.ot3_0 > 0 ? 'text-amber-400 font-bold' : ''}`}>
                      {row.ot3_0 > 0 ? row.ot3_0 : '0'}
                    </td>

                    {/* Stand by Allowance */}
                    <td className={`p-1 font-mono border-r border-slate-700/40 ${
                      row.standbyAllowance > 0 ? 'text-amber-300 font-bold bg-amber-500/15' : ''
                    }`}>
                      {row.standbyAllowance > 0 ? row.standbyAllowance : '0'}
                    </td>

                    {/* Emergency Allowance */}
                    <td className={`p-1 font-mono border-r border-slate-700/40 ${
                      row.emergencyAllowance > 0 ? 'text-rose-300 font-bold bg-rose-500/15' : ''
                    }`}>
                      {row.emergencyAllowance > 0 ? row.emergencyAllowance : '0'}
                    </td>

                    {/* Code Leave */}
                    <td className="p-1 font-mono font-bold text-amber-400 border-r border-slate-700/40">
                      {row.codeLeave}
                    </td>

                    {/* Remark */}
                    <td className="p-1 text-left pl-2 truncate max-w-[200px] border-r border-slate-700/40 text-slate-300">
                      {row.remark}
                    </td>

                    {/* Manual Edit Action */}
                    {canEdit && (
                      <td className="p-1">
                        <button
                          onClick={() => handleOpenEdit(row)}
                          title="แก้ไขข้อมูลแบบ Manual (Manual Override)"
                          className="p-1 text-teal-400 hover:text-white rounded hover:bg-teal-500/20"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>

            {/* Bottom Total Footer Row (Matches Time Sheet.png) */}
            <tfoot className={`font-bold border-t-2 border-slate-600 ${
              isDark ? 'bg-[#091119] text-white' : 'bg-slate-200 text-slate-900'
            }`}>
              <tr>
                <td className="p-2 text-left pl-2 font-bold border-r border-slate-700">Total :</td>
                <td className="border-r border-slate-700">-</td>
                <td className="border-r border-slate-700">-</td>
                <td className="p-2 border-r border-slate-700 font-mono text-teal-400">
                  {timesheetSummary.totalWorkDays} วัน
                </td>
                <td className="border-r border-slate-700">-</td>
                <td className="p-2 border-r border-slate-700 font-mono text-teal-300">
                  {timesheetSummary.totalDiffTime}
                </td>
                <td className="p-2 border-r border-slate-700 font-mono text-red-400">
                  {timesheetSummary.totalLateTime}
                </td>
                <td className="border-r border-slate-700">-</td>
                <td className="border-r border-slate-700">-</td>
                <td className="border-r border-slate-700">-</td>
                <td className="p-2 border-r border-slate-700 font-mono">
                  {timesheetSummary.totalWorkHours}
                </td>
                <td className="p-2 border-r border-slate-700 font-mono text-[#00e5e5]">
                  {timesheetSummary.totalOT1_5}
                </td>
                <td className="p-2 border-r border-slate-700 font-mono text-amber-400">
                  {timesheetSummary.totalOT3_0}
                </td>
                <td className="p-2 border-r border-slate-700 font-mono">
                  {timesheetSummary.totalStandby}
                </td>
                <td className="p-2 border-r border-slate-700 font-mono">
                  {timesheetSummary.totalEmergency}
                </td>
                <td className="p-2 border-r border-slate-700 font-mono">
                  {timesheetSummary.totalLeaveDays}
                </td>
                <td className="border-r border-slate-700"></td>
                {canEdit && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 4. Legend Footnote */}
        <div className={`mt-3 p-2.5 rounded border text-[10px] ${
          isDark ? 'bg-[#0a1118] border-[#1f2e3d] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-600'
        }`}>
          <div className="font-bold text-slate-400 mb-0.5">คำอธิบายรหัสการลา (Leave Legend) & บันทึกเพิ่มเติม:</div>
          <div><strong>A</strong>: Annual Leave (ลาพักร้อน), <strong>C</strong>: Casual Leave (ลากิจ), <strong>S</strong>: Sick Leave (ลาป่วย), <strong>O</strong>: Other Leave (ลาอื่นๆ)</div>
          <div><strong>X</strong>: Forgot to use the Card (ลืมรูดบัตร), <strong>Y</strong>: Forgot to bring the Card (ลืมนำบัตรมา)</div>
        </div>

        {/* 5. Signatures Block (Originator & Approval Signature) */}
        <div className="mt-8 pt-4 border-t border-slate-700/50 flex flex-col sm:flex-row justify-end items-center gap-12 text-xs">
          <div className="flex flex-col items-center">
            <div className="w-56 border-b border-slate-400 mb-1"></div>
            <span className="font-semibold">Signature Originator / Date</span>
            <span className="text-[10px] text-slate-400">(ลายเซ็นผู้จัดทำ / วันที่)</span>
          </div>

          <div className="flex flex-col items-center">
            <div className="w-56 border-b border-slate-400 mb-1"></div>
            <span className="font-semibold">Approval Signature / Date</span>
            <span className="text-[10px] text-slate-400">(ลายเซ็นผู้อนุมัติ / วันที่)</span>
          </div>
        </div>
      </div>
      ) : (
        <div className="p-8 text-center text-slate-400">
          ไม่พบข้อมูลพนักงานสำหรับแสดง Time Sheet
        </div>
      )}

      {/* Manual Edit Modal */}
      {editingRow && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className={`w-full max-w-lg rounded-lg border shadow-2xl p-5 ${
            isDark ? 'bg-[#152230] border-[#294058] text-white' : 'bg-white border-slate-300 text-slate-900'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-teal-400" />
                แก้ไข Time Sheet แบบ Manual: {editingRow.dayString}
              </h3>
              <button 
                onClick={() => setEditingRow(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="my-4 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Shift Code</label>
                  <input
                    type="text"
                    value={editForm.shiftCode || ''}
                    onChange={e => {
                      const newCode = e.target.value.toUpperCase();
                      const hasX = newCode.includes('-X');
                      const hasET = newCode.includes('-ET');
                      setEditForm(prev => ({
                        ...prev,
                        shiftCode: newCode,
                        standbyAllowance: hasX ? 300 : (prev.standbyAllowance === 300 ? 0 : prev.standbyAllowance),
                        emergencyAllowance: hasET ? 300 : (prev.emergencyAllowance === 300 ? 0 : prev.emergencyAllowance),
                      }));
                    }}
                    placeholder="เช่น D, AD1-X, E-ET, N"
                    className={`w-full p-2 rounded border font-mono uppercase ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        let c = (editForm.shiftCode || 'D').replace(/-X/gi, '').replace(/-ET/gi, '');
                        c = c + '-X';
                        setEditForm(prev => ({ ...prev, shiftCode: c, standbyAllowance: 300 }));
                      }}
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 cursor-pointer"
                    >
                      + Standby (-X) [300฿]
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        let c = (editForm.shiftCode || 'E').replace(/-X/gi, '').replace(/-ET/gi, '');
                        c = c + '-ET';
                        setEditForm(prev => ({ ...prev, shiftCode: c, emergencyAllowance: 300 }));
                      }}
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 cursor-pointer"
                    >
                      + Emergency (-ET) [300฿]
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Code Leave (A, C, S, O, X, Y)</label>
                  <input
                    type="text"
                    value={editForm.codeLeave || ''}
                    onChange={e => setEditForm(prev => ({ ...prev, codeLeave: e.target.value.toUpperCase() }))}
                    placeholder="e.g. A, S, C"
                    className={`w-full p-2 rounded border uppercase font-mono ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Real Time I (In) (HH:mm)</label>
                  <input
                    type="text"
                    value={editForm.realTime1In || ''}
                    onChange={e => setEditForm(prev => ({ ...prev, realTime1In: e.target.value }))}
                    placeholder="08:00"
                    className={`w-full p-2 rounded border font-mono ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Real Time I (Out) (HH:mm)</label>
                  <input
                    type="text"
                    value={editForm.realTime1Out || ''}
                    onChange={e => setEditForm(prev => ({ ...prev, realTime1Out: e.target.value }))}
                    placeholder="17:00"
                    className={`w-full p-2 rounded border font-mono ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">OT 1.5 เท่า (ชั่วโมง)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={editForm.ot1_5 !== undefined ? editForm.ot1_5 : 0}
                    onChange={e => setEditForm(prev => ({ ...prev, ot1_5: parseFloat(e.target.value) || 0 }))}
                    className={`w-full p-2 rounded border font-mono ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">OT 3.0 เท่า (ชั่วโมง)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={editForm.ot3_0 !== undefined ? editForm.ot3_0 : 0}
                    onChange={e => setEditForm(prev => ({ ...prev, ot3_0: parseFloat(e.target.value) || 0 }))}
                    className={`w-full p-2 rounded border font-mono ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Team Emergency (บาท)</label>
                  <input
                    type="number"
                    value={editForm.emergencyAllowance !== undefined ? editForm.emergencyAllowance : 0}
                    onChange={e => setEditForm(prev => ({ ...prev, emergencyAllowance: parseFloat(e.target.value) || 0 }))}
                    className={`w-full p-2 rounded border font-mono ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Shift Allowance (บาท)</label>
                  <input
                    type="number"
                    value={editForm.shiftAllowance !== undefined ? editForm.shiftAllowance : 0}
                    onChange={e => setEditForm(prev => ({ ...prev, shiftAllowance: parseFloat(e.target.value) || 0 }))}
                    className={`w-full p-2 rounded border font-mono ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Standby (บาท)</label>
                  <input
                    type="number"
                    value={editForm.standbyAllowance !== undefined ? editForm.standbyAllowance : 0}
                    onChange={e => setEditForm(prev => ({ ...prev, standbyAllowance: parseFloat(e.target.value) || 0 }))}
                    className={`w-full p-2 rounded border font-mono ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Remark (หมายเหตุ)</label>
                <input
                  type="text"
                  value={editForm.remark || ''}
                  onChange={e => setEditForm(prev => ({ ...prev, remark: e.target.value }))}
                  placeholder="เช่น support for random Narcotics testing"
                  className={`w-full p-2 rounded border ${
                    isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                  }`}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-700">
              <button
                onClick={() => handleResetRow(editingRow.date)}
                className="flex items-center space-x-1 px-3 py-1.5 rounded border border-slate-600 text-xs text-slate-400 hover:text-white"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>คืนค่าคำนวณอัตโนมัติ</span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setEditingRow(null)}
                  className="px-3 py-1.5 rounded text-xs text-slate-300 hover:text-white"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-1.5 rounded text-xs font-semibold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow"
                >
                  บันทึกการแก้ไข
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
