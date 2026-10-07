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
import { normalizeOTDate, detectFileDateFormat, forceDateToTargetMonth, normalizeOTTime } from './otManager';
import { normalizeShiftTimeString, getShiftCategoryColor } from './timeCalc';

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
 * Universal Worksheet to JSON rows parser with smart header detection
 * Finds the real header row even if there are banner titles, notes, or blank rows at the top
 */
export function parseWorksheetToRows(worksheet: XLSX.WorkSheet): any[] {
  if (!worksheet) return [];

  // 1. Try standard json conversion first
  const defaultRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  if (defaultRows.length === 0) return [];

  // Check if first row is already a valid header
  const firstRowKeys = Object.keys(defaultRows[0] || {});
  const isHeaderValid = firstRowKeys.some(k => {
    const cleanK = k.trim().toLowerCase().replace(/[\s._-]/g, '');
    return cleanK.includes('empno') || cleanK.includes('employee') || cleanK.includes('name') ||
           cleanK.includes('ชื่อ') || cleanK.includes('รหัส') || cleanK.includes('gid') ||
           cleanK.includes('empcode') || cleanK.includes('costcenter') ||
           cleanK === '1' || cleanK === '01' || cleanK === 'd1' || cleanK === 'date';
  });

  if (isHeaderValid) {
    return defaultRows;
  }

  // 2. If row 0 was a title/banner, find the real header row within the first 15 rows
  const rawMatrix: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  let headerRowIndex = -1;

  for (let r = 0; r < Math.min(rawMatrix.length, 15); r++) {
    const row = rawMatrix[r];
    if (!Array.isArray(row)) continue;
    const hasEmpHeader = row.some(cell => {
      const s = String(cell || '').trim().toLowerCase().replace(/[\s._-]/g, '');
      return s.includes('empno') || s.includes('employee') || s.includes('name') ||
             s.includes('ชื่อ') || s.includes('รหัส') || s.includes('gid') ||
             s.includes('empcode') || s.includes('costcenter') ||
             s === 'code' || s === 'no' || s === 'no.' || s === 'id' || s.includes('staff');
    });
    const hasDayNumbers = row.some(cell => {
      const s = String(cell || '').trim();
      return s === '1' || s === '01' || s === 'D1' || s.startsWith('1 ') || s.startsWith('01 ') || s === 'd1';
    });

    if (hasEmpHeader || hasDayNumbers) {
      headerRowIndex = r;
      break;
    }
  }

  if (headerRowIndex >= 0) {
    const headers = rawMatrix[headerRowIndex].map((h, i) => String(h || '').trim() || `_COL_${i}`);
    const rows: any[] = [];
    for (let r = headerRowIndex + 1; r < rawMatrix.length; r++) {
      const rowArr = rawMatrix[r];
      if (!rowArr || rowArr.every(c => String(c || '').trim() === '')) continue;
      const rowObj: Record<string, any> = {};
      headers.forEach((h, colIdx) => {
        rowObj[h] = rowArr[colIdx] !== undefined ? rowArr[colIdx] : '';
      });
      rows.push(rowObj);
    }
    return rows;
  }

  return defaultRows;
}

/**
 * Convert Excel / CSV workbook sheet into array of objects with smart header row detection
 */
export function parseSheetToRows(data: ArrayBuffer): any[] {
  const workbook = XLSX.read(data, { type: 'array' });
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) return [];

  // Determine best worksheet: prefer 'Export', 'Approved_OT', 'OT', 'Employee_Master', 'Employees', 'Data'
  let chosenSheetName = workbook.SheetNames[0];

  const candidateNames = ['Export', 'Approved_OT', 'OT', 'ApprovedOT', 'TimeSheet', 'Employee_Master', 'EmployeeMaster', 'Employees', 'พนักงาน', 'Master', 'Data', 'Sheet1'];
  for (const cand of candidateNames) {
    const found = workbook.SheetNames.find(s => s.trim().toLowerCase() === cand.toLowerCase());
    if (found && workbook.Sheets[found]) {
      chosenSheetName = found;
      break;
    }
  }

  // If still on default sheet and another sheet clearly has OT or employee data columns, inspect all sheets
  if (workbook.SheetNames.length > 1) {
    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      if (!ws) continue;
      const sampleRows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (sampleRows.length > 0 && Array.isArray(sampleRows[0])) {
        const topRowStr = sampleRows[0].map(c => String(c || '').toLowerCase()).join(' ');
        if ((topRowStr.includes('empno') || topRowStr.includes('gid')) &&
            (topRowStr.includes('date') || topRowStr.includes('hours') || topRowStr.includes('rate'))) {
          chosenSheetName = sheetName;
          break;
        }
      }
    }
  }

  // If still on sheet 0 and it looks like instructions while another sheet has employee data, switch
  if (chosenSheetName.toLowerCase().includes('instruction') && workbook.SheetNames.length > 1) {
    const alternative = workbook.SheetNames.find(s => !s.toLowerCase().includes('instruction'));
    if (alternative && workbook.Sheets[alternative]) {
      chosenSheetName = alternative;
    }
  }

  const worksheet = workbook.Sheets[chosenSheetName];
  if (!worksheet) return [];

  return parseWorksheetToRows(worksheet);
}

/**
 * Parse raw CSV or TSV text string into array of row objects
 * Handles quoted fields, escaped quotes, commas, tabs, and multiline values
 */
export function parseCSVTextToRows(csvText: string): any[] {
  if (!csvText || !csvText.trim()) return [];

  // Strip BOM if present
  let cleanText = csvText.replace(/^\uFEFF/, '').trim();
  if (!cleanText) return [];

  // Parse lines considering quotes that span across lines
  const lines: string[] = [];
  let curLine = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    if (char === '"') {
      if (inQuotes && cleanText[i + 1] === '"') {
        curLine += '"';
        i++; // skip next escaped quote
      } else {
        inQuotes = !inQuotes;
        curLine += '"';
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && cleanText[i + 1] === '\n') {
        i++;
      }
      if (curLine.trim().length > 0) {
        lines.push(curLine);
      }
      curLine = '';
    } else {
      curLine += char;
    }
  }
  if (curLine.trim().length > 0) {
    lines.push(curLine);
  }

  if (lines.length === 0) return [];

  // Parse individual line into column tokens
  const parseLine = (line: string, delimiter?: string): string[] => {
    const cols: string[] = [];
    let cur = '';
    let inQ = false;
    // Auto-detect delimiter if not specified: prefer tab if contains tabs, else comma
    const delim = delimiter || (line.includes('\t') && !line.includes(',') ? '\t' : ',');

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (c === delim && !inQ) {
        cols.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    cols.push(cur.trim());
    return cols;
  };

  const headerLine = lines[0];
  const detectedDelim = headerLine.includes('\t') && !headerLine.includes(',') ? '\t' : ',';
  const rawHeaders = parseLine(headerLine, detectedDelim);
  const headers = rawHeaders.map((h, idx) => h.trim().replace(/^["']|["']$/g, '') || `_COL_${idx}`);

  const rows: any[] = [];
  for (let r = 1; r < lines.length; r++) {
    const line = lines[r].trim();
    if (!line) continue;
    const values = parseLine(line, detectedDelim);
    const rowObj: Record<string, any> = {};
    headers.forEach((h, colIdx) => {
      let val = values[colIdx] !== undefined ? values[colIdx] : '';
      // Strip outer quotes
      if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
        val = val.substring(1, val.length - 1).replace(/""/g, '"');
      }
      rowObj[h] = val;
    });
    rows.push(rowObj);
  }

  return rows;
}

/**
 * Flexible department comparison helper (handles BES/PSY, BES/PSY2, BES, PSY, TRW/TRL, TRW-TRL, etc.)
 */
export function isSameDepartment(deptA?: string, deptB?: string): boolean {
  if (!deptA || !deptB) return false;
  const a = deptA.trim().toUpperCase();
  const b = deptB.trim().toUpperCase();
  if (a === b) return true;
  if (a === 'ALL' || b === 'ALL') return true;

  const normalizeDept = (d: string) => d.replace(/[\s\/_\\\-+&()]/g, '').toUpperCase();
  const na = normalizeDept(a);
  const nb = normalizeDept(b);
  if (na && nb && na === nb) return true;

  // Split tokens e.g. "BES/PSY" -> ["BES", "PSY"], "BES/PSY2" -> ["BES", "PSY2"]
  const tokenize = (d: string) => d.toUpperCase().split(/[\s\/_\\\-+&(),.]+/).filter(Boolean);
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  // Common token match (e.g. "BES" in "BES/PSY" and "BES/PSY2" or "PSY" in "PSY" and "BES/PSY")
  const hasCommonToken = tokensA.some(ta => tokensB.some(tb => {
    if (ta === tb) return true;
    const cleanTa = ta.replace(/\d+$/, '');
    const cleanTb = tb.replace(/\d+$/, '');
    return cleanTa && cleanTb && cleanTa === cleanTb && cleanTa.length >= 3;
  }));
  if (hasCommonToken) return true;

  // Handle specific paired aliases
  const pairs: [string, string][] = [
    ['BESPSY', 'BES'], ['BESPSY', 'PSY'],
    ['BESPSY2', 'BES'], ['BESPSY2', 'PSY'],
    ['BESPSY', 'BESPSY2'], ['BESPSY2', 'BESPSY'],
    ['TRWTRL', 'TRW'], ['TRWTRL', 'TRL'], ['TRWTRL', 'TRD'], ['TRWTRL', 'TRWTRD'],
    ['TRWTRD', 'TRW'], ['TRWTRD', 'TRD'], ['TRWTRD', 'TRL'],
    ['ADMCMM', 'ADM'], ['ADMCMM', 'CMM'],
    ['RST', 'RST2'], ['RST2', 'RST'],
  ];

  for (const [p1, p2] of pairs) {
    if ((na === p1 && nb === p2) || (na === p2 && nb === p1)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate whether a GID is real, legitimate, and complete
 * Blacklists placeholders, missing strings, and dummy values like XXX, 000, N/A, etc.
 */
export function isValidGID(gid?: string | null): boolean {
  if (!gid) return false;
  const raw = String(gid).trim();
  if (raw.length < 3) return false; // Real Siemens GID has at least 3 chars (e.g. Z00430UZ, Z00149TH, Z0057PU)

  const upper = raw.toUpperCase();
  const clean = upper.replace(/[\s._\-\/\\#()\[\]]/g, '');

  if (!clean || clean.length < 3) return false;

  const invalidBlacklist = [
    'XXX', 'XXXX', 'XXXXX', 'XXXXXX', 'XXXXXXX', 'XXXXXXXX', 'X', 'XX',
    '000', '0000', '00000', '000000', '0000000', '00000000', '0', '00',
    'NA', 'N/A', 'N.A', 'N.A.', '#N/A', 'N\\A', 'NAN',
    'NONE', 'NULL', 'NIL', 'VOID', 'NO', 'UNKNOWN', 'TBD', 'TBA',
    'TEST', 'DUMMY', 'SAMPLE', 'DEMO', 'TEMP', 'PENDING', 'WAIT',
    'NOGID', 'NO-GID', 'NO_GID', 'NOTSET', 'NOT-SET', 'EMPTY',
    'ไม่มี', 'ไม่ระบุ', 'ว่าง', 'รอระบุ', 'รอ', 'ตัวอย่าง'
  ];

  if (invalidBlacklist.includes(upper) || invalidBlacklist.includes(clean)) {
    return false;
  }

  // Reject placeholder combinations like "XXX 000", "000 N/A", "XXX-000", "N/A (TBD)", "000-000"
  if (/^(XXX|000|NA|N\/A|NULL|NONE|TBD|TEST|DUMMY|SAMPLE)/i.test(upper) && (upper.includes(' ') || upper.includes('-') || upper.includes('_') || upper.includes('/'))) {
    return false;
  }

  // Reject all identical repeated characters (e.g. "---", "???", "...", "999", "ZZZ", "AAA", "111")
  if (/^(.)\1+$/.test(clean) && clean.length <= 8) {
    return false;
  }

  // Reject all zeros or pure non-alphanumeric characters
  if (/^0+$/.test(clean) || /^[^A-Za-z0-9]+$/.test(raw)) {
    return false;
  }

  // Must contain at least one valid alphanumeric character
  if (!/[A-Za-z0-9]/.test(raw)) {
    return false;
  }

  return true;
}

/**
 * Standard Siemens Department Cost Center mapper
 * Returns departmental cost center (e.g., C93021 for RST, C93035 for TEL, C93056 for GM, etc.)
 */
export function getDefaultCostCenterForDepartment(department?: string, existingEmployees: Employee[] = []): string {
  if (!department) return 'C93056';
  const cleanDept = department.trim().toUpperCase();

  // 1. Look up if existing employees in this department have a defined cost center
  const matchedEmp = existingEmployees.find(
    e => e.department && isSameDepartment(e.department, cleanDept) && e.costCenter && e.costCenter.trim() !== ''
  );
  if (matchedEmp && matchedEmp.costCenter.trim()) {
    return matchedEmp.costCenter.trim();
  }

  // 2. Department mapping table
  if (cleanDept.includes('RST') || cleanDept.includes('RS') || cleanDept.includes('WORKSHOP') || cleanDept.includes('DEPOT') || cleanDept.includes('MECH') || cleanDept.includes('ELEC')) {
    return 'C93021';
  }
  if (cleanDept.includes('SIG') || cleanDept.includes('SIGNALLING') || cleanDept.includes('SIGNAL')) {
    return 'C93031';
  }
  if (cleanDept.includes('TEL') || cleanDept.includes('TELECOM')) {
    return 'C93035';
  }
  if (cleanDept.includes('TRW') || cleanDept.includes('TRL') || cleanDept.includes('TRACK') || cleanDept.includes('CIVIL')) {
    return 'C93041';
  }
  if (cleanDept.includes('POW') || cleanDept.includes('POWER') || cleanDept.includes('BES') || cleanDept.includes('PSY') || cleanDept.includes('SUB')) {
    return 'C93051';
  }
  if (cleanDept.includes('STN') || cleanDept.includes('STATION')) {
    return 'C93061';
  }
  if (cleanDept.includes('AFC')) {
    return 'C93065';
  }
  if (cleanDept.includes('GM') || cleanDept.includes('ADM') || cleanDept.includes('QM') || cleanDept.includes('SAF') || cleanDept.includes('SYS')) {
    return 'C93056';
  }

  return 'C93056';
}

export interface ShiftPlanSkippedRow {
  row: number;
  empNo?: string;
  gid?: string;
  name?: string;
  department?: string;
  reason: string;
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
  newShiftCodes?: ShiftCode[];
  newEmployees?: Employee[];
  skippedRows?: ShiftPlanSkippedRow[];
  skippedCount?: number;
}

/**
 * Clean and normalize employee name (stripping Thai/English honorific titles and multiple spaces)
 */
export function cleanEmployeeName(nameStr: string): string {
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
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Split raw name into first name and family name cleanly
 */
export function parseEmployeeNameParts(rawName: string): { firstName: string; familyName: string } {
  if (!rawName) return { firstName: 'Staff', familyName: '-' };
  const cleaned = cleanEmployeeName(rawName);
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: 'Staff', familyName: '-' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], familyName: '-' };
  }
  return { firstName: parts[0], familyName: parts.slice(1).join(' ') };
}

/**
 * Robustly checks if a single identifier string (which may be Emp No, Emp Code, or GID) matches an employee.
 * User requirement: "Emp No ที่ใช้ Mapping อาจจะเป็น Emp Code หรือ GID ก็ได้แต่จะมี 1 ค่าเท่านั้นที่ User อาจจะเพิ่มเอง"
 */
export function isEmployeeIdentifierMatch(
  identifier: string,
  e: Employee
): boolean {
  if (!identifier || !e) return false;
  const rawId = String(identifier).trim().toLowerCase();
  if (!rawId) return false;
  const cleanId = rawId.replace(/[^a-z0-9]/gi, '');

  const eNoRaw = (e.empNo || '').trim().toLowerCase();
  const eNoClean = eNoRaw.replace(/[^a-z0-9]/gi, '');

  const eCodeRaw = (e.empCode || '').trim().toLowerCase();
  const eCodeClean = eCodeRaw.replace(/[^a-z0-9]/gi, '');

  const gidRaw = (e.gid || '').trim().toLowerCase();
  const gidClean = gidRaw.replace(/[^a-z0-9]/gi, '');

  // 1. Direct equality with empNo, empCode, or GID
  if (rawId === eNoRaw || rawId === eCodeRaw || rawId === gidRaw) return true;
  if (cleanId && (cleanId === eNoClean || cleanId === eCodeClean || cleanId === gidClean)) return true;

  // 2. GID match (case-insensitive & clean alphanumeric, e.g. "Z00430UZ", "z00430uz", "Z-00430UZ")
  if (gidClean && cleanId && (cleanId === gidClean || gidClean === cleanId)) return true;

  // 3. Digits extraction for numeric EmpNo and EmpCode
  const idDigits = rawId.replace(/\D/g, '');
  const idNum = idDigits.replace(/^0+/, ''); // strip leading zeros

  const eNoDigits = eNoRaw.replace(/\D/g, '');
  const eNoNum = eNoDigits.replace(/^0+/, '');

  const eCodeDigits = eCodeRaw.replace(/\D/g, '');
  const eCodeNum = eCodeDigits.replace(/^0+/, '');

  if (idNum) {
    // Numeric equality with empNo (handles leading zeros e.g. "0950" == "950")
    if (eNoNum && idNum === eNoNum) return true;
    // Numeric equality with empCode
    if (eCodeNum && idNum === eCodeNum) return true;
    // 4-digit padded matching
    if (eNoDigits && idDigits.padStart(4, '0') === eNoDigits.padStart(4, '0')) return true;

    // Cross-match 8-digit Payroll EmpCode (e.g. "10000950" or "65090950") with short EmpNo (e.g. "0950" or "950")
    if (idDigits.length >= 7 && (idDigits.startsWith('1000') || idDigits.startsWith('6509') || idDigits.startsWith('650'))) {
      const subDigits = idDigits.replace(/^(10000|1000|6509|650)/, '').replace(/^0+/, '');
      if (subDigits && eNoNum && subDigits === eNoNum) return true;
      if (subDigits && eCodeNum && subDigits === eCodeNum) return true;
    }
    if (eCodeDigits.length >= 7 && (eCodeDigits.startsWith('1000') || eCodeDigits.startsWith('6509') || eCodeDigits.startsWith('650'))) {
      const subDigits = eCodeDigits.replace(/^(10000|1000|6509|650)/, '').replace(/^0+/, '');
      if (subDigits && idNum && subDigits === idNum) return true;
    }

    // Check if GID digits match (e.g. GID "Z000950TH" or "Z0149TH" has digits "0950" / "950")
    if (gidRaw) {
      const gidDigits = gidRaw.replace(/\D/g, '').replace(/^0+/, '');
      if (gidDigits && (idNum === gidDigits || (idDigits.length >= 4 && gidDigits.endsWith(idDigits)))) return true;
    }
  }

  return false;
}

/**
 * Helper to match an employee from database using Name, EmpNo, or GID.
 * Priority: ใช้รหัสเดี่ยวที่ผู้ใช้ระบุ (อาจเป็น Emp No, Emp Code หรือ GID) เป็นหลักในการ Mapping
 */
function matchEmployeeFromDatabase(
  rawName: string,
  rawEmpNo: string,
  rawGid: string,
  deptEmployees: Employee[],
  allEmployees: Employee[]
): { employee?: Employee; foreignEmployee?: Employee } {
  let primaryId = (rawEmpNo || rawGid || '').trim();
  let normName = rawName.replace(/\s+/g, ' ').trim().toLowerCase();
  let cleanName = cleanEmployeeName(rawName);

  // If primaryId is empty, check if rawName contains embedded EmpNo or GID
  if (!primaryId && rawName) {
    const trimmed = rawName.trim();
    // 1. Pure numbers e.g. "0950" or "10000950"
    if (/^\d{2,8}$/.test(trimmed)) {
      primaryId = trimmed;
    } else {
      // 2. Prefix format: "0950 Napassawan" or "0950 - นภัสวรรณ"
      const prefixMatch = trimmed.match(/^(\d{2,8})\s*[-:_\/]?\s+(.*)$/);
      if (prefixMatch) {
        primaryId = prefixMatch[1];
        normName = prefixMatch[2].replace(/\s+/g, ' ').trim().toLowerCase();
        cleanName = cleanEmployeeName(prefixMatch[2]);
      } else {
        // 3. Parenthesis format: "Napassawan (0950)"
        const parenMatch = trimmed.match(/^(.*?)\s*[\(\[](\d{2,8})[\)\]]$/);
        if (parenMatch) {
          primaryId = parenMatch[2];
          normName = parenMatch[1].replace(/\s+/g, ' ').trim().toLowerCase();
          cleanName = cleanEmployeeName(parenMatch[1]);
        }
      }

      // 4. Check for GID format e.g. "Z00430UZ Napassawan"
      const gidMatch = trimmed.match(/\b([A-Z]\d{4,}[A-Z0-9]*)\b/i);
      if (gidMatch) {
        primaryId = gidMatch[1];
      }
    }
  }

  // 1. PRIMARY RULE: Match by single identifier (Emp No, Emp Code, or GID)
  // Check target department first, then across all departments
  if (primaryId) {
    const deptMatch = deptEmployees.find(e => isEmployeeIdentifierMatch(primaryId, e));
    if (deptMatch) return { employee: deptMatch };

    const foreignMatch = allEmployees.find(e => isEmployeeIdentifierMatch(primaryId, e));
    if (foreignMatch) return { foreignEmployee: foreignMatch };
  }

  // 3. Try matching by Name (ทั้งแบบมีนามสกุล หรือมีเฉพาะชื่อต้น)
  if (normName || cleanName) {
    const isFullNameMatch = (e: Employee) => {
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
      if (cleanLegacy && normName.replace(/\s+/g, '') === cleanLegacy.replace(/\s+/g, '')) return true;
      if (noSpace1 && normName.replace(/\s+/g, '') === noSpace1) return true;

      return false;
    };

    // A. Full name match in department
    const deptFullMatch = deptEmployees.find(isFullNameMatch);
    if (deptFullMatch) return { employee: deptFullMatch };

    // B. First name only match within department (กรณีบางแผนกไม่ระบุนามสกุลในไฟล์ Excel)
    const deptFirstMatches = deptEmployees.filter(e => {
      const fn = (e.firstName || '').trim().toLowerCase();
      const cleanFn = cleanEmployeeName(e.firstName || '');
      return (fn && (normName === fn || cleanName === cleanFn)) ||
             (cleanFn && (cleanName.startsWith(cleanFn) || cleanFn.startsWith(cleanName)));
    });
    if (deptFirstMatches.length === 1) {
      return { employee: deptFirstMatches[0] };
    }

    // C. Search across all departments (to detect foreign department mismatch)
    const foreignFullMatch = allEmployees.find(isFullNameMatch);
    if (foreignFullMatch) return { foreignEmployee: foreignFullMatch };

    const foreignFirstMatches = allEmployees.filter(e => {
      const fn = (e.firstName || '').trim().toLowerCase();
      const cleanFn = cleanEmployeeName(e.firstName || '');
      return fn && (normName === fn || cleanName === cleanFn);
    });
    if (foreignFirstMatches.length === 1) {
      return { foreignEmployee: foreignFirstMatches[0] };
    }
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
  const skippedRows: ShiftPlanSkippedRow[] = [];

  if (!rawRows || rawRows.length === 0) {
    return {
      valid: false,
      errors: ['ไฟล์ว่างเปล่าหรือไม่พบข้อมูลในตาราง'],
      warnings: [],
      plans: [],
      matchedEmployeesCount: 0,
      totalRows: 0,
      skippedRows: [],
      skippedCount: 0,
    };
  }

  const validShiftCodeSet = new Set(registeredShiftCodes.map(sc => sc.code.toUpperCase()));
  // Also common off days
  validShiftCodeSet.add('OFF');
  validShiftCodeSet.add('H');

  const KNOWN_NON_WORKING_OR_LEAVE_CODES = new Set([
    'OFF', 'H', 'AL', 'SL', 'ML', 'PL', 'BL', 'CL', 'UL', 'PH', 'WFH', 'TR'
  ]);

  const newShiftCodesMap = new Map<string, ShiftCode>();
  const newlyAddedNotices = new Set<string>();
  const newEmployeesMap = new Map<string, Employee>();

  // Working lists of employees (mutable during parsing so newly auto-added employees match on subsequent rows)
  const allEmployeesWorkList = [...employees];
  const deptEmployeesWorkList = selectedDepartment === 'ALL' 
    ? [...employees] 
    : employees.filter(e => isSameDepartment(e.department, selectedDepartment));

  const isCodeValid = (c: string) => {
    if (validShiftCodeSet.has(c)) return true;
    if (KNOWN_NON_WORKING_OR_LEAVE_CODES.has(c)) return true;
    const base = c.replace(/-X/gi, '').replace(/-ET/gi, '').trim();
    if (validShiftCodeSet.has(base)) return true;
    if (KNOWN_NON_WORKING_OR_LEAVE_CODES.has(base)) return true;
    if (base.startsWith('A') && base.length > 1 && validShiftCodeSet.has(base.slice(1))) return true;
    return false;
  };

  /**
   * Rule: บางครั้งอาจจะมี Shift Code ที่ยังไม่มีมาในระบบให้เพิ่มเข้าไปใน Shift Code ของแผนกนั้นเป็นเวลาทำงานปกติ
   * โดยใส่ค่าเริ่มต้นเวลาเป็น 08:00 - 17:00 พร้อมแจ้งให้ทำการตรวจสอบเวลาของ shift Code ใหม่ที่เพิ่มเข้ามา
   */
  const ensureShiftCodeRegistered = (c: string, employee: Employee, rawDept?: string) => {
    if (!c || c === 'OFF') return;
    if (isCodeValid(c)) return;

    // Clean code: remove bracketed notes or qualifiers
    const cleanC = c.replace(/\(.*\)/g, '').replace(/-X/gi, '').replace(/-ET/gi, '').replace(/[*_]/g, '').trim().toUpperCase();
    const codeToAdd = cleanC || c.trim().toUpperCase();
    if (!codeToAdd || KNOWN_NON_WORKING_OR_LEAVE_CODES.has(codeToAdd)) return;

    const shiftDept = (selectedDepartment && selectedDepartment !== 'ALL') 
      ? selectedDepartment 
      : ((rawDept && rawDept.trim().toUpperCase()) || employee.department || 'ALL');

    const mapKey = `${codeToAdd}_${shiftDept.trim().toUpperCase()}`;

    const isNightCode = /^(N|AN)/i.test(codeToAdd) || /NIGHT/i.test(codeToAdd) || /ดึก/i.test(codeToAdd);
    const defaultStartTime = isNightCode ? (codeToAdd === 'N1' ? '22:00' : codeToAdd === 'N2' ? '23:00' : '20:00') : '08:00';
    const defaultEndTime = isNightCode ? (codeToAdd === 'N1' ? '06:30' : codeToAdd === 'N2' ? '07:30' : '05:00') : '17:00';
    const defaultColor = isNightCode ? '#6366f1' : getShiftCategoryColor(codeToAdd, '#0d9488');

    if (!newShiftCodesMap.has(mapKey)) {
      const newShiftObj: ShiftCode = {
        code: codeToAdd,
        department: shiftDept,
        name: `${codeToAdd} (${shiftDept})`,
        startTime: defaultStartTime,
        endTime: defaultEndTime,
        breakMinutes: 60,
        workingHours: 8,
        isWorkingDay: true,
        color: defaultColor,
        description: `เพิ่มอัตโนมัติจากไฟล์ Shift Plan แผนก ${shiftDept} (${isNightCode ? 'กะดึกข้ามคืน' : 'เวลาทำงานปกติ'} ${defaultStartTime} - ${defaultEndTime} โปรดตรวจสอบเวลาทำงาน)`,
      };
      newShiftCodesMap.set(mapKey, newShiftObj);
      validShiftCodeSet.add(codeToAdd);
    }

    if (!newlyAddedNotices.has(mapKey)) {
      newlyAddedNotices.add(mapKey);
      warnings.push(
        `ตรวจพบ Shift Code ใหม่ "${codeToAdd}" ของแผนก ${shiftDept}: ระบบได้เพิ่มเข้ารหัสกะของแผนกโดยตั้งค่าเวลาเริ่มต้นเป็น ${defaultStartTime} - ${defaultEndTime} ${isNightCode ? '(กะดึกข้ามคืน)' : '(เวลาทำงานปกติ)'} ให้เรียบร้อยแล้ว — กรุณาทำการตรวจสอบหรือปรับเปลี่ยนเวลาเข้า-ออกงานของ Shift Code ใหม่นี้ให้ตรงตามจริง`
      );
    }
  };

  const matchedEmpSet = new Set<string>();

  // Helper to extract value from multiple possible column keys (case-insensitive & trimmed)
  const getRowVal = (row: any, keys: string[]): string => {
    for (const k of keys) {
      if (row[k] !== undefined && String(row[k]).trim() !== '') {
        return String(row[k]).trim();
      }
    }
    const allRowKeys = Object.keys(row);
    for (const rk of allRowKeys) {
      const cleanRk = rk.trim().toLowerCase().replace(/[\s._-]/g, '');
      for (const k of keys) {
        if (cleanRk === k.trim().toLowerCase().replace(/[\s._-]/g, '')) {
          if (row[rk] !== undefined && String(row[rk]).trim() !== '') {
            return String(row[rk]).trim();
          }
        }
      }
    }
    return '';
  };

  // Helper to find day column value from any possible header naming style
  const extractDayVal = (row: any, dayNum: number, monthYear: string): string | undefined => {
    const dStr = String(dayNum);
    const dPad = dStr.padStart(2, '0');
    const [yStr, mStr] = monthYear.split('-');
    const mNum = parseInt(mStr, 10);
    const fullDateDash = `${monthYear}-${dPad}`;
    const fullDateSlash = `${monthYear}/${dPad}`;

    const keys = Object.keys(row);

    // 1. Direct key match
    const primaryMatches = [
      dStr, dPad, `D${dayNum}`, `d${dayNum}`, `Day${dayNum}`, `Day ${dayNum}`, `day_${dayNum}`,
      `วันที่ ${dayNum}`, `วันที่ ${dPad}`, `วันที่${dayNum}`,
      fullDateDash, fullDateSlash,
      `${dPad}/${mStr}/${yStr}`, `${dStr}/${mStr}/${yStr}`, `${dPad}-${mStr}-${yStr}`,
    ];
    for (const pm of primaryMatches) {
      if (row[pm] !== undefined && row[pm] !== null && String(row[pm]).trim() !== '') {
        return String(row[pm]).trim();
      }
    }

    // 2. Pattern scan across all row keys
    for (const k of keys) {
      const tk = k.trim();
      if (!tk) continue;
      const lower = tk.toLowerCase();

      // Skip non-day identity columns
      if (lower.includes('empno') || lower.includes('employee') || lower.includes('name') ||
          lower.includes('ชื่อ') || lower.includes('รหัส') || lower.includes('gid') ||
          lower.includes('function') || lower.includes('position') || lower.includes('ตำแหน่ง') ||
          lower === 'code' || lower === 'dept' || lower === 'department' || lower === 'section' || lower === 'costcenter') {
        continue;
      }

      // Check if key starts with day number (e.g. "1 Fri", "01 (Fri)", "1 (ศ.)", "01_Fri", "1-Fri")
      const startNumMatch = tk.match(/^(\d{1,2})[\s\(\/_\-\.,]/);
      if (startNumMatch && parseInt(startNumMatch[1], 10) === dayNum) {
        if (row[k] !== undefined && row[k] !== null) {
          return String(row[k]).trim();
        }
      }

      // Check if key contains date suffix like "-01" or "/01"
      if (tk.endsWith(`-${dPad}`) || tk.endsWith(`/${dPad}`) || tk.endsWith(`-${dStr}`) || tk.endsWith(`/${dStr}`)) {
        if (row[k] !== undefined && row[k] !== null) {
          return String(row[k]).trim();
        }
      }

      // Check exact number key
      if (tk === dStr || tk === dPad) {
        if (row[k] !== undefined && row[k] !== null) {
          return String(row[k]).trim();
        }
      }
    }

    return undefined;
  };

  // Check rows: Can be wide format (Name, Department, 01, 02... 31) OR long format (Name, Date, ShiftCode)
  rawRows.forEach((row, idx) => {
    const rowNum = idx + 2;

    // Extract identifiers from row with flexible Siemens header patterns
    let rawEmpNo = getRowVal(row, [
      'EmpNo', 'Emp No', 'Emp No.', 'Emp.No', 'Emp. No', 'Emp. No.', 'Employee No', 'Employee No.', 'EmployeeNo',
      'Employee_No', 'Emp_No', 'EmpCode', 'Emp Code', 'Emp Code.', 'Employee Code', 'EmployeeCode', 'Employee_Code',
      'Staff No', 'Staff No.', 'Staff ID', 'StaffCode', 'Staff Code',
      'Personnel No', 'Personnel No.', 'Personnel Number', 'Person No',
      'Code', 'code', 'empNo', 'emp_no', 'emp_code', 'รหัสพนักงาน', 'รหัส', 'รหัส พนักงาน', 'รหัสประจำตัว',
      'No.', 'No', 'No .', 'ID', 'Employee ID', 'Emp ID', 'Emp_ID'
    ]);
    if (rawEmpNo) {
      rawEmpNo = rawEmpNo.trim().replace(/\.0+$/, '');
    }

    let rawGid = getRowVal(row, [
      'GID', 'gid', 'Gid', 'Global ID', 'GlobalID', 'รหัส GID', 'รหัสGID'
    ]);

    const rawName = getRowVal(row, [
      'Name', 'name', 'Employee Name', 'EmployeeName', 'Employee', 
      'ชื่อ-นามสกุล', 'ชื่อพนักงาน', 'ชื่อ', 'Firstname', 'First Name', 'First_Name'
    ]);

    const rawDept = getRowVal(row, [
      'Department', 'department', 'Dept', 'dept', 'แผนก', 'Section', 'section', 'CostCenter', 'Cost Center'
    ]);

    const rawFunction = getRowVal(row, [
      'Function', 'function', 'Position', 'position', 'ตำแหน่ง', 'Job Title', 'JobTitle', 'Title', 'title', 'FunctionTitle', 'Function Title'
    ]);

    const rawCostCenter = getRowVal(row, [
      'CostCenter', 'Cost Center', 'Cost_Center', 'costcenter', 'cost center', 'Cost centre', 'CostCentre'
    ]);

    // Smart fallback: if rawEmpNo and rawGid were not found by key, inspect first 3 columns for digits or GID
    if (!rawEmpNo && !rawGid) {
      const keys = Object.keys(row);
      for (const k of keys.slice(0, 3)) {
        const val = String(row[k] || '').trim().replace(/\.0+$/, '');
        if (/^\d{1,8}$/.test(val)) {
          rawEmpNo = val;
          break;
        } else if (/^[A-Z]\d{4,}[A-Z0-9]*$/i.test(val) || isValidGID(val)) {
          rawGid = val;
          break;
        }
      }
    }

    // Skip totally empty row
    if (!rawName && !rawEmpNo && !rawGid) {
      return;
    }

    // Match employee against Employee Database (Emp No / GID / Name)
    const { employee: matchedDeptEmp, foreignEmployee } = matchEmployeeFromDatabase(
      rawName,
      rawEmpNo,
      rawGid,
      deptEmployeesWorkList,
      allEmployeesWorkList
    );

    // Rule: "การอัปโหลด Shift Plan ผิดแผนกจะต้องดำเนินการไม่ได้เด็ดขาด"
    if (selectedDepartment !== 'ALL') {
      if (rawDept && rawDept.trim() && !isSameDepartment(rawDept, selectedDepartment)) {
        errors.push(
          `แถวที่ ${rowNum}: อัปโหลดผิดแผนก — พนักงาน "${rawName || rawEmpNo || 'ไม่ระบุชื่อ'}" ระบุแผนก "${rawDept}" ซึ่งไม่ตรงกับแผนกเป้าหมายที่เลือก (${selectedDepartment})`
        );
        return;
      }
      if (foreignEmployee && foreignEmployee.department && !isSameDepartment(foreignEmployee.department, selectedDepartment)) {
        errors.push(
          `แถวที่ ${rowNum}: อัปโหลดผิดแผนก — พนักงาน "${foreignEmployee.firstName} ${foreignEmployee.familyName}" (รหัส ${foreignEmployee.empNo}) สังกัดแผนก "${foreignEmployee.department}" ในระบบ ซึ่งไม่ตรงกับแผนกเป้าหมายที่เลือก (${selectedDepartment})`
        );
        return;
      }
    }

    let employee: Employee;

    if (matchedDeptEmp) {
      employee = matchedDeptEmp;

      // Auto-assign Function & Cost Center if missing
      let empModified = false;
      if (!employee.functionTitle || employee.functionTitle.trim() === '' || employee.functionTitle === '-') {
        employee.functionTitle = (rawFunction && rawFunction.trim()) ? rawFunction.trim() : 'Service Technician';
        empModified = true;
      } else if (rawFunction && rawFunction.trim() && rawFunction.trim() !== employee.functionTitle) {
        employee.functionTitle = rawFunction.trim();
        empModified = true;
      }

      if (!employee.costCenter || employee.costCenter.trim() === '' || employee.costCenter === '-') {
        employee.costCenter = (rawCostCenter && rawCostCenter.trim())
          ? rawCostCenter.trim()
          : getDefaultCostCenterForDepartment(employee.department, allEmployeesWorkList);
        empModified = true;
      } else if (rawCostCenter && rawCostCenter.trim() && rawCostCenter.trim() !== employee.costCenter) {
        employee.costCenter = rawCostCenter.trim();
        empModified = true;
      }

      if (rawGid && isValidGID(rawGid) && rawGid.trim().toUpperCase() !== (employee.gid || '').trim().toUpperCase()) {
        employee.gid = rawGid.trim().toUpperCase();
        empModified = true;
      }

      // If template row specifies a department or target department differs (within same department family)
      if (rawDept && rawDept.trim() && isSameDepartment(rawDept, employee.department) && rawDept.trim().toUpperCase() !== employee.department.toUpperCase()) {
        employee.department = rawDept.trim().toUpperCase();
        empModified = true;
      }

      if (empModified) {
        employee.updatedAt = new Date().toISOString();
        newEmployeesMap.set(employee.empNo, employee);
      }
    } else if (foreignEmployee) {
      if (selectedDepartment !== 'ALL' && !isSameDepartment(foreignEmployee.department, selectedDepartment)) {
        errors.push(
          `แถวที่ ${rowNum}: อัปโหลดผิดแผนก — พนักงาน "${foreignEmployee.firstName} ${foreignEmployee.familyName}" สังกัดแผนก "${foreignEmployee.department}" ไม่สามารถอัปโหลดเข้าสู่แผนก "${selectedDepartment}" ได้`
        );
        return;
      }
      employee = foreignEmployee;
    } else {
      // New Employee in Shift Plan (User added a new employee with a single identifier)
      // "Emp No ที่ใช้ Mapping อาจจะเป็น Emp Code หรือ GID ก็ได้แต่จะมี 1 ค่าเท่านั้นที่ User อาจจะเพิ่มเอง"
      let inputId = (rawEmpNo || rawGid || '').trim().replace(/\.0+$/, '');
      if (!inputId && rawName && rawName.trim()) {
        const cleanDeptPrefix = (rawDept || selectedDepartment || 'EMP').replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || 'EMP';
        inputId = `${cleanDeptPrefix}${String(rowNum).padStart(3, '0')}`;
      }

      if (!inputId) {
        const invalidIdDisplay = 'ไม่ได้ระบุรหัสพนักงาน (Emp No / Emp Code / GID)';
        skippedRows.push({
          row: rowNum,
          empNo: '(ไม่มี)',
          gid: '(ว่าง)',
          name: rawName || `พนักงานแถวที่ ${rowNum}`,
          department: rawDept || selectedDepartment,
          reason: `พนักงานใหม่ไม่มีรหัสสำหรับใช้ Mapping (${invalidIdDisplay}) — กรุณาระบุรหัสพนักงาน (Emp No / Emp Code / GID)`,
        });
        warnings.push(
          `แถวที่ ${rowNum}: ข้ามการนำเข้าพนักงานใหม่ "${rawName || `แถวที่ ${rowNum}`}" เนื่องจากไม่มีรหัสระบุตัวตนสำหรับ Mapping`
        );
        return; // Reject and skip this row
      }

      // Determine whether inputId is GID, 8-digit Payroll EmpCode, or short EmpNo
      let finalEmpNo = inputId;
      let finalEmpCode = inputId;
      let finalGid = inputId;

      const isGidPattern = /^[A-Z]\d{4,}[A-Z0-9]*$/i.test(inputId) || isValidGID(inputId);
      const isEightDigitCode = /^\d{8}$/.test(inputId);
      const isDigitsOnly = /^\d+$/.test(inputId);

      if (isGidPattern) {
        // 1. Single value is a GID (e.g. "Z00430UZ", "Z00999TH")
        finalGid = inputId.toUpperCase();
        const digits = inputId.replace(/\D/g, '');
        finalEmpNo = digits ? digits.slice(-4).padStart(4, '0') : inputId;
        finalEmpCode = digits ? `1000${finalEmpNo.padStart(4, '0')}` : inputId;
      } else if (isEightDigitCode) {
        // 2. Single value is 8-digit Payroll Emp Code (e.g. "10000950", "10001234")
        finalEmpCode = inputId;
        finalEmpNo = inputId.slice(-4);
        finalGid = `Z${finalEmpNo}TH`;
      } else if (isDigitsOnly) {
        // 3. Single value is short Emp No (e.g. "0950", "950", "503", "82", "1442")
        finalEmpNo = inputId.length <= 4 ? inputId.padStart(4, '0') : inputId;
        finalEmpCode = `1000${finalEmpNo.padStart(4, '0')}`;
        finalGid = `Z${finalEmpNo.padStart(4, '0')}TH`;
      } else {
        // 4. Other code
        finalGid = `Z${inputId.toUpperCase()}TH`;
        finalEmpCode = inputId;
        finalEmpNo = inputId;
      }

      const { firstName, familyName } = parseEmployeeNameParts(rawName || `พนักงาน ${finalEmpNo}`);
      const deptToUse = (rawDept && rawDept.trim().toUpperCase()) || (selectedDepartment !== 'ALL' ? selectedDepartment : 'GM');

      if (selectedDepartment !== 'ALL' && !isSameDepartment(deptToUse, selectedDepartment)) {
        errors.push(
          `แถวที่ ${rowNum}: อัปโหลดผิดแผนก — พนักงานใหม่ "${firstName} ${familyName}" ระบุแผนก "${deptToUse}" ไม่ตรงกับแผนกที่เลือก (${selectedDepartment})`
        );
        return;
      }

      // Auto-assign Function: default to 'Service Technician' if not provided in template
      const functionToUse = (rawFunction && rawFunction.trim()) ? rawFunction.trim() : 'Service Technician';

      // Auto-assign Cost Center: map according to department
      const costCenterToUse = (rawCostCenter && rawCostCenter.trim()) 
        ? rawCostCenter.trim() 
        : getDefaultCostCenterForDepartment(deptToUse, allEmployeesWorkList);

      const newEmp: Employee = {
        id: `emp-${finalEmpNo}-${Date.now()}`,
        empNo: finalEmpNo,
        empCode: finalEmpCode,
        gid: finalGid,
        firstName,
        familyName,
        department: deptToUse,
        division: 'MO CS BTS',
        functionTitle: functionToUse,
        costCenter: costCenterToUse,
        isShiftWorker: true,
        isActive: true,
        updatedAt: new Date().toISOString(),
      };

      newEmployeesMap.set(finalEmpNo, newEmp);
      if (inputId.toUpperCase() !== finalEmpNo.toUpperCase()) {
        newEmployeesMap.set(inputId.toUpperCase(), newEmp);
      }
      const rawNumStr = inputId.replace(/^0+/, '');
      if (rawNumStr) {
        newEmployeesMap.set(rawNumStr, newEmp);
      }
      allEmployeesWorkList.push(newEmp);
      if (isSameDepartment(deptToUse, selectedDepartment) || selectedDepartment === 'ALL') {
        deptEmployeesWorkList.push(newEmp);
      }

      employee = newEmp;

      warnings.push(
        `แถวที่ ${rowNum}: เพิ่มพนักงานใหม่ "${firstName} ${familyName}" (Emp No: ${finalEmpNo}, Emp Code: ${finalEmpCode}, GID: ${finalGid}, แผนก: ${deptToUse}) เข้าสู่ระบบอัตโนมัติจากรหัสที่ระบุ (${inputId})`
      );
    }

    matchedEmpSet.add(employee.empNo);

    // Target department for parsed shift plans: Priority is row's own department in the file
    const targetDeptForPlan = (rawDept && rawDept.trim())
      ? rawDept.trim().toUpperCase()
      : ((selectedDepartment && selectedDepartment !== 'ALL') ? selectedDepartment : (employee.department || 'GM'));

    // Format A: Wide format with Day columns 1 to 31 (e.g. "1", "2", "3" ... or "01", "02")
    const daysInMonth = new Date(
      parseInt(selectedMonthYear.split('-')[0]),
      parseInt(selectedMonthYear.split('-')[1]),
      0
    ).getDate();

    let hasDayColumns = false;
    // Check if wide format day column headers exist in this row
    for (let d = 1; d <= Math.min(daysInMonth, 7); d++) {
      if (extractDayVal(row, d, selectedMonthYear) !== undefined) {
        hasDayColumns = true;
        break;
      }
    }

    if (hasDayColumns) {
      for (let d = 1; d <= daysInMonth; d++) {
        const rawVal = extractDayVal(row, d, selectedMonthYear);
        const trimmed = String(rawVal ?? '').trim().toUpperCase();
        // Rule: Empty or blank cell is treated as OFF (Day Off)
        const code = trimmed === '' ? 'OFF' : trimmed.replace(/\(.*\)/g, '').replace(/[*_]/g, '').trim();

        // Ensure Shift Code exists or auto-add as normal working shift 08:00 - 17:00
        ensureShiftCodeRegistered(code, employee, rawDept);

        const dateStr = `${selectedMonthYear}-${String(d).padStart(2, '0')}`;
        parsedPlans.push({
          id: `plan-${employee.empNo}-${dateStr}-${Date.now()}`,
          empNo: employee.empNo, // Auto-pulled from Employee Database
          gid: employee.gid,     // Auto-pulled from Employee Database
          date: dateStr,
          shiftCode: code,
          department: targetDeptForPlan,
          updatedBy: currentUserEmail,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Format B: Long format with 'Date' and 'ShiftCode'
    if (!hasDayColumns && (row['Date'] || row['date'])) {
      const dateVal = String(row['Date'] || row['date']).trim();
      const codeVal = String(row['ShiftCode'] || row['Shift Code'] || row['shiftCode'] || 'OFF').trim().toUpperCase().replace(/\(.*\)/g, '').trim();

      // Ensure date matches selected monthYear
      if (!dateVal.startsWith(selectedMonthYear)) {
        errors.push(
          `แถวที่ ${rowNum}: วันที่ "${dateVal}" ไม่ตรงกับเดือน-ปี ที่เลือก (${selectedMonthYear})`
        );
        return;
      }

      // Ensure Shift Code exists or auto-add as normal working shift 08:00 - 17:00
      ensureShiftCodeRegistered(codeVal, employee, rawDept);

      parsedPlans.push({
        id: `plan-${employee.empNo}-${dateVal}-${Date.now()}`,
        empNo: employee.empNo, // Auto-pulled from Employee Database
        gid: employee.gid,     // Auto-pulled from Employee Database
        date: dateVal,
        shiftCode: codeVal,
        department: targetDeptForPlan,
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
    newShiftCodes: Array.from(newShiftCodesMap.values()),
    newEmployees: Array.from(new Map(Array.from(newEmployeesMap.values()).map(e => [e.empNo, e])).values()),
    skippedRows,
    skippedCount: skippedRows.length,
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
    const rawStartTime = row['StartTime'] || row['Start Time'] || row['In'];
    const rawEndTime = row['EndTime'] || row['End Time'] || row['Out'];
    const startTime = !isWorking 
      ? (normalizeShiftTimeString(rawStartTime) || '00:00') 
      : (normalizeShiftTimeString(rawStartTime) || '08:00');
    const endTime = !isWorking 
      ? (normalizeShiftTimeString(rawEndTime) || '00:00') 
      : (normalizeShiftTimeString(rawEndTime) || '17:00');
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
  currentMonthYear: string, // e.g. "2026-04"
  selectedRate?: 1.5 | 3.0,
  forceToTargetMonth: boolean = true
): OTParseResult {
  const records: OTRecord[] = [];
  const warnings: string[] = [];
  let retroactiveCount = 0;
  const fileDateFormat = detectFileDateFormat(rawRows);

  rawRows.forEach((row, idx) => {
    const rowKeys = Object.keys(row || {});

    // Helper to safely get string value with case-insensitive and whitespace-flexible matching
    const getVal = (keys: string[]) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
          return String(row[k]).trim();
        }
      }
      for (const k of keys) {
        const target = k.trim().toLowerCase();
        const matched = rowKeys.find(rk => rk.trim().toLowerCase() === target);
        if (matched && row[matched] !== undefined && row[matched] !== null && String(row[matched]).trim() !== '') {
          return String(row[matched]).trim();
        }
      }
      return '';
    };

    // Helper to safely get numeric value with case-insensitive and whitespace-flexible matching
    const getNum = (keys: string[]): number => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null) {
          const num = Number(row[k]);
          if (!isNaN(num) && num > 0) return num;
        }
      }
      for (const k of keys) {
        const target = k.trim().toLowerCase();
        const matched = rowKeys.find(rk => rk.trim().toLowerCase() === target);
        if (matched && row[matched] !== undefined && row[matched] !== null) {
          const num = Number(row[matched]);
          if (!isNaN(num) && num > 0) return num;
        }
      }
      return 0;
    };

    // Flexible column headers for Power BI, Excel (.xlsx Export), and CSV exports
    const empNo = getVal([
      'EmpNo', 'Emp No', 'Employee No', 'EmployeeNo',
      'Staff ID', 'Employee ID', 'EmpID', 'Code', 'รหัสพนักงาน', 'รหัส', 'Emp_No'
    ]);

    const gid = getVal([
      'GID', 'gid', 'Global ID', 'GlobalID', 'Gid', 'Global_ID'
    ]);

    const rawDate = getVal([
      'Date', 'OT Date', 'OTDate', 'Work Date', 'WorkDate', 'วันที่', 'วันที่ทำโอที', 'OT_Date', 'Work_Date'
    ]);

    let originalDateParsed = normalizeOTDate(rawDate, fileDateFormat, currentMonthYear);
    if (!originalDateParsed && currentMonthYear && /^\d{4}-\d{2}$/.test(currentMonthYear)) {
      originalDateParsed = `${currentMonthYear}-01`;
    }

    const hours = getNum([
      'Hours', 'OT Hours', 'OTHours', 'Duration', 'OT_Hours',
      'Total Hours', 'จำนวนชั่วโมง', 'ชั่วโมง', 'OT Hour', 'OT', 'Hour'
    ]);

    // Resolve Rate from row if present, or use Admin selection
    const rawRateStr = getVal(['Rate', 'OT Rate', 'OTRate', 'OT_Rate', 'ประเภท OT', 'ประเภท', 'Type']);
    let fileRate: 1.5 | 3.0 | undefined = undefined;
    if (/3(\.0)?/i.test(rawRateStr)) {
      fileRate = 3.0;
    } else if (/1\.5/i.test(rawRateStr)) {
      fileRate = 1.5;
    }

    const resolvedRate: 1.5 | 3.0 = fileRate !== undefined ? fileRate : (selectedRate ? selectedRate : 1.5);

    const rawStartTime = getVal(['StartTime', 'Start Time', 'Start', 'เวลาเริ่ม', 'Start_Time']);
    const rawEndTime = getVal(['EndTime', 'End Time', 'End', 'เวลาสิ้นสุด', 'End_Time']);
    const startTime = normalizeOTTime(rawStartTime, '17:30');
    const endTime = normalizeOTTime(rawEndTime, '20:30');
    const reason = getVal(['Reason', 'Task', 'Remark', 'ชื่องาน', 'เหตุผล']) || 'Approved OT';
    const approvedBy = getVal(['ApprovedBy', 'Approved By', 'Approver', 'ผู้อนุมัติ', 'Status', 'Approved_By']) || 'TRUE';

    if ((!empNo && !gid) || !originalDateParsed || hours <= 0) return;

    // Force date strictly to currentMonthYear if requested by Admin
    const targetDate = (forceToTargetMonth && /^\d{4}-\d{2}$/.test(currentMonthYear))
      ? forceDateToTargetMonth(originalDateParsed, currentMonthYear)
      : originalDateParsed;

    const isDifferentMonth = originalDateParsed && !originalDateParsed.startsWith(currentMonthYear);
    if (isDifferentMonth) {
      retroactiveCount++;
      warnings.push(
        `แถวที่ ${idx + 2}: พนักงาน ${empNo || gid} วันที่เดิม ${originalDateParsed} ถูกบังคับบันทึกลงสู่งวดเดือน ${currentMonthYear} (วันที่ ${targetDate}) ตามคำสั่ง Admin`
      );
    }

    const primaryId = (empNo || gid).replace(/[^a-zA-Z0-9]/g, '');
    records.push({
      id: `ot-${primaryId}-${targetDate}-${resolvedRate}-${idx}`,
      empNo,
      gid,
      date: targetDate,
      originalDate: originalDateParsed,
      startTime,
      endTime,
      hours,
      rate: resolvedRate,
      reason,
      approvedBy,
      isRetroactive: false, // In target-month binding mode, all records are directly committed to target month
      retroactiveTargetDate: targetDate,
      status: 'Approved',
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
export const ANNUAL_TEMPLATE_MONTH_NAMES = [
  { short: 'JAN', full: 'January', th: 'มกราคม', shortTh: 'ม.ค.', monthNum: 1 },
  { short: 'FEB', full: 'February', th: 'กุมภาพันธ์', shortTh: 'ก.พ.', monthNum: 2 },
  { short: 'MAR', full: 'March', th: 'มีนาคม', shortTh: 'มี.ค.', monthNum: 3 },
  { short: 'APR', full: 'April', th: 'เมษายน', shortTh: 'เม.ย.', monthNum: 4 },
  { short: 'MAY', full: 'May', th: 'พฤษภาคม', shortTh: 'พ.ค.', monthNum: 5 },
  { short: 'JUN', full: 'June', th: 'มิถุนายน', shortTh: 'มิ.ย.', monthNum: 6 },
  { short: 'JUL', full: 'July', th: 'กรกฎาคม', shortTh: 'ก.ค.', monthNum: 7 },
  { short: 'AUG', full: 'August', th: 'สิงหาคม', shortTh: 'ส.ค.', monthNum: 8 },
  { short: 'SEP', full: 'September', th: 'กันยายน', shortTh: 'ก.ย.', monthNum: 9 },
  { short: 'OCT', full: 'October', th: 'ตุลาคม', shortTh: 'ต.ค.', monthNum: 10 },
  { short: 'NOV', full: 'November', th: 'พฤศจิกายน', shortTh: 'พ.ย.', monthNum: 11 },
  { short: 'DEC', full: 'December', th: 'ธันวาคม', shortTh: 'ธ.ค.', monthNum: 12 },
];

/**
 * Generate Annual Shift Plan Excel (.xlsx) Template with 12 Sheets (JAN-YYYY to DEC-YYYY)
 */
export function generateAnnualShiftPlanTemplate(
  department: string,
  year: number,
  employees: Employee[],
  shiftCodes: ShiftCode[] = []
): { workbook: XLSX.WorkBook; filename: string } {
  const targetYear = Math.max(2020, year || new Date().getFullYear());
  const deptEmployees = department === 'ALL'
    ? employees.filter(e => e.isActive !== false)
    : employees.filter(e => e.department === department && e.isActive !== false);

  // Sort employees cleanly by EmpNo
  const sortedEmps = [...deptEmployees].sort((a, b) => (a.empNo || '').localeCompare(b.empNo || ''));

  const workbook = XLSX.utils.book_new();

  // 12 Monthly Sheets (JAN-YYYY to DEC-YYYY)
  ANNUAL_TEMPLATE_MONTH_NAMES.forEach(mInfo => {
    const sheetName = `${mInfo.short}-${targetYear}`;
    const daysInMonth = new Date(targetYear, mInfo.monthNum, 0).getDate();

    // Clean Column Headers: Emp No for mapping, Name and Department for reference
    const headers = ['Emp No', 'Name', 'Department'];
    for (let d = 1; d <= daysInMonth; d++) {
      headers.push(String(d).padStart(2, '0'));
    }

    const rows: any[] = [];
    if (sortedEmps.length > 0) {
      sortedEmps.forEach(emp => {
        const fullName = `${emp.firstName || ''} ${emp.familyName || ''}`.trim() || (emp as any).name || emp.empNo;
        const rowObj: any = {
          'Emp No': emp.empNo || '',
          'Name': fullName,
          'Department': emp.department || (department === 'ALL' ? 'GM' : department),
        };
        for (let d = 1; d <= daysInMonth; d++) {
          const dateObj = new Date(targetYear, mInfo.monthNum - 1, d);
          const dow = dateObj.getDay();
          // Weekends (Sat/Sun) default to OFF, Weekdays default to D
          rowObj[String(d).padStart(2, '0')] = (dow === 0 || dow === 6) ? 'OFF' : 'D';
        }
        rows.push(rowObj);
      });
    } else {
      // Fallback sample row so file is ready for blank departments
      const sampleRow: any = {
        'Emp No': '1001234',
        'Name': 'Sample Employee (ตัวอย่างชื่อพนักงาน)',
        'Department': department === 'ALL' ? 'GM' : department,
      };
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(targetYear, mInfo.monthNum - 1, d);
        const dow = dateObj.getDay();
        sampleRow[String(d).padStart(2, '0')] = (dow === 0 || dow === 6) ? 'OFF' : 'D';
      }
      rows.push(sampleRow);
    }

    const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });

    // Formatting Column Widths
    const colWidths = [
      { wch: 14 }, // Emp No
      { wch: 28 }, // Name
      { wch: 16 }, // Department
    ];
    for (let d = 1; d <= daysInMonth; d++) {
      colWidths.push({ wch: 6 });
    }
    worksheet['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  });

  // Reference Guide Sheet for Shift Codes
  if (shiftCodes && shiftCodes.length > 0) {
    const applicableCodes = shiftCodes.filter(sc => department === 'ALL' || sc.department === 'ALL' || sc.department === department);
    const guideRows = (applicableCodes.length > 0 ? applicableCodes : shiftCodes).map(sc => ({
      'Shift Code': sc.code,
      'Shift Name': sc.name,
      'Department': sc.department,
      'Start Time': sc.startTime,
      'End Time': sc.endTime,
      'Break (Min)': sc.breakMinutes,
      'Working Hours': sc.workingHours,
      'Work Day?': sc.isWorkingDay ? 'YES' : 'NO (OFF)',
      'Description': sc.description || '',
    }));
    const guideSheet = XLSX.utils.json_to_sheet(guideRows);
    guideSheet['!cols'] = [
      { wch: 12 }, { wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 35 }
    ];
    XLSX.utils.book_append_sheet(workbook, guideSheet, 'Shift_Codes_Guide');
  }

  const filename = `ShiftPlan_Annual_12Months_${department}_${targetYear}.xlsx`;
  return { workbook, filename };
}

/**
 * Detect month and year from a Sheet Name (e.g. "JAN-2027", "FEB-2027", "2027-02", "ม.ค.-2570", etc.)
 */
export function detectMonthYearFromSheetName(
  sheetName: string,
  fallbackYear?: number
): { monthYear: string; monthIndex: number; year: number; monthShort: string; monthTh: string; isConfident: boolean } | null {
  if (!sheetName) return null;
  const clean = sheetName.trim().toUpperCase().replace(/[\s_]/g, '-');

  // Skip guide / instruction sheets
  if (clean.includes('GUIDE') || clean.includes('INSTRUCTION') || clean.includes('CODE') || clean.includes('SUMMARY') || clean.includes('SETTING')) {
    return null;
  }

  // 1. Check direct match with "JAN-2027", "FEB-2027", etc.
  for (let idx = 0; idx < ANNUAL_TEMPLATE_MONTH_NAMES.length; idx++) {
    const mInfo = ANNUAL_TEMPLATE_MONTH_NAMES[idx];
    const mShort = mInfo.short;
    const mFull = mInfo.full.toUpperCase();
    const mTh = mInfo.shortTh.toUpperCase();

    if (clean.startsWith(mShort) || clean.includes(`-${mShort}`) || clean.includes(`${mShort}-`) || clean.startsWith(mFull) || clean.includes(mTh)) {
      // Find year in string (e.g. 2027, 27, 2570)
      const yearMatches = clean.match(/(\d{4}|\d{2})/g);
      let detectedYear = fallbackYear || new Date().getFullYear();
      if (yearMatches && yearMatches.length > 0) {
        const yVal = parseInt(yearMatches[0], 10);
        if (yVal > 2400) {
          detectedYear = yVal - 543; // Buddhist Era
        } else if (yVal >= 2000 && yVal <= 2100) {
          detectedYear = yVal;
        } else if (yVal >= 20 && yVal <= 99) {
          detectedYear = 2000 + yVal;
        }
      }
      const mStr = String(mInfo.monthNum).padStart(2, '0');
      return {
        monthYear: `${detectedYear}-${mStr}`,
        monthIndex: mInfo.monthNum,
        year: detectedYear,
        monthShort: mInfo.short,
        monthTh: mInfo.th,
        isConfident: true,
      };
    }
  }

  // 2. Check "YYYY-MM" or "MM-YYYY" formats
  const yyyyMmMatch = clean.match(/(\d{4})[-/](\d{1,2})/);
  if (yyyyMmMatch) {
    let yVal = parseInt(yyyyMmMatch[1], 10);
    if (yVal > 2400) yVal -= 543;
    const mVal = parseInt(yyyyMmMatch[2], 10);
    if (mVal >= 1 && mVal <= 12) {
      const mInfo = ANNUAL_TEMPLATE_MONTH_NAMES[mVal - 1];
      return {
        monthYear: `${yVal}-${String(mVal).padStart(2, '0')}`,
        monthIndex: mVal,
        year: yVal,
        monthShort: mInfo.short,
        monthTh: mInfo.th,
        isConfident: true,
      };
    }
  }

  const mmYyyyMatch = clean.match(/(\d{1,2})[-/](\d{4})/);
  if (mmYyyyMatch) {
    const mVal = parseInt(mmYyyyMatch[1], 10);
    let yVal = parseInt(mmYyyyMatch[2], 10);
    if (yVal > 2400) yVal -= 543;
    if (mVal >= 1 && mVal <= 12) {
      const mInfo = ANNUAL_TEMPLATE_MONTH_NAMES[mVal - 1];
      return {
        monthYear: `${yVal}-${String(mVal).padStart(2, '0')}`,
        monthIndex: mVal,
        year: yVal,
        monthShort: mInfo.short,
        monthTh: mInfo.th,
        isConfident: true,
      };
    }
  }

  return null;
}

export interface WorkbookSheetDetail {
  sheetName: string;
  sheetIndex: number;
  detectedMonthYear: string;
  detectedMonthShort: string;
  detectedMonthTh: string;
  detectedYear: number;
  isMonthSheet: boolean;
  rowCount: number;
}

/**
 * Inspect an uploaded Shift Plan Workbook to extract all available sheets & detected months
 */
export function inspectShiftPlanWorkbook(buffer: ArrayBuffer, defaultYear?: number): {
  sheetCount: number;
  sheets: WorkbookSheetDetail[];
  hasMultipleMonthSheets: boolean;
  isAnnualWorkbook: boolean;
  detectedYear: number;
  defaultSelectedMonthYear: string;
} {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetNames = workbook.SheetNames || [];
  const sheets: WorkbookSheetDetail[] = [];
  let monthSheetCount = 0;
  let dominantYear = defaultYear || new Date().getFullYear();

  sheetNames.forEach((sName, sIdx) => {
    const worksheet = workbook.Sheets[sName];
    const rowCount = worksheet ? (XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[]).length : 0;
    const detected = detectMonthYearFromSheetName(sName, dominantYear);

    if (detected) {
      monthSheetCount++;
      dominantYear = detected.year;
      sheets.push({
        sheetName: sName,
        sheetIndex: sIdx,
        detectedMonthYear: detected.monthYear,
        detectedMonthShort: detected.monthShort,
        detectedMonthTh: detected.monthTh,
        detectedYear: detected.year,
        isMonthSheet: true,
        rowCount: Math.max(0, rowCount - 1),
      });
    } else {
      sheets.push({
        sheetName: sName,
        sheetIndex: sIdx,
        detectedMonthYear: `${dominantYear}-01`,
        detectedMonthShort: sName,
        detectedMonthTh: sName,
        detectedYear: dominantYear,
        isMonthSheet: false,
        rowCount: Math.max(0, rowCount - 1),
      });
    }
  });

  const isAnnual = monthSheetCount >= 6; // If contains 6 or more monthly sheets (e.g. 12 sheets)
  const defaultSelectedMonthYear = sheets.find(s => s.isMonthSheet)?.detectedMonthYear || `${dominantYear}-05`;

  return {
    sheetCount: sheetNames.length,
    sheets,
    hasMultipleMonthSheets: monthSheetCount > 1,
    isAnnualWorkbook: isAnnual,
    detectedYear: dominantYear,
    defaultSelectedMonthYear,
  };
}

/**
 * Parse a specific sheet from ArrayBuffer to JSON rows
 */
export function parseSpecificSheetToRows(buffer: ArrayBuffer, sheetNameOrIndex: string | number): any[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  let targetSheetName = typeof sheetNameOrIndex === 'number'
    ? workbook.SheetNames[sheetNameOrIndex]
    : sheetNameOrIndex;

  if (!targetSheetName || !workbook.Sheets[targetSheetName]) {
    targetSheetName = workbook.SheetNames[0];
  }
  const worksheet = workbook.Sheets[targetSheetName];
  if (!worksheet) return [];
  return parseWorksheetToRows(worksheet);
}

export function generateShiftPlanTemplate(
  department: string,
  monthYear: string,
  employees: Employee[],
  shiftCodes: ShiftCode[] = []
): { csvContent: string; workbook: XLSX.WorkBook; sheetName?: string; filename?: string } {
  const deptEmployees = department === 'ALL' 
    ? employees.filter(e => e.isActive !== false) 
    : employees.filter(e => isSameDepartment(e.department, department) && e.isActive !== false);
  
  const cleanMonthYear = monthYear && monthYear.includes('-') ? monthYear : '2026-09';
  const [yearStr, monthStr] = cleanMonthYear.split('-');
  const yearNum = parseInt(yearStr, 10) || 2026;
  const monthNum = parseInt(monthStr, 10) || 9;
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

  // Find month info to format Sheet Name identically to Annual Template (e.g. SEP-2026)
  const monthInfo = ANNUAL_TEMPLATE_MONTH_NAMES.find(m => m.monthNum === monthNum) ||
                    ANNUAL_TEMPLATE_MONTH_NAMES[monthNum - 1] || 
                    { short: 'SEP' };
  const monthlySheetName = `${monthInfo.short}-${yearNum}`; // e.g. "SEP-2026"

  // Clean Column Headers: Emp No for mapping, Name and Department for reference
  // (No Emp Code / GID / Function - matching requirements)
  const headers = ['Emp No', 'Name', 'Department'];
  for (let d = 1; d <= daysInMonth; d++) {
    headers.push(String(d).padStart(2, '0'));
  }

  // Sort employees cleanly by EmpNo
  const sortedEmps = [...deptEmployees].sort((a, b) => (a.empNo || '').localeCompare(b.empNo || ''));

  const rows: any[] = [];
  if (sortedEmps.length > 0) {
    sortedEmps.forEach(emp => {
      const fullName = `${emp.firstName || ''} ${emp.familyName || ''}`.trim() || (emp as any).name || emp.empNo;
      const rowObj: any = {
        'Emp No': emp.empNo || '',
        'Name': fullName,
        'Department': emp.department || (department === 'ALL' ? 'GM' : department),
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
    const deptPrefix = department.replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || 'EMP';
    const sampleRow: any = {
      'Emp No': `${deptPrefix}01`,
      'Name': 'Sample Employee (ตัวอย่างชื่อพนักงาน)',
      'Department': department === 'ALL' ? 'GM' : department,
    };
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(yearNum, monthNum - 1, d);
      const dow = dateObj.getDay();
      sampleRow[String(d).padStart(2, '0')] = (dow === 0 || dow === 6) ? 'OFF' : 'D';
    }
    rows.push(sampleRow);
  }

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });

  // Add standard column widths matching annual template for clean presentation
  const colWidths = [
    { wch: 14 }, // Emp No (Mapping)
    { wch: 28 }, // Name (Reference)
    { wch: 16 }, // Department (Reference)
  ];
  for (let d = 1; d <= daysInMonth; d++) {
    colWidths.push({ wch: 6 });
  }
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  // Name the primary sheet e.g. "SEP-2026", matching the annual template format exactly
  XLSX.utils.book_append_sheet(workbook, worksheet, monthlySheetName);

  // Optional Reference Guide Sheet for Shift Codes (same as Annual Template)
  if (shiftCodes && shiftCodes.length > 0) {
    const applicableCodes = shiftCodes.filter(sc => department === 'ALL' || sc.department === 'ALL' || sc.department === department);
    const guideRows = (applicableCodes.length > 0 ? applicableCodes : shiftCodes).map(sc => ({
      'Shift Code': sc.code,
      'Shift Name': sc.name,
      'Work Time': sc.isWorkingDay ? `${sc.startTime} - ${sc.endTime}` : 'OFF',
      'Department': sc.department,
      'Description': sc.description || '',
    }));
    const guideSheet = XLSX.utils.json_to_sheet(guideRows);
    XLSX.utils.book_append_sheet(workbook, guideSheet, 'Shift_Codes_Guide');
  }

  // Add UTF-8 BOM so Microsoft Excel correctly displays Thai employee names and headers
  const BOM = '\uFEFF';
  const rawCsv = XLSX.utils.sheet_to_csv(worksheet);
  const csvContent = BOM + rawCsv;

  const filename = `ShiftPlan_Template_${department || 'ALL'}_${monthlySheetName}.xlsx`;

  return { csvContent, workbook, sheetName: monthlySheetName, filename };
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

/**
 * Generate Employee Master Import Template with EmpCode (8 digits)
 */
export function generateEmployeeMasterTemplate(sampleEmployees?: any[]): { csvContent: string; workbook: XLSX.WorkBook } {
  const defaultSamples = [
    {
      EmpCode: '10000950', // 8-digit payroll reference code
      EmpNo: '0950',
      GID: 'Z00430UZ',
      FirstName: 'Napassawan',
      FamilyName: 'Ngamsomsong',
      Department: 'GM',
      Division: 'MO CS BTS',
      Function: 'Safety Professional',
      CostCenter: 'C93056',
      IsShiftWorker: 'No',
      IsActive: 'Active',
    },
    {
      EmpCode: '10000149',
      EmpNo: '0149',
      GID: 'Z00149TH',
      FirstName: 'Somchai',
      FamilyName: 'Prasert',
      Department: 'RST',
      Division: 'MO CS BTS',
      Function: 'Depot Maintenance Lead',
      CostCenter: 'C93021',
      IsShiftWorker: 'Yes',
      IsActive: 'Active',
    },
    {
      EmpCode: '10000094',
      EmpNo: '0094',
      GID: 'Z00094TH',
      FirstName: 'Wiroj',
      FamilyName: 'Srisuk',
      Department: 'RST',
      Division: 'MO CS BTS',
      Function: 'Senior Rolling Stock Engineer',
      CostCenter: 'C93021',
      IsShiftWorker: 'Yes',
      IsActive: 'Active',
    },
  ];

  const rows = sampleEmployees && sampleEmployees.length > 0
    ? sampleEmployees.map(e => ({
        EmpCode: e.empCode || '',
        EmpNo: e.empNo,
        GID: e.gid,
        FirstName: e.firstName,
        FamilyName: e.familyName,
        Department: e.department,
        Division: e.division,
        Function: e.functionTitle,
        CostCenter: e.costCenter,
        IsShiftWorker: e.isShiftWorker ? 'Yes' : 'No',
        IsActive: e.isActive ? 'Active' : 'Inactive',
      }))
    : defaultSamples;

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 14 }, // EmpCode
    { wch: 10 }, // EmpNo
    { wch: 12 }, // GID
    { wch: 16 }, // FirstName
    { wch: 16 }, // FamilyName
    { wch: 14 }, // Department
    { wch: 14 }, // Division
    { wch: 24 }, // Function
    { wch: 12 }, // CostCenter
    { wch: 14 }, // IsShiftWorker
    { wch: 10 }, // IsActive
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Employee_Master');

  // Add Instructions Sheet for users
  const instructions = [
    {
      'หัวข้อ (Topic)': 'การแก้ไข / เพิ่มข้อมูลพนักงาน',
      'คำอธิบาย (Description)': 'สามารถอัปโหลดไฟล์ที่มีเฉพาะคอลัมน์ที่ต้องการแก้ไขได้ เช่น ระบุ EmpNo ร่วมกับ CostCenter หรือ EmpCode',
      'ตัวอย่าง (Example)': 'คอลัมน์: EmpNo, CostCenter, EmpCode'
    },
    {
      'หัวข้อ (Topic)': 'รหัสอ้างอิงพนักงาน (Primary Keys)',
      'คำอธิบาย (Description)': 'ต้องมี EmpNo หรือ GID อย่างน้อย 1 ค่า เพื่อให้ระบบค้นหาและจับคู่พนักงานในระบบได้ถูกต้อง',
      'ตัวอย่าง (Example)': 'EmpNo: 0950 หรือ GID: Z00430UZ'
    },
    {
      'หัวข้อ (Topic)': 'การเปลี่ยน CostCenter',
      'คำอธิบาย (Description)': 'ระบุรหัสศูนย์ต้นทุนใหม่ในคอลัมน์ CostCenter (ระบบจะเปลี่ยนศูนย์ต้นทุนให้ทันที)',
      'ตัวอย่าง (Example)': 'C93021, C93056'
    },
    {
      'หัวข้อ (Topic)': 'การเพิ่ม/แก้ไข EmpCode (8 หลัก)',
      'คำอธิบาย (Description)': 'ระบุรหัส 8 หลักสำหรับส่งฝ่าย Payroll ในคอลัมน์ EmpCode',
      'ตัวอย่าง (Example)': '10000950'
    },
    {
      'หัวข้อ (Topic)': 'การรักษาข้อมูลเดิม (Non-Destructive)',
      'คำอธิบาย (Description)': 'คอลัมน์ใดที่เว้นว่างไว้หรือไม่ใส่เข้ามาในไฟล์ ระบบจะไม่เขียนทับและคงข้อมูลเดิมของพนักงานไว้ทั้งหมด',
      'ตัวอย่าง (Example)': 'ถ้าไม่ระบุ Department พนักงานจะยังคงอยู่แผนกเดิม ไม่ถูกรีเซ็ต'
    },
    {
      'หัวข้อ (Topic)': 'การเพิ่มพนักงานใหม่ (New Employee)',
      'คำอธิบาย (Description)': 'กรณีเป็นพนักงานใหม่ที่ยังไม่มีในระบบ ต้องระบุอย่างน้อย EmpNo, GID และ FirstName',
      'ตัวอย่าง (Example)': 'EmpNo: 0999, GID: Z00999TH, FirstName: Somrak'
    },
  ];
  const wsInst = XLSX.utils.json_to_sheet(instructions);
  wsInst['!cols'] = [
    { wch: 30 },
    { wch: 70 },
    { wch: 35 }
  ];
  XLSX.utils.book_append_sheet(workbook, wsInst, 'Instructions_คำแนะนำ');

  const BOM = '\uFEFF';
  const rawCsv = XLSX.utils.sheet_to_csv(worksheet);
  const csvContent = BOM + rawCsv;
  return { csvContent, workbook };
}

export function escapeCSV(val: string | number | undefined | null): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Filter only employees who have extra income from OT (1.5 / 3.0 / other)
 * or Allowances (Emergency Team -ET / OnCall -X).
 */
export function filterPayrollEligibleSummaries(summaries: any[]): any[] {
  return summaries.filter(s => {
    const ot1_5 = Number(s.totalOT1_5 || 0);
    const ot3_0 = Number(s.totalOT3_0 || 0);
    const ot1_0 = Number(s.totalOT1_0 || 0);
    const totalOT = Number((ot1_5 + ot3_0 + ot1_0).toFixed(2));
    const emergency = Number(s.totalEmergency || 0);
    const standby = Number(s.totalStandby || 0);
    const totalAllowance = emergency + standby;
    return totalOT > 0 || totalAllowance > 0;
  });
}

/**
 * Generate Payroll CSV formatted strictly to Siemens Financial Payroll specification:
 * EmpCode, GID, Department, FirstName, FamilyName, TotalOT, 2010/2000, 2010/2001, 2010/2002, 0015/5016, 0015/5019, 0015/5000, 0015/5022, TotalAllowance
 */
export function generatePayrollCSV(
  summaries: any[],
  _monthYear?: string,
  filterOnlyExtraIncome: boolean = true
): string {
  // UTF-8 BOM for Microsoft Excel Thai language compatibility
  const BOM = '\uFEFF';
  const headers = [
    'EmpCode',
    'GID',
    'Department',
    'FirstName',
    'FamilyName',
    'TotalOT',
    '2010/2000',
    '2010/2001',
    '2010/2002',
    '0015/5016',
    '0015/5019',
    '0015/5000',
    '0015/5022',
    'TotalAllowance'
  ];

  const targetList = filterOnlyExtraIncome ? filterPayrollEligibleSummaries(summaries) : summaries;
  const lines = [headers.join(',')];

  targetList.forEach(s => {
    const ot1_5 = Number(s.totalOT1_5 || 0);
    const ot3_0 = Number(s.totalOT3_0 || 0);
    const ot1_0 = Number(s.totalOT1_0 || 0);
    const totalOT = Number((ot1_5 + ot3_0 + ot1_0).toFixed(2));
    const emergency = Number(s.totalEmergency || 0);
    const standby = Number(s.totalStandby || 0);
    const totalAllowance = emergency + standby;
    const empCode = s.employee?.empCode || s.empCode || s.empNo || '';

    const row = [
      escapeCSV(empCode),
      escapeCSV(s.gid || s.employee?.gid || ''),
      escapeCSV(s.employee?.department || ''),
      escapeCSV(s.employee?.firstName || ''),
      escapeCSV(s.employee?.familyName || ''),
      totalOT,
      ot1_5,
      ot3_0,
      0, // 2010/2002
      0, // 0015/5016
      0, // 0015/5019
      emergency, // 0015/5000: กะ -ET รวมค่า Emergency Team
      standby,   // 0015/5022: กะ -X รวมค่า OnCall
      totalAllowance // TotalAllowance: รวมค่า -ET และ -X
    ];
    lines.push(row.join(','));
  });

  return BOM + lines.join('\r\n');
}

/**
 * Generate Payroll Excel (.xlsx) file with styled column widths and data types
 */
export function generatePayrollExcel(
  summaries: any[],
  monthYear: string,
  filterOnlyExtraIncome: boolean = true
): Uint8Array {
  const headers = [
    'EmpCode',
    'GID',
    'Department',
    'FirstName',
    'FamilyName',
    'TotalOT',
    '2010/2000',
    '2010/2001',
    '2010/2002',
    '0015/5016',
    '0015/5019',
    '0015/5000',
    '0015/5022',
    'TotalAllowance'
  ];

  const targetList = filterOnlyExtraIncome ? filterPayrollEligibleSummaries(summaries) : summaries;
  const dataRows: any[] = [headers];

  targetList.forEach(s => {
    const ot1_5 = Number(s.totalOT1_5 || 0);
    const ot3_0 = Number(s.totalOT3_0 || 0);
    const ot1_0 = Number(s.totalOT1_0 || 0);
    const totalOT = Number((ot1_5 + ot3_0 + ot1_0).toFixed(2));
    const emergency = Number(s.totalEmergency || 0);
    const standby = Number(s.totalStandby || 0);
    const totalAllowance = emergency + standby;
    const empCode = s.employee?.empCode || s.empCode || s.empNo || '';

    dataRows.push([
      String(empCode),
      String(s.gid || s.employee?.gid || ''),
      String(s.employee?.department || ''),
      String(s.employee?.firstName || ''),
      String(s.employee?.familyName || ''),
      totalOT,
      ot1_5,
      ot3_0,
      0, // 2010/2002
      0, // 0015/5016
      0, // 0015/5019
      emergency, // 0015/5000
      standby,   // 0015/5022
      totalAllowance
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(dataRows);

  ws['!cols'] = [
    { wch: 14 }, // EmpCode
    { wch: 14 }, // GID
    { wch: 14 }, // Department
    { wch: 18 }, // FirstName
    { wch: 20 }, // FamilyName
    { wch: 12 }, // TotalOT
    { wch: 12 }, // 2010/2000
    { wch: 12 }, // 2010/2001
    { wch: 12 }, // 2010/2002
    { wch: 12 }, // 0015/5016
    { wch: 12 }, // 0015/5019
    { wch: 14 }, // 0015/5000
    { wch: 14 }, // 0015/5022
    { wch: 16 }, // TotalAllowance
  ];

  XLSX.utils.book_append_sheet(wb, ws, `Payroll_${monthYear.replace('-', '_')}`);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

/**
 * Generate Payroll TSV (Tab-separated) string for direct clipboard pasting into Excel/Spreadsheets
 */
export function generatePayrollTSV(
  summaries: any[],
  filterOnlyExtraIncome: boolean = true
): string {
  const headers = [
    'EmpCode',
    'GID',
    'Department',
    'FirstName',
    'FamilyName',
    'TotalOT',
    '2010/2000',
    '2010/2001',
    '2010/2002',
    '0015/5016',
    '0015/5019',
    '0015/5000',
    '0015/5022',
    'TotalAllowance'
  ];

  const targetList = filterOnlyExtraIncome ? filterPayrollEligibleSummaries(summaries) : summaries;
  const lines = [headers.join('\t')];

  targetList.forEach(s => {
    const ot1_5 = Number(s.totalOT1_5 || 0);
    const ot3_0 = Number(s.totalOT3_0 || 0);
    const ot1_0 = Number(s.totalOT1_0 || 0);
    const totalOT = Number((ot1_5 + ot3_0 + ot1_0).toFixed(2));
    const emergency = Number(s.totalEmergency || 0);
    const standby = Number(s.totalStandby || 0);
    const totalAllowance = emergency + standby;
    const empCode = s.employee?.empCode || s.empCode || s.empNo || '';

    const row = [
      empCode,
      s.gid || s.employee?.gid || '',
      s.employee?.department || '',
      s.employee?.firstName || '',
      s.employee?.familyName || '',
      totalOT,
      ot1_5,
      ot3_0,
      0,
      0,
      0,
      emergency,
      standby,
      totalAllowance
    ];
    lines.push(row.join('\t'));
  });

  return lines.join('\n');
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
