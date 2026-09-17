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
 * Match a biometric punch identifier to an employee
 * Handles exact match, GID match, leading-zero differences ("0451" vs "451", "01503" vs "1503", "0082" vs "82"),
 * and prefix variations (SM549, etc.)
 */
export function isEmployeeMatch(
  punchIdentifier: string,
  employee: { empNo?: string; gid?: string }
): boolean {
  if (!punchIdentifier || !employee) return false;
  const p = punchIdentifier.trim().toLowerCase();
  const eNo = (employee.empNo || '').trim().toLowerCase();
  const gid = (employee.gid || '').trim().toLowerCase();
  if (!p) return false;

  // 1. Direct match with empNo or GID
  if (p === eNo || (gid && p === gid)) return true;

  // 2. Numeric match (handling leading zeros: "0451" vs "451", "01503" vs "1503", "0082" vs "82")
  const pNum = p.replace(/^0+/, '');
  const eNum = eNo.replace(/^0+/, '');
  if (pNum && eNum && pNum === eNum) return true;

  // 3. Substring / Prefix match
  if (eNo && (p.startsWith(eNo) || eNo.startsWith(p))) return true;
  if (gid && (p.startsWith(gid) || gid.startsWith(p))) return true;

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

/**
 * Resolve ShiftCode metadata from map even with custom tags or aliases
 */
export function resolveShiftInfo(rawCode: string, shiftCodeMap: Map<string, ShiftCode>): ShiftCode | undefined {
  if (!rawCode) return undefined;
  const upper = rawCode.trim().toUpperCase();

  // 1. Direct match
  if (shiftCodeMap.has(upper)) {
    return shiftCodeMap.get(upper);
  }

  // 2. Base code (without -X, -ET)
  const { baseCode } = parseShiftCodeTags(rawCode);
  if (baseCode && shiftCodeMap.has(baseCode)) {
    return shiftCodeMap.get(baseCode);
  }

  // 3. Leading 'A' alias (e.g. AD1 -> D1, AD2 -> D2, AE -> E, AN -> N)
  if (baseCode.startsWith('A') && baseCode.length > 1) {
    const strippedA = baseCode.slice(1);
    if (shiftCodeMap.has(strippedA)) {
      return shiftCodeMap.get(strippedA);
    }
  }

  // 4. Case-insensitive fallback
  for (const [key, val] of shiftCodeMap.entries()) {
    if (key.toUpperCase() === upper || key.toUpperCase() === baseCode) {
      return val;
    }
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
 * Convert "HH:mm" to total minutes from midnight
 */
export function hhmmToMinutes(timeStr: string): number {
  if (!timeStr || !timeStr.includes(':')) return 0;
  const [h, m] = timeStr.split(':').map(Number);
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
  if (!punches || punches.length === 0) {
    return {
      clockIn: '',
      clockOut: '',
      resolutionType: 'no_punches',
      resolutionDescription: 'ไม่มีบันทึกการสแกนเวลาในวันนี้',
      hasIrregularity: false,
    };
  }

  // Sort chronologically by time
  const sorted = [...punches].sort((a, b) => hhmmToMinutes(a.time) - hhmmToMinutes(b.time));

  // Cluster punches within 30 mins (Rule 6: "หากมีการบันทึกซ้ำในเวลาใกล้เคียงกันจะใช้เวลาล่าสุด")
  const clusters: BiometricRawPunch[][] = [];
  let currentCluster: BiometricRawPunch[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = currentCluster[currentCluster.length - 1];
    const diff = hhmmToMinutes(sorted[i].time) - hhmmToMinutes(prev.time);
    if (diff <= 30) {
      currentCluster.push(sorted[i]);
    } else {
      clusters.push(currentCluster);
      currentCluster = [sorted[i]];
    }
  }
  clusters.push(currentCluster);

  // Check if shift is cross-midnight night shift (e.g. 20:00 - 05:00)
  const isNightShift = Boolean(
    shiftInfo?.isWorkingDay &&
    shiftInfo?.startTime &&
    shiftInfo?.endTime &&
    hhmmToMinutes(shiftInfo.startTime) > hhmmToMinutes(shiftInfo.endTime)
  );

  // CASE 1: Single Distinct Cluster on this day
  if (clusters.length === 1) {
    const singleCluster = clusters[0];
    const repPunch = singleCluster[singleCluster.length - 1];
    const repTime = repPunch.time;

    // Check if night shift punch out is in next morning's punches
    if (isNightShift && nextDayPunches && nextDayPunches.length > 0) {
      // Find morning punch in next day (e.g. 03:00 - 10:00)
      const morningPunches = nextDayPunches
        .filter(p => hhmmToMinutes(p.time) >= 180 && hhmmToMinutes(p.time) <= 600)
        .sort((a, b) => hhmmToMinutes(a.time) - hhmmToMinutes(b.time));

      if (morningPunches.length > 0) {
        const nextMorningOut = morningPunches[morningPunches.length - 1].time;
        return {
          clockIn: repTime,
          clockOut: nextMorningOut,
          resolutionType: 'cross_midnight_resolved',
          resolutionDescription: `กะดึกข้ามคืน: เชื่อมโยงเวลาออกเช้าวันถัดไป (${nextMorningOut}) ตามกะ ${shiftInfo?.code || ''}`,
          hasIrregularity: true,
          shiftCodeUsed: shiftInfo?.code,
        };
      }
    }

    // Determine if this single scan is In or Out using Shift Code
    if (shiftInfo?.isWorkingDay && shiftInfo?.startTime && shiftInfo?.endTime) {
      const distToStart = circularTimeDistance(repTime, shiftInfo.startTime);
      const distToEnd = circularTimeDistance(repTime, shiftInfo.endTime);

      if (distToStart <= distToEnd) {
        return {
          clockIn: repTime,
          clockOut: '',
          resolutionType: 'single_in_only',
          resolutionDescription: `พบเฉพาะเวลาเข้างาน (${repTime}) ขาดการสแกนออก อ้างอิงตามกะ ${shiftInfo.code}`,
          hasIrregularity: true,
          shiftCodeUsed: shiftInfo.code,
        };
      } else {
        return {
          clockIn: '',
          clockOut: repTime,
          resolutionType: 'single_out_only',
          resolutionDescription: `พบเฉพาะเวลาออกงาน (${repTime}) ขาดการสแกนเข้า อ้างอิงตามกะ ${shiftInfo.code}`,
          hasIrregularity: true,
          shiftCodeUsed: shiftInfo.code,
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
      };
    } else {
      return {
        clockIn: repTime,
        clockOut: '',
        resolutionType: 'single_in_only',
        resolutionDescription: `พบเฉพาะเวลาเข้างาน (${repTime} สถานะ I)`,
        hasIrregularity: false,
      };
    }
  }

  // CASE 2: Multiple Clusters (>= 2 distinct time windows)
  const allTypes = sorted.map(p => p.type);
  const hasOnlyI = allTypes.every(t => t === 'I');
  const hasOnlyO = allTypes.every(t => t === 'O');

  // SUBCASE 2A: All punches are 'I' (Forgot to press Out at end of day)
  if (hasOnlyI) {
    const earliestCluster = clusters[0];
    const latestCluster = clusters[clusters.length - 1];
    const clockIn = earliestCluster[earliestCluster.length - 1].time;
    const clockOut = latestCluster[latestCluster.length - 1].time;

    let secondIn = '';
    let secondOut = '';
    if (clusters.length >= 4) {
      secondIn = clusters[1][clusters[1].length - 1].time;
      secondOut = clusters[2][clusters[2].length - 1].time;
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
    };
  }

  // SUBCASE 2B: All punches are 'O' (Mistakenly pressed Out on arrival)
  if (hasOnlyO) {
    const earliestCluster = clusters[0];
    const latestCluster = clusters[clusters.length - 1];
    const clockIn = earliestCluster[earliestCluster.length - 1].time;
    const clockOut = latestCluster[latestCluster.length - 1].time;

    let secondIn = '';
    let secondOut = '';
    if (clusters.length >= 4) {
      secondIn = clusters[1][clusters[1].length - 1].time;
      secondOut = clusters[2][clusters[2].length - 1].time;
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
    };
  }

  // SUBCASE 2C: Both 'I' and 'O' exist in punches
  const inPunches = sorted.filter(p => p.type === 'I');
  const outPunches = sorted.filter(p => p.type === 'O');

  // Cluster 'I' punches
  const inClusters: BiometricRawPunch[][] = [];
  if (inPunches.length > 0) {
    let curr: BiometricRawPunch[] = [inPunches[0]];
    for (let i = 1; i < inPunches.length; i++) {
      if (hhmmToMinutes(inPunches[i].time) - hhmmToMinutes(curr[curr.length - 1].time) <= 30) {
        curr.push(inPunches[i]);
      } else {
        inClusters.push(curr);
        curr = [inPunches[i]];
      }
    }
    inClusters.push(curr);
  }

  // Cluster 'O' punches
  const outClusters: BiometricRawPunch[][] = [];
  if (outPunches.length > 0) {
    let curr: BiometricRawPunch[] = [outPunches[0]];
    for (let i = 1; i < outPunches.length; i++) {
      if (hhmmToMinutes(outPunches[i].time) - hhmmToMinutes(curr[curr.length - 1].time) <= 30) {
        curr.push(outPunches[i]);
      } else {
        outClusters.push(curr);
        curr = [outPunches[i]];
      }
    }
    outClusters.push(curr);
  }

  const firstIn = inClusters.length > 0 ? inClusters[0][inClusters[0].length - 1].time : '';
  const lastOut = outClusters.length > 0 ? outClusters[outClusters.length - 1][outClusters[outClusters.length - 1].length - 1].time : '';

  // Check if In and Out are in normal chronological order
  if (firstIn && lastOut && hhmmToMinutes(firstIn) <= hhmmToMinutes(lastOut)) {
    // Normal Standard Case: First In and Last Out
    let clockIn = firstIn;
    let clockOut = lastOut;
    let secondIn = '';
    let secondOut = '';

    if (inClusters.length > 1) {
      secondIn = inClusters[1][inClusters[1].length - 1].time;
    }
    if (outClusters.length > 1) {
      secondOut = clockOut;
      clockOut = outClusters[0][outClusters[0].length - 1].time;
    }

    return {
      clockIn,
      clockOut,
      secondIn: secondIn || undefined,
      secondOut: secondOut || undefined,
      resolutionType: 'standard_in_out',
      resolutionDescription: 'บันทึกเวลาเข้า-ออกตามปกติ (In - Out)',
      hasIrregularity: false,
      shiftCodeUsed: shiftInfo?.code,
    };
  }

  // Check if buttons were inverted (e.g. employee pressed 'O' in morning and 'I' in evening on daytime shift)
  if (firstIn && lastOut && hhmmToMinutes(firstIn) > hhmmToMinutes(lastOut) && !isNightShift) {
    const earliestTime = clusters[0][clusters[0].length - 1].time;
    const latestTime = clusters[clusters.length - 1][clusters.length - 1].time;

    return {
      clockIn: earliestTime,
      clockOut: latestTime,
      resolutionType: 'inverted_resolved',
      resolutionDescription: `ตรวจพบการกดสลับปุ่ม (Out ตอนเช้า / In ตอนเย็น): ปรับเข้างานเป็น ${earliestTime} และเลิกงานเป็น ${latestTime} โดยเทียบกับ Shift Code ${shiftInfo?.code || ''}`,
      hasIrregularity: true,
      shiftCodeUsed: shiftInfo?.code,
    };
  }

  // Fallback: Use earliest and latest cluster
  const clockIn = clusters[0][clusters[0].length - 1].time;
  const clockOut = clusters[clusters.length - 1][clusters.length - 1].time;
  return {
    clockIn,
    clockOut,
    resolutionType: 'shift_time_aligned',
    resolutionDescription: `กำหนดเวลาเข้า (${clockIn}) และเลิกงาน (${clockOut}) ตามลำดับเวลาที่สแกน`,
    hasIrregularity: true,
    shiftCodeUsed: shiftInfo?.code,
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

  // Filter biometric punches matching either empNo or gid (robust tolerance for leading zeros & prefixes)
  const empPunches = allPunches.filter(p => isEmployeeMatch(p.empIdentifier, employee));

  // Filter approved OT for this month or retroactive OT assigned to this month
  const empOT = otRecords.filter(ot => {
    const isEmpMatch = ot.empNo === employee.empNo || ot.gid === employee.gid;
    if (!isEmpMatch) return false;
    const targetDate = ot.retroactiveTargetDate || ot.date;
    return targetDate.startsWith(monthYear) && ot.status === 'Approved';
  });

  // Filter other allowances for this month
  const empAllowances = allowances.filter(a => {
    const isEmpMatch = a.empNo === employee.empNo || a.gid === employee.gid;
    return isEmpMatch && a.monthYear === monthYear;
  });

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

    // Find shift code for this day from plan
    const plan = shiftPlans.find(sp => 
      (sp.empNo === employee.empNo || sp.gid === employee.gid) && sp.date === dateStr
    );
    const shiftCodeVal = plan ? plan.shiftCode : (dayOfWeek === 'Sat' || dayOfWeek === 'Sun' ? 'OFF' : 'D');

    // Check if there are manual overrides saved for this day
    const overrideKey = `${employee.empNo}_${dateStr}`;
    const overrides = manualOverrides[overrideKey] || {};

    const effectiveShiftCode = (overrides.shiftCode !== undefined ? overrides.shiftCode : shiftCodeVal) || '';

    // Parse shift code tags (-X for Standby 300฿, -ET for Emergency 300฿)
    const tagInfo = parseShiftCodeTags(effectiveShiftCode);
    const shiftInfo = resolveShiftInfo(effectiveShiftCode, shiftCodeMap);

    const shiftIn = shiftInfo?.isWorkingDay ? shiftInfo.startTime : '';
    const shiftOut = shiftInfo?.isWorkingDay ? shiftInfo.endTime : '';

    // Punches for this day
    const dayPunches = empPunches.filter(p => p.date === dateStr);

    // Look ahead to next day for night shift (cross-midnight) punch out
    let nextDateStr = '';
    if (d < totalDays) {
      const nextDayPadded = String(d + 1).padStart(2, '0');
      nextDateStr = `${monthYear}-${nextDayPadded}`;
    }
    const nextDayPunches = nextDateStr ? empPunches.filter(p => p.date === nextDateStr) : [];

    const punchResolution = filterDeduplicatedPunches(dayPunches, shiftInfo, nextDayPunches);
    const { clockIn, clockOut, secondIn, secondOut } = punchResolution;

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
    const dayOTs = empOT.filter(ot => (ot.retroactiveTargetDate || ot.date) === dateStr);
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

    const dayAllowances = empAllowances.filter(a => !a.date || a.date === dateStr);
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

    const row: TimeSheetRow = {
      date: dateStr,
      dayString,
      dayOfWeek,
      shiftCode: effectiveShiftCode,
      shiftIn: overrides.shiftIn !== undefined ? overrides.shiftIn : shiftIn,
      shiftOut: overrides.shiftOut !== undefined ? overrides.shiftOut : shiftOut,
      realTime1In: overrides.realTime1In !== undefined ? overrides.realTime1In : clockIn,
      realTime1Out: overrides.realTime1Out !== undefined ? overrides.realTime1Out : clockOut,
      diff1: overrides.diff1 !== undefined ? overrides.diff1 : diff1Str,
      diff1Hours: diff1Minutes / 60,
      late: overrides.late !== undefined ? overrides.late : lateStr,
      lateMinutes,
      realTime2In: overrides.realTime2In !== undefined ? overrides.realTime2In : (secondIn || ''),
      realTime2Out: overrides.realTime2Out !== undefined ? overrides.realTime2Out : (secondOut || ''),
      diff2: overrides.diff2 !== undefined ? overrides.diff2 : diff2Str,
      diff2Hours: diff2Minutes / 60,
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
