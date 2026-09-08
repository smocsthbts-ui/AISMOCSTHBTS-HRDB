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
 * Format minutes into "HH:mm"
 */
export function minutesToHHMM(totalMinutes: number): string {
  if (totalMinutes <= 0 || isNaN(totalMinutes)) return '00:00';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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
 * Deduplicate biometric punches for an employee on a given date:
 * Rule 6: "หากมีการบันทึกซ้ำในเวลาใกล้เคียงกันจะใช้เวลาล่าสุด"
 */
export function filterDeduplicatedPunches(punches: BiometricRawPunch[]): {
  clockIn: string;
  clockOut: string;
  secondIn?: string;
  secondOut?: string;
} {
  if (!punches || punches.length === 0) {
    return { clockIn: '', clockOut: '' };
  }

  // Sort chronologically
  const sorted = [...punches].sort((a, b) => hhmmToMinutes(a.time) - hhmmToMinutes(b.time));

  // Separate explicit In ('I') and Out ('O')
  const inPunches = sorted.filter(p => p.type === 'I');
  const outPunches = sorted.filter(p => p.type === 'O');

  let clockIn = '';
  let clockOut = '';
  let secondIn = '';
  let secondOut = '';

  // If we have explicit 'I' punches:
  // "หากมีการบันทึกซ้ำในเวลาใกล้เคียงกันจะใช้เวลาล่าสุด"
  // For punch in: If user swiped at 07:35 and again at 07:41 (repeated within 30 min before shift), take the latest close punch
  if (inPunches.length > 0) {
    // Cluster punches within 30 mins
    const clusters: BiometricRawPunch[][] = [];
    let currentCluster: BiometricRawPunch[] = [inPunches[0]];

    for (let i = 1; i < inPunches.length; i++) {
      const prev = currentCluster[currentCluster.length - 1];
      const diff = hhmmToMinutes(inPunches[i].time) - hhmmToMinutes(prev.time);
      if (diff <= 30) {
        currentCluster.push(inPunches[i]);
      } else {
        clusters.push(currentCluster);
        currentCluster = [inPunches[i]];
      }
    }
    clusters.push(currentCluster);

    // First cluster: take latest punch (Rule 6: "หากมีการบันทึกซ้ำในเวลาใกล้เคียงกันจะใช้เวลาล่าสุด")
    const firstCluster = clusters[0];
    clockIn = firstCluster[firstCluster.length - 1].time;

    // If there's a second distinct cluster hours later (e.g. split shift or afternoon clock in)
    if (clusters.length > 1) {
      const secondCluster = clusters[1];
      secondIn = secondCluster[secondCluster.length - 1].time;
    }
  }

  // For punch out:
  if (outPunches.length > 0) {
    const clusters: BiometricRawPunch[][] = [];
    let currentCluster: BiometricRawPunch[] = [outPunches[0]];

    for (let i = 1; i < outPunches.length; i++) {
      const prev = currentCluster[currentCluster.length - 1];
      const diff = hhmmToMinutes(outPunches[i].time) - hhmmToMinutes(prev.time);
      if (diff <= 30) {
        currentCluster.push(outPunches[i]);
      } else {
        clusters.push(currentCluster);
        currentCluster = [outPunches[i]];
      }
    }
    clusters.push(currentCluster);

    // Latest punch out of first cluster or final departure
    const lastCluster = clusters[clusters.length - 1];
    clockOut = lastCluster[lastCluster.length - 1].time;

    if (clusters.length > 1) {
      secondOut = clockOut;
      clockOut = clusters[0][clusters[0].length - 1].time;
    }
  }

  // Fallback: If punches didn't have explicit I/O flags or only timestamps were provided
  if (!clockIn && !clockOut && sorted.length > 0) {
    clockIn = sorted[0].time;
    if (sorted.length > 1) {
      clockOut = sorted[sorted.length - 1].time;
    }
  }

  return { clockIn, clockOut, secondIn, secondOut };
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

  // Filter biometric punches matching either empNo or gid
  const empPunches = allPunches.filter(p => {
    const ident = p.empIdentifier.trim().toLowerCase();
    const eNo = employee.empNo.toLowerCase();
    const gid = employee.gid.toLowerCase();
    return ident === eNo || ident === gid || ident.startsWith(eNo) || ident.startsWith(gid);
  });

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
    const shiftInfo = shiftCodeMap.get(shiftCodeVal);

    const shiftIn = shiftInfo?.isWorkingDay ? shiftInfo.startTime : '';
    const shiftOut = shiftInfo?.isWorkingDay ? shiftInfo.endTime : '';

    // Punches for this day
    const dayPunches = empPunches.filter(p => p.date === dateStr);
    const { clockIn, clockOut, secondIn, secondOut } = filterDeduplicatedPunches(dayPunches);

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

    // Allowances on this day if any
    let standbyAllowance = 0;
    let emergencyAllowance = 0;
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

    // Check if there are manual overrides saved for this day
    const overrideKey = `${employee.empNo}_${dateStr}`;
    const overrides = manualOverrides[overrideKey] || {};

    const row: TimeSheetRow = {
      date: dateStr,
      dayString,
      dayOfWeek,
      shiftCode: overrides.shiftCode !== undefined ? overrides.shiftCode : shiftCodeVal,
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
      totalWorkHours: overrides.totalWorkHours !== undefined ? overrides.totalWorkHours : totalWorkingHoursOnDay,
      ot1_5: overrides.ot1_5 !== undefined ? overrides.ot1_5 : ot1_5,
      ot3_0: overrides.ot3_0 !== undefined ? overrides.ot3_0 : ot3_0,
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
