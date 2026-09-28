export type Role = 'Admin' | 'User';

export type UserStatus = 'Active' | 'Pending_Approval' | 'Deactivated' | 'active' | 'pending' | 'deactivated';

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string;
  status: UserStatus;
  createdAt: string;
  lastLogin?: string;
  photoURL?: string;
  isGoogleAccount?: boolean;
  assignedBy?: string;
  activatedAt?: string;
  updatedAt?: string;
  empNo?: string;
  gid?: string;
}

export interface Department {
  code: string;
  name: string;
  updatedAt?: string;
}

export interface Employee {
  id?: string;
  empNo: string;        // e.g. "0950"
  empCode?: string;     // 8-digit number e.g. "10000950" for Export to Payroll
  gid: string;          // e.g. "Z00430UZ"
  firstName: string;    // "Napassawan"
  familyName: string;   // "Ngamsomsong"
  department: string;   // "GM", "RS", "SIG", "STN"
  division: string;     // "MO CS BTS"
  functionTitle: string;// "Safety Professional"
  costCenter: string;   // "C93056"
  isShiftWorker: boolean;// Yes/No (เข้ากะหรือไม่)
  isActive: boolean;    // Activate / Deactivate by Admin
  updatedAt?: string;   // ISO timestamp for conflict resolution
}

export interface ShiftCode {
  code: string;         // e.g. "D", "N", "M", "H", "OFF"
  department: string;   // "ALL" or specific e.g. "GM", "RS"
  name: string;         // "Day Shift 08:00-17:00"
  startTime: string;    // "08:00"
  endTime: string;      // "17:00"
  breakMinutes: number; // 60
  workingHours: number; // 8
  isWorkingDay: boolean;// false for H, OFF
  color: string;        // hex/tailwind color
  description?: string;
  updatedAt?: string;
}

export interface DailyShiftPlan {
  id: string;
  empNo: string;
  gid: string;
  date: string;         // "YYYY-MM-DD" e.g. "2026-05-01"
  shiftCode: string;    // "D", "N", "H", etc.
  department: string;
  updatedBy: string;
  updatedAt: string;
}

export interface BiometricRawPunch {
  id: string;
  empIdentifier: string; // EmpNo or GID e.g. "0149" or "Z0057PU"
  type: 'I' | 'O';      // In or Out
  timestamp: string;    // "YYYY-MM-DD HH:mm"
  date: string;         // "YYYY-MM-DD"
  time: string;         // "HH:mm"
  deviceId: string;     // "01", "02"
  rawLine?: string;
}

export interface OTRecord {
  id: string;
  empNo: string;
  gid: string;
  date: string;         // "YYYY-MM-DD" (Target date)
  originalDate: string; // If submitted from previous month
  startTime: string;    // "17:30"
  endTime: string;      // "20:30"
  hours: number;        // 3.0
  rate: 1.5 | 3.0;      // 1.5 or 3.0
  reason: string;
  approvedBy: string;
  isRetroactive: boolean; // Is from previous month? Needs Admin review
  retroactiveTargetDate?: string;
  status: 'Approved' | 'Pending_Admin_Review' | 'Rejected';
}

export interface OtherAllowance {
  id: string;
  empNo: string;
  gid: string;
  monthYear: string;    // "2026-05"
  date?: string;        // "2026-05-20"
  teamEmergency: number;// e.g. 500
  shiftAllowance: number;// e.g. 300
  standbyAllowance: number;// e.g. 200
  remark?: string;
}

export interface TimeSheetRow {
  date: string;         // "2026-05-01"
  dayString: string;    // "01-05-26 Fri"
  dayOfWeek: string;    // "Fri"
  shiftCode: string;    // "D", "H", etc.
  shiftIn: string;      // "08:00"
  shiftOut: string;     // "17:00"
  realTime1In: string;  // "07:39"
  realTime1Out: string; // "17:29"
  diff1: string;        // "08:50" (HH:mm)
  diff1Hours: number;   // 8.83
  late: string;         // "00:00"
  lateMinutes: number;  // 0
  realTime2In: string;  // "17:31" (e.g. for OT or second shift)
  realTime2Out: string;
  diff2: string;
  diff2Hours: number;
  totalWorkHours: number;// 3 or standard
  ot1_5: number;        // 3.0
  ot3_0: number;        // 0.0
  standbyAllowance: number;
  emergencyAllowance: number;
  shiftAllowance: number;
  codeLeave: string;    // "A", "C", "S", "O", "X", "Y" or ""
  remark: string;       // "support for random Narcotics..."
  isManualOverride?: boolean;
}

export interface TimeSheetSummary {
  empNo: string;
  gid: string;
  employee: Employee;
  monthYear: string;    // "2026-05"
  rows: TimeSheetRow[];
  totalWorkDays: number;
  totalDiffTime: string;// "143:46"
  totalLateTime: string;// "00:00"
  totalWorkHours: number;
  totalOT1_5: number;
  totalOT3_0: number;
  totalStandby: number;
  totalEmergency: number;
  totalShiftAllowance: number;
  totalLeaveDays: number;
}
