import { BiometricRawPunch, Employee, ShiftCode, DailyShiftPlan } from '../types';
import { isEmployeeMatch, hhmmToMinutes, minutesToHHMM, resolveShiftInfo, filterDeduplicatedPunches, getPunchKey } from './timeCalc';

/**
 * Normalizes an employee identifier for deduplication key
 * Strips leading zeros from numeric IDs so '0451' and '451' share the same canonical key
 */
export function canonicalEmpIdentifier(emp: string): string {
  if (!emp) return '';
  const trimmed = emp.trim().toLowerCase();
  const noZeros = trimmed.replace(/^0+/, '');
  return noZeros || trimmed;
}

/**
 * Helper to check if a token looks like a date (6 digits, 8 digits, YYYY-MM-DD, DD/MM/YYYY, etc.)
 */
function isDateToken(token: string): boolean {
  if (!token) return false;
  const clean = token.replace(/[-/.]/g, '');
  if (clean.length === 6 && /^\d{6}$/.test(clean)) return true;
  if (clean.length === 8 && /^\d{8}$/.test(clean)) return true;
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(token)) return true;
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(token)) return true;
  return false;
}

/**
 * Helper to check if a token looks like a time (4 digits, HH:MM, HH:MM:SS)
 */
function isTimeToken(token: string): boolean {
  if (!token) return false;
  const clean = token.replace(/:/g, '');
  if (clean.length === 4 && /^\d{4}$/.test(clean)) return true;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(token)) return true;
  return false;
}

/**
 * Normalizes any recognized date representation into YYYY-MM-DD
 */
function normalizeDate(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();

  // 6 digits: YYMMDD (e.g. 260901 -> 2026-09-01, 260128 -> 2026-01-28)
  if (/^\d{6}$/.test(trimmed)) {
    const yy = trimmed.substring(0, 2);
    const mm = trimmed.substring(2, 4);
    const dd = trimmed.substring(4, 6);
    return `20${yy}-${mm}-${dd}`;
  }

  // 8 digits: YYYYMMDD (e.g. 20260901 -> 2026-09-01)
  if (/^\d{8}$/.test(trimmed)) {
    const yyyy = trimmed.substring(0, 4);
    const mm = trimmed.substring(4, 6);
    const dd = trimmed.substring(6, 8);
    return `${yyyy}-${mm}-${dd}`;
  }

  // YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  const ymdMatch = trimmed.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = ymdMatch[2].padStart(2, '0');
    const d = ymdMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})/);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    let y = dmyMatch[3];
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m}-${d}`;
  }

  return trimmed;
}

/**
 * Normalizes any recognized time representation into HH:MM
 */
function normalizeTime(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();

  // 4 digits: HHMM (e.g. 0546 -> 05:46, 0442 -> 04:42)
  if (/^\d{4}$/.test(trimmed)) {
    return `${trimmed.substring(0, 2)}:${trimmed.substring(2, 4)}`;
  }

  // HH:MM or HH:MM:SS
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (match) {
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }

  return trimmed;
}

/**
 * Robust text parser for Biometric Time Attendance files (.txt, .TXT, .dat, .DAT, .csv, .log)
 * Formats supported:
 * 1) Standard: "0082   I 260901 0546 03"
 * 2) Standard: "0451   O 260802 0725 03"
 * 3) GID prefix: "SM549  O 260901 0808 03"
 * 4) Compact: "Z0057PUI 260128 0757 01" (compact without space before I/O)
 * 5) Date first: "0082   260901 0546   I 03" or "0082 2026-09-01 05:46:00 I"
 * 6) ZKTeco tab-delimited: "0082\t2026-09-01 05:46:00\t1\t1"
 * 7) CSV/Comma delimited: "0082,I,260901,0546,03" or "0082,2026-09-01,05:46,I"
 */
export function parseBiometricText(text: string, sourceFileName?: string): BiometricRawPunch[] {
  if (!text) return [];

  // 1. Remove UTF-8 Byte Order Mark (BOM) if present
  const cleanedText = text.replace(/^\uFEFF/, '');
  // 2. Normalize Windows and legacy Mac line breaks to standard \n
  const rawLines = cleanedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const punches: BiometricRawPunch[] = [];

  rawLines.forEach((rawLine, index) => {
    // Replace non-breaking spaces and unicode whitespace with standard ASCII space
    const line = rawLine.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ').trim();
    if (!line) return;

    // Filter out common header lines from machine reports or CSV exports
    const lower = line.toLowerCase();
    if (
      lower.startsWith('emp') ||
      lower.startsWith('employee') ||
      lower.startsWith('user') ||
      lower.startsWith('pin') ||
      lower.startsWith('no\t') ||
      lower.startsWith('no,') ||
      lower.startsWith('id\t') ||
      lower.startsWith('id,') ||
      lower.startsWith('date') ||
      lower.startsWith('time attendance') ||
      lower.startsWith('report') ||
      lower.startsWith('---') ||
      lower.startsWith('===')
    ) {
      return;
    }

    let emp = '';
    let type: 'I' | 'O' = 'I';
    let dateStr = '';
    let timeStr = '';
    let dev = '01';

    // Pattern 1: Standard with spaces: "0082   I 260901 0546 03" or "0149   I 260128 0442 01"
    const standardMatch = line.match(/^([A-Za-z0-9_-]+)\s+([IO]|IN|OUT)\s+(\d{6}|\d{8}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s+(\d{4}|\d{1,2}:\d{2}(?::\d{2})?)\s*([A-Za-z0-9_-]*)/i);

    // Pattern 2: Compact: "Z0057PUI 260128 0757 01" or "0451O 260802 0725 03"
    const compactMatch = line.match(/^([A-Za-z0-9_-]+?)([IO]|IN|OUT)\s+(\d{6}|\d{8}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s+(\d{4}|\d{1,2}:\d{2}(?::\d{2})?)\s*([A-Za-z0-9_-]*)/i);

    // Pattern 3: Date and Time before I/O: "0082   260901 0546   I 03" or "0082 2026-09-01 05:46:00 I 01"
    const dateFirstMatch = line.match(/^([A-Za-z0-9_-]+)\s+(\d{6}|\d{8}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s+(\d{4}|\d{1,2}:\d{2}(?::\d{2})?)\s+([IO]|IN|OUT|\d)\s*([A-Za-z0-9_-]*)/i);

    // Pattern 4: ZKTeco / Fingerprint standard delimited (Tab / Comma):
    // "0082\t2026-09-01 05:46:00\t1\t1" or "0082,2026-09-01 05:46:00,1,1"
    const delimitedMatch = line.match(/^([A-Za-z0-9_-]+)[\t,;]\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?|\d{4})(?:[\t,;]\s*([A-Za-z0-9_-]+))?(?:[\t,;]\s*([A-Za-z0-9_-]+))?/i);

    if (standardMatch) {
      emp = standardMatch[1];
      type = standardMatch[2].toUpperCase().includes('O') ? 'O' : 'I';
      dateStr = normalizeDate(standardMatch[3]);
      timeStr = normalizeTime(standardMatch[4]);
      dev = standardMatch[5] || '01';
    } else if (compactMatch) {
      emp = compactMatch[1];
      type = compactMatch[2].toUpperCase().includes('O') ? 'O' : 'I';
      dateStr = normalizeDate(compactMatch[3]);
      timeStr = normalizeTime(compactMatch[4]);
      dev = compactMatch[5] || '01';
    } else if (dateFirstMatch) {
      emp = dateFirstMatch[1];
      dateStr = normalizeDate(dateFirstMatch[2]);
      timeStr = normalizeTime(dateFirstMatch[3]);
      const tRaw = dateFirstMatch[4].toUpperCase();
      type = (tRaw === 'O' || tRaw === 'OUT' || tRaw === '2') ? 'O' : 'I';
      dev = dateFirstMatch[5] || '01';
    } else if (delimitedMatch) {
      emp = delimitedMatch[1];
      dateStr = normalizeDate(delimitedMatch[2]);
      timeStr = normalizeTime(delimitedMatch[3]);
      const state = (delimitedMatch[4] || '').toUpperCase();
      // In ZKTeco: 0 = Check-in, 1 = Check-out, or explicit 'I' / 'O'
      type = (state === '1' || state.includes('O')) ? 'O' : 'I';
      dev = delimitedMatch[5] || '01';
    } else {
      // General delimiter fallback (split by whitespace, comma, semicolon, or tab)
      const parts = line.split(/[\t,;\s]+/).filter(Boolean);
      if (parts.length >= 3) {
        let dateIdx = -1;
        let timeIdx = -1;
        let typeIdx = -1;

        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          if (dateIdx === -1 && isDateToken(p)) {
            dateIdx = i;
          } else if (timeIdx === -1 && isTimeToken(p)) {
            timeIdx = i;
          } else if (typeIdx === -1 && /^(I|O|IN|OUT|[012])$/i.test(p)) {
            typeIdx = i;
          }
        }

        if (dateIdx !== -1 && timeIdx !== -1) {
          emp = parts[0] !== parts[dateIdx] ? parts[0] : (parts[1] || parts[0]);
          dateStr = normalizeDate(parts[dateIdx]);
          timeStr = normalizeTime(parts[timeIdx]);
          if (typeIdx !== -1) {
            const t = parts[typeIdx].toUpperCase();
            type = (t === 'O' || t === 'OUT' || t === '2') ? 'O' : 'I';
          } else {
            const hr = parseInt(timeStr.split(':')[0], 10) || 0;
            type = hr >= 12 ? 'O' : 'I';
          }
          dev = parts[parts.length - 1] && parts.length > 4 ? parts[parts.length - 1] : '01';
        }
      }
    }

    if (emp && dateStr && timeStr) {
      punches.push({
        id: `punch-${index}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        empIdentifier: emp.trim(),
        type,
        timestamp: `${dateStr} ${timeStr}`,
        date: dateStr,
        time: timeStr,
        deviceId: dev || '01',
        rawLine: line,
      });
    }
  });

  return punches;
}

/**
 * Result metrics from punch merge & deduplication
 */
export interface PunchMergeResult {
  merged: BiometricRawPunch[];
  newAddedCount: number;
  updatedCount: number;
  duplicateSkippedCount: number;
  totalBefore: number;
  totalAfter: number;
  detectedMonths: string[];
  earliestDate: string;
  latestDate: string;
  uniqueEmployeesCount: number;
}

/**
 * Smart Merge & Deduplicate Punches
 * Rule: "อาจมีการอับโหลดซ้ำให้เลือกข้อมูลล่าสุด"
 * - Same canonical employee, date, time, and punch type are treated as the same event.
 * - When duplicated, incoming record updates/replaces the existing record with latest timestamp.
 */
export function mergeAndDeduplicatePunches(
  existingPunches: BiometricRawPunch[],
  incomingPunches: BiometricRawPunch[],
  mode: 'smart-merge' | 'replace-month' = 'smart-merge'
): PunchMergeResult {
  // 1. Detect months affected by incoming punches (e.g. ['2026-08', '2026-09'])
  const incomingMonthsSet = new Set<string>();
  const empSet = new Set<string>();
  let earliestDate = '';
  let latestDate = '';

  (incomingPunches || []).forEach(p => {
    if (!p || !p.empIdentifier || !p.date || typeof p.time !== 'string' || !p.time.trim()) return;
    const ym = p.date.substring(0, 7);
    incomingMonthsSet.add(ym);
    if (!earliestDate || p.date < earliestDate) earliestDate = p.date;
    if (!latestDate || p.date > latestDate) latestDate = p.date;
    empSet.add(canonicalEmpIdentifier(p.empIdentifier));
  });

  const detectedMonths = Array.from(incomingMonthsSet).sort();

  // 2. Build existing map (if replace-month, immediately skip existing records belonging to incoming months in 1 pass)
  const existingMap = new Map<string, BiometricRawPunch>();
  (existingPunches || []).forEach(p => {
    if (!p || !p.empIdentifier || !p.date || typeof p.time !== 'string' || !p.time.trim()) return;
    const ym = p.date.substring(0, 7);
    if (mode === 'replace-month' && incomingMonthsSet.has(ym)) {
      return; // Skip existing punch belonging to replaced month
    }
    const key = `${canonicalEmpIdentifier(p.empIdentifier)}_${p.date}_${p.time}_${p.type || 'I'}`;
    existingMap.set(key, p);
  });

  let newAddedCount = 0;
  let updatedCount = 0;
  let duplicateSkippedCount = 0;

  // 3. Process incoming punches
  (incomingPunches || []).forEach(p => {
    if (!p || !p.empIdentifier || !p.date || typeof p.time !== 'string' || !p.time.trim()) return;
    const key = `${canonicalEmpIdentifier(p.empIdentifier)}_${p.date}_${p.time}_${p.type || 'I'}`;
    if (existingMap.has(key)) {
      // Duplicate entry found -> overwrite with the latest incoming punch
      existingMap.set(key, { ...p, id: existingMap.get(key)!.id });
      updatedCount++;
    } else {
      existingMap.set(key, p);
      newAddedCount++;
    }
  });

  const merged = Array.from(existingMap.values()).sort((a, b) => {
    const dComp = (a.date || '').localeCompare(b.date || '');
    if (dComp !== 0) return dComp;
    return (a.time || '').localeCompare(b.time || '');
  });

  return {
    merged,
    newAddedCount,
    updatedCount,
    duplicateSkippedCount,
    totalBefore: existingPunches.length,
    totalAfter: merged.length,
    detectedMonths,
    earliestDate,
    latestDate,
    uniqueEmployeesCount: empSet.size,
  };
}

/**
 * Recursively extracts all files from a DataTransferItemList (Folder drag and drop support)
 */
export async function getFilesFromDataTransferItems(items: DataTransferItemList): Promise<File[]> {
  const files: File[] = [];

  const traverseFileTree = async (item: any): Promise<void> => {
    if (!item) return;

    if (item.isFile) {
      const file: File = await new Promise((resolve, reject) => {
        item.file(resolve, reject);
      });
      if (file && isAttendanceFile(file)) {
        files.push(file);
      }
    } else if (item.isDirectory) {
      // Chromium FileSystem API: readEntries only returns up to 100 entries per call.
      // Must loop until batch is empty to retrieve all files in a folder.
      const dirReader = item.createReader();
      const readAllEntries = async (): Promise<any[]> => {
        const allEntries: any[] = [];
        let batch: any[] = [];
        do {
          batch = await new Promise((resolve, reject) => {
            dirReader.readEntries(resolve, reject);
          });
          if (batch && batch.length > 0) {
            allEntries.push(...batch);
          }
        } while (batch && batch.length > 0);
        return allEntries;
      };

      try {
        const entries = await readAllEntries();
        for (const entry of entries) {
          await traverseFileTree(entry);
        }
      } catch (err) {
        console.warn('Error reading directory entries:', err);
      }
    }
  };

  const promises: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const entry = (item as any).webkitGetAsEntry?.();
      if (entry) {
        promises.push(traverseFileTree(entry));
      } else {
        const f = item.getAsFile();
        if (f && isAttendanceFile(f)) files.push(f);
      }
    }
  }

  await Promise.all(promises);
  return files;
}

/**
 * Filter valid attendance files (.txt, .TXT, .dat, .DAT, .csv, .log, .prn, .xlsx, .xls)
 */
export function isAttendanceFile(file: File): boolean {
  if (!file || !file.name) return false;
  const name = file.name.toLowerCase();

  // Filter out system hidden files or Mac OS metadata
  if (
    name.startsWith('.') || 
    name.startsWith('__macosx') || 
    name === 'thumbs.db' || 
    name === 'desktop.ini' ||
    name === '.ds_store'
  ) {
    return false;
  }

  return (
    name.endsWith('.txt') ||
    name.endsWith('.dat') ||
    name.endsWith('.csv') ||
    name.endsWith('.log') ||
    name.endsWith('.prn') ||
    name.endsWith('.tsv') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    !name.includes('.')
  );
}

/**
 * Verification preview record for comparing Punch Attendance vs Scheduled Shift Code
 */
export interface AttendanceVsShiftComparison {
  date: string;
  empNo: string;
  empName: string;
  department: string;
  scheduledShiftCode: string;
  shiftDescription: string;
  shiftHours: string;
  isWorkingDay: boolean;
  clockIn: string;
  clockOut: string;
  secondIn?: string;
  secondOut?: string;
  allPunchesCount: number;
  punchRecords: BiometricRawPunch[];
  status: 'on_time' | 'late' | 'no_stamp' | 'off_day' | 'worked_on_off' | 'leave' | 'unknown';
  statusLabel: string;
  lateMinutes: number;
  resolutionType?: string;
  resolutionDescription?: string;
  hasIrregularity?: boolean;
}

/**
 * Compare attendance punches against shift plans for learning & verification
 */
export function compareAttendanceVsShiftCodes(
  punches: BiometricRawPunch[],
  shiftPlans: DailyShiftPlan[],
  employees: Employee[],
  shiftCodes: ShiftCode[],
  targetDateOrMonth?: string
): AttendanceVsShiftComparison[] {
  const shiftCodeMap = new Map<string, ShiftCode>();
  shiftCodes.forEach(sc => shiftCodeMap.set(sc.code, sc));

  // 1. Fast O(1) Employee lookup index
  const empByIdMap = new Map<string, Employee>();
  employees.forEach(e => {
    if (e.empNo) {
      empByIdMap.set(e.empNo.trim().toUpperCase(), e);
      empByIdMap.set(canonicalEmpIdentifier(e.empNo).toUpperCase(), e);
    }
    if (e.gid) {
      empByIdMap.set(e.gid.trim().toUpperCase(), e);
      empByIdMap.set(canonicalEmpIdentifier(e.gid).toUpperCase(), e);
    }
  });

  const getMatchedEmp = (id: string): Employee | undefined => {
    if (!id) return undefined;
    const clean = id.trim().toUpperCase();
    const canon = canonicalEmpIdentifier(id).toUpperCase();
    return empByIdMap.get(clean) || empByIdMap.get(canon);
  };

  // 2. Pre-index Shift Plans by (canonEmpKey, date) in O(1)
  const plansByEmpAndDate = new Map<string, Map<string, DailyShiftPlan>>();
  const allPlanDatesByEmp = new Map<string, Set<string>>();

  shiftPlans.forEach(sp => {
    if (!sp || !sp.date) return;
    const ids = [sp.empNo, sp.gid].filter(Boolean) as string[];
    ids.forEach(rawId => {
      const canon = canonicalEmpIdentifier(rawId).toUpperCase();
      if (!plansByEmpAndDate.has(canon)) {
        plansByEmpAndDate.set(canon, new Map());
        allPlanDatesByEmp.set(canon, new Set());
      }
      plansByEmpAndDate.get(canon)!.set(sp.date, sp);
      allPlanDatesByEmp.get(canon)!.add(sp.date);
    });
  });

  // 3. Determine relevant punches
  let relevantPunches = (punches || []).filter(p => p && p.date && typeof p.time === 'string' && p.time.trim());
  if (targetDateOrMonth && targetDateOrMonth.length === 7) {
    const [yStr, mStr] = targetDateOrMonth.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const nextMonthObj = new Date(y, m, 1);
    const nextMStr = `${nextMonthObj.getFullYear()}-${String(nextMonthObj.getMonth() + 1).padStart(2, '0')}`;
    const prevMonthObj = new Date(y, m - 2, 1);
    const prevMStr = `${prevMonthObj.getFullYear()}-${String(prevMonthObj.getMonth() + 1).padStart(2, '0')}`;

    relevantPunches = relevantPunches.filter(p => 
      p.date.startsWith(targetDateOrMonth) ||
      (p.date.startsWith(nextMStr) && p.date <= `${nextMStr}-02`) ||
      (p.date.startsWith(prevMStr) && p.date >= `${prevMStr}-28`)
    );
  } else if (targetDateOrMonth) {
    relevantPunches = relevantPunches.filter(p => p.date === targetDateOrMonth);
  }

  // 4. Pre-index punches by (canonEmpKey, date) in O(1)
  const punchesByEmpAndDate = new Map<string, Map<string, BiometricRawPunch[]>>();
  const allPunchDatesByEmp = new Map<string, Set<string>>();
  const allEmpPunchesMap = new Map<string, BiometricRawPunch[]>();

  relevantPunches.forEach(p => {
    if (!p || !p.empIdentifier || !p.date) return;
    const canon = canonicalEmpIdentifier(p.empIdentifier).toUpperCase();
    if (!punchesByEmpAndDate.has(canon)) {
      punchesByEmpAndDate.set(canon, new Map());
      allPunchDatesByEmp.set(canon, new Set());
      allEmpPunchesMap.set(canon, []);
    }
    const empDateMap = punchesByEmpAndDate.get(canon)!;
    if (!empDateMap.has(p.date)) {
      empDateMap.set(p.date, []);
    }
    empDateMap.get(p.date)!.push(p);
    allPunchDatesByEmp.get(canon)!.add(p.date);
    allEmpPunchesMap.get(canon)!.push(p);
  });

  const results: AttendanceVsShiftComparison[] = [];

  // 5. Iterate over unique employees with punches
  for (const [canonEmp, empPunchList] of allEmpPunchesMap.entries()) {
    const matchedEmployee = getMatchedEmp(canonEmp) || (empPunchList[0] ? getMatchedEmp(empPunchList[0].empIdentifier) : undefined);

    const empNo = matchedEmployee?.empNo || empPunchList[0]?.empIdentifier || canonEmp;
    const empName = matchedEmployee 
      ? `${matchedEmployee.firstName} ${matchedEmployee.familyName}`
      : `ID: ${empPunchList[0]?.empIdentifier || canonEmp}`;
    const dept = matchedEmployee?.department || 'N/A';

    const empPlanDateMap = plansByEmpAndDate.get(canonEmp) 
      || (matchedEmployee?.empNo ? plansByEmpAndDate.get(canonicalEmpIdentifier(matchedEmployee.empNo).toUpperCase()) : undefined)
      || (matchedEmployee?.gid ? plansByEmpAndDate.get(canonicalEmpIdentifier(matchedEmployee.gid).toUpperCase()) : undefined)
      || new Map<string, DailyShiftPlan>();

    const empPunchDateMap = punchesByEmpAndDate.get(canonEmp) || new Map<string, BiometricRawPunch[]>();

    // Get all unique dates from both punches and shift plans sorted ascending
    const empDatesSet = new Set<string>();
    allPunchDatesByEmp.get(canonEmp)?.forEach(d => empDatesSet.add(d));
    if (matchedEmployee?.empNo) {
      allPlanDatesByEmp.get(canonicalEmpIdentifier(matchedEmployee.empNo).toUpperCase())?.forEach(d => empDatesSet.add(d));
    }
    if (matchedEmployee?.gid) {
      allPlanDatesByEmp.get(canonicalEmpIdentifier(matchedEmployee.gid).toUpperCase())?.forEach(d => empDatesSet.add(d));
    }
    allPlanDatesByEmp.get(canonEmp)?.forEach(d => empDatesSet.add(d));

    const uniqueDates = Array.from(empDatesSet).sort();
    const consumedPunchKeys = new Set<string>();

    for (const date of uniqueDates) {
      // Find scheduled Shift Plan for this date in O(1)
      const plan = empPlanDateMap.get(date);

      const rawShiftCode = (plan?.shiftCode || '').trim();
      const shiftInfo = rawShiftCode ? resolveShiftInfo(rawShiftCode, shiftCodes, matchedEmployee || plan?.department) : null;

      const isConsumed = (p: BiometricRawPunch) => consumedPunchKeys.has(getPunchKey(p)) || (Boolean(p.id) && consumedPunchKeys.has(p.id));

      // Available punches for this day in O(1)
      const rawDayPunches = empPunchDateMap.get(date) || [];
      const dayPunches = rawDayPunches.filter(p => !isConsumed(p));
      const sortedPunches = [...dayPunches].sort((a, b) => (a?.time || '').localeCompare(b?.time || ''));

      // Look up next day punches for night shifts in O(1)
      const [curY, curM, curD] = date.split('-').map(Number);
      const nextDateObj = new Date(curY, curM - 1, curD + 1);
      const nextDateStr = `${nextDateObj.getFullYear()}-${String(nextDateObj.getMonth() + 1).padStart(2, '0')}-${String(nextDateObj.getDate()).padStart(2, '0')}`;

      const rawNextDayPunches = empPunchDateMap.get(nextDateStr) || [];
      const nextDayPunches = rawNextDayPunches.filter(p => !isConsumed(p));

      // Special protection for Day OFF following night shift:
      if (!shiftInfo?.isWorkingDay && dayPunches.length === 1) {
        const singlePunch = dayPunches[0];
        const isSingleMorningOut = hhmmToMinutes(singlePunch.time) <= 600 && (singlePunch.type === 'O' || !singlePunch.type);
        if (isSingleMorningOut) {
          const prevDateObj = new Date(curY, curM - 1, curD - 1);
          const prevDateStr = `${prevDateObj.getFullYear()}-${String(prevDateObj.getMonth() + 1).padStart(2, '0')}-${String(prevDateObj.getDate()).padStart(2, '0')}`;
          const prevPlan = empPlanDateMap.get(prevDateStr);
          const prevCode = (prevPlan?.shiftCode || '').trim().toUpperCase();
          if (/^(N|AN)/i.test(prevCode) || /NIGHT/i.test(prevCode) || /ดึก/i.test(prevCode)) {
            consumedPunchKeys.add(getPunchKey(singlePunch));
            if (singlePunch.id) consumedPunchKeys.add(singlePunch.id);
            continue;
          }
        }
      }

      // Intelligently resolve punches with Shift Code guidance
      const punchRes = filterDeduplicatedPunches(dayPunches, shiftInfo, nextDayPunches);
      const clockIn = punchRes.clockIn;
      const clockOut = punchRes.clockOut;
      const secondIn = punchRes.secondIn;
      const secondOut = punchRes.secondOut;

      // Mark used punches as consumed
      punchRes.usedTodayPunches?.forEach(p => {
        consumedPunchKeys.add(getPunchKey(p));
        if (p.id) consumedPunchKeys.add(p.id);
      });
      punchRes.usedNextDayPunches?.forEach(p => {
        consumedPunchKeys.add(getPunchKey(p));
        if (p.id) consumedPunchKeys.add(p.id);
      });

      // Filter output to target month only if month filter was provided
      if (targetDateOrMonth && targetDateOrMonth.length === 7 && !date.startsWith(targetDateOrMonth)) {
        continue;
      }

      // If day was an OFF day with no remaining unconsumed punches, skip displaying or record as clean off_day
      if (!shiftInfo?.isWorkingDay && !clockIn && !clockOut && dayPunches.length === 0) {
        continue;
      }

      let status: AttendanceVsShiftComparison['status'] = 'unknown';
      let statusLabel = 'ตรวจพบเวลาสแกน';
      let lateMinutes = 0;

      const shiftHours = shiftInfo?.isWorkingDay 
        ? `${shiftInfo.startTime} - ${shiftInfo.endTime}`
        : (shiftInfo ? (shiftInfo.name || shiftInfo.description || 'วันหยุด') : 'ไม่ได้กำหนดกะ');

      if (shiftInfo) {
        if (!shiftInfo.isWorkingDay) {
          // Scheduled as Day OFF / Holiday / Leave
          const codeUpper = rawShiftCode.toUpperCase();
          if (codeUpper.startsWith('SL')) {
            status = 'leave';
            statusLabel = '🩺 ลาป่วย (Sick Leave)';
          } else if (codeUpper.startsWith('AL')) {
            status = 'leave';
            statusLabel = '🏖️ ลาพักร้อน (Annual Leave)';
          } else if (codeUpper === 'OFF' || codeUpper === 'H') {
            if (clockIn || clockOut) {
              status = 'worked_on_off';
              statusLabel = '💼 มีสแกนในวันหยุด (Worked on OFF/Holiday)';
            } else {
              status = 'off_day';
              statusLabel = '🏝️ วันหยุด (Day OFF / Holiday)';
            }
          } else {
            status = 'leave';
            statusLabel = `📋 วันลา/อื่นๆ (${rawShiftCode})`;
          }
        } else {
          // Working Day
          if (!clockIn && !clockOut) {
            status = 'no_stamp';
            statusLabel = '🔴 ไม่มีการสแกน (No Stamp)';
          } else if (shiftInfo.startTime && clockIn) {
            const inMin = hhmmToMinutes(clockIn);
            const shiftInMin = hhmmToMinutes(shiftInfo.startTime);
            if (inMin > shiftInMin) {
              lateMinutes = inMin - shiftInMin;
              status = 'late';
              statusLabel = punchRes.hasIrregularity 
                ? `⚠️ มาสาย (${lateMinutes} นาที) [ปรับตามกะ]` 
                : `⚠️ มาสาย (${lateMinutes} นาที)`;
            } else {
              status = 'on_time';
              statusLabel = punchRes.hasIrregularity 
                ? `✅ เข้างานตรงเวลา [ปรับตามกะ]` 
                : `✅ เข้างานตรงเวลา (On Time)`;
            }
          } else {
            status = 'on_time';
            statusLabel = punchRes.hasIrregularity ? 'สแกนเข้างานแล้ว [ปรับตามกะ]' : 'สแกนเข้างานแล้ว';
          }
        }
      } else {
        status = 'unknown';
        statusLabel = `สแกน ${dayPunches.length} ครั้ง (ไม่มี Shift Plan)`;
      }

      results.push({
        date,
        empNo,
        empName,
        department: dept,
        scheduledShiftCode: rawShiftCode || 'N/A',
        shiftDescription: (shiftInfo ? (shiftInfo.name || shiftInfo.description) : null) || (rawShiftCode ? `รหัส ${rawShiftCode}` : 'ไม่มีข้อมูลกะ'),
        shiftHours,
        isWorkingDay: shiftInfo?.isWorkingDay || false,
        clockIn,
        clockOut,
        secondIn,
        secondOut,
        allPunchesCount: dayPunches.length,
        punchRecords: sortedPunches,
        status,
        statusLabel,
        lateMinutes,
        resolutionType: punchRes.resolutionType,
        resolutionDescription: punchRes.resolutionDescription,
        hasIrregularity: punchRes.hasIrregularity,
      });
    }
  }

  // Sort by date then empNo
  return results.sort((a, b) => {
    const dC = a.date.localeCompare(b.date);
    if (dC !== 0) return dC;
    return a.empNo.localeCompare(b.empNo);
  });
}
