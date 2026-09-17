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
import { normalizeOTDate } from './otManager';

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

/**
 * Clean and normalize employee name (stripping Thai/English honorific titles and multiple spaces)
 */
function cleanEmployeeName(nameStr: string): string {
  if (!nameStr) return '';
  let s = String(nameStr).trim();
  // Remove common Thai and English honorific prefixes
  const prefixes = [
    /^นาย\s*/i,
    /^นางสาว\s*/i,
    /^นาง\s*/i,
    /^คุณ\s*/i,
    /^ด\.ช\.\s*/i,
    /^ด\.ญ\.\s*/i,
    /^mr\.?\s*/i,
    /^mrs\.?\s*/i,
    /^ms\.?\s*/i,
    /^miss\s*/i,
  ];
  for (const p of prefixes) {
    s = s.replace(p, '');
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Helper to match an employee from database using Name, EmpNo, or GID
 */
function matchEmployeeFromDatabase(
  rawName: string,
  rawEmpNo: string,
  rawGid: string,
  deptEmployees: Employee[],
  allEmployees: Employee[]
): { employee?: Employee; foreignEmployee?: Employee } {
  const normEmpNo = rawEmpNo.trim().toLowerCase();
  const normGid = rawGid.trim().toLowerCase();
  const normName = rawName.replace(/\s+/g, ' ').trim().toLowerCase();
  const cleanName = cleanEmployeeName(rawName);
  const rawNameNoSpace = normName.replace(/\s+/g, '');

  // 1. Try matching by EmpNo in target department first, then across company
  if (normEmpNo) {
    const deptMatch = deptEmployees.find(e => e.empNo.toLowerCase() === normEmpNo);
    if (deptMatch) return { employee: deptMatch };
    const foreignMatch = allEmployees.find(e => e.empNo.toLowerCase() === normEmpNo);
    if (foreignMatch) return { foreignEmployee: foreignMatch };
  }

  // 2. Try matching by GID in target department first, then across company
  if (normGid) {
    const deptMatch = deptEmployees.find(e => e.gid.toLowerCase() === normGid);
    if (deptMatch) return { employee: deptMatch };
    const foreignMatch = allEmployees.find(e => e.gid.toLowerCase() === normGid);
    if (foreignMatch) return { foreignEmployee: foreignMatch };
  }

  // 3. Try matching by Name
  if (normName || cleanName) {
    const isNameMatch = (e: Employee) => {
      const full1 = `${e.firstName || ''} ${e.familyName || ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
      const full2 = `${e.familyName || ''} ${e.firstName || ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
      const cleanFull1 = cleanEmployeeName(`${e.firstName || ''} ${e.familyName || ''}`);
      const cleanFull2 = cleanEmployeeName(`${e.familyName || ''} ${e.firstName || ''}`);
      const noSpace1 = full1.replace(/\s+/g, '');
      const legacyName = ((e as any).name || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const cleanLegacy = cleanEmployeeName((e as any).name || '');

      // Direct full match or reversed first/last name
      if (normName && (normName === full1 || normName === full2 || (legacyName && normName === legacyName))) return true;
      if (cleanName && (cleanName === cleanFull1 || cleanName === cleanFull2 || (cleanLegacy && cleanName === cleanLegacy))) return true;
      if (rawNameNoSpace && (rawNameNoSpace === noSpace1 || (cleanLegacy && rawNameNoSpace === cleanLegacy.replace(/\s+/g, '')))) return true;

      // Match first name or family name if unique
      const firstNorm = (e.firstName || '').trim().toLowerCase();
      const cleanFirst = cleanEmployeeName(e.firstName || '');
      if (normName === firstNorm || cleanName === cleanFirst) return true;

      return false;
    };

    // A. Search within target department
    const deptMatch = deptEmployees.find(isNameMatch);
    if (deptMatch) return { employee: deptMatch };

    // B. Search across all departments (to detect foreign department mismatch)
    const foreignMatch = allEmployees.find(isNameMatch);
    if (foreignMatch) return { foreignEmployee: foreignMatch };
  }

  return {};
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

  const matchedEmpSet = new Set<string>();

  // Check rows: Can be wide format (Name, Department, 01, 02... 31) OR long format (Name, Date, ShiftCode)
  rawRows.forEach((row, idx) => {
    const rowNum = idx + 2;

    // Extract identifiers from row
    const rawName = String(
      row['Name'] || 
      row['name'] || 
      row['Employee Name'] || 
      row['EmployeeName'] || 
      row['Employee'] || 
      row['ชื่อ-นามสกุล'] || 
      row['ชื่อพนักงาน'] || 
      row['ชื่อ'] || 
      ''
    ).trim();

    const rawEmpNo = String(
      row['EmpNo'] || 
      row['Emp No'] || 
      row['Employee No'] || 
      row['empNo'] || 
      row['รหัสพนักงาน'] || 
      ''
    ).trim();

    const rawGid = String(
      row['GID'] || 
      row['gid'] || 
      row['Gid'] || 
      row['รหัส GID'] || 
      ''
    ).trim();

    // Skip empty row
    if (!rawName && !rawEmpNo && !rawGid) {
      return;
    }

    // Match employee against Employee Database
    const { employee, foreignEmployee } = matchEmployeeFromDatabase(
      rawName,
      rawEmpNo,
      rawGid,
      deptEmployees,
      employees
    );

    if (!employee) {
      if (foreignEmployee) {
        errors.push(
          `แถวที่ ${rowNum}: พนักงาน "${foreignEmployee.firstName} ${foreignEmployee.familyName}" (รหัส: ${foreignEmployee.empNo}, GID: ${foreignEmployee.gid}) สังกัดแผนก "${foreignEmployee.department}" ไม่ตรงกับแผนกที่เลือกอัปโหลด "${selectedDepartment}"`
        );
      } else {
        const identifier = rawName || (rawEmpNo ? `EmpNo: ${rawEmpNo}` : '') || (rawGid ? `GID: ${rawGid}` : '');
        errors.push(
          `แถวที่ ${rowNum}: ไม่พบข้อมูลพนักงาน "${identifier}" ในฐานข้อมูลพนักงาน (Employee Database) — กรุณาไปที่เมนู "ฐานข้อมูลพนักงาน (Employee Master)" เพื่อเพิ่มพนักงานใหม่นี้เข้าสู่ระบบก่อนอัปโหลด หรือตรวจสอบการสะกดชื่อ-สกุลให้ถูกต้อง`
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

        const isCodeValid = (c: string) => {
          if (validShiftCodeSet.has(c)) return true;
          const base = c.replace(/-X/gi, '').replace(/-ET/gi, '').trim();
          if (validShiftCodeSet.has(base)) return true;
          if (base.startsWith('A') && base.length > 1 && validShiftCodeSet.has(base.slice(1))) return true;
          return false;
        };

        if (!isCodeValid(code)) {
          warnings.push(
            `แถวที่ ${rowNum} (${employee.firstName}): วันที่ ${d} มี Shift Code "${code}" ซึ่งไม่มีในฐานข้อมูลระบบ (แจ้งเตือน)`
          );
        }

        const dateStr = `${selectedMonthYear}-${String(d).padStart(2, '0')}`;
        parsedPlans.push({
          id: `plan-${employee.empNo}-${dateStr}-${Date.now()}`,
          empNo: employee.empNo, // Auto-pulled from Employee Database
          gid: employee.gid,     // Auto-pulled from Employee Database
          date: dateStr,
          shiftCode: code,
          department: employee.department || selectedDepartment,
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

      const isCodeValid = (c: string) => {
        if (validShiftCodeSet.has(c)) return true;
        const base = c.replace(/-X/gi, '').replace(/-ET/gi, '').trim();
        if (validShiftCodeSet.has(base)) return true;
        if (base.startsWith('A') && base.length > 1 && validShiftCodeSet.has(base.slice(1))) return true;
        return false;
      };

      if (!isCodeValid(codeVal)) {
        warnings.push(
          `แถวที่ ${rowNum} (${employee.firstName}): วันที่ ${dateVal} มี Shift Code "${codeVal}" ซึ่งไม่มีในฐานข้อมูลระบบ`
        );
      }

      parsedPlans.push({
        id: `plan-${employee.empNo}-${dateVal}-${Date.now()}`,
        empNo: employee.empNo, // Auto-pulled from Employee Database
        gid: employee.gid,     // Auto-pulled from Employee Database
        date: dateVal,
        shiftCode: codeVal,
        department: employee.department || selectedDepartment,
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
    const isWorking = row['IsWorkingDay'] !== undefined ? String(row['IsWorkingDay']).toLowerCase() !== 'false' : (code !== 'H' && code !== 'OFF' && code !== 'AL' && code !== 'SL');
    const startTime = !isWorking ? String(row['StartTime'] || row['Start Time'] || row['In'] || '00:00').trim() : String(row['StartTime'] || row['Start Time'] || row['In'] || '08:00').trim();
    const endTime = !isWorking ? String(row['EndTime'] || row['End Time'] || row['Out'] || '00:00').trim() : String(row['EndTime'] || row['End Time'] || row['Out'] || '17:00').trim();
    const breakMin = !isWorking ? Number(row['BreakMinutes'] || row['Break (min)'] || 0) : Number(row['BreakMinutes'] || row['Break (min)'] || 60);
    const workHours = !isWorking ? Number(row['WorkingHours'] || row['Working Hours'] || 0) : Number(row['WorkingHours'] || row['Working Hours'] || 8);
    const color = String(row['Color'] || (!isWorking ? '#6b7280' : '#008b99')).trim();

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
  currentMonthYear: string, // e.g. "2026-05"
  selectedRate?: 1.5 | 3.0
): OTParseResult {
  const records: OTRecord[] = [];
  const warnings: string[] = [];
  let retroactiveCount = 0;

  rawRows.forEach((row, idx) => {
    // Flexible column headers for Power BI, Excel, and CSV exports (English and Thai)
    const empNo = String(
      row['EmpNo'] || row['Emp No'] || row['Employee No'] || row['EmployeeNo'] ||
      row['Staff ID'] || row['Employee ID'] || row['EmpID'] || row['Code'] ||
      row['รหัสพนักงาน'] || ''
    ).trim();

    const gid = String(
      row['GID'] || row['gid'] || row['Global ID'] || row['GlobalID'] || ''
    ).trim();

    const rawDate = row['Date'] || row['OT Date'] || row['OTDate'] || row['Work Date'] ||
      row['WorkDate'] || row['วันที่'] || row['วันที่ทำโอที'] || '';
    const dateStr = normalizeOTDate(rawDate);

    const hours = Number(
      row['Hours'] || row['OT Hours'] || row['OTHours'] || row['Duration'] ||
      row['Total Hours'] || row['จำนวนชั่วโมง'] || row['ชั่วโมง'] || 0
    );

    // Resolve Rate from row if present, or use Admin selection
    const rawRateStr = String(row['Rate'] || row['OT Rate'] || row['OTRate'] || row['ประเภท OT'] || row['ประเภท'] || '').trim();
    let fileRate: 1.5 | 3.0 | undefined = undefined;
    if (/3(\.0)?/i.test(rawRateStr)) {
      fileRate = 3.0;
    } else if (/1\.5/i.test(rawRateStr)) {
      fileRate = 1.5;
    }

    const resolvedRate: 1.5 | 3.0 = selectedRate ? selectedRate : (fileRate ?? 1.5);

    const startTime = String(row['StartTime'] || row['Start Time'] || row['Start'] || row['เวลาเริ่ม'] || '17:30').trim();
    const endTime = String(row['EndTime'] || row['End Time'] || row['End'] || row['เวลาสิ้นสุด'] || '20:30').trim();
    const reason = String(row['Reason'] || row['Task'] || row['Remark'] || row['ชื่องาน'] || row['เหตุผล'] || 'Approved OT').trim();
    const approvedBy = String(row['ApprovedBy'] || row['Approved By'] || row['Approver'] || row['ผู้อนุมัติ'] || 'Manager').trim();

    if ((!empNo && !gid) || !dateStr || hours <= 0) return;

    // Check if date belongs to previous month (Retroactive OT)
    const isRetro = !dateStr.startsWith(currentMonthYear);
    if (isRetro) {
      retroactiveCount++;
      warnings.push(
        `แถวที่ ${idx + 2}: โอทีพนักงาน ${empNo || gid} วันที่ ${dateStr} เป็นของเดือนก่อนหน้า (${dateStr.substring(0, 7)}) ต้องให้ Admin ตรวจสอบวันที่จะลงบันทึกใน Time Sheet`
      );
    }

    const primaryId = (empNo || gid).replace(/[^a-zA-Z0-9]/g, '');
    records.push({
      id: `ot-${primaryId}-${dateStr}-${resolvedRate}-${idx}`,
      empNo,
      gid,
      date: isRetro ? `${currentMonthYear}-01` : dateStr,
      originalDate: dateStr,
      startTime,
      endTime,
      hours,
      rate: resolvedRate,
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
  const deptEmployees = department === 'ALL' 
    ? employees.filter(e => e.isActive !== false) 
    : employees.filter(e => e.department === department && e.isActive !== false);
  
  const cleanMonthYear = monthYear && monthYear.includes('-') ? monthYear : '2026-05';
  const [yearStr, monthStr] = cleanMonthYear.split('-');
  const yearNum = parseInt(yearStr, 10) || 2026;
  const monthNum = parseInt(monthStr, 10) || 5;
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

  // Primary reference columns: Emp No, Name, and Department
  const headers = ['Emp No', 'Name', 'Department'];
  for (let d = 1; d <= daysInMonth; d++) {
    headers.push(String(d).padStart(2, '0'));
  }

  const rows: any[] = [];
  if (deptEmployees && deptEmployees.length > 0) {
    deptEmployees.forEach(emp => {
      const fullName = `${emp.firstName || ''} ${emp.familyName || ''}`.trim() || (emp as any).name || emp.empNo;
      const rowObj: any = {
        'Emp No': emp.empNo || '',
        Name: fullName,
        Department: emp.department || (department === 'ALL' ? 'RST' : department),
      };
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(yearNum, monthNum - 1, d);
        const dow = dateObj.getDay();
        // Default placeholder: D for weekdays, OFF for weekend
        rowObj[String(d).padStart(2, '0')] = (dow === 0 || dow === 6) ? 'OFF' : 'D';
      }
      rows.push(rowObj);
    });
  } else {
    // If no active employees in this department, provide sample rows so template is ready to use
    const sampleRow: any = {
      'Emp No': '1001234',
      Name: 'Sample Employee (ตัวอย่างชื่อพนักงาน)',
      Department: department === 'ALL' ? 'RST' : department,
    };
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(yearNum, monthNum - 1, d);
      const dow = dateObj.getDay();
      sampleRow[String(d).padStart(2, '0')] = (dow === 0 || dow === 6) ? 'OFF' : 'D';
    }
    rows.push(sampleRow);
  }

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });

  // Add column widths for a clean presentation
  const colWidths = [
    { wch: 14 }, // Emp No
    { wch: 28 }, // Name
    { wch: 15 }, // Department
  ];
  for (let d = 1; d <= daysInMonth; d++) {
    colWidths.push({ wch: 6 });
  }
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  const safeDeptSheetName = `Shift_${(department || 'ALL').replace(/[\\/*?:[\]]/g, '').slice(0, 20)}`;
  XLSX.utils.book_append_sheet(workbook, worksheet, safeDeptSheetName);

  // Add UTF-8 BOM so Microsoft Excel correctly displays Thai employee names and headers
  const BOM = '\uFEFF';
  const rawCsv = XLSX.utils.sheet_to_csv(worksheet);
  const csvContent = BOM + rawCsv;

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

export function generateOTApprovedTemplate(targetRate: 1.5 | 3.0 = 1.5): { csvContent: string; workbook: XLSX.WorkBook } {
  const rows = [
    {
      EmpNo: '0950',
      GID: 'Z00430UZ',
      Date: '2026-05-20',
      StartTime: targetRate === 3.0 ? '08:00' : '17:30',
      EndTime: targetRate === 3.0 ? '16:00' : '20:30',
      Hours: targetRate === 3.0 ? 8.0 : 3.0,
      Rate: targetRate,
      Reason: targetRate === 3.0 ? 'Holiday Duty / Special OT Work' : 'Support for random Narcotics and Intoxicant Testing for operation staff',
      ApprovedBy: 'Safety Lead',
    },
    {
      EmpNo: '0149',
      GID: 'Z00149TH',
      Date: '2026-04-29', // Retroactive sample
      StartTime: targetRate === 3.0 ? '08:00' : '18:00',
      EndTime: targetRate === 3.0 ? '12:00' : '22:00',
      Hours: 4.0,
      Rate: targetRate,
      Reason: targetRate === 3.0 ? 'Holiday emergency track support' : 'Emergency bogie inspection after track maintenance delay',
      ApprovedBy: 'RS Depot Chief',
    }
  ];

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, `Approved_OT_${targetRate === 3.0 ? '3_0' : '1_5'}`);

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
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) {
      document.body.removeChild(a);
    }
    URL.revokeObjectURL(url);
  }, 2500);
}

/**
 * Trigger browser XLSX workbook download
 */
export function downloadWorkbook(workbook: XLSX.WorkBook, filename: string) {
  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  downloadBlob(wbout, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
