import React, { useState, useMemo } from 'react';
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
import { buildTimeSheetForEmployee } from '../utils/timeCalc';
import { exportTimeSheetsToPDF } from '../utils/pdfExport';
import { generatePayrollCSV, downloadBlob } from '../utils/fileParser';
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
  Info
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

  const [exportScope, setExportScope] = useState<'all' | 'dept' | 'single'>('dept');
  const [targetDept, setTargetDept] = useState<string>(
    selectedDepartment !== 'ALL' ? selectedDepartment : 'GM'
  );
  const [targetEmpNo, setTargetEmpNo] = useState<string>(employees[0]?.empNo || '');
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const manualOverrides = storage.getManualOverrides();

  // Filter employees according to chosen scope
  const targetEmployees = useMemo(() => {
    if (exportScope === 'single') {
      return employees.filter(e => e.empNo === targetEmpNo);
    }
    if (exportScope === 'dept') {
      return employees.filter(e => e.department === targetDept);
    }
    return employees;
  }, [exportScope, targetDept, targetEmpNo, employees]);

  // Compute summaries for target employees for the selected MonthYear
  const computedSummaries: TimeSheetSummary[] = useMemo(() => {
    return targetEmployees.map(emp => {
      return buildTimeSheetForEmployee(
        emp,
        selectedMonthYear,
        shiftCodes,
        shiftPlans,
        biometricPunches,
        otRecords,
        otherAllowances,
        manualOverrides
      );
    });
  }, [targetEmployees, selectedMonthYear, shiftCodes, shiftPlans, biometricPunches, otRecords, otherAllowances, manualOverrides]);

  // Handle PDF Export
  const handleExportPDF = () => {
    setIsExporting(true);
    try {
      const scopeLabel = exportScope === 'all' ? 'All_Depts' : exportScope === 'dept' ? targetDept : targetEmpNo;
      exportTimeSheetsToPDF(computedSummaries, `Siemens_TimeSheet_${scopeLabel}_${selectedMonthYear}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Handle Payroll CSV Export
  const handleExportPayrollCSV = () => {
    const csvData = generatePayrollCSV(computedSummaries, selectedMonthYear);
    const scopeLabel = exportScope === 'all' ? 'All' : exportScope === 'dept' ? targetDept : targetEmpNo;
    downloadBlob(
      csvData,
      `Siemens_Payroll_Summary_${scopeLabel}_${selectedMonthYear}.csv`,
      'text/csv;charset=utf-8;'
    );
  };

  // Grand totals across all computed summaries
  const grandTotals = useMemo(() => {
    return computedSummaries.reduce(
      (acc, s) => ({
        workDays: acc.workDays + s.totalWorkDays,
        workHours: acc.workHours + s.totalWorkHours,
        ot1_5: acc.ot1_5 + s.totalOT1_5,
        ot3_0: acc.ot3_0 + s.totalOT3_0,
        emergency: acc.emergency + s.totalEmergency,
        shiftAllw: acc.shiftAllw + s.totalShiftAllowance,
        standby: acc.standby + s.totalStandby,
      }),
      { workDays: 0, workHours: 0, ot1_5: 0, ot3_0: 0, emergency: 0, shiftAllw: 0, standby: 0 }
    );
  }, [computedSummaries]);

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
              Export เอกสาร Time Sheet เป็น PDF มาตรฐาน Siemens และไฟล์สรุปส่งฝ่ายการเงิน (Payroll Summary) รองรับการเลือกดูและทำรายการย้อนหลัง
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

      {/* Top Controls Bar: Month-Year Selector & Scope Settings */}
      <div className={`p-3.5 rounded border flex flex-wrap items-center justify-between gap-3 ${
        isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        {/* Month-Year Filter for Past & Current Months */}
        <div className="flex items-center space-x-3 flex-wrap gap-y-2">
          <div className="flex items-center space-x-2">
            <MonthYearFilter
              selectedMonthYear={selectedMonthYear}
              onChange={onSelectMonthYear}
              theme={theme}
              idPrefix="export-month-filter"
            />
          </div>

          <div className="h-5 w-[1px] bg-slate-700/50 hidden sm:block" />

          <div className={`text-xs flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            <Info className="w-3.5 h-3.5 text-teal-400 shrink-0" />
            <span>สามารถเปลี่ยนเดือนเพื่อดูและส่งออกรายงานสำหรับปิดรอบ Payroll ประจำเดือนย้อนหลังได้</span>
          </div>
        </div>
      </div>

      {/* Scope Selector Card */}
      <div className={`p-4 rounded border grid grid-cols-1 md:grid-cols-3 gap-4 ${
        isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        {/* Scope Options */}
        <div>
          <label className={`block text-xs font-semibold mb-2 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            ขอบเขตการส่งออก (Export Scope):
          </label>
          <div className="space-y-1.5 text-xs">
            {[
              { id: 'dept', label: 'ส่งออกเฉพาะแผนก (By Department)', icon: Building2 },
              { id: 'all', label: 'ส่งออกทุกแผนก (All Departments)', icon: Layers },
              { id: 'single', label: 'ส่งออกรายบุคคล (Individual Employee)', icon: Users },
            ].map(item => (
              <label 
                key={item.id}
                className={`flex items-center space-x-2.5 p-2 rounded border cursor-pointer transition ${
                  exportScope === item.id 
                    ? isDark 
                      ? 'border-[#00e5e5] bg-teal-500/10 text-teal-300 font-semibold' 
                      : 'border-teal-500 bg-teal-50 text-teal-800 font-semibold'
                    : isDark 
                      ? 'border-[#223344] hover:bg-[#182635] text-slate-300' 
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="exportScope"
                  checked={exportScope === item.id}
                  onChange={() => setExportScope(item.id as any)}
                  className="accent-[#008b99]"
                />
                <item.icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Dynamic Parameter based on Scope */}
        <div>
          {exportScope === 'dept' && (
            <div>
              <label className={`block text-xs font-semibold mb-2 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                เลือกแผนกเป้าหมาย:
              </label>
              <select
                value={targetDept}
                onChange={e => {
                  setTargetDept(e.target.value);
                  if (onSelectDepartment) onSelectDepartment(e.target.value);
                }}
                className={`w-full p-2.5 rounded border text-xs font-mono font-semibold transition ${
                  isDark ? 'bg-[#0f1722] border-[#273a4e] text-white focus:border-teal-400' : 'bg-slate-50 border-slate-300 text-slate-800 focus:border-teal-500'
                }`}
              >
                {storage.getDepartments().map(d => (
                  <option key={d.code} value={d.code} className={isDark ? 'bg-[#141f2c] text-white' : ''}>
                    {d.name && d.name !== d.code ? `${d.code} - ${d.name}` : d.code}
                  </option>
                ))}
              </select>
              <p className={`text-[11px] mt-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                จำนวนพนักงานในแผนกนี้: <strong className="text-teal-400">{targetEmployees.length} คน</strong>
              </p>
            </div>
          )}

          {exportScope === 'single' && (
            <div>
              <label className={`block text-xs font-semibold mb-2 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                เลือกพนักงาน:
              </label>
              <select
                value={targetEmpNo}
                onChange={e => setTargetEmpNo(e.target.value)}
                className={`w-full p-2.5 rounded border text-xs font-mono transition ${
                  isDark ? 'bg-[#0f1722] border-[#273a4e] text-white focus:border-teal-400' : 'bg-slate-50 border-slate-300 text-slate-800 focus:border-teal-500'
                }`}
              >
                {employees.map(emp => (
                  <option key={emp.empNo} value={emp.empNo} className={isDark ? 'bg-[#141f2c] text-white' : ''}>
                    {emp.empNo} / {emp.gid} - {emp.firstName} {emp.familyName} ({emp.department})
                  </option>
                ))}
              </select>
            </div>
          )}

          {exportScope === 'all' && (
            <div className={`text-xs space-y-1.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              <div className="font-semibold text-slate-200">ส่งออกข้อมูลรวมทั้งหมด:</div>
              <div>จำนวนพนักงานทั้งหมด: <strong className="text-teal-400">{employees.length} คน</strong></div>
              <div>ครอบคลุมแผนก: <span className="font-mono">{storage.getDepartments().map(d => d.code).join(', ')}</span></div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col justify-center space-y-2.5">
          <button
            id="btn-export-pdf-batch"
            onClick={handleExportPDF}
            disabled={isExporting || targetEmployees.length === 0}
            className="w-full flex items-center justify-center space-x-2 py-2.5 rounded font-semibold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition disabled:opacity-50 cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>Export Time Sheet เป็น PDF ({targetEmployees.length} คน)</span>
          </button>

          <button
            id="btn-export-payroll-csv"
            onClick={handleExportPayrollCSV}
            disabled={targetEmployees.length === 0}
            className="w-full flex items-center justify-center space-x-2 py-2.5 rounded font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow transition disabled:opacity-50 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export ส่ง Payroll ฝ่ายการเงิน (CSV)</span>
          </button>
        </div>
      </div>

      {/* Summary Preview Table */}
      <div className={`p-4 rounded border text-xs overflow-hidden ${
        isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-teal-400" />
            พรีวิวสรุปข้อมูลประจำเดือน (Payroll Preview — {selectedMonthYear}): {targetEmployees.length} รายการ
          </h3>
          <div className="text-[11px] text-slate-400 flex flex-wrap gap-2">
            <span>รวม OT 1.5: <strong className="text-[#00e5e5]">{grandTotals.ot1_5} ชม.</strong></span>
            <span>|</span>
            <span>รวม OT 3.0: <strong className="text-amber-400">{grandTotals.ot3_0} ชม.</strong></span>
            <span>|</span>
            <span>เบี้ยเลี้ยงรวม: <strong className="text-emerald-400">{(grandTotals.emergency + grandTotals.shiftAllw + grandTotals.standby).toLocaleString()} บาท</strong></span>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[50vh] scrollbar-thin">
          <table className="w-full border-collapse text-center">
            <thead className={`sticky top-0 ${isDark ? 'bg-[#0a1118] text-slate-200 border-b border-[#223344]' : 'bg-slate-100 text-slate-800 border-b border-slate-300'}`}>
              <tr>
                <th className="p-2.5 border-r border-inherit text-left">พนักงาน (EmpNo / GID)</th>
                <th className="p-2.5 border-r border-inherit">แผนก</th>
                <th className="p-2.5 border-r border-inherit">วันทำงาน</th>
                <th className="p-2.5 border-r border-inherit">ชั่วโมงรวม</th>
                <th className="p-2.5 border-r border-inherit text-[#00e5e5]">OT 1.5 (ชม.)</th>
                <th className="p-2.5 border-r border-inherit text-amber-400">OT 3.0 (ชม.)</th>
                <th className="p-2.5 border-r border-inherit text-red-400">สาย (HH:mm)</th>
                <th className="p-2.5 border-r border-inherit">Emergency</th>
                <th className="p-2.5 border-r border-inherit">Shift Allw</th>
                <th className="p-2.5 border-r border-inherit">Standby</th>
                <th className="p-2.5 font-bold text-emerald-400">รวมเบี้ยเลี้ยง</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-inherit">
              {computedSummaries.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-6 text-center text-slate-400">
                    ไม่พบข้อมูลตามขอบเขตและงวดเดือนที่เลือก ({selectedMonthYear})
                  </td>
                </tr>
              ) : (
                computedSummaries.map(s => {
                  const totalAllw = s.totalEmergency + s.totalShiftAllowance + s.totalStandby;
                  return (
                    <tr key={s.empNo} className={`transition ${
                      isDark ? 'hover:bg-teal-500/5' : 'hover:bg-slate-50'
                    }`}>
                      <td className="p-2.5 text-left font-medium border-r border-inherit">
                        <div className="font-semibold text-slate-100">{s.employee.firstName} {s.employee.familyName}</div>
                        <div className="text-[10px] font-mono text-slate-400">{s.empNo} / {s.gid}</div>
                      </td>
                      <td className="p-2.5 font-mono font-bold text-teal-300 border-r border-inherit">{s.employee.department}</td>
                      <td className="p-2.5 font-mono border-r border-inherit">{s.totalWorkDays}</td>
                      <td className="p-2.5 font-mono border-r border-inherit">{s.totalWorkHours}</td>
                      <td className="p-2.5 font-mono font-bold text-[#00e5e5] border-r border-inherit">{s.totalOT1_5}</td>
                      <td className="p-2.5 font-mono font-bold text-amber-400 border-r border-inherit">{s.totalOT3_0}</td>
                      <td className={`p-2.5 font-mono border-r border-inherit ${s.totalLateTime !== '00:00' ? 'text-red-400 font-bold' : ''}`}>
                        {s.totalLateTime}
                      </td>
                      <td className="p-2.5 font-mono border-r border-inherit">{s.totalEmergency}</td>
                      <td className="p-2.5 font-mono border-r border-inherit">{s.totalShiftAllowance}</td>
                      <td className="p-2.5 font-mono border-r border-inherit">{s.totalStandby}</td>
                      <td className="p-2.5 font-mono font-bold text-emerald-400">{totalAllw.toLocaleString()} ฿</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {/* Grand totals row */}
            <tfoot className={`font-bold border-t-2 ${
              isDark ? 'bg-[#091119] text-white border-slate-600' : 'bg-slate-100 text-slate-900 border-slate-300'
            }`}>
              <tr>
                <td className="p-2.5 text-left pl-3 border-r border-inherit">Total ({computedSummaries.length} คน)</td>
                <td className="border-r border-inherit">-</td>
                <td className="p-2.5 font-mono border-r border-inherit">{grandTotals.workDays}</td>
                <td className="p-2.5 font-mono border-r border-inherit">{grandTotals.workHours}</td>
                <td className="p-2.5 font-mono text-[#00e5e5] border-r border-inherit">{grandTotals.ot1_5}</td>
                <td className="p-2.5 font-mono text-amber-400 border-r border-inherit">{grandTotals.ot3_0}</td>
                <td className="border-r border-inherit">-</td>
                <td className="p-2.5 font-mono border-r border-inherit">{grandTotals.emergency}</td>
                <td className="p-2.5 font-mono border-r border-inherit">{grandTotals.shiftAllw}</td>
                <td className="p-2.5 font-mono border-r border-inherit">{grandTotals.standby}</td>
                <td className="p-2.5 font-mono text-emerald-400">
                  {(grandTotals.emergency + grandTotals.shiftAllw + grandTotals.standby).toLocaleString()} ฿
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};
