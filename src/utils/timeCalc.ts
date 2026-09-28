import { 
  Employee, 
  ShiftCode, 
  DailyShiftPlan, 
  BiometricRawPunch, 
  OTRecord, 
  OtherAllowance, 
  TimeSheetRow, 
  TimeSheetSummary 
} from '../types';

/**
 * Robustly normalizes an employee identifier, stripping Excel trailing decimals (e.g. "1432.0" -> "1432"),
 * invisible whitespace, and non-printable characters.
 */
export function cleanIdentifier(id: any): string {
  if (id === null || id === undefined) return '';
  return String(id)
    .trim()
    .replace(/\.0+$/, '')
    .trim();
}

/**
 * Checks if a biometric punch identifier matches an employee (empNo, gid, or empCode).
 * Fully tolerant of:
 * - Leading zeros ("0005" vs "5", "0149" vs "149", "01432" vs "1432")
 * - Excel float artifacts ("1432.0" vs "1432")
 * - 8-digit payroll codes ("10000149", "65090005", "65091432")
 * - Prefix variations ("SM549", "SM-149", etc.)
 * - GID matching (Z005ABHM, Z00430UZ, etc.)
 */
export function isEmployeeMatch(
  punchIdentifier: string,
  employee: { empNo?: string; gid?: string; empCode?: string }
): boolean {
  if (!punchIdentifier || !employee) return false;
  const pRaw = cleanIdentifier(punchIdentifier).toLowerCase();
  const eNoRaw = cleanIdentifier(employee.empNo).toLowerCase();
  const gidRaw = cleanIdentifier(employee.gid).toLowerCase();
  const empCodeRaw = cleanIdentifier(employee.empCode).toLowerCase();
  if (!pRaw) return false;

  const pClean = pRaw.replace(/[^a-z0-9]/gi, '');
  const gidClean = gidRaw.replace(/[^a-z0-9]/gi, '');
  const eNoClean = eNoRaw.replace(/[^a-z0-9]/gi, '');
  const empCodeClean = empCodeRaw.replace(/[^a-z0-9]/gi, '');

  // 1. GID check: If punchIdentifier is a GID (starts with 'z' followed by alphanumeric)
  const isGIDLike = /^z[0-9a-z]{4,}$/i.test(pRaw);
  if (isGIDLike) {
    // A GID punch MUST ONLY match if employee.gid or employee.empNo matches this exact GID
    return (gidClean && pClean === gidClean) || (eNoClean && pClean === eNoClean);
  }

  // If employee has a GID, and punch is a different GID
  if (gidClean && isGIDLike && pClean !== gidClean) {
    return false;
  }

  // 2. Direct exact or cleaned match with empNo, GID, or empCode
  if (pRaw === eNoRaw || (gidRaw && pRaw === gidRaw) || (empCodeRaw && pRaw === empCodeRaw)) return true;
  if (gidClean && pClean && pClean === gidClean) return true;
  if (eNoClean && pClean && pClean === eNoClean) return true;
  if (empCodeClean && pClean && pClean === empCodeClean) return true;

  // 3. Pure numeric match (handling leading zeros: "0005" vs "5", "0149" vs "149", "01432" vs "1432")
  const pDigits = pRaw.replace(/\D/g, '');
  const eDigits = eNoRaw.replace(/\D/g, '');
  const pNum = pDigits.replace(/^0+/, '');
  const eNum = eDigits.replace(/^0+/, '');

  if (pNum && eNum && pNum === eNum) return true;
  if (pDigits && eDigits && pDigits.padStart(4, '0') === eDigits.padStart(4, '0')) return true;

  // 4. Match 8-digit Payroll EmpCode (e.g. "10000149" vs "149", or "65091432" vs "1432")
  if (empCodeRaw) {
    const cDigits = empCodeRaw.replace(/\D/g, '');
    const cNum = cDigits.replace(/^0+/, '');
    if (pDigits && cDigits && pDigits === cDigits) return true;
    if (pNum && cNum && pNum === cNum) return true;
  }

  if (pNum && eNum && pNum.length >= 7 && (pNum.startsWith('1000') || pNum.startsWith('6509') || pNum.startsWith('650'))) {
    const pSub = pNum.replace(/^(10000|1000|6509|650)/, '').replace(/^0+/, '');
    if (pSub && pSub === eNum) return true;
  }
  if (eNum && pNum && eNum.length >= 7 && (eNum.startsWith('1000') || eNum.startsWith('6509') || eNum.startsWith('650'))) {
    const eSub = eNum.replace(/^(10000|1000|6509|650)/, '').replace(/^0+/, '');
    if (eSub && eSub === pNum) return true;
  }

  // 5. Alpha-prefix match (e.g. "SM149", "SM-149" vs "149")
  if (/^(sm|emp)-?\d+$/i.test(pRaw)) {
    const pAlphaStripped = pRaw.replace(/^[a-z]+-?/i, '').replace(/^0+/, '');
    if (pAlphaStripped && eNum && pAlphaStripped === eNum) return true;
  }

  return false;
}

/**
 * Safe matcher for Shift Plans, OT Records, and Other Allowances.
 * Compares GID with GID, and EmpNo with EmpNo, with full cross-tolerance for Excel columns.
 */
export function isEmployeePlanMatch(
  record: { empNo?: string; gid?: string } | null | undefined,
  employee: { empNo?: string; gid?: string; empCode?: string } | null | undefined
): boolean {
  if (!record || !employee) return false;

  const rEmpNo = cleanIdentifier(record.empNo).toLowerCase();
  const rGid = cleanIdentifier(record.gid).toLowerCase();
  const eEmpNo = cleanIdentifier(employee.empNo).toLowerCase();
  const eGid = cleanIdentifier(employee.gid).toLowerCase();
  const eEmpCode = cleanIdentifier(employee.empCode).toLowerCase();

  const rCleanGid = rGid.replace(/[^a-z0-9]/gi, '');
  const eCleanGid = eGid.replace(/[^a-z0-9]/gi, '');
  const rCleanEmpNo = rEmpNo.replace(/[^a-z0-9]/gi, '');
  const eCleanEmpNo = eEmpNo.replace(/[^a-z0-9]/gi, '');

  // CRITICAL CONFLICT GUARD:
  // If both record and employee have distinct GIDs, and they do NOT match,
  // they belong to completely different people! NEVER match them even if empNo happens to collide!
  if (rCleanGid && eCleanGid && rCleanGid.length >= 4 && eCleanGid.length >= 4 && rCleanGid !== eCleanGid) {
    return false;
  }

  // 1. Direct or clean GID-to-GID match
  if (rCleanGid && eCleanGid && rCleanGid === eCleanGid) return true;

  // 2. Direct or clean EmpNo-to-EmpNo match
  if (rCleanEmpNo && eCleanEmpNo && rCleanEmpNo === eCleanEmpNo) return true;

  // 3. GID stored in record.empNo matching employee.gid (e.g. Excel column had GID)
  if (rCleanEmpNo && eCleanGid && rCleanEmpNo === eCleanGid) return true;

  // 4. EmpNo stored in record.gid matching employee.empNo
  if (rCleanGid && eCleanEmpNo && rCleanGid === eCleanEmpNo) return true;

  // 5. Numeric EmpNo match with leading zero tolerance (e.g. "0005" vs "5", "01432" vs "1432")
  const rDigits = rEmpNo.replace(/\D/g, '');
  const eDigits = eEmpNo.replace(/\D/g, '');
  if (rDigits && eDigits) {
    const rNum = rDigits.replace(/^0+/, '');
    const eNum = eDigits.replace(/^0+/, '');
    if (rNum && eNum && rNum === eNum) return true;
    if (rDigits.padStart(4, '0') === eDigits.padStart(4, '0')) return true;
  }

  // 6. EmpCode (Payroll) match (e.g. "10000005" vs "5", "65091432" vs "1432")
  if (eEmpCode) {
    const eCodeClean = eEmpCode.replace(/[^a-z0-9]/gi, '');
    if (rCleanEmpNo && rCleanEmpNo === eCodeClean) return true;
    const eCodeDigits = eEmpCode.replace(/\D/g, '').replace(/^0+/, '');
    if (rDigits) {
      const rNum = rDigits.replace(/^0+/, '');
      if (rNum && eCodeDigits && rNum === eCodeDigits) return true;
    }
  }

  // 7. Check if record.empNo starts with common payroll prefix (10000 or 6509) matching employee.empNo
  if (rDigits && eDigits) {
    const rNum = rDigits.replace(/^0+/, '');
    const eNum = eDigits.replace(/^0+/, '');
    if (rNum.length >= 7 && (rNum.startsWith('1000') || rNum.startsWith('6509'))) {
      const rStripped = rNum.replace(/^(10000|1000|6509)/, '').replace(/^0+/, '');
      if (rStripped && eNum && rStripped === eNum) return true;
    }
  }

  return false;
}

/**
 * Format minutes into "HH:mm"
 */
export function minutesToHHMM(totalMinutes: number): string {
  if (totalMinutes <= 0 || isNaN(totalMinutes)) return '00:00';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Shift Tag & Allowance Info
 * -X  => Standby Allowance (+300 THB)
 * -ET => Emergency Allowance (+300 THB)
 */
export interface ParsedShiftTagInfo {
  baseCode: string;
  hasStandbyTag: boolean;      // -X
  hasEmergencyTag: boolean;    // -ET
  standbyAllowance: number;    // 300 if hasStandbyTag else 0
  emergencyAllowance: number;  // 300 if hasEmergencyTag else 0
  cleanDisplayCode: string;
}

/**
 * Parse Shift Code Tags (-X for Standby 300฿, -ET for Emergency 300฿)
 * e.g. "AD1-X", "E-ET", "D-X", "N-X", "AD1-X-ET"
 */
export function parseShiftCodeTags(rawCode: string): ParsedShiftTagInfo {
  if (!rawCode) {
    return {
      baseCode: '',
      hasStandbyTag: false,
      hasEmergencyTag: false,
      standbyAllowance: 0,
      emergencyAllowance: 0,
      cleanDisplayCode: '',
    };
  }

  const codeUpper = rawCode.trim().toUpperCase();

  // Check for -X (Standby Allowance = 300 THB)
  const hasStandbyTag = /(?:-X\b|-X$)/i.test(codeUpper) || codeUpper.includes('-X');

  // Check for -ET (Emergency Allowance = 300 THB)
  const hasEmergencyTag = /(?:-ET\b|-ET$)/i.test(codeUpper) || codeUpper.includes('-ET');

  // Strip -X and -ET to find the base shift code
  const baseCode = codeUpper
    .replace(/-X/gi, '')
    .replace(/-ET/gi, '')
    .trim();

  return {
    baseCode,
    hasStandbyTag,
    hasEmergencyTag,
    standbyAllowance: hasStandbyTag ? 300 : 0,
    emergencyAllowance: hasEmergencyTag ? 300 : 0,
    cleanDisplayCode: codeUpper,
  };
}

// Known non-working or leave codes
const KNOWN_NON_WORKING_OR_LEAVE_CODES = new Map<string, { name: string; color: string; workingHours: number }>([
  ['AL', { name: 'Annual Leave (ลาพักร้อน)', color: '#ec4899', workingHours: 0 }],
  ['AL1', { name: 'Annual Leave (ลาพักร้อนเต็มวัน)', color: '#ec4899', workingHours: 0 }],
  ['AL2', { name: 'Annual Leave (ลาพักร้อนครึ่งวัน)', color: '#db2777', workingHours: 4 }],
  ['ALU', { name: 'Annual Leave (Unpaid)', color: '#be185d', workingHours: 0 }],
  ['AL1U', { name: 'Annual Leave (เต็มวัน Unpaid)', color: '#be185d', workingHours: 0 }],
  ['AL2U', { name: 'Annual Leave (ครึ่งวัน Unpaid)', color: '#be185d', workingHours: 4 }],
  ['SL', { name: 'Sick Leave (ลาป่วย)', color: '#f43f5e', workingHours: 0 }],
  ['SL1', { name: 'Sick Leave (ลาป่วยเต็มวัน)', color: '#f43f5e', workingHours: 0 }],
  ['SL2', { name: 'Sick Leave (ลาป่วยครึ่งวัน)', color: '#e11d48', workingHours: 4 }],
  ['SLU', { name: 'Sick Leave (Unpaid)', color: '#be185d', workingHours: 0 }],
  ['SL1U', { name: 'Sick Leave (เต็มวัน Unpaid)', color: '#be185d', workingHours: 0 }],
  ['SL2U', { name: 'Sick Leave (ครึ่งวัน Unpaid)', color: '#be185d', workingHours: 4 }],
  ['BL', { name: 'Business Leave (ลากิจ)', color: '#8b5cf6', workingHours: 0 }],
  ['BL1', { name: 'Business Leave (ลากิจเต็มวัน)', color: '#8b5cf6', workingHours: 0 }],
  ['BL2', { name: 'Business Leave (ลากิจครึ่งวัน)', color: '#7c3aed', workingHours: 4 }],
  ['BLU', { name: 'Business Leave (Unpaid)', color: '#be185d', workingHours: 0 }],
  ['BL1U', { name: 'Business Leave (เต็มวัน Unpaid)', color: '#be185d', workingHours: 0 }],
  ['BL2U', { name: 'Business Leave (ครึ่งวัน Unpaid)', color: '#be185d', workingHours: 4 }],
  ['ML', { name: 'Maternity Leave (ลาคลอด)', color: '#d946ef', workingHours: 0 }],
  ['PL', { name: 'Paternity Leave (ลาเพื่อเลี้ยงดูบุตร)', color: '#a855f7', workingHours: 0 }],
  ['UL', { name: 'Unpaid Leave (ลาไม่รับค่าจ้าง)', color: '#9333ea', workingHours: 0 }],
  ['CL', { name: 'Compassionate Leave (ฌาปนกิจ)', color: '#6366f1', workingHours: 0 }],
  ['OL', { name: 'Ordination / Other Leave (ลาบวช/อื่นๆ)', color: '#4f46e5', workingHours: 0 }],
  ['EL', { name: 'Emergency Leave (ลาฉุกเฉิน)', color: '#ef4444', workingHours: 0 }],
  ['FL', { name: 'Family Leave', color: '#f97316', workingHours: 0 }],
  ['OFF', { name: 'Day Off (วันหยุดประจำสัปดาห์)', color: '#64748b', workingHours: 0 }],
  ['O', { name: 'Day Off (วันหยุด)', color: '#64748b', workingHours: 0 }],
  ['H', { name: 'Public Holiday (วันหยุดนักขัตฤกษ์)', color: '#475569', workingHours: 0 }],
  ['PH', { name: 'Public Holiday (วันหยุดนักขัตฤกษ์)', color: '#475569', workingHours: 0 }],
  ['HOL', { name: 'Holiday', color: '#475569', workingHours: 0 }],
  ['AB', { name: 'Absent (ขาดงาน)', color: '#dc2626', workingHours: 0 }],
]);

/**
 * Resolve ShiftCode metadata from map even with custom tags or aliases
 */
export function resolveShiftInfo(
  rawCode: string,
  shiftCodeMapOrList: Map<string, ShiftCode> | ShiftCode[],
  employeeOrDept?: Employee | { department?: string; division?: string; section?: string; functionTitle?: string } | string
): ShiftCode | undefined {
  if (!rawCode) return undefined;

  const isNightCode = (code: string) => {
    const c = code.trim().toUpperCase().replace(/-.*/, '');
    return /^N[0-9]?$/i.test(c) || /^AN[0-9]?$/i.test(c) || /NIGHT/i.test(c) || /ดึก/i.test(code);
  };

  const sanitizeNightShiftTimes = (s: ShiftCode): ShiftCode => {
    if (isNightCode(s.code) && s.startTime && s.endTime && hhmmToMinutes(s.startTime) <= hhmmToMinutes(s.endTime)) {
      const codeClean = s.code.trim().toUpperCase();
      let start = '20:00';
      let end = '05:00';
      if (codeClean === 'N1') { start = '22:00'; end = '06:30'; }
      else if (codeClean === 'N2') { start = '23:00'; end = '07:30'; }
      return {
        ...s,
        startTime: start,
        endTime: end,
        isWorkingDay: true,
        breakMinutes: 60,
        workingHours: 8,
      };
    }
    return s;
  };

  const { baseCode } = parseShiftCodeTags(rawCode);

  const allShiftCodes: ShiftCode[] = Array.isArray(shiftCodeMapOrList)
    ? shiftCodeMapOrList
    : Array.from(shiftCodeMapOrList.values());

  let targetDepts: string[] = [];

  if (typeof employeeOrDept === 'string') {
    if (employeeOrDept.trim()) targetDepts.push(employeeOrDept.trim().toUpperCase());
  } else if (employeeOrDept && typeof employeeOrDept === 'object') {
    const d = (employeeOrDept.department || '').trim().toUpperCase();
    const pd = ((employeeOrDept as any).planDepartment || '').trim().toUpperCase();
    const sec = ((employeeOrDept as any).section || (employeeOrDept as any).functionTitle || '').trim().toUpperCase();
    const div = ((employeeOrDept as any).division || '').trim().toUpperCase();

    // Priority order of target departments
    if (pd && pd !== 'ALL') targetDepts.push(pd);
    if (d && d !== 'ALL' && !targetDepts.includes(d)) targetDepts.push(d);
    if (sec && sec !== 'ALL' && !targetDepts.includes(sec)) targetDepts.push(sec);
    if (div && div !== 'ALL' && !targetDepts.includes(div)) targetDepts.push(div);
  }

  const norm = (s: string) => s.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const tokenize = (s: string) => s.toUpperCase().split(/[\/\s,-]+/).filter(p => p.length > 1);

  const scoreCandidate = (c: ShiftCode): number => {
    if (!c || !c.department) return 0;
    const cDept = c.department.trim().toUpperCase();

    // 1. If candidate is 'ALL', company-wide standard default
    if (cDept === 'ALL') {
      return 500;
    }

    // If no target department was specified
    if (targetDepts.length === 0) {
      // Unspecified target: prefer 'ALL' (500) over random specific department (100)
      return 100;
    }

    const cNorm = norm(cDept);
    const cTokens = tokenize(cDept);

    for (let i = 0; i < targetDepts.length; i++) {
      const t = targetDepts[i];
      const tNorm = norm(t);
      const tTokens = tokenize(t);
      const baseWeight = 1000 - i * 50;

      // Exact match (e.g. "BES/PSY" === "BES/PSY")
      if (cDept === t) return baseWeight;

      // Normalized match (e.g. "BES / PSY" vs "BES/PSY")
      if (cNorm && tNorm && cNorm === tNorm) return baseWeight - 10;

      // Token match (e.g. candidate "BES/PSY" matches target "BES" or "PSY")
      if (cTokens.length > 0 && tTokens.length > 0) {
        const hasCommonToken = cTokens.some(ct => tTokens.includes(ct));
        if (hasCommonToken) {
          return baseWeight - 30;
        }
      }

      // Substring containment (e.g. "BES/PSY2" contains "BES/PSY")
      if ((cDept.includes(t) || t.includes(cDept)) && cDept.length > 2 && t.length > 2) {
        return baseWeight - 50;
      }
    }

    // Belongs to an unrelated other department (e.g. candidate is "ADM" while target is "BES/PSY")
    // Score is 10, so it will NEVER beat 'ALL' (score 500) or employee's section/dept (score 700-1000)
    return 10;
  };

  const findBestInCandidates = (candidates: ShiftCode[]): ShiftCode | undefined => {
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];

    // Sort candidates by score descending
    const scored = candidates.map(c => ({ candidate: c, score: scoreCandidate(c) }));
    scored.sort((a, b) => b.score - a.score);

    return scored[0].candidate;
  };

  const findByCodeString = (codeToFind: string): ShiftCode | undefined => {
    if (!codeToFind) return undefined;
    const cleanTarget = codeToFind.trim().toUpperCase();
    const candidates = allShiftCodes.filter(sc => sc.code.trim().toUpperCase() === cleanTarget);
    return findBestInCandidates(candidates);
  };

  // 1. Known leave & non-working codes first
  const isLeavePrefix = /^(AL|SL|BL|ML|PL|UL|CL|OL|EL|FL)/i.test(baseCode || rawCode);
  if (KNOWN_NON_WORKING_OR_LEAVE_CODES.has(baseCode) || KNOWN_NON_WORKING_OR_LEAVE_CODES.has(rawCode.toUpperCase()) || isLeavePrefix) {
    const customConfig = findByCodeString(rawCode) || findByCodeString(baseCode);
    if (customConfig) return customConfig;

    const meta = KNOWN_NON_WORKING_OR_LEAVE_CODES.get(baseCode) || KNOWN_NON_WORKING_OR_LEAVE_CODES.get(rawCode.toUpperCase()) || {
      name: `Leave / ลา (${rawCode.toUpperCase()})`,
      color: '#ec4899',
      workingHours: (baseCode.includes('2') || rawCode.includes('2')) ? 4 : 0,
    };
    return {
      code: rawCode.toUpperCase(),
      name: meta.name,
      department: 'ALL',
      startTime: '00:00',
      endTime: '00:00',
      breakMinutes: 0,
      workingHours: meta.workingHours,
      isWorkingDay: false,
      color: meta.color,
      description: meta.name,
    };
  }

  // 2. Direct match on rawCode or baseCode
  const matchDirect = findByCodeString(rawCode);
  if (matchDirect) return sanitizeNightShiftTimes(matchDirect);

  const matchBase = findByCodeString(baseCode);
  if (matchBase) return sanitizeNightShiftTimes(matchBase);

  // 3. Acting shift prefix (AD1 -> D1, AE -> E, etc.)
  if (
    (baseCode.startsWith('AD') || baseCode.startsWith('AE') || baseCode.startsWith('AM') ||
     baseCode.startsWith('AN') || baseCode.startsWith('AS') || baseCode.startsWith('AST')) &&
    baseCode.length > 2
  ) {
    const strippedA = baseCode.slice(1);
    const matchStripped = findByCodeString(strippedA);
    if (matchStripped) return sanitizeNightShiftTimes(matchStripped);
  }

  // 4. Night shift fallback
  if (isNightCode(baseCode || rawCode)) {
    const codeClean = (baseCode || rawCode).trim().toUpperCase();
    let start = '20:00';
    let end = '05:00';
    if (codeClean === 'N1') { start = '22:00'; end = '06:30'; }
    else if (codeClean === 'N2') { start = '23:00'; end = '07:30'; }
    return {
      code: rawCode.toUpperCase(),
      name: `กะดึก (${rawCode.toUpperCase()})`,
      department: 'ALL',
      startTime: start,
      endTime: end,
      breakMinutes: 60,
      workingHours: 8,
      isWorkingDay: true,
      color: '#6366f1',
      description: `กะดึกข้ามคืน (${start} - ${end})`,
    };
  }

  return undefined;
}

/**
 * Standard Shift Category Color Resolver
 * Group shift codes by family (D, M/E, A, N, ST, OFF, H, SL/AL/TR, SBY)
 */
export function getShiftCategoryColor(code: string, fallbackColor?: string): string {
  if (!code) return '#6b7280';
  let c = code.trim().toUpperCase().replace(/-X/gi, '').replace(/-ET/gi, '').trim();

  // Handle 'A' prefix alias (e.g. AD1 -> D1) if it's not the afternoon 'A' shift
  if (c.startsWith('AD') || c.startsWith('AE') || c.startsWith('AM') || c.startsWith('AN')) {
    c = c.slice(1);
  }

  // 1. Day Shifts (D, D1, D2, D3, etc.) - Siemens Teal / Cyan family
  if (c === 'D') return '#008b99';       // Primary Siemens Teal
  if (c === 'D1') return '#0891b2';      // Dark Cyan
  if (c === 'D2') return '#0284c7';      // Sky Blue
  if (c.startsWith('D')) return '#008b99';

  // 2. Morning / Early Shifts (M, M1, E, E1, etc.) - Blue family
  if (c === 'M' || c === 'E') return '#06b6d4';   // Morning Cyan
  if (c === 'M1' || c === 'E1') return '#3b82f6'; // Bright Royal Blue
  if (c.startsWith('M') || c.startsWith('E')) return '#0284c7';

  // 3. Afternoon Shifts (A, A1, A2, etc.) - Orange / Amber family
  if (c === 'A') return '#f59e0b';       // Gold Amber
  if (c === 'A1') return '#ea580c';      // Warm Orange
  if (c === 'A2') return '#d97706';      // Dark Amber
  if (c.startsWith('A')) return '#f59e0b';

  // 4. Night Shifts (N, N1, N2, etc.) - Indigo / Purple family
  if (c === 'N') return '#6366f1';       // Indigo Night
  if (c === 'N1') return '#7c3aed';      // Violet Track Work
  if (c === 'N2') return '#4f46e5';      // Deep Indigo Overhaul
  if (c.startsWith('N')) return '#6366f1';

  // 5. Special / Station Shifts (S1, ST1, ST2)
  if (c === 'S1') return '#10b981';      // Emerald
  if (c === 'ST1') return '#14b8a6';     // Teal
  if (c === 'ST2') return '#d97706';     // Amber

  // 6. Day Off & Holidays
  if (c === 'OFF') return '#475569';     // Slate Dark
  if (c === 'H') return '#ef4444';       // Red

  // 7. Leaves & Training & Workshops
  if (c === 'T' || c === 'TR') return '#059669';  // Training Green
  if (c === 'W') return '#0d9488';                // Workshop Teal
  if (c === 'AL') return '#ec4899';               // Annual Leave Pink
  if (c === 'AL2') return '#db2777';              // Annual Leave Half-day
  if (c === 'ALU') return '#e11d48';              // Annual Leave Emergency
  if (c === 'AL2U') return '#be123c';             // Annual Leave Emergency Half-day
  if (c === 'CL') return '#f97316';               // Casual Leave Orange
  if (c === 'SL') return '#f43f5e';               // Sick Leave Rose
  if (c === 'SL2') return '#dc2626';              // Sick Leave Half-day
  if (c === 'SLO' || c === 'SL0') return '#991b1b'; // Sick Leave No Certificate Dark Red
  if (c === 'SBY') return '#8b5cf6';              // Violet

  return fallbackColor || '#4b5563';
}

/**
 * Flexibly normalizes any time string (e.g. "8:00", "08:00", "08:00:00", "8.00", "17.00", "0800", "8", "8:30 AM", "08:30 น.")
 * into standard "HH:mm" format (24-hour). Returns null if string cannot be parsed into a valid time.
 */
export function normalizeShiftTimeString(raw: any, defaultFallback?: string): string | null {
  if (raw === null || raw === undefined) return defaultFallback || null;
  let str = String(raw).trim();
  if (!str) return defaultFallback || null;

  // Clean Thai notation / units (e.g. "น.", "นาฬิกา", "hrs", "hr", "hours")
  str = str.replace(/(?:น\.|นาฬิกา|hrs?|hours?)/gi, '').trim();

  // Support Excel time serial numbers (fraction of a 24-hour day, e.g. 0.2916666666666667 -> 07:00, 0.7083333333333334 -> 17:00)
  if (/^0?\.\d+$/.test(str)) {
    const num = parseFloat(str);
    if (!isNaN(num) && num >= 0 && num < 1) {
      const totalMinutes = Math.round(num * 1440) % 1440;
      const hh = Math.floor(totalMinutes / 60);
      const mm = totalMinutes % 60;
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }

  // Check 12-hour AM/PM modifiers
  const isPM = /\bpm\b/i.test(str) || /pm$/i.test(str);
  const isAM = /\bam\b/i.test(str) || /am$/i.test(str);
  str = str.replace(/\b[ap]m\b/gi, '').replace(/[ap]m$/gi, '').trim();

  // Replace dot, dash, underscore, slash, space separators with colon
  const clean = str.replace(/[.\-_/\s]+/g, ':').replace(/:+/g, ':').replace(/^:+|:+$/g, '');

  let hours = 0;
  let minutes = 0;

  if (clean.includes(':')) {
    const parts = clean.split(':');
    hours = parseInt(parts[0], 10);
    minutes = parts.length > 1 && parts[1] !== '' ? parseInt(parts[1], 10) : 0;
  } else if (/^\d{3,4}$/.test(clean)) {
    // 3 or 4 digits: e.g. 800 -> 8:00 ; 0800 -> 08:00 ; 1730 -> 17:30
    if (clean.length === 3) {
      hours = parseInt(clean.substring(0, 1), 10);
      minutes = parseInt(clean.substring(1, 3), 10);
    } else {
      hours = parseInt(clean.substring(0, 2), 10);
      minutes = parseInt(clean.substring(2, 4), 10);
    }
  } else if (/^\d{1,2}$/.test(clean)) {
    // 1 or 2 digits: e.g. 8 -> 08:00, 17 -> 17:00, 0 -> 00:00
    hours = parseInt(clean, 10);
    minutes = 0;
  } else {
    return defaultFallback || null;
  }

  if (isNaN(hours) || isNaN(minutes)) return defaultFallback || null;

  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return defaultFallback || null;
  }

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Convert "HH:mm" to total minutes from midnight
 */
export function hhmmToMinutes(timeStr: string): number {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const normalized = normalizeShiftTimeString(timeStr);
  if (!normalized || !normalized.includes(':')) return 0;
  const [h, m] = normalized.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Calculate difference between two "HH:mm" times, handling cross-midnight
 */
export function calculateTimeDiffMinutes(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return 0;
  const start = hhmmToMinutes(startTime);
  let end = hhmmToMinutes(endTime);
  if (end < start) {
    // Cross midnight
    end += 24 * 60;
  }
  return Math.max(0, end - start);
}

/**
 * Calculate circular minute distance on a 24-hour clock face (0 - 1440 mins).
 */
export function circularTimeDistance(timeA: string, timeB: string): number {
  if (!timeA || !timeB) return 9999;
  const a = hhmmToMinutes(timeA);
  const b = hhmmToMinutes(timeB);
  const diff = Math.abs(a - b);
  return Math.min(diff, 1440 - diff);
}

/**
 * Unique identifier for a biometric punch record
 */
export function getPunchKey(p: BiometricRawPunch): string {
  if (!p) return '';
  return `${(p.empIdentifier || '').trim()}_${(p.date || '').trim()}_${(p.time || '').trim()}_${(p.type || '').trim()}`;
}

/**
 * Cluster punches within maxGapMinutes (Rule 6: "หากมีการบันทึกซ้ำในเวลาใกล้เคียงกันจะใช้เวลาล่าสุด")
 */
export function clusterPunches(punches: BiometricRawPunch[], maxGapMinutes = 30): BiometricRawPunch[][] {
  const validPunches = (punches || []).filter(
    (p): p is BiometricRawPunch => Boolean(p && typeof p === 'object' && typeof p.time === 'string' && p.time.trim())
  );
  if (validPunches.length === 0) return [];
  const sorted = [...validPunches].sort((a, b) => hhmmToMinutes(a.time) - hhmmToMinutes(b.time));
  const clusters: BiometricRawPunch[][] = [];
  let currentCluster: BiometricRawPunch[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const prev = currentCluster[currentCluster.length - 1];
    const diff = hhmmToMinutes(item.time) - hhmmToMinutes(prev.time);
    if (diff <= maxGapMinutes) {
      currentCluster.push(item);
    } else {
      clusters.push(currentCluster);
      currentCluster = [item];
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }
  return clusters;
}

/**
 * Find cluster closest to a target reference time (e.g. shift startTime or endTime)
 */
export function findBestCluster(clusters: BiometricRawPunch[][], targetTime: string): BiometricRawPunch[] {
  if (clusters.length === 0) return [];
  let bestCluster = clusters[0];
  let minDistance = 99999;
  for (const cluster of clusters) {
    const repTime = cluster[cluster.length - 1]?.time || cluster[0]?.time;
    const dist = circularTimeDistance(repTime, targetTime);
    if (dist < minDistance) {
      minDistance = dist;
      bestCluster = cluster;
    }
  }
  return bestCluster;
}

export interface PunchResolutionDetails {
  clockIn: string;
  clockOut: string;
  secondIn?: string;
  secondOut?: string;
  resolutionType:
    | 'standard_in_out'         // Normal I & O punches
    | 'dual_in_resolved'        // Both I & I, flexibly resolved by Shift Code
    | 'dual_out_resolved'       // Both O & O, flexibly resolved by Shift Code
    | 'inverted_resolved'       // O morning & I evening, inverted and resolved
    | 'shift_time_aligned'      // Timestamps aligned based on Shift Code start/end
    | 'single_in_only'          // Only arrival punch detected
    | 'single_out_only'         // Only departure punch detected
    | 'cross_midnight_resolved' // Night shift punch out connected across midnight
    | 'no_punches';
  resolutionDescription: string;
  hasIrregularity: boolean;
  shiftCodeUsed?: string;
  usedTodayPunches?: BiometricRawPunch[];
  usedNextDayPunches?: BiometricRawPunch[];
}

/**
 * Deduplicate and intelligently resolve biometric punches for an employee on a given date:
 * - Rule 6: "หากมีการบันทึกซ้ำในเวลาใกล้เคียงกันจะใช้เวลาล่าสุด"
 * - Flexible Shift Code Learning: Resolves dual 'I' (forgot to press Out), dual 'O' (accidentally pressed Out on arrival),
 *   inverted buttons, and cross-midnight night shifts using Shift Code start/end as reference,
 *   while strictly preserving the standard flow when In-Out were correctly pressed.
 */
export function filterDeduplicatedPunches(
  punches: BiometricRawPunch[],
  shiftInfo?: ShiftCode | null,
  nextDayPunches?: BiometricRawPunch[]
): PunchResolutionDetails {
  // Sanitize punches: filter out any null, undefined or entries without a valid string time
  const validPunches = (punches || []).filter(
    (p): p is BiometricRawPunch => Boolean(p && typeof p === 'object' && typeof p.time === 'string' && p.time.trim())
  );

  // Check if shift is cross-midnight night shift (e.g. 20:00 - 05:00, 22:00 - 06:30, etc.)
  const codeStr = (shiftInfo?.code || '').trim().toUpperCase().replace(/-.*/, '');
  const isNightCode = /^N[0-9]?$/i.test(codeStr) || /^AN[0-9]?$/i.test(codeStr) || /NIGHT/i.test(shiftInfo?.name || '') || /ดึก/i.test(shiftInfo?.name || '');

  const isExplicitNonWorking = shiftInfo?.isWorkingDay === false || KNOWN_NON_WORKING_OR_LEAVE_CODES.has(codeStr);

  const hasCrossMidnightHours = Boolean(
    !isExplicitNonWorking &&
    shiftInfo?.startTime &&
    shiftInfo?.endTime &&
    hhmmToMinutes(shiftInfo.startTime) > hhmmToMinutes(shiftInfo.endTime)
  );

  const isNightShift = Boolean(
    !isExplicitNonWorking &&
    (hasCrossMidnightHours || isNightCode)
  );

  // -------------------------------------------------------------
  // SPECIALIZED HANDLING FOR NIGHT SHIFTS (CROSS-MIDNIGHT)
  // -------------------------------------------------------------
  if (isNightShift) {
    const effectiveStartTime = (hasCrossMidnightHours && shiftInfo?.startTime)
      ? shiftInfo.startTime
      : (codeStr === 'N1' ? '22:00' : codeStr === 'N2' ? '23:00' : '20:00');
    const effectiveEndTime = (hasCrossMidnightHours && shiftInfo?.endTime)
      ? shiftInfo.endTime
      : (codeStr === 'N1' ? '06:30' : codeStr === 'N2' ? '07:30' : '05:00');

    // 1. Resolve Clock In from today's punches:
    // For night shift, Clock In happens in evening/night (usually >= 14:00, closest to effectiveStartTime).
    // Any morning punches on today (<= 12:00) belong to the PREVIOUS day's night shift departure!
    const eveningPunches = validPunches.filter(p => hhmmToMinutes(p.time) >= 840); // >= 14:00
    const morningLeftoverPunches = validPunches.filter(p => hhmmToMinutes(p.time) <= 720); // <= 12:00

    let inPunch: BiometricRawPunch | undefined;
    const usedToday: BiometricRawPunch[] = [];

    // Mark previous shift's morning punches as consumed on today so they don't linger
    morningLeftoverPunches.forEach(p => usedToday.push(p));

    if (eveningPunches.length > 0) {
      const eveningClusters = clusterPunches(eveningPunches);
      // Pre-shift OT or early arrival: Use earliest evening cluster so overtime prior to shift start is included
      const earliestCluster = eveningClusters[0];
      inPunch = earliestCluster?.[0] || earliestCluster?.[earliestCluster.length - 1];
      eveningClusters.forEach(cluster => usedToday.push(...cluster));
    } else {
      // If no evening arrival punch, do not treat morning departure as arrival
      inPunch = undefined;
    }

    const clockIn = inPunch?.time || '';

    // 2. Resolve Clock Out from nextDayPunches:
    // For night shift ending next morning, Clock Out is in morning of next day (00:00 - 13:00)
    // CRITICAL: ONLY look ahead to next day's morning punches if employee actually clocked in on today!
    // If there is NO clock-in on today (e.g. absent, leave, or no evening punch), tomorrow morning's punch
    // belongs to tomorrow's day shift and MUST NOT be stolen or consumed!
    let outPunch: BiometricRawPunch | undefined;
    const usedNextDay: BiometricRawPunch[] = [];

    if (clockIn && nextDayPunches && nextDayPunches.length > 0) {
      const validNextPunches = nextDayPunches.filter(
        (p): p is BiometricRawPunch => Boolean(p && typeof p === 'object' && typeof p.time === 'string' && p.time.trim())
      );
      // Morning punches on next day (<= 13:00 / 780 minutes)
      const morningNextPunches = validNextPunches.filter(p => hhmmToMinutes(p.time) <= 780);

      if (morningNextPunches.length > 0) {
        const nextClusters = clusterPunches(morningNextPunches);
        // Post-shift OT or late departure: Use latest morning cluster so overtime after shift end is included
        const latestCluster = nextClusters[nextClusters.length - 1];
        outPunch = latestCluster?.[latestCluster.length - 1];
        nextClusters.forEach(cluster => usedNextDay.push(...cluster));
      }
    }

    const clockOut = outPunch?.time || '';

    if (clockIn && clockOut) {
      return {
        clockIn,
        clockOut,
        resolutionType: 'cross_midnight_resolved',
        resolutionDescription: `กะดึกข้ามคืน: บันทึกเวลาเข้า (${clockIn}) และเชื่อมโยงเวลาออกเช้าวันถัดไป (${clockOut}) ตามกะ ${shiftInfo?.code || ''}`,
        hasIrregularity: false,
        shiftCodeUsed: shiftInfo?.code,
        usedTodayPunches: usedToday,
        usedNextDayPunches: usedNextDay,
      };
    } else if (clockIn && !clockOut) {
      return {
        clockIn,
        clockOut: '',
        resolutionType: 'single_in_only',
        resolutionDescription: `กะดึก: พบเฉพาะเวลาเข้างาน (${clockIn}) ขาดการสแกนออกเช้าวันถัดไป ตามกะ ${shiftInfo?.code || ''}`,
        hasIrregularity: true,
        shiftCodeUsed: shiftInfo?.code,
        usedTodayPunches: usedToday,
        usedNextDayPunches: [],
      };
    } else {
      return {
        clockIn: '',
        clockOut: '',
        resolutionType: 'no_punches',
        resolutionDescription: morningLeftoverPunches.length > 0 
          ? 'ไม่มีการเข้างานกะดึกในคืนนี้ (พบเฉพาะเวลาออกของกะดึกเมื่อวาน)'
          : 'ไม่มีบันทึกการสแกนเวลาในวันนี้',
        hasIrregularity: false,
        usedTodayPunches: usedToday,
        usedNextDayPunches: [],
      };
    }
  }

  // -------------------------------------------------------------
  // STANDARD HANDLING FOR DAYTIME SHIFTS & OFF DAYS
  // -------------------------------------------------------------
  if (validPunches.length === 0) {
    return {
      clockIn: '',
      clockOut: '',
      resolutionType: 'no_punches',
      resolutionDescription: 'ไม่มีบันทึกการสแกนเวลาในวันนี้',
      hasIrregularity: false,
      usedTodayPunches: [],
      usedNextDayPunches: [],
    };
  }

  // Sort chronologically by time
  const sorted = [...validPunches].sort((a, b) => hhmmToMinutes(a.time) - hhmmToMinutes(b.time));
  const clusters = clusterPunches(sorted);

  if (clusters.length === 0) {
    return {
      clockIn: '',
      clockOut: '',
      resolutionType: 'no_punches',
      resolutionDescription: 'ไม่มีบันทึกการสแกนเวลาในวันนี้',
      hasIrregularity: false,
      usedTodayPunches: [],
      usedNextDayPunches: [],
    };
  }

  /**
   * Helper to look ahead to next day's early morning punches if today's shift clock-out occurred past midnight
   */
  const tryFindNextDayCrossMidnightOut = (
    clockInTime: string
  ): { clockOut: string; usedNextDayPunches: BiometricRawPunch[] } => {
    if (!clockInTime || !nextDayPunches || nextDayPunches.length === 0) {
      return { clockOut: '', usedNextDayPunches: [] };
    }
    const validNext = nextDayPunches.filter(
      (p): p is BiometricRawPunch => Boolean(p && typeof p === 'object' && typeof p.time === 'string' && p.time.trim())
    );
    // Early morning punches on next day (<= 08:00 / 480 minutes)
    const morningNext = validNext.filter(p => hhmmToMinutes(p.time) <= 480);
    if (morningNext.length === 0) {
      return { clockOut: '', usedNextDayPunches: [] };
    }

    const candidateNextClusters = clusterPunches(morningNext);
    const latestNextCluster = candidateNextClusters[candidateNextClusters.length - 1];
    const candidateOutPunch = latestNextCluster?.[latestNextCluster.length - 1];

    if (!candidateOutPunch) {
      return { clockOut: '', usedNextDayPunches: [] };
    }

    const candidateTime = candidateOutPunch.time;
    const candidateMin = hhmmToMinutes(candidateTime);

    // If candidate punch is type 'I' and time >= 06:00 (360 min), it's an In punch for next day's morning shift, not an Out punch
    if (candidateOutPunch.type === 'I' && candidateMin >= 360) {
      return { clockOut: '', usedNextDayPunches: [] };
    }

    // Ensure total duration from clockIn to next day morning out is reasonable (>= 2 hours and <= 20 hours = 120 - 1200 mins)
    const duration = calculateTimeDiffMinutes(clockInTime, candidateTime);
    if (duration >= 120 && duration <= 1200) {
      const usedNext: BiometricRawPunch[] = [];
      candidateNextClusters.forEach(cluster => usedNext.push(...cluster));
      return { clockOut: candidateTime, usedNextDayPunches: usedNext };
    }

    return { clockOut: '', usedNextDayPunches: [] };
  };

  // CASE 1: Single Distinct Cluster on this day
  if (clusters.length === 1) {
    const singleCluster = clusters[0] || [];
    const repPunch = singleCluster[singleCluster.length - 1];
    if (!repPunch) {
      return {
        clockIn: '',
        clockOut: '',
        resolutionType: 'no_punches',
        resolutionDescription: 'ไม่มีบันทึกการสแกนเวลาในวันนี้',
        hasIrregularity: false,
        usedTodayPunches: [],
        usedNextDayPunches: [],
      };
    }
    const repTime = repPunch.time || '';

    // Determine if this single scan is In or Out using Shift Code
    if (shiftInfo?.isWorkingDay && shiftInfo?.startTime && shiftInfo?.endTime) {
      const distToStart = circularTimeDistance(repTime, shiftInfo.startTime);
      const distToEnd = circularTimeDistance(repTime, shiftInfo.endTime);

      if (distToStart <= distToEnd) {
        const nextOut = tryFindNextDayCrossMidnightOut(repTime);
        if (nextOut.clockOut) {
          return {
            clockIn: repTime,
            clockOut: nextOut.clockOut,
            resolutionType: 'cross_midnight_resolved',
            resolutionDescription: `พบเวลาเข้างาน (${repTime}) และเชื่อมโยงเวลาออกข้ามคืนเช้าวันถัดไป (${nextOut.clockOut}) ตามกะ ${shiftInfo.code}`,
            hasIrregularity: false,
            shiftCodeUsed: shiftInfo.code,
            usedTodayPunches: singleCluster,
            usedNextDayPunches: nextOut.usedNextDayPunches,
          };
        }

        return {
          clockIn: repTime,
          clockOut: '',
          resolutionType: 'single_in_only',
          resolutionDescription: `พบเฉพาะเวลาเข้างาน (${repTime}) ขาดการสแกนออก อ้างอิงตามกะ ${shiftInfo.code}`,
          hasIrregularity: true,
          shiftCodeUsed: shiftInfo.code,
          usedTodayPunches: singleCluster,
          usedNextDayPunches: [],
        };
      } else {
        return {
          clockIn: '',
          clockOut: repTime,
          resolutionType: 'single_out_only',
          resolutionDescription: `พบเฉพาะเวลาออกงาน (${repTime}) ขาดการสแกนเข้า อ้างอิงตามกะ ${shiftInfo.code}`,
          hasIrregularity: true,
          shiftCodeUsed: shiftInfo.code,
          usedTodayPunches: singleCluster,
          usedNextDayPunches: [],
        };
      }
    }

    // If no shift info, rely on punch type
    if (repPunch.type === 'O') {
      return {
        clockIn: '',
        clockOut: repTime,
        resolutionType: 'single_out_only',
        resolutionDescription: `พบเฉพาะเวลาออกงาน (${repTime} สถานะ O)`,
        hasIrregularity: true,
        usedTodayPunches: singleCluster,
        usedNextDayPunches: [],
      };
    } else {
      const nextOut = tryFindNextDayCrossMidnightOut(repTime);
      if (nextOut.clockOut) {
        return {
          clockIn: repTime,
          clockOut: nextOut.clockOut,
          resolutionType: 'cross_midnight_resolved',
          resolutionDescription: `พบเวลาเข้างาน (${repTime}) และเชื่อมโยงเวลาออกข้ามคืนเช้าวันถัดไป (${nextOut.clockOut})`,
          hasIrregularity: false,
          shiftCodeUsed: shiftInfo?.code,
          usedTodayPunches: singleCluster,
          usedNextDayPunches: nextOut.usedNextDayPunches,
        };
      }

      return {
        clockIn: repTime,
        clockOut: '',
        resolutionType: 'single_in_only',
        resolutionDescription: `พบเฉพาะเวลาเข้างาน (${repTime} สถานะ I)`,
        hasIrregularity: false,
        usedTodayPunches: singleCluster,
        usedNextDayPunches: [],
      };
    }
  }

  // CASE 2: Multiple Clusters (>= 2 distinct time windows)
  const allTypes = sorted.map(p => p.type);
  const hasOnlyI = allTypes.length > 0 && allTypes.every(t => t === 'I');
  const hasOnlyO = allTypes.length > 0 && allTypes.every(t => t === 'O');

  // SUBCASE 2A: All punches are 'I' (Forgot to press Out at end of day)
  if (hasOnlyI) {
    const earliestCluster = clusters[0] || [];
    const latestCluster = clusters[clusters.length - 1] || [];
    const clockIn = earliestCluster[earliestCluster.length - 1]?.time || '';
    let clockOut = latestCluster[latestCluster.length - 1]?.time || '';

    let secondIn = '';
    let secondOut = '';
    if (clusters.length >= 4) {
      secondIn = clusters[1]?.[clusters[1].length - 1]?.time || '';
      secondOut = clusters[2]?.[clusters[2].length - 1]?.time || '';
    }

    const shiftDesc = shiftInfo?.code 
      ? `ตามกะ ${shiftInfo.code} (${shiftInfo.startTime}-${shiftInfo.endTime})` 
      : 'ตามลำดับเวลาเช้า-เย็น';

    return {
      clockIn,
      clockOut,
      secondIn: secondIn || undefined,
      secondOut: secondOut || undefined,
      resolutionType: 'dual_in_resolved',
      resolutionDescription: `ตรวจพบสถานะ In ทั้ง 2 ช่วงเวลา (ไม่ได้กด Out): ระบบเทียบกับ Shift Code กำหนดเวลาแรก (${clockIn}) เป็นเข้างาน และเวลาหลัง (${clockOut}) เป็นเลิกงานอัตโนมัติ ${shiftDesc}`,
      hasIrregularity: true,
      shiftCodeUsed: shiftInfo?.code,
      usedTodayPunches: validPunches,
      usedNextDayPunches: [],
    };
  }

  // SUBCASE 2B: All punches are 'O' (Mistakenly pressed Out on arrival)
  if (hasOnlyO) {
    const earliestCluster = clusters[0] || [];
    const latestCluster = clusters[clusters.length - 1] || [];
    const clockIn = earliestCluster[earliestCluster.length - 1]?.time || '';
    const clockOut = latestCluster[latestCluster.length - 1]?.time || '';

    let secondIn = '';
    let secondOut = '';
    if (clusters.length >= 4) {
      secondIn = clusters[1]?.[clusters[1].length - 1]?.time || '';
      secondOut = clusters[2]?.[clusters[2].length - 1]?.time || '';
    }

    const shiftDesc = shiftInfo?.code 
      ? `ตามกะ ${shiftInfo.code} (${shiftInfo.startTime}-${shiftInfo.endTime})` 
      : 'ตามลำดับเวลาเช้า-เย็น';

    return {
      clockIn,
      clockOut,
      secondIn: secondIn || undefined,
      secondOut: secondOut || undefined,
      resolutionType: 'dual_out_resolved',
      resolutionDescription: `ตรวจพบสถานะ Out ทั้ง 2 ช่วงเวลา (กดผิดเป็น Out ตอนเข้างาน): ระบบเทียบกับ Shift Code กำหนดเวลาแรก (${clockIn}) เป็นเข้างาน และเวลาหลัง (${clockOut}) เป็นเลิกงานอัตโนมัติ ${shiftDesc}`,
      hasIrregularity: true,
      shiftCodeUsed: shiftInfo?.code,
      usedTodayPunches: validPunches,
      usedNextDayPunches: [],
    };
  }

  // SUBCASE 2C: Both 'I' and 'O' exist in punches
  const inPunches = sorted.filter(p => p.type === 'I');
  const outPunches = sorted.filter(p => p.type === 'O');

  // Cluster 'I' punches
  const inClusters = clusterPunches(inPunches);
  // Cluster 'O' punches
  const outClusters = clusterPunches(outPunches);

  const firstIn = inClusters.length > 0 ? (inClusters[0]?.[inClusters[0].length - 1]?.time || '') : '';
  const lastOut = outClusters.length > 0 ? (outClusters[outClusters.length - 1]?.[outClusters[outClusters.length - 1].length - 1]?.time || '') : '';

  // Check if In and Out are in normal chronological order
  if (firstIn && lastOut && hhmmToMinutes(firstIn) <= hhmmToMinutes(lastOut)) {
    // Normal Standard Case: First In and Last Out (combined session including pre-shift & post-shift OT)
    let clockIn = firstIn;
    let clockOut = lastOut;
    let secondIn = '';
    let secondOut = '';

    // Only assign separate second period if there is a distinct 4-punch split shift: In1 < Out1 < In2 < Out2
    if (inClusters.length >= 2 && outClusters.length >= 2) {
      const in1 = inClusters[0]?.[inClusters[0].length - 1]?.time || '';
      const out1 = outClusters[0]?.[outClusters[0].length - 1]?.time || '';
      const in2 = inClusters[1]?.[inClusters[1].length - 1]?.time || '';
      const out2 = outClusters[outClusters.length - 1]?.[outClusters[outClusters.length - 1].length - 1]?.time || '';

      if (
        hhmmToMinutes(in1) < hhmmToMinutes(out1) &&
        hhmmToMinutes(out1) < hhmmToMinutes(in2) &&
        hhmmToMinutes(in2) <= hhmmToMinutes(out2)
      ) {
        clockIn = in1;
        clockOut = out1;
        secondIn = in2;
        secondOut = out2;
      }
    }

    return {
      clockIn,
      clockOut,
      secondIn: secondIn || undefined,
      secondOut: secondOut || undefined,
      resolutionType: 'standard_in_out',
      resolutionDescription: 'บันทึกเวลาเข้า-ออกตามปกติ (In - Out รวมช่วงเวลาทำโอทีทั้งหมด)',
      hasIrregularity: false,
      shiftCodeUsed: shiftInfo?.code,
      usedTodayPunches: validPunches,
      usedNextDayPunches: [],
    };
  }

  // Check if buttons were inverted or if lastOut was from morning of yesterday's shift
  if (firstIn && lastOut && hhmmToMinutes(firstIn) > hhmmToMinutes(lastOut)) {
    // CRITICAL: If firstIn is in day/afternoon/evening (>= 08:00 AM) and lastOut is in early morning (<= 11:00 AM)
    // This is NOT an inverted daytime shift! Morning punch is yesterday's departure; evening/day punch is today's arrival.
    if (hhmmToMinutes(firstIn) >= 480 && hhmmToMinutes(lastOut) <= 660) {
      const nextOut = tryFindNextDayCrossMidnightOut(firstIn);
      const nextOutPunch = nextOut.clockOut;

      return {
        clockIn: firstIn,
        clockOut: nextOutPunch,
        resolutionType: 'cross_midnight_resolved',
        resolutionDescription: `พบเวลาเข้างาน (${firstIn}) และเชื่อมโยงเวลาออกข้ามคืนเช้าวันถัดไป (${nextOutPunch || 'รอสแกนออก'}) ตามกะ ${shiftInfo?.code || ''}`,
        hasIrregularity: !nextOutPunch,
        shiftCodeUsed: shiftInfo?.code,
        usedTodayPunches: validPunches,
        usedNextDayPunches: nextOut.usedNextDayPunches,
      };
    }

    const earliestTime = clusters[0]?.[clusters[0].length - 1]?.time || firstIn;
    const latestTime = clusters[clusters.length - 1]?.[clusters[clusters.length - 1].length - 1]?.time || lastOut;

    return {
      clockIn: earliestTime,
      clockOut: latestTime,
      resolutionType: 'inverted_resolved',
      resolutionDescription: `ตรวจพบการกดสลับปุ่ม (Out ตอนเช้า / In ตอนเย็น): ปรับเข้างานเป็น ${earliestTime} และเลิกงานเป็น ${latestTime} โดยเทียบกับ Shift Code ${shiftInfo?.code || ''}`,
      hasIrregularity: true,
      shiftCodeUsed: shiftInfo?.code,
      usedTodayPunches: validPunches,
      usedNextDayPunches: [],
    };
  }

  // Fallback: Use earliest and latest cluster, with cross-midnight lookahead if clockOut is missing
  const clockIn = clusters[0]?.[clusters[0].length - 1]?.time || '';
  let clockOut = clusters[clusters.length - 1]?.[clusters[clusters.length - 1].length - 1]?.time || '';
  let usedNext: BiometricRawPunch[] = [];

  if (clockIn && (!clockOut || clockOut === clockIn)) {
    const nextOut = tryFindNextDayCrossMidnightOut(clockIn);
    if (nextOut.clockOut) {
      clockOut = nextOut.clockOut;
      usedNext = nextOut.usedNextDayPunches;
    }
  }

  return {
    clockIn,
    clockOut,
    resolutionType: usedNext.length > 0 ? 'cross_midnight_resolved' : 'shift_time_aligned',
    resolutionDescription: usedNext.length > 0 
      ? `พบเวลาเข้างาน (${clockIn}) และเชื่อมโยงเวลาออกข้ามคืนเช้าวันถัดไป (${clockOut})` 
      : `กำหนดเวลาเข้า (${clockIn}) และเลิกงาน (${clockOut}) ตามลำดับเวลาที่สแกน`,
    hasIrregularity: !clockOut,
    shiftCodeUsed: shiftInfo?.code,
    usedTodayPunches: validPunches,
    usedNextDayPunches: usedNext,
  };
}

/**
 * Generate full monthly TimeSheet rows for a specific employee and monthYear (e.g. "2026-05")
 */
export function buildTimeSheetForEmployee(
  employee: Employee,
  monthYear: string, // "YYYY-MM"
  shiftCodes: ShiftCode[],
  shiftPlans: DailyShiftPlan[],
  allPunches: BiometricRawPunch[],
  otRecords: OTRecord[],
  allowances: OtherAllowance[],
  manualOverrides: Record<string, Partial<TimeSheetRow>> = {}
): TimeSheetSummary {
  const [yearStr, monthStr] = monthYear.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10); // 1-indexed

  // Total days in month
  const totalDays = new Date(year, month, 0).getDate();

  const shiftCodeMap = new Map<string, ShiftCode>();
  shiftCodes.forEach(sc => shiftCodeMap.set(sc.code, sc));

  // Filter biometric punches matching either empNo, gid, or empCode (robust tolerance for leading zeros, prefixes, and excel floats)
  const empPunches = (allPunches || []).filter(p => {
    if (!p || typeof p !== 'object' || typeof p.time !== 'string' || !p.time.trim()) return false;
    const pId = cleanIdentifier(p.empIdentifier || (p as any).empNo || (p as any).gid);
    if (!pId) return false;
    return isEmployeeMatch(pId, employee);
  });

  // Filter approved OT for this month or retroactive OT assigned to this month
  const empOT = otRecords.filter(ot => {
    const isEmpMatch = isEmployeePlanMatch(ot, employee);
    if (!isEmpMatch) return false;
    const targetDate = ot.retroactiveTargetDate || ot.date;
    return targetDate.startsWith(monthYear) && ot.status === 'Approved';
  });

  // Filter other allowances for this month
  const empAllowances = allowances.filter(a => {
    const isEmpMatch = isEmployeePlanMatch(a, employee);
    return isEmpMatch && a.monthYear === monthYear;
  });

  // PRE-INDEXED LOOKUPS (O(1) per day)
  // Shift Plan resolution: matches ShiftRosterView exactly (EmpNo primary, GID fallback)
  const empPlanMap = new Map<string, DailyShiftPlan>();
  const empNoClean = cleanIdentifier(employee.empNo).toUpperCase();
  const empNoDigits = empNoClean.replace(/\D/g, '').replace(/^0+/, '');
  const empNoPadded = empNoDigits ? empNoDigits.padStart(4, '0') : '';
  const empGidClean = cleanIdentifier(employee.gid).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const empCodeClean = cleanIdentifier(employee.empCode).toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Pre-index shiftPlans by EmpNo and by GID
  const planByEmpNo = new Map<string, DailyShiftPlan>();
  const planByGid = new Map<string, DailyShiftPlan>();

  for (const sp of shiftPlans) {
    if (!sp || !sp.date) continue;
    const spEmp = cleanIdentifier(sp.empNo).toUpperCase();
    const spGid = cleanIdentifier(sp.gid).toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (spEmp) {
      planByEmpNo.set(`${spEmp}_${sp.date}`, sp);
      const spDigits = spEmp.replace(/\D/g, '').replace(/^0+/, '');
      if (spDigits) {
        planByEmpNo.set(`${spDigits}_${sp.date}`, sp);
        planByEmpNo.set(`${spDigits.padStart(4, '0')}_${sp.date}`, sp);
      }
    }
    if (spGid) {
      planByGid.set(`${spGid}_${sp.date}`, sp);
    }
  }

  // Populate empPlanMap for each date (EmpNo check first, then GID fallback)
  for (const sp of shiftPlans) {
    if (!sp || !sp.date || empPlanMap.has(sp.date)) continue;
    const date = sp.date;

    let matched: DailyShiftPlan | undefined;
    if (empNoClean) matched = planByEmpNo.get(`${empNoClean}_${date}`);
    if (!matched && empNoDigits) matched = planByEmpNo.get(`${empNoDigits}_${date}`);
    if (!matched && empNoPadded) matched = planByEmpNo.get(`${empNoPadded}_${date}`);
    if (!matched && empCodeClean) matched = planByEmpNo.get(`${empCodeClean}_${date}`);
    if (!matched && empGidClean) matched = planByGid.get(`${empGidClean}_${date}`);

    if (matched) {
      empPlanMap.set(date, matched);
    }
  }

  const empPunchesByDate = new Map<string, BiometricRawPunch[]>();
  for (const p of empPunches) {
    if (!p.date) continue;
    let list = empPunchesByDate.get(p.date);
    if (!list) {
      list = [];
      empPunchesByDate.set(p.date, list);
    }
    list.push(p);
  }

  const empOTByDate = new Map<string, OTRecord[]>();
  for (const ot of empOT) {
    const targetDate = ot.retroactiveTargetDate || ot.date;
    let list = empOTByDate.get(targetDate);
    if (!list) {
      list = [];
      empOTByDate.set(targetDate, list);
    }
    list.push(ot);
  }

  const empAllowancesByDate = new Map<string, OtherAllowance[]>();
  const genericMonthAllowances: OtherAllowance[] = [];
  for (const a of empAllowances) {
    if (!a.date) {
      genericMonthAllowances.push(a);
    } else {
      let list = empAllowancesByDate.get(a.date);
      if (!list) {
        list = [];
        empAllowancesByDate.set(a.date, list);
      }
      list.push(a);
    }
  }

  const rows: TimeSheetRow[] = [];
  let totalDiffMinutes = 0;
  let totalLateMinutes = 0;
  let totalWorkHoursSum = 0;
  let totalOT1_5Sum = 0;
  let totalOT3_0Sum = 0;
  let totalStandbySum = 0;
  let totalEmergencySum = 0;
  let totalShiftAllowanceSum = 0;
  let totalLeaveCount = 0;
  let actualWorkDaysCount = 0;

  // Track punches consumed by previous shifts (e.g. night shift clock-out on next morning)
  const consumedPunchKeys = new Set<string>();

  for (let d = 1; d <= totalDays; d++) {
    const dayPadded = String(d).padStart(2, '0');
    const dateStr = `${monthYear}-${dayPadded}`;
    const dateObj = new Date(year, month - 1, d);

    // Format: "01-05-26 Fri"
    const yy = String(year).slice(-2);
    const mm = String(month).padStart(2, '0');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayOfWeek = dayNames[dateObj.getDay()];
    const dayString = `${dayPadded}-${mm}-${yy} ${dayOfWeek}`;

    // Find shift code for this day from plan (O(1))
    const plan = empPlanMap.get(dateStr);
    const shiftCodeVal = plan ? plan.shiftCode : (dayOfWeek === 'Sat' || dayOfWeek === 'Sun' ? 'OFF' : 'D');

    // Check if there are manual overrides saved for this day
    const cleanEmp = cleanIdentifier(employee.empNo);
    const cleanGid = cleanIdentifier(employee.gid);
    const overrideKey1 = `${cleanEmp}_${dateStr}`;
    const overrideKey2 = cleanGid ? `${cleanGid}_${dateStr}` : '';
    const overrideKey3 = cleanEmp ? `${cleanEmp.padStart(4, '0')}_${dateStr}` : '';
    const overrideKey4 = cleanEmp ? `${cleanEmp.replace(/^0+/, '')}_${dateStr}` : '';
    const overrides = {
      ...(overrideKey4 && manualOverrides[overrideKey4] ? manualOverrides[overrideKey4] : {}),
      ...(overrideKey3 && manualOverrides[overrideKey3] ? manualOverrides[overrideKey3] : {}),
      ...(overrideKey2 && manualOverrides[overrideKey2] ? manualOverrides[overrideKey2] : {}),
      ...(manualOverrides[overrideKey1] || {}),
    };

    const effectiveShiftCode = (overrides.shiftCode !== undefined ? overrides.shiftCode : shiftCodeVal) || '';

    // Parse shift code tags (-X for Standby 300฿, -ET for Emergency 300฿)
    const tagInfo = parseShiftCodeTags(effectiveShiftCode);
    const targetDeptContext = {
      department: employee.department,
      planDepartment: plan?.department,
      division: employee.division,
      section: (employee as any).section || (employee as any).functionTitle,
    };
    const shiftInfo = resolveShiftInfo(effectiveShiftCode, shiftCodes, targetDeptContext);

    const shiftIn = shiftInfo?.isWorkingDay ? shiftInfo.startTime : '';
    const shiftOut = shiftInfo?.isWorkingDay ? shiftInfo.endTime : '';

    const isConsumed = (p: BiometricRawPunch) => consumedPunchKeys.has(getPunchKey(p)) || (Boolean(p.id) && consumedPunchKeys.has(p.id));

    // Punches for this day (excluding punches already consumed by previous day's night shift)
    const rawDayPunches = empPunchesByDate.get(dateStr) || [];
    const dayPunches = rawDayPunches.filter(p => !isConsumed(p));

    // Look ahead to next day for night shift (cross-midnight) punch out (including cross-month boundary)
    const nextDateObj = new Date(year, month - 1, d + 1);
    const nextY = nextDateObj.getFullYear();
    const nextM = String(nextDateObj.getMonth() + 1).padStart(2, '0');
    const nextD = String(nextDateObj.getDate()).padStart(2, '0');
    const nextDateStr = `${nextY}-${nextM}-${nextD}`;

    const rawNextDayPunches = empPunchesByDate.get(nextDateStr) || [];
    const nextDayPunches = rawNextDayPunches.filter(p => !isConsumed(p));

    const punchResolution = filterDeduplicatedPunches(dayPunches, shiftInfo, nextDayPunches);
    const { clockIn, clockOut, secondIn, secondOut } = punchResolution;

    // Mark used punches as consumed so they are not reused by subsequent days
    punchResolution.usedTodayPunches?.forEach(p => {
      consumedPunchKeys.add(getPunchKey(p));
      if (p.id) consumedPunchKeys.add(p.id);
    });
    punchResolution.usedNextDayPunches?.forEach(p => {
      consumedPunchKeys.add(getPunchKey(p));
      if (p.id) consumedPunchKeys.add(p.id);
    });

    // Calculate Diff. I
    let diff1Minutes = 0;
    let diff1Str = '';
    if (clockIn && clockOut) {
      diff1Minutes = calculateTimeDiffMinutes(clockIn, clockOut);
      diff1Str = minutesToHHMM(diff1Minutes);
    } else if (clockIn && !clockOut) {
      // In only
      diff1Str = '';
    }

    // Calculate Late (H)
    let lateMinutes = 0;
    let lateStr = '00:00';
    if (shiftIn && clockIn) {
      const inMin = hhmmToMinutes(clockIn);
      const shiftInMin = hhmmToMinutes(shiftIn);
      if (inMin > shiftInMin) {
        lateMinutes = inMin - shiftInMin;
        lateStr = minutesToHHMM(lateMinutes);
      }
    }

    // Second period / Real Time II
    let diff2Minutes = 0;
    let diff2Str = '';
    if (secondIn && secondOut) {
      diff2Minutes = calculateTimeDiffMinutes(secondIn, secondOut);
      diff2Str = minutesToHHMM(diff2Minutes);
    }

    // OT on this day:
    // Rule 5: "หากวันไดมีการทำโอทีหลายช่วงเวลาให้รวมเวลาของวันนั้นเข้าด้วยกัน"
    const dayOTs = empOTByDate.get(dateStr) || [];
    let ot1_5 = 0;
    let ot3_0 = 0;
    let otRemarks: string[] = [];

    dayOTs.forEach(ot => {
      if (ot.rate === 3.0) {
        ot3_0 += ot.hours;
      } else {
        ot1_5 += ot.hours;
      }
      if (ot.reason) {
        otRemarks.push(ot.reason);
      }
    });

    // Working Hours Total
    // In Siemens Time Sheet standard (as in Time Sheet.png):
    // Total is either OT total or working hours approved
    const totalWorkingHoursOnDay = ot1_5 + ot3_0;

    // Allowances on this day:
    // Rule 1: -X tag in shift code => +300 THB Standby Allowance (e.g. AD1-X)
    // Rule 2: -ET tag in shift code => +300 THB Emergency Allowance (e.g. E-ET)
    let standbyAllowance = tagInfo.standbyAllowance;
    let emergencyAllowance = tagInfo.emergencyAllowance;
    let shiftAllowance = 0;

    const specificAllowances = empAllowancesByDate.get(dateStr) || [];
    const dayAllowances = genericMonthAllowances.length > 0 
      ? [...genericMonthAllowances, ...specificAllowances] 
      : specificAllowances;

    if (dayAllowances.length > 0) {
      dayAllowances.forEach(a => {
        standbyAllowance += a.standbyAllowance || 0;
        emergencyAllowance += a.teamEmergency || 0;
        shiftAllowance += a.shiftAllowance || 0;
      });
    }

    let codeLeave = '';
    let remark = otRemarks.join('; ');

    const effOT1_5 = overrides.ot1_5 !== undefined ? overrides.ot1_5 : ot1_5;
    const effOT3_0 = overrides.ot3_0 !== undefined ? overrides.ot3_0 : ot3_0;
    const effTotalWorkHours = overrides.totalWorkHours !== undefined 
      ? overrides.totalWorkHours 
      : (effOT1_5 + effOT3_0);

    // Rule for OFF, H, or Non-working days:
    // ในกรณีที่เป็นกะ OFF หรือ H ไม่ต้องแสดงเวลาใดๆ ที่อาจมีข้อมูลที่ผิดพลาดจากเครื่อง Time Attendance
    // เว้นแต่ในวันนั้นๆ จะมีการนำเข้าข้อมูล OT ในวันหยุด จึงจะแสดงเวลาเข้าออก
    const isOffOrHolidayCode = (code: string) => {
      const c = (code || '').trim().toUpperCase();
      return (
        c === 'OFF' ||
        c === 'H' ||
        c === 'PH' ||
        c === 'HOL' ||
        c.startsWith('OFF') ||
        c.startsWith('H-') ||
        c.includes('OFF') ||
        c.includes('HOLIDAY') ||
        c.includes('วันหยุด') ||
        c.includes('หยุด')
      );
    };

    const isNonWorkingOrOffOrHoliday = 
      !shiftInfo?.isWorkingDay || 
      isOffOrHolidayCode(effectiveShiftCode) || 
      isOffOrHolidayCode(tagInfo.baseCode);

    const hasHolidayOT = 
      (dayOTs.length > 0 && dayOTs.some(ot => (ot.hours || 0) > 0)) || 
      effOT1_5 > 0 || 
      effOT3_0 > 0 || 
      (overrides.totalWorkHours !== undefined && overrides.totalWorkHours > 0);

    const hasManualTimeOverrides = 
      overrides.realTime1In !== undefined || 
      overrides.realTime1Out !== undefined || 
      overrides.realTime2In !== undefined || 
      overrides.realTime2Out !== undefined || 
      overrides.diff1 !== undefined;

    // If day is OFF or Holiday and NO OT was worked/imported AND NO manual time overrides exist, suppress any accidental biometric punches
    const shouldSuppressPunches = isNonWorkingOrOffOrHoliday && !hasHolidayOT && !hasManualTimeOverrides;

    let finalRealTime1In = overrides.realTime1In !== undefined 
      ? overrides.realTime1In 
      : (shouldSuppressPunches ? '' : clockIn);

    let finalRealTime1Out = overrides.realTime1Out !== undefined 
      ? overrides.realTime1Out 
      : (shouldSuppressPunches ? '' : clockOut);

    let finalRealTime2In = overrides.realTime2In !== undefined 
      ? overrides.realTime2In 
      : (shouldSuppressPunches ? '' : (secondIn || ''));

    let finalRealTime2Out = overrides.realTime2Out !== undefined 
      ? overrides.realTime2Out 
      : (shouldSuppressPunches ? '' : (secondOut || ''));

    // Calculate Diff 1
    let finalDiff1Str = '';
    let finalDiff1Minutes = 0;
    if (overrides.diff1 !== undefined) {
      finalDiff1Str = overrides.diff1;
      finalDiff1Minutes = hhmmToMinutes(overrides.diff1);
    } else if (finalRealTime1In && finalRealTime1Out) {
      finalDiff1Minutes = calculateTimeDiffMinutes(finalRealTime1In, finalRealTime1Out);
      finalDiff1Str = minutesToHHMM(finalDiff1Minutes);
    }

    // Calculate Diff 2
    let finalDiff2Str = '';
    let finalDiff2Minutes = 0;
    if (overrides.diff2 !== undefined) {
      finalDiff2Str = overrides.diff2;
      finalDiff2Minutes = hhmmToMinutes(overrides.diff2);
    } else if (finalRealTime2In && finalRealTime2Out) {
      finalDiff2Minutes = calculateTimeDiffMinutes(finalRealTime2In, finalRealTime2Out);
      finalDiff2Str = minutesToHHMM(finalDiff2Minutes);
    }

    let finalLateStr = '00:00';
    let finalLateMinutes = 0;
    if (overrides.late !== undefined) {
      finalLateStr = overrides.late;
      finalLateMinutes = hhmmToMinutes(overrides.late);
    } else if (!shouldSuppressPunches) {
      finalLateStr = lateStr;
      finalLateMinutes = lateMinutes;
    }

    const row: TimeSheetRow = {
      date: dateStr,
      dayString,
      dayOfWeek,
      shiftCode: effectiveShiftCode,
      shiftIn: overrides.shiftIn !== undefined ? overrides.shiftIn : shiftIn,
      shiftOut: overrides.shiftOut !== undefined ? overrides.shiftOut : shiftOut,
      realTime1In: finalRealTime1In,
      realTime1Out: finalRealTime1Out,
      diff1: finalDiff1Str,
      diff1Hours: finalDiff1Minutes / 60,
      late: finalLateStr,
      lateMinutes: finalLateMinutes,
      realTime2In: finalRealTime2In,
      realTime2Out: finalRealTime2Out,
      diff2: finalDiff2Str,
      diff2Hours: finalDiff2Minutes / 60,
      totalWorkHours: effTotalWorkHours,
      ot1_5: effOT1_5,
      ot3_0: effOT3_0,
      standbyAllowance: overrides.standbyAllowance !== undefined ? overrides.standbyAllowance : standbyAllowance,
      emergencyAllowance: overrides.emergencyAllowance !== undefined ? overrides.emergencyAllowance : emergencyAllowance,
      shiftAllowance: overrides.shiftAllowance !== undefined ? overrides.shiftAllowance : shiftAllowance,
      codeLeave: overrides.codeLeave !== undefined ? overrides.codeLeave : codeLeave,
      remark: overrides.remark !== undefined ? overrides.remark : remark,
      isManualOverride: Object.keys(overrides).length > 0,
    };

    // Tally sums
    if (row.realTime1In || row.realTime1Out) {
      actualWorkDaysCount++;
    }
    if (row.diff1) {
      totalDiffMinutes += hhmmToMinutes(row.diff1);
    }
    if (row.late && row.late !== '00:00') {
      totalLateMinutes += hhmmToMinutes(row.late);
    }
    totalWorkHoursSum += row.totalWorkHours || 0;
    totalOT1_5Sum += row.ot1_5 || 0;
    totalOT3_0Sum += row.ot3_0 || 0;
    totalStandbySum += row.standbyAllowance || 0;
    totalEmergencySum += row.emergencyAllowance || 0;
    totalShiftAllowanceSum += row.shiftAllowance || 0;
    if (row.codeLeave) {
      totalLeaveCount++;
    }

    rows.push(row);
  }

  return {
    empNo: employee.empNo,
    gid: employee.gid,
    employee,
    monthYear,
    rows,
    totalWorkDays: actualWorkDaysCount,
    totalDiffTime: minutesToHHMM(totalDiffMinutes),
    totalLateTime: minutesToHHMM(totalLateMinutes),
    totalWorkHours: totalWorkHoursSum,
    totalOT1_5: totalOT1_5Sum,
    totalOT3_0: totalOT3_0Sum,
    totalStandby: totalStandbySum,
    totalEmergency: totalEmergencySum,
    totalShiftAllowance: totalShiftAllowanceSum,
    totalLeaveDays: totalLeaveCount,
  };
}

/**
 * Ultra-optimized batch TimeSheet generator for multiple employees.
 * Pre-indexes all shifts, punches, OT, and allowances once, reducing computational complexity
 * from O(N_emp * N_punches * N_plans) down to O(N_punches + N_plans + N_emp * 31).
 */
export function buildTimeSheetsInBatch(
  employees: Employee[],
  monthYear: string,
  shiftCodes: ShiftCode[],
  shiftPlans: DailyShiftPlan[],
  allPunches: BiometricRawPunch[],
  otRecords: OTRecord[],
  allowances: OtherAllowance[],
  manualOverrides: Record<string, Partial<TimeSheetRow>> = {}
): TimeSheetSummary[] {
  if (!employees || employees.length === 0) return [];

  // Index shift plans once
  const planByEmpNo = new Map<string, DailyShiftPlan>();
  const planByGid = new Map<string, DailyShiftPlan>();
  for (const sp of shiftPlans || []) {
    if (!sp || !sp.date) continue;
    const spEmp = cleanIdentifier(sp.empNo).toUpperCase();
    const spGid = cleanIdentifier(sp.gid).toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (spEmp) {
      planByEmpNo.set(`${spEmp}_${sp.date}`, sp);
      const spDigits = spEmp.replace(/\D/g, '').replace(/^0+/, '');
      if (spDigits) {
        planByEmpNo.set(`${spDigits}_${sp.date}`, sp);
        planByEmpNo.set(`${spDigits.padStart(4, '0')}_${sp.date}`, sp);
      }
    }
    if (spGid) {
      planByGid.set(`${spGid}_${sp.date}`, sp);
    }
  }

  // Index punches by clean identifier
  const punchesById = new Map<string, BiometricRawPunch[]>();
  for (const p of allPunches || []) {
    if (!p || typeof p !== 'object' || typeof p.time !== 'string' || !p.time.trim() || !p.date) continue;
    const pId = cleanIdentifier(p.empIdentifier || (p as any).empNo || (p as any).gid);
    if (!pId) continue;
    const key = pId.toUpperCase();
    let list = punchesById.get(key);
    if (!list) {
      list = [];
      punchesById.set(key, list);
    }
    list.push(p);

    const digits = key.replace(/\D/g, '').replace(/^0+/, '');
    if (digits && digits !== key) {
      let dList = punchesById.get(digits);
      if (!dList) {
        dList = [];
        punchesById.set(digits, dList);
      }
      dList.push(p);
    }
  }

  // Filter & index OT for this month
  const otByEmpKey = new Map<string, OTRecord[]>();
  for (const ot of otRecords || []) {
    if (!ot || ot.status !== 'Approved') continue;
    const targetDate = ot.retroactiveTargetDate || ot.date;
    if (!targetDate || !targetDate.startsWith(monthYear)) continue;

    const rEmp = cleanIdentifier(ot.empNo).toUpperCase();
    const rGid = cleanIdentifier(ot.gid).toUpperCase();

    const addOT = (k: string) => {
      if (!k) return;
      let list = otByEmpKey.get(k);
      if (!list) {
        list = [];
        otByEmpKey.set(k, list);
      }
      list.push(ot);
    };

    if (rEmp) {
      addOT(rEmp);
      const digits = rEmp.replace(/\D/g, '').replace(/^0+/, '');
      if (digits) {
        addOT(digits);
        addOT(digits.padStart(4, '0'));
      }
    }
    if (rGid) {
      addOT(rGid);
    }
  }

  // Filter & index allowances for this month
  const allowancesByEmpKey = new Map<string, OtherAllowance[]>();
  for (const a of allowances || []) {
    if (!a || a.monthYear !== monthYear) continue;
    const aEmp = cleanIdentifier(a.empNo).toUpperCase();
    const aGid = cleanIdentifier(a.gid).toUpperCase();

    const addA = (k: string) => {
      if (!k) return;
      let list = allowancesByEmpKey.get(k);
      if (!list) {
        list = [];
        allowancesByEmpKey.set(k, list);
      }
      list.push(a);
    };

    if (aEmp) {
      addA(aEmp);
      const digits = aEmp.replace(/\D/g, '').replace(/^0+/, '');
      if (digits) {
        addA(digits);
        addA(digits.padStart(4, '0'));
      }
    }
    if (aGid) {
      addA(aGid);
    }
  }

  return employees.map(employee => {
    // Collect punches for this employee from indexed map
    const empPunchesSet = new Set<BiometricRawPunch>();
    const empNoClean = cleanIdentifier(employee.empNo).toUpperCase();
    const empNoDigits = empNoClean.replace(/\D/g, '').replace(/^0+/, '');
    const empGidClean = cleanIdentifier(employee.gid).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const empCodeClean = cleanIdentifier(employee.empCode).toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (empNoClean && punchesById.has(empNoClean)) punchesById.get(empNoClean)!.forEach(p => empPunchesSet.add(p));
    if (empNoDigits && punchesById.has(empNoDigits)) punchesById.get(empNoDigits)!.forEach(p => empPunchesSet.add(p));
    if (empGidClean && punchesById.has(empGidClean)) punchesById.get(empGidClean)!.forEach(p => empPunchesSet.add(p));
    if (empCodeClean && punchesById.has(empCodeClean)) punchesById.get(empCodeClean)!.forEach(p => empPunchesSet.add(p));

    const empPunches = empPunchesSet.size > 0 ? Array.from(empPunchesSet) : allPunches;

    // Collect OT for this employee
    const empOTSet = new Set<OTRecord>();
    if (empNoClean && otByEmpKey.has(empNoClean)) otByEmpKey.get(empNoClean)!.forEach(o => empOTSet.add(o));
    if (empNoDigits && otByEmpKey.has(empNoDigits)) otByEmpKey.get(empNoDigits)!.forEach(o => empOTSet.add(o));
    if (empGidClean && otByEmpKey.has(empGidClean)) otByEmpKey.get(empGidClean)!.forEach(o => empOTSet.add(o));
    if (empCodeClean && otByEmpKey.has(empCodeClean)) otByEmpKey.get(empCodeClean)!.forEach(o => empOTSet.add(o));
    const empOT = empOTSet.size > 0 ? Array.from(empOTSet) : otRecords;

    // Collect allowances for this employee
    const empAllowancesSet = new Set<OtherAllowance>();
    if (empNoClean && allowancesByEmpKey.has(empNoClean)) allowancesByEmpKey.get(empNoClean)!.forEach(a => empAllowancesSet.add(a));
    if (empNoDigits && allowancesByEmpKey.has(empNoDigits)) allowancesByEmpKey.get(empNoDigits)!.forEach(a => empAllowancesSet.add(a));
    if (empGidClean && allowancesByEmpKey.has(empGidClean)) allowancesByEmpKey.get(empGidClean)!.forEach(a => empAllowancesSet.add(a));
    if (empCodeClean && allowancesByEmpKey.has(empCodeClean)) allowancesByEmpKey.get(empCodeClean)!.forEach(a => empAllowancesSet.add(a));
    const empAllowances = empAllowancesSet.size > 0 ? Array.from(empAllowancesSet) : allowances;

    return buildTimeSheetForEmployee(
      employee,
      monthYear,
      shiftCodes,
      shiftPlans,
      empPunches,
      empOT,
      empAllowances,
      manualOverrides
    );
  });
}
