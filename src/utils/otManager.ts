import { OTRecord, Employee } from '../types';

export type OTMergeMode = 'smart_merge' | 'replace_month' | 'append_all';

export interface OTMergeDetail {
  empNo: string;
  gid: string;
  empName: string;
  department: string;
  date: string;
  rate: 1.5 | 3.0;
  status: 'NEW_ADDED' | 'PREVENTED_DUPLICATE' | 'UPDATED_HOURS';
  oldHours?: number;
  newHours: number;
  reason: string;
  timeSlot?: string;
}

export interface OTMergeResult {
  merged: OTRecord[];
  totalIncoming: number;
  addedCount: number;
  updatedCount: number;
  duplicatePreventedCount: number;
  totalHoursBefore: number;
  totalHoursAfter: number;
  netHoursDelta: number;
  impactedEmployeeCount: number;
  details: OTMergeDetail[];
}

/**
 * Standardize any date input (Excel serial number, M/D/YYYY, D/M/YYYY, YYYY-MM-DD, Thai Buddhist Era)
 * into a uniform ISO date "YYYY-MM-DD".
 */
export function normalizeOTDate(
  raw: any,
  formatHint?: 'MDY' | 'DMY',
  preferredMonthYear?: string
): string {
  if (raw === null || raw === undefined || raw === '') return '';

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const s = String(raw).trim();

  // Excel serial date number (both integer e.g. 46162, 46262 and floating point e.g. 46262.0000462963)
  const numSerial = Number(s);
  if (!isNaN(numSerial) && numSerial >= 30000 && numSerial <= 80000 && /^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(numSerial);
    // Excel base date Dec 30 1899
    const utcDays = serial - 25569;
    const date = new Date(utcDays * 86400 * 1000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Handle DD-MMM-YY, DD-MMM-YYYY, D-MMM-YY (e.g. 30-Apr-26, 29-Apr-26, 30-เม.ย.-26, 30 Apr 2026)
  const MONTH_MAP: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    'ม.ค': 1, 'ก.พ': 2, 'มี.ค': 3, 'เม.ย': 4, 'พ.ค': 5, 'มิ.ย': 6,
    'ก.ค': 7, 'ส.ค': 8, 'ก.ย': 9, 'ต.ค': 10, 'พ.ย': 11, 'ธ.ค': 12,
    'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
    'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
    'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4, 'พฤษภาคม': 5, 'มิถุนายน': 6,
    'กรกฎาคม': 7, 'สิงหาคม': 8, 'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12
  };

  const dMmmY = s.match(/^(\d{1,2})[-\s\/.]([a-zA-Z\u0E00-\u0E7F\.]+)[-\s\/.]([0-9]{2,4})$/);
  if (dMmmY) {
    const d = parseInt(dMmmY[1], 10);
    const mKey = dMmmY[2].toLowerCase().replace(/\.$/, '');
    let y = parseInt(dMmmY[3], 10);
    if (dMmmY[3].length === 2) y += (y >= 70 ? 1900 : 2000);
    if (y > 2400) y -= 543;
    const m = MONTH_MAP[mKey] || MONTH_MAP[dMmmY[2].toLowerCase()];
    if (m) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // Handle MMM-DD-YY, MMM-DD-YYYY (e.g. Apr-30-26, Apr 30, 2026)
  const mmmDY = s.match(/^([a-zA-Z\u0E00-\u0E7F\.]+)[-\s\/.]([0-9]{1,2})[-\s\/.,]+([0-9]{2,4})$/);
  if (mmmDY) {
    const mKey = mmmDY[1].toLowerCase().replace(/\.$/, '');
    const d = parseInt(mmmDY[2], 10);
    let y = parseInt(mmmDY[3], 10);
    if (mmmDY[3].length === 2) y += (y >= 70 ? 1900 : 2000);
    if (y > 2400) y -= 543;
    const m = MONTH_MAP[mKey] || MONTH_MAP[mmmDY[1].toLowerCase()];
    if (m) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // Handle YYYY/MM/DD or YYYY-MM-DD or YYYY.MM.DD
  const ymdMatch = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (ymdMatch) {
    let y = parseInt(ymdMatch[1], 10);
    if (y > 2400) y -= 543;
    const m = ymdMatch[2].padStart(2, '0');
    const d = ymdMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Handle A/B/YYYY or A-B-YYYY or A.B.YYYY (or 2-digit year)
  const slashMatch = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (slashMatch) {
    const part1 = parseInt(slashMatch[1], 10);
    const part2 = parseInt(slashMatch[2], 10);
    let y = parseInt(slashMatch[3], 10);
    if (slashMatch[3].length === 2) {
      y += (y >= 70 ? 1900 : 2000);
    }
    if (y > 2400) y -= 543; // Thai Buddhist Era (2569 -> 2026)

    let m: number;
    let d: number;

    if (part2 > 12 && part1 <= 12) {
      // Unambiguous M/D/YYYY (e.g. 8/28/2026 -> month 8, day 28)
      m = part1;
      d = part2;
    } else if (part1 > 12 && part2 <= 12) {
      // Unambiguous D/M/YYYY (e.g. 28/8/2026 -> day 28, month 8)
      d = part1;
      m = part2;
    } else if (formatHint === 'MDY') {
      // Explicit or detected file convention: Month first
      m = part1;
      d = part2;
    } else if (formatHint === 'DMY') {
      // Explicit or detected file convention: Day first
      d = part1;
      m = part2;
    } else if (preferredMonthYear) {
      // Match against expected month in preferredMonthYear (e.g. "2026-08")
      const prefM = parseInt(preferredMonthYear.split('-')[1] || '0', 10);
      if (part1 === prefM && part2 !== prefM) {
        m = part1;
        d = part2;
      } else if (part2 === prefM && part1 !== prefM) {
        d = part1;
        m = part2;
      } else {
        m = part1;
        d = part2;
      }
    } else {
      // Default to M/D/YYYY for standard Power BI / Excel data
      m = part1;
      d = part2;
    }

    const mStr = String(m).padStart(2, '0');
    const dStr = String(d).padStart(2, '0');
    return `${y}-${mStr}-${dStr}`;
  }

  return s;
}

/**
 * Scan rows to auto-detect whether slash-separated dates follow 'MDY' (US/PowerBI) or 'DMY' (Thai/UK)
 */
export function detectFileDateFormat(rawRows: any[]): 'MDY' | 'DMY' | undefined {
  if (!rawRows || rawRows.length === 0) return undefined;

  let mdyEvidence = 0;
  let dmyEvidence = 0;

  for (let i = 0; i < Math.min(rawRows.length, 200); i++) {
    const row = rawRows[i];
    if (!row) continue;
    const rawDate = row['Date'] || row['OT Date'] || row['OTDate'] || row['Work Date'] ||
      row['WorkDate'] || row['วันที่'] || row['วันที่ทำโอที'] || '';
    const s = String(rawDate).trim();
    const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
    if (m) {
      const p1 = parseInt(m[1], 10);
      const p2 = parseInt(m[2], 10);
      if (p1 <= 12 && p2 > 12) mdyEvidence++;
      if (p1 > 12 && p2 <= 12) dmyEvidence++;
    }
  }

  if (mdyEvidence > dmyEvidence) return 'MDY';
  if (dmyEvidence > mdyEvidence) return 'DMY';
  return undefined;
}

/**
 * Flexibly normalizes any OT time input (fraction of day float e.g. 0.2916666666666667, HH:mm:ss, HH:mm, HH.mm, 4-digits)
 * into a clean standard "HH:mm" 24-hour string.
 */
export function normalizeOTTime(raw: any, defaultFallback: string = ''): string {
  if (raw === null || raw === undefined) return defaultFallback;
  const s = String(raw).trim();
  if (!s) return defaultFallback;

  // 1. If floating point number (fraction of a 24-hour day in Excel, e.g. 0.2916666666666667, 0.7083333333333334, 0.875)
  if (/^0?\.\d+$/.test(s)) {
    const num = parseFloat(s);
    if (!isNaN(num) && num >= 0 && num < 1) {
      const totalMinutes = Math.round(num * 1440) % 1440;
      const hh = Math.floor(totalMinutes / 60);
      const mm = totalMinutes % 60;
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }

  // 2. If number is larger than 1 with decimals (Excel serial datetime like 46262.2916666667)
  const floatNum = Number(s);
  if (!isNaN(floatNum) && floatNum > 1 && s.includes('.')) {
    const fraction = floatNum - Math.floor(floatNum);
    const totalMinutes = Math.round(fraction * 1440) % 1440;
    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  // 3. HH:MM:SS or HH:MM (e.g. "06:00:00", "07:00", "7:00")
  const hhmmMatch = s.match(/^(\d{1,2}):(\d{2})(:(\d{2}))?$/);
  if (hhmmMatch) {
    const hh = String(parseInt(hhmmMatch[1], 10)).padStart(2, '0');
    const mm = hhmmMatch[2];
    return `${hh}:${mm}`;
  }

  // 4. Dot notation (e.g. "17.30", "06.00")
  const dotMatch = s.match(/^(\d{1,2})\.(\d{2})$/);
  if (dotMatch) {
    const hh = String(parseInt(dotMatch[1], 10)).padStart(2, '0');
    const mm = dotMatch[2];
    return `${hh}:${mm}`;
  }

  // 5. 3 or 4 digits without separator (e.g. "0600", "1730")
  if (/^\d{3,4}$/.test(s)) {
    const hh = s.length === 3 ? s.substring(0, 1) : s.substring(0, 2);
    const mm = s.length === 3 ? s.substring(1, 3) : s.substring(2, 4);
    return `${hh.padStart(2, '0')}:${mm}`;
  }

  return s || defaultFallback;
}

/**
 * Format any timeSlot string (e.g. "0.2916666666666667-0.4583333333333333", "07:00-11:00", "17:30 - 20:30")
 * into clean "HH:mm - HH:mm".
 */
export function formatTimeSlot(timeSlot?: string | null): string {
  if (!timeSlot || timeSlot === '-' || timeSlot.trim() === '') return '17:30 - 20:30';
  const trimmed = timeSlot.trim();
  const parts = trimmed.split(/\s*[-–—]\s*/);
  if (parts.length === 2) {
    const start = normalizeOTTime(parts[0], parts[0]);
    const end = normalizeOTTime(parts[1], parts[1]);
    return `${start} - ${end}`;
  }
  return normalizeOTTime(trimmed, trimmed);
}

/**
 * Resolve employee identity to canonical empNo and gid using Employee Master
 */
export function getEmployeeFullName(employee?: Employee): string {
  if (!employee) return '';
  return `${employee.firstName || ''} ${employee.familyName || ''}`.trim();
}

export function resolveEmployeeIdentity(
  empNo: string,
  gid: string,
  employees: Employee[]
): { canonicalEmpNo: string; canonicalGid: string; employee?: Employee } {
  const cleanEmpNo = (empNo || '').trim();
  const cleanGid = (gid || '').trim();

  const matched = employees.find(e => {
    if (cleanEmpNo && e.empNo.toLowerCase() === cleanEmpNo.toLowerCase()) return true;
    if (cleanGid && e.gid.toLowerCase() === cleanGid.toLowerCase()) return true;
    // Match numeric padding (e.g. "950" vs "0950")
    if (cleanEmpNo && !isNaN(Number(cleanEmpNo)) && !isNaN(Number(e.empNo))) {
      return Number(cleanEmpNo) === Number(e.empNo);
    }
    return false;
  });

  return {
    canonicalEmpNo: matched ? matched.empNo : cleanEmpNo,
    canonicalGid: matched ? matched.gid : cleanGid,
    employee: matched,
  };
}

/**
 * Key generator for comparing employee OT records on a specific date
 */
export function getOTDayPersonKey(
  empNo: string,
  gid: string,
  targetDate: string,
  rate: 1.5 | 3.0,
  employees: Employee[]
): string {
  const { canonicalEmpNo, canonicalGid } = resolveEmployeeIdentity(empNo, gid, employees);
  const primaryId = (canonicalEmpNo || canonicalGid).toUpperCase();
  const normalizedDate = normalizeOTDate(targetDate) || targetDate;
  return `${primaryId}__${normalizedDate}__${rate}`;
}

/**
 * Merge and deduplicate OT records during file re-import.
 * Guarantees that re-importing the whole month with previous data does NOT double hours
 * for each person on each day of that month.
 */
export function mergeAndDeduplicateOTRecords(
  existingRecords: OTRecord[],
  incomingRecords: OTRecord[],
  targetMonthYear: string, // e.g. "2026-05" or "ALL"
  targetRate: 1.5 | 3.0 | 'ALL',
  mode: OTMergeMode = 'smart_merge',
  employees: Employee[] = []
): OTMergeResult {
  const totalIncoming = incomingRecords.length;
  const details: OTMergeDetail[] = [];
  let addedCount = 0;
  let updatedCount = 0;
  let duplicatePreventedCount = 0;

  // Calculate total hours before merge for the affected month/rate
  const isTargetScope = (r: OTRecord) => {
    const d = r.retroactiveTargetDate || r.date || '';
    const normD = normalizeOTDate(d);
    const matchesMonth = targetMonthYear === 'ALL' || normD.startsWith(targetMonthYear) || d.startsWith(targetMonthYear);
    const matchesRate = targetRate === 'ALL' || r.rate === targetRate;
    return matchesMonth && matchesRate;
  };

  const hoursBefore = existingRecords
    .filter(isTargetScope)
    .reduce((acc, r) => acc + (Number(r.hours) || 0), 0);

  // If append_all mode selected explicitly
  if (mode === 'append_all') {
    const merged = [...existingRecords, ...incomingRecords];
    const hoursAfter = merged
      .filter(isTargetScope)
      .reduce((acc, r) => acc + (Number(r.hours) || 0), 0);

    incomingRecords.forEach(r => {
      const { canonicalEmpNo, canonicalGid, employee } = resolveEmployeeIdentity(r.empNo, r.gid, employees);
      details.push({
        empNo: canonicalEmpNo,
        gid: canonicalGid,
        empName: getEmployeeFullName(employee),
        department: employee?.department || '',
        date: r.retroactiveTargetDate || r.date,
        rate: r.rate,
        status: 'NEW_ADDED',
        newHours: r.hours,
        reason: r.reason || '',
        timeSlot: formatTimeSlot(`${r.startTime || ''}-${r.endTime || ''}`),
      });
    });

    return {
      merged,
      totalIncoming,
      addedCount: incomingRecords.length,
      updatedCount: 0,
      duplicatePreventedCount: 0,
      totalHoursBefore: hoursBefore,
      totalHoursAfter: hoursAfter,
      netHoursDelta: hoursAfter - hoursBefore,
      impactedEmployeeCount: new Set(incomingRecords.map(r => r.empNo || r.gid)).size,
      details,
    };
  }

  // Partition existing records into unaffected (other months/rates) vs affected
  const unaffectedExisting: OTRecord[] = [];
  const affectedExisting: OTRecord[] = [];

  existingRecords.forEach(r => {
    if (isTargetScope(r)) {
      affectedExisting.push(r);
    } else {
      unaffectedExisting.push(r);
    }
  });

  // Map to hold merged records for the target scope
  let mergedTargetRecords: OTRecord[] = [];

  if (mode === 'replace_month') {
    // Mode: REPLACE MONTH
    // Existing records for this month and rate are cleanly cleared and replaced with incoming
    // Compare each incoming record against what previously existed to provide accurate statistics
    const affectedExistingMap = new Map<string, OTRecord[]>();
    affectedExisting.forEach(r => {
      const key = getOTDayPersonKey(r.empNo, r.gid, r.retroactiveTargetDate || r.date, r.rate, employees);
      if (!affectedExistingMap.has(key)) affectedExistingMap.set(key, []);
      affectedExistingMap.get(key)!.push(r);
    });

    incomingRecords.forEach(inRec => {
      const { canonicalEmpNo, canonicalGid, employee } = resolveEmployeeIdentity(inRec.empNo, inRec.gid, employees);
      const targetDate = inRec.retroactiveTargetDate || inRec.date;
      const key = getOTDayPersonKey(canonicalEmpNo, canonicalGid, targetDate, inRec.rate, employees);
      const prevList = affectedExistingMap.get(key);

      const normalizedRec: OTRecord = {
        ...inRec,
        empNo: canonicalEmpNo,
        gid: canonicalGid,
      };

      if (prevList && prevList.length > 0) {
        // Find if slot or hours match
        const inSlot = formatTimeSlot(`${inRec.startTime || ''}-${inRec.endTime || ''}`);
        const prevSlot = prevList.find(p => {
          const pSlot = formatTimeSlot(`${p.startTime || ''}-${p.endTime || ''}`);
          return pSlot === inSlot || prevList.length === 1;
        }) || prevList[0];

        if (Number(prevSlot.hours) === Number(inRec.hours)) {
          duplicatePreventedCount++;
          details.push({
            empNo: canonicalEmpNo,
            gid: canonicalGid,
            empName: getEmployeeFullName(employee),
            department: employee?.department || '',
            date: targetDate,
            rate: inRec.rate,
            status: 'PREVENTED_DUPLICATE',
            oldHours: prevSlot.hours,
            newHours: inRec.hours,
            reason: inRec.reason,
            timeSlot: formatTimeSlot(`${inRec.startTime}-${inRec.endTime}`),
          });
        } else {
          updatedCount++;
          details.push({
            empNo: canonicalEmpNo,
            gid: canonicalGid,
            empName: getEmployeeFullName(employee),
            department: employee?.department || '',
            date: targetDate,
            rate: inRec.rate,
            status: 'UPDATED_HOURS',
            oldHours: prevSlot.hours,
            newHours: inRec.hours,
            reason: inRec.reason,
            timeSlot: formatTimeSlot(`${inRec.startTime}-${inRec.endTime}`),
          });
        }
      } else {
        addedCount++;
        details.push({
          empNo: canonicalEmpNo,
          gid: canonicalGid,
          empName: getEmployeeFullName(employee),
          department: employee?.department || '',
          date: targetDate,
          rate: inRec.rate,
          status: 'NEW_ADDED',
          newHours: inRec.hours,
          reason: inRec.reason,
          timeSlot: formatTimeSlot(`${inRec.startTime}-${inRec.endTime}`),
        });
      }

      mergedTargetRecords.push(normalizedRec);
    });
  } else {
    // Mode: SMART MERGE (Default: Non-doubling Upsert)
    // Groups existing records by Person + Date + Rate
    const existingGroupMap = new Map<string, OTRecord[]>();
    affectedExisting.forEach(r => {
      const { canonicalEmpNo, canonicalGid } = resolveEmployeeIdentity(r.empNo, r.gid, employees);
      const targetDate = r.retroactiveTargetDate || r.date;
      const key = getOTDayPersonKey(canonicalEmpNo, canonicalGid, targetDate, r.rate, employees);
      if (!existingGroupMap.has(key)) existingGroupMap.set(key, []);
      existingGroupMap.get(key)!.push({
        ...r,
        empNo: canonicalEmpNo,
        gid: canonicalGid,
      });
    });

    // Group incoming records by Person + Date + Rate
    const incomingGroupMap = new Map<string, OTRecord[]>();
    incomingRecords.forEach(r => {
      const { canonicalEmpNo, canonicalGid } = resolveEmployeeIdentity(r.empNo, r.gid, employees);
      const targetDate = r.retroactiveTargetDate || r.date;
      const key = getOTDayPersonKey(canonicalEmpNo, canonicalGid, targetDate, r.rate, employees);
      if (!incomingGroupMap.has(key)) incomingGroupMap.set(key, []);
      incomingGroupMap.get(key)!.push({
        ...r,
        empNo: canonicalEmpNo,
        gid: canonicalGid,
      });
    });

    // Process each incoming group
    incomingGroupMap.forEach((inList, key) => {
      const exList = existingGroupMap.get(key);

      if (!exList || exList.length === 0) {
        // Entirely new person/day record(s) - e.g. late approvals
        inList.forEach(inRec => {
          addedCount++;
          const { canonicalEmpNo, canonicalGid, employee } = resolveEmployeeIdentity(inRec.empNo, inRec.gid, employees);
          details.push({
            empNo: canonicalEmpNo,
            gid: canonicalGid,
            empName: getEmployeeFullName(employee),
            department: employee?.department || '',
            date: inRec.retroactiveTargetDate || inRec.date,
            rate: inRec.rate,
            status: 'NEW_ADDED',
            newHours: inRec.hours,
            reason: inRec.reason,
            timeSlot: formatTimeSlot(`${inRec.startTime}-${inRec.endTime}`),
          });
          mergedTargetRecords.push(inRec);
        });
      } else {
        // Person already has record(s) on this date with this rate!
        // We must reconcile and avoid doubling!
        // Track which existing slots have been matched
        const matchedExistingIds = new Set<string>();

        inList.forEach((inRec, idx) => {
          const { canonicalEmpNo, canonicalGid, employee } = resolveEmployeeIdentity(inRec.empNo, inRec.gid, employees);
          const targetDate = inRec.retroactiveTargetDate || inRec.date;

          // Try matching by normalized time slot first, or by index
          const inSlot = formatTimeSlot(`${inRec.startTime || ''}-${inRec.endTime || ''}`);
          let match = exList.find(e => {
            if (matchedExistingIds.has(e.id)) return false;
            const eSlot = formatTimeSlot(`${e.startTime || ''}-${e.endTime || ''}`);
            return eSlot === inSlot;
          });

          if (!match && idx < exList.length && !matchedExistingIds.has(exList[idx].id)) {
            match = exList[idx];
          }

          if (!match) {
            // Unmatched non-consumed existing record
            match = exList.find(e => !matchedExistingIds.has(e.id));
          }

          if (match) {
            matchedExistingIds.add(match.id);

            // Reconcile: Is it identical or updated?
            const isSameHours = Number(match.hours) === Number(inRec.hours);
            const isSameReason = (match.reason || '').trim() === (inRec.reason || '').trim();

            if (isSameHours && isSameReason) {
              // Exact duplicate! Prevent doubling!
              duplicatePreventedCount++;
              details.push({
                empNo: canonicalEmpNo,
                gid: canonicalGid,
                empName: getEmployeeFullName(employee),
                department: employee?.department || '',
                date: targetDate,
                rate: inRec.rate,
                status: 'PREVENTED_DUPLICATE',
                oldHours: match.hours,
                newHours: inRec.hours,
                reason: inRec.reason,
                timeSlot: formatTimeSlot(`${inRec.startTime}-${inRec.endTime}`),
              });
              // Keep the existing record (retaining its id, approved date, etc.)
              mergedTargetRecords.push(match);
            } else {
              // Hours or reason were updated in latest approved report
              updatedCount++;
              details.push({
                empNo: canonicalEmpNo,
                gid: canonicalGid,
                empName: getEmployeeFullName(employee),
                department: employee?.department || '',
                date: targetDate,
                rate: inRec.rate,
                status: 'UPDATED_HOURS',
                oldHours: match.hours,
                newHours: inRec.hours,
                reason: inRec.reason,
                timeSlot: formatTimeSlot(`${inRec.startTime}-${inRec.endTime}`),
              });
              // Update with new approved hours and reason, preserving id
              mergedTargetRecords.push({
                ...match,
                hours: inRec.hours,
                reason: inRec.reason || match.reason,
                startTime: inRec.startTime || match.startTime,
                endTime: inRec.endTime || match.endTime,
                approvedBy: inRec.approvedBy || match.approvedBy,
              });
            }
          } else {
            // Incoming file has an additional distinct OT slot on this day that wasn't there before
            addedCount++;
            details.push({
              empNo: canonicalEmpNo,
              gid: canonicalGid,
              empName: getEmployeeFullName(employee),
              department: employee?.department || '',
              date: targetDate,
              rate: inRec.rate,
              status: 'NEW_ADDED',
              newHours: inRec.hours,
              reason: inRec.reason,
              timeSlot: formatTimeSlot(`${inRec.startTime}-${inRec.endTime}`),
            });
            mergedTargetRecords.push(inRec);
          }
        });

        // Any existing records that were NOT in the incoming file:
        // In smart_merge mode, we preserve them
        exList.forEach(e => {
          if (!matchedExistingIds.has(e.id)) {
            mergedTargetRecords.push(e);
          }
        });
      }
    });

    // Also preserve any existing records whose person/day was not mentioned in the incoming file at all
    existingGroupMap.forEach((exList, key) => {
      if (!incomingGroupMap.has(key)) {
        exList.forEach(e => mergedTargetRecords.push(e));
      }
    });
  }

  // Combine unaffected + merged target records
  const finalMerged = [...unaffectedExisting, ...mergedTargetRecords];

  const hoursAfter = finalMerged
    .filter(isTargetScope)
    .reduce((acc, r) => acc + (Number(r.hours) || 0), 0);

  const impactedEmployeeCount = new Set(details.map(d => d.empNo || d.gid)).size;

  return {
    merged: finalMerged,
    totalIncoming,
    addedCount,
    updatedCount,
    duplicatePreventedCount,
    totalHoursBefore: hoursBefore,
    totalHoursAfter: hoursAfter,
    netHoursDelta: hoursAfter - hoursBefore,
    impactedEmployeeCount,
    details,
  };
}

/**
 * Sanitize all OT records:
 * Converts any stray Excel serial floats (e.g. "46262.0000462963") into proper "YYYY-MM-DD"
 */
export function sanitizeOTRecords(records: OTRecord[]): OTRecord[] {
  if (!records || !Array.isArray(records)) return [];
  return records.map(r => {
    let cleanDate = r.date;
    let cleanOriginalDate = r.originalDate || r.date;
    let cleanRetroTargetDate = r.retroactiveTargetDate;

    if (cleanDate && (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate) || /^\d{5}(\.\d+)?$/.test(cleanDate))) {
      const norm = normalizeOTDate(cleanDate);
      if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) cleanDate = norm;
    }
    if (cleanOriginalDate && (!/^\d{4}-\d{2}-\d{2}$/.test(cleanOriginalDate) || /^\d{5}(\.\d+)?$/.test(cleanOriginalDate))) {
      const norm = normalizeOTDate(cleanOriginalDate);
      if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) cleanOriginalDate = norm;
    }
    if (cleanRetroTargetDate && (!/^\d{4}-\d{2}-\d{2}$/.test(cleanRetroTargetDate) || /^\d{5}(\.\d+)?$/.test(cleanRetroTargetDate))) {
      const norm = normalizeOTDate(cleanRetroTargetDate);
      if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) cleanRetroTargetDate = norm;
    }

    return {
      ...r,
      date: cleanDate || r.date,
      originalDate: cleanOriginalDate || r.originalDate,
      retroactiveTargetDate: cleanRetroTargetDate || r.retroactiveTargetDate,
    };
  });
}

/**
 * Force a date string to belong strictly to the targetMonthYear (YYYY-MM).
 * Preserves the day of month from the original date, clamping to max days of target month.
 */
export function forceDateToTargetMonth(dateStr: string, targetMonthYear: string): string {
  if (!targetMonthYear || !/^\d{4}-\d{2}$/.test(targetMonthYear)) return dateStr;
  const [tYearStr, tMonthStr] = targetMonthYear.split('-');
  const tYear = parseInt(tYearStr, 10);
  const tMonth = parseInt(tMonthStr, 10);
  const maxDays = new Date(tYear, tMonth, 0).getDate();

  // If dateStr is already in targetMonthYear, return it directly
  if (dateStr && dateStr.startsWith(targetMonthYear)) {
    return dateStr;
  }

  // Extract day from dateStr
  let day = 1;
  const ymdMatch = (dateStr || '').match(/^\d{4}-\d{2}-(\d{1,2})$/);
  if (ymdMatch) {
    day = parseInt(ymdMatch[1], 10);
  } else {
    const dMatch = (dateStr || '').match(/\b([0-2]?[0-9]|3[01])\b/);
    if (dMatch) day = parseInt(dMatch[1], 10);
  }

  const clampedDay = Math.min(Math.max(day, 1), maxDays);
  return `${targetMonthYear}-${String(clampedDay).padStart(2, '0')}`;
}

