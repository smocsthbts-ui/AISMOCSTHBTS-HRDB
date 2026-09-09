import * as XLSX from 'xlsx';
import { 
  DailyShiftPlan, 
  ShiftCode, 
  Employee, 
  OTRecord, 
  OtherAllowance, 
  BiometricRawPunch 
} from '../types';
import { parseBiometricText } from './storage';

/**
 * Read File as ArrayBuffer or Text
 */
export async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target?.result as ArrayBuffer);
    reader.onerror = err => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target?.result as string);
    reader.onerror = err => reject(err);
    reader.readAsText(file);
  });
}

/**
 * Convert Excel / CSV workbook sheet into array of objects
 */
export function parseSheetToRows(data: ArrayBuffer): any[] {
  const workbook = XLSX.read(data, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(worksheet, { defval: '' });
}

/**
 * 1. Validate & Parse Shift Plan File
 * Rule 3: "บังคับเลือกข้อมูลเดือน-ปี และแผนกก่อนทุกครั้งพร้อมทั้งตรวจสอบรายชื่อพนักงานว่าถูกอับโหลดถูกแผนกหรือไม่ก่อนการอับโหลด"
 * Rule 4: "หากมีการลง Shift Code ที่ไม่มีในระบบมาจะมีการแจ้งเตือนในขั้นตอนการอับโหลด Shift Plan"
 */
export interface ShiftPlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  plans: DailyShiftPlan[];
  matchedEmployeesCount: number;
  totalRows: number;
}

export function validateAndParseShiftPlan(
  rawRows: any[],
  selectedMonthYear: string, // e.g. "2026-05"
  selectedDepartment: string,// e.g. "GM"
  employees: Employee[],
  registeredShiftCodes: ShiftCode[],
  currentUserEmail: string
): ShiftPlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsedPlans: DailyShiftPlan[] = [];

  if (!rawRows || rawRows.length === 0) {
    return {
      valid: false,
      errors: ['ไฟล์ว่างเปล่าหรือไม่พบข้อมูลในตาราง'],
      warnings: [],
      plans: [],
      matchedEmployeesCount: 0,
      totalRows: 0,
    };
  }

  const validShiftCodeSet = new Set(registeredShiftCodes.map(sc => sc.code.toUpperCase()));
  // Also common off days
  validShiftCodeSet.add('OFF');
  validShiftCodeSet.add('H');

  // Filter department employees (or all if ALL selected)
  const deptEmployees = selectedDepartment === 'ALL' 
    ? employees 
    : employees.filter(e => e.department === selectedDepartment);
  const deptEmpMap = new Map<string, Employee>();
  deptEmployees.forEach(e => {
    deptEmpMap.set(e.empNo.toLowerCase(), e);
    deptEmpMap.set(e.gid.toLowerCase(), e);
  });

  const allEmpMap = new Map<string, Employee>();
  employees.forEach(e => {
    allEmpMap.set(e.empNo.toLowerCase(), e);
    allEmpMap.set(e.gid.toLowerCase(), e);
  });

  const matchedEmpSet = new Set<string>();

  // Check rows: Can be wide format (EmpNo, GID, Name, 01, 02, 03... 31) OR long format (EmpNo, Date, ShiftCode)
  rawRows.forEach((row, idx) => {
    const rowNum = idx + 2;

    // Identify identifier
    const empNo = String(row['EmpNo'] || row['Emp No'] || row['Employee No'] || row['empNo'] || '').trim();
    const gid = String(row['GID'] || row['gid'] || '').trim();

    if (!empNo && !gid) {
      // Skip empty row
      return;
    }

    // Verify employee belongs to the selected department
    const employee = deptEmpMap.get(empNo.toLowerCase()) || deptEmpMap.get(gid.toLowerCase());
    const foreignEmp = allEmpMap.get(empNo.toLowerCase()) || allEmpMap.get(gid.toLowerCase());

    if (!employee) {
      if (foreignEmp) {
        errors.push(
          `แถวที่ ${rowNum}: พนักงาน ${foreignEmp.firstName} ${foreignEmp.familyName} (EmpNo: ${foreignEmp.empNo}, GID: ${foreignEmp.gid}) อยู่แผนก "${foreignEmp.department}" ไม่ตรงกับแผนกที่เลือก "${selectedDepartment}"`
        );
      } else {
        errors.push(
          `แถวที่ ${rowNum}: ไม่พบข้อมูลพนักงานสำหรับ EmpNo: "${empNo}" หรือ GID: "${gid}" ในระบบแผนก ${selectedDepartment}`
        );
      }
      return;
    }

    matchedEmpSet.add(employee.empNo);

    // Format A: Wide format with Day columns 1 to 31 (e.g. "1", "2", "3" ... or "01", "02")
    const daysInMonth = new Date(
      parseInt(selectedMonthYear.split('-')[0]),
      parseInt(selectedMonthYear.split('-')[1]),
      0
    ).getDate();

    let hasDayColumns = false;
    // Check if wide format day column headers exist in this row
    for (let d = 1; d <= daysInMonth; d++) {
      const colKey1 = String(d);
      const colKey2 = String(d).padStart(2, '0');
      const colKey3 = `D${d}`;
      const colKey4 = `Day${d}`;
      if (row[colKey1] !== undefined || row[colKey2] !== undefined || row[colKey3] !== undefined || row[colKey4] !== undefined) {
        hasDayColumns = true;
        break;
      }
    }

    if (hasDayColumns) {
      for (let d = 1; d <= daysInMonth; d++) {
        const colKey1 = String(d);
        const colKey2 = String(d).padStart(2, '0');
        const colKey3 = `D${d}`;
        const colKey4 = `Day${d}`;

        const rawVal = row[colKey1] !== undefined ? row[colKey1] :
                       row[colKey2] !== undefined ? row[colKey2] :
                       row[colKey3] !== undefined ? row[colKey3] :
                       row[colKey4] !== undefined ? row[colKey4] : '';

        const trimmed = String(rawVal ?? '').trim().toUpperCase();
        // Rule: Empty or blank cell is treated as OFF (Day Off)
        const code = trimmed === '' ? 'OFF' : trimmed;

        if (!validShiftCodeSet.has(code)) {
          warnings.push(
            `แถวที่ ${rowNum} (${employee.firstName}): วันที่ ${d} มี Shift Code "${code}" ซึ่งไม่มีในฐานข้อมูลระบบ (แจ้งเตือน)`
          );
        }

        const dateStr = `${selectedMonthYear}-${String(d).padStart(2, '0')}`;
        parsedPlans.push({
          id: `plan-${employee.empNo}-${dateStr}-${Date.now()}`,
          empNo: employee.empNo,
          gid: employee.gid,
          date: dateStr,
          shiftCode: code,
          department: selectedDepartment,
          updatedBy: currentUserEmail,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Format B: Long format with 'Date' and 'ShiftCode'
    if (!hasDayColumns && (row['Date'] || row['date'])) {
      const dateVal = String(row['Date'] || row['date']).trim();
      const codeVal = String(row['ShiftCode'] || row['Shift Code'] || row['shiftCode'] || 'OFF').trim().toUpperCase();

      // Ensure date matches selected monthYear
      if (!dateVal.startsWith(selectedMonthYear)) {
        errors.push(
          `แถวที่ ${rowNum}: วันที่ "${dateVal}" ไม่ตรงกับเดือน-ปี ที่เลือก (${selectedMonthYear})`
        );
        return;
      }

      if (!validShiftCodeSet.has(codeVal)) {
        warnings.push(
          `แถวที่ ${rowNum} (${employee.firstName}): วันที่ ${dateVal} มี Shift Code "${codeVal}" ซึ่งไม่มีในฐานข้อมูลระบบ`
        );
      }

      parsedPlans.push({
        id: `plan-${employee.empNo}-${dateVal}-${Date.now()}`,
        empNo: employee.empNo,
        gid: employee.gid,
        date: dateVal,
        shiftCode: codeVal,
        department: selectedDepartment,
        updatedBy: currentUserEmail,
        updatedAt: new Date().toISOString(),
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    plans: parsedPlans,
    matchedEmployeesCount: matchedEmpSet.size,
    totalRows: rawRows.length,
  };
}

/**
 * 2. Parse & Validate Shift Codes
 */
export function parseShiftCodesFromRows(rawRows: any[]): ShiftCode[] {
  const codes: ShiftCode[] = [];
  rawRows.forEach(row => {
    const code = String(row['Code'] || row['code'] || row['Shift Code'] || '').trim().toUpperCase();
    if (!code) return;

    const name = String(row['Name'] || row['name'] || row['Description'] || code).trim();
    const department = String(row['Department'] || row['department'] || 'ALL').trim().toUpperCase();
    const startTime = String(row['StartTime'] || row['Start Time'] || row['In'] || '08:00').trim();
    const endTime = String(row['EndTime'] || row['End Time'] || row['Out'] || '17:00').trim();
    const breakMin = Number(row['BreakMinutes'] || row['Break (min)'] || 60);
    const workHours = Number(row['WorkingHours'] || row['Working Hours'] || 8);
    const isWorking = row['IsWorkingDay'] !== undefined ? String(row['IsWorkingDay']).toLowerCase() !== 'false' : (code !== 'H' && code !== 'OFF');
    const color = String(row['Color'] || '#008b99').trim();

    codes.push({
      code,
      name,
      department,
      startTime,
      endTime,
      breakMinutes: breakMin,
      workingHours: workHours,
      isWorkingDay: isWorking,
      color,
    });
  });
  return codes;
}

/**
 * 3. Parse Approved OT file (from Power BI export)
 * Rule 5: "มีระบบอับโหลดโอทีพนักงานที่ได้รับการอนุมัติแล้วผ่านไฟล์ Excel...
 * หากวันไดมีการทำโอทีหลายช่วงเวลาให้รวมเวลาของวันนั้นเข้าด้วยกัน
 * และหากมีการอับโหลดโอทีเดือนก่อนหน้าซึ่งล่าช้าเข้ามาในระบบจะต้องให้ Admin ตรวจสอบวันที่จะลงบันทึก OT ก่อน"
 */
export interface OTParseResult {
  records: OTRecord[];
  retroactiveCount: number;
  warnings: string[];
}

export function parseApprovedOTFile(
  rawRows: any[],
  currentMonthYear: string // e.g. "2026-05"
): OTParseResult {
  const records: OTRecord[] = [];
  const warnings: string[] = [];
  let retroactiveCount = 0;

  rawRows.forEach((row, idx) => {
    const empNo = String(row['EmpNo'] || row['Emp No'] || row['Employee No'] || '').trim();
    const gid = String(row['GID'] || row['gid'] || '').trim();
    const dateStr = String(row['Date'] || row['OT Date'] || '').trim();
    const hours = Number(row['Hours'] || row['OT Hours'] || row['Duration'] || 0);
    const rate = Number(row['Rate'] || row['OT Rate'] || 1.5) === 3 ? 3.0 : 1.5;
    const startTime = String(row['StartTime'] || row['Start Time'] || '17:30').trim();
    const endTime = String(row['EndTime'] || row['End Time'] || '20:30').trim();
    const reason = String(row['Reason'] || row['Task'] || row['Remark'] || 'Approved OT').trim();
    const approvedBy = String(row['ApprovedBy'] || row['Approved By'] || 'Manager').trim();

    if ((!empNo && !gid) || !dateStr || hours <= 0) return;

    // Check if date belongs to previous month (Retroactive OT)
    const isRetro = !dateStr.startsWith(currentMonthYear);
    if (isRetro) {
      retroactiveCount++;
      warnings.push(
        `แถวที่ ${idx + 2}: โอทีพนักงาน ${empNo || gid} วันที่ ${dateStr} เป็นของเดือนก่อนหน้า (${dateStr.substring(0, 7)}) ต้องให้ Admin ตรวจสอบวันที่จะลงบันทึกใน Time Sheet`
      );
    }

    records.push({
      id: `ot-${empNo}-${gid}-${dateStr}-${idx}-${Date.now()}`,
      empNo,
      gid,
      date: isRetro ? `${currentMonthYear}-01` : dateStr,
      originalDate: dateStr,
      startTime,
      endTime,
      hours,
      rate,
      reason,
      approvedBy,
      isRetroactive: isRetro,
      retroactiveTargetDate: isRetro ? `${currentMonthYear}-01` : dateStr,
      status: isRetro ? 'Pending_Admin_Review' : 'Approved',
    });
  });

  return { records, retroactiveCount, warnings };
}

/**
 * 4. Parse Other Allowances (Team Emergency, Shift Allowance, Standby)
 */
export function parseOtherAllowances(rawRows: any[]): OtherAllowance[] {
  const list: OtherAllowance[] = [];
  rawRows.forEach((row, idx) => {
    const empNo = String(row['EmpNo'] || row['Emp No'] || '').trim();
    const gid = String(row['GID'] || row['gid'] || '').trim();
    const monthYear = String(row['MonthYear'] || row['Month'] || '').trim();
    const date = String(row['Date'] || '').trim();
    const teamEmergency = Number(row['TeamEmergency'] || row['Team Emergency'] || row['Emergency'] || 0);
    const shiftAllowance = Number(row['ShiftAllowance'] || row['Shift Allowance'] || 0);
    const standbyAllowance = Number(row['StandbyAllowance'] || row['Standby'] || 0);
    const remark = String(row['Remark'] || row['Note'] || '').trim();

    if (!empNo && !gid) return;

    list.push({
      id: `allw-${idx}-${Date.now()}`,
      empNo,
      gid,
      monthYear,
      date: date || undefined,
      teamEmergency,
      shiftAllowance,
      standbyAllowance,
      remark,
    });
  });
  return list;
}

/**
 * 5. Template Generators for Download Center
 */
export function generateShiftPlanTemplate(
  department: string,
  monthYear: string,
  employees: Employee[]
): { csvContent: string; workbook: XLSX.WorkBook } {
  const deptEmployees = department === 'ALL' ? employees : employees.filter(e => e.department === department);
  const [yearStr, monthStr] = monthYear.split('-');
  const daysInMonth = new Date(parseInt(yearStr), parseInt(monthStr), 0).getDate();

  const headers = ['EmpNo', 'GID', 'Name', 'Department'];
  for (let d = 1; d <= daysInMonth; d++) {
    headers.push(String(d).padStart(2, '0'));
  }

  const rows: any[] = [];
  deptEmployees.forEach(emp => {
    const rowObj: any = {
      EmpNo: emp.empNo,
      GID: emp.gid,
      Name: `${emp.firstName} ${emp.familyName}`,
      Department: emp.department,
    };
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(parseInt(yearStr), parseInt(monthStr) - 1, d);
      const dow = dateObj.getDay();
      // Default placeholder: D for weekdays, OFF for weekend
      rowObj[String(d).padStart(2, '0')] = (dow === 0 || dow === 6) ? 'OFF' : 'D';
    }
    rows.push(rowObj);
  });

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, `ShiftPlan_${department}`);

  const csvContent = XLSX.utils.sheet_to_csv(worksheet);
  return { csvContent, workbook };
}

export function generateShiftCodeTemplate(shiftCodes: ShiftCode[]): { csvContent: string; workbook: XLSX.WorkBook } {
  const rows = shiftCodes.map(sc => ({
    Code: sc.code,
    Name: sc.name,
    Department: sc.department,
    StartTime: sc.startTime,
    EndTime: sc.endTime,
    BreakMinutes: sc.breakMinutes,
    WorkingHours: sc.workingHours,
    IsWorkingDay: sc.isWorkingDay ? 'TRUE' : 'FALSE',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ShiftCodes');

  const csvContent = XLSX.utils.sheet_to_csv(worksheet);
  return { csvContent, workbook };
}

export function generateOTApprovedTemplate(): { csvContent: string; workbook: XLSX.WorkBook } {
  const rows = [
    {
      EmpNo: '0950',
      GID: 'Z00430UZ',
      Date: '2026-05-20',
      StartTime: '17:30',
      EndTime: '20:30',
      Hours: 3.0,
      Rate: 1.5,
      Reason: 'Support for random Narcotics and Intoxicant Testing for operation staff',
      ApprovedBy: 'Safety Lead',
    },
    {
      EmpNo: '0149',
      GID: 'Z00149TH',
      Date: '2026-04-29', // Retroactive sample
      StartTime: '18:00',
      EndTime: '22:00',
      Hours: 4.0,
      Rate: 1.5,
      Reason: 'Emergency bogie inspection after track maintenance delay',
      ApprovedBy: 'RS Depot Chief',
    }
  ];

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Approved_OT_Report');

  const csvContent = XLSX.utils.sheet_to_csv(worksheet);
  return { csvContent, workbook };
}

export function generatePayrollCSV(
  summaries: any[],
  monthYear: string
): string {
  // UTF-8 BOM for Microsoft Excel Thai language compatibility
  const BOM = '\uFEFF';
  const headers = [
    'EmpNo',
    'GID',
    'EmployeeName',
    'Department',
    'Division',
    'CostCenter',
    'MonthYear',
    'TotalWorkDays',
    'TotalWorkHours',
    'OT_1_5_Hours',
    'OT_3_0_Hours',
    'TeamEmergencyAllowance',
    'ShiftAllowance',
    'StandbyAllowance',
    'TotalAllowanceAmount',
    'LateTime',
    'LeaveDaysCount',
    'Status'
  ];

  const lines = [headers.join(',')];

  summaries.forEach(s => {
    const totalAddPay = (s.totalEmergency || 0) + (s.totalShiftAllowance || 0) + (s.totalStandby || 0);
    const row = [
      `"${s.empNo}"`,
      `"${s.gid}"`,
      `"${s.employee?.firstName || ''} ${s.employee?.familyName || ''}"`,
      `"${s.employee?.department || ''}"`,
      `"${s.employee?.division || 'MO CS BTS'}"`,
      `"${s.employee?.costCenter || ''}"`,
      `"${monthYear}"`,
      s.totalWorkDays || 0,
      s.totalWorkHours || 0,
      s.totalOT1_5 || 0,
      s.totalOT3_0 || 0,
      s.totalEmergency || 0,
      s.totalShiftAllowance || 0,
      s.totalStandby || 0,
      totalAddPay,
      `"${s.totalLateTime || '00:00'}"`,
      s.totalLeaveDays || 0,
      '"Approved_For_Payroll"'
    ];
    lines.push(row.join(','));
  });

  return BOM + lines.join('\r\n');
}

/**
 * Trigger browser file download
 */
export function downloadBlob(content: BlobPart, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Trigger browser XLSX workbook download
 */
export function downloadWorkbook(workbook: XLSX.WorkBook, filename: string) {
  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  downloadBlob(wbout, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
