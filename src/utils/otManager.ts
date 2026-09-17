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
 * Standardize any date input (Excel serial number, DD/MM/YYYY, YYYY-MM-DD, Thai Buddhist Era)
 * into a uniform ISO date "YYYY-MM-DD".
 */
export function normalizeOTDate(raw: any): string {
  if (raw === null || raw === undefined || raw === '') return '';

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const s = String(raw).trim();

  // Excel serial date number (e.g. 46162)
  if (/^\d{5}$/.test(s)) {
    const serial = parseInt(s, 10);
    // Excel base date Dec 30 1899
    const utcDays = serial - 25569;
    const date = new Date(utcDays * 86400 * 1000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Handle DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    let y = parseInt(dmyMatch[3], 10);
    if (y > 2400) y -= 543; // Convert Thai Buddhist Era (2569 -> 2026)
    return `${y}-${m}-${d}`;
  }

  // Handle YYYY/MM/DD or YYYY-MM-DD
  const ymdMatch = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymdMatch) {
    let y = parseInt(ymdMatch[1], 10);
    if (y > 2400) y -= 543;
    const m = ymdMatch[2].padStart(2, '0');
    const d = ymdMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return s;
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
  return `${primaryId}__${targetDate}__${rate}`;
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
    const d = r.retroactiveTargetDate || r.date;
    const matchesMonth = targetMonthYear === 'ALL' || d.startsWith(targetMonthYear);
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
        timeSlot: `${r.startTime || ''}-${r.endTime || ''}`,
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
        const prevSlot = prevList.find(p => 
          (p.startTime === inRec.startTime && p.endTime === inRec.endTime) ||
          prevList.length === 1
        ) || prevList[0];

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
            timeSlot: `${inRec.startTime}-${inRec.endTime}`,
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
            timeSlot: `${inRec.startTime}-${inRec.endTime}`,
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
          timeSlot: `${inRec.startTime}-${inRec.endTime}`,
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
            timeSlot: `${inRec.startTime}-${inRec.endTime}`,
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

          // Try matching by exact time slot first, or by index
          let match = exList.find(e => 
            !matchedExistingIds.has(e.id) &&
            e.startTime === inRec.startTime &&
            e.endTime === inRec.endTime
          );

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
                timeSlot: `${inRec.startTime}-${inRec.endTime}`,
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
                timeSlot: `${inRec.startTime}-${inRec.endTime}`,
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
              timeSlot: `${inRec.startTime}-${inRec.endTime}`,
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
