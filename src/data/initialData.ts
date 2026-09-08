import { Employee, ShiftCode, UserAccount, BiometricRawPunch, OTRecord, OtherAllowance } from '../types';

export const DEPARTMENTS = [
  { code: 'GM', name: 'General Management (GM)' },
  { code: 'RS', name: 'Rolling Stock (RS)' },
  { code: 'SIG', name: 'Signalling & Telecom (SIG)' },
  { code: 'STN', name: 'Station Operations (STN)' },
  { code: 'IT', name: 'IT & Digital Grid (IT)' },
];

export const INITIAL_USERS: UserAccount[] = [
  {
    id: 'usr-admin-google',
    email: 'smo.cs.th.bts@gmail.com',
    name: 'SMO CS TH BTS (System Admin)',
    role: 'Admin',
    department: 'ALL',
    status: 'active',
    createdAt: '2026-09-07',
    lastLogin: '2026-09-07 22:30',
  },
  {
    id: 'usr-admin-1',
    email: 'admin@siemens.com',
    name: 'Administrator (HR & Ops Lead)',
    role: 'Admin',
    department: 'ALL',
    status: 'active',
    createdAt: '2026-01-01',
    lastLogin: '2026-09-07 14:20',
  },
  {
    id: 'usr-user-gm',
    email: 'napassawan@siemens.com',
    name: 'Napassawan Ngamsomsong',
    role: 'User',
    department: 'GM',
    status: 'active',
    createdAt: '2026-01-05',
    lastLogin: '2026-09-07 11:15',
  },
  {
    id: 'usr-user-rs',
    email: 'somchai@siemens.com',
    name: 'Somchai Prasert (RS Lead)',
    role: 'User',
    department: 'RS',
    status: 'active',
    createdAt: '2026-01-10',
    lastLogin: '2026-09-06 09:30',
  },
  {
    id: 'usr-user-pending',
    email: 'sarawut@siemens.com',
    name: 'Sarawut Phromdee',
    role: 'User',
    department: 'RS',
    status: 'pending',
    createdAt: '2026-09-07',
  }
];

export const INITIAL_EMPLOYEES: Employee[] = [
  {
    empNo: '0950',
    gid: 'Z00430UZ',
    firstName: 'Napassawan',
    familyName: 'Ngamsomsong',
    department: 'GM',
    division: 'MO CS BTS',
    functionTitle: 'Safety Professional',
    costCenter: 'C93056',
    isShiftWorker: false,
    isActive: true,
  },
  {
    empNo: '0149',
    gid: 'Z00149TH',
    firstName: 'Somchai',
    familyName: 'Prasert',
    department: 'RS',
    division: 'MO CS BTS',
    functionTitle: 'Depot Maintenance Lead',
    costCenter: 'C93021',
    isShiftWorker: true,
    isActive: true,
  },
  {
    empNo: '0094',
    gid: 'Z00094TH',
    firstName: 'Wiroj',
    familyName: 'Srisuk',
    department: 'RS',
    division: 'MO CS BTS',
    functionTitle: 'Senior Rolling Stock Engineer',
    costCenter: 'C93021',
    isShiftWorker: true,
    isActive: true,
  },
  {
    empNo: '1442',
    gid: 'Z00144TH',
    firstName: 'Kittisak',
    familyName: 'Boonma',
    department: 'SIG',
    division: 'MO CS BTS',
    functionTitle: 'Signalling Specialist',
    costCenter: 'C93035',
    isShiftWorker: true,
    isActive: true,
  },
  {
    empNo: '0077',
    gid: 'Z00077TH',
    firstName: 'Anan',
    familyName: 'Chaisiri',
    department: 'SIG',
    division: 'MO CS BTS',
    functionTitle: 'Field Telecom Technician',
    costCenter: 'C93035',
    isShiftWorker: true,
    isActive: true,
  },
  {
    empNo: '0315',
    gid: 'Z00315TH',
    firstName: 'Thanaporn',
    familyName: 'Wattana',
    department: 'STN',
    division: 'MO CS BTS',
    functionTitle: 'Station Controller',
    costCenter: 'C93010',
    isShiftWorker: true,
    isActive: true,
  },
  {
    empNo: '1234',
    gid: 'Z0057PU',
    firstName: 'Sarawut',
    familyName: 'Phromdee',
    department: 'RS',
    division: 'MO CS BTS',
    functionTitle: 'Depot Inspector',
    costCenter: 'C93021',
    isShiftWorker: true,
    isActive: true,
  },
  {
    empNo: '1477',
    gid: 'Z00147TH',
    firstName: 'Supachai',
    familyName: 'Ratanaporn',
    department: 'GM',
    division: 'MO CS BTS',
    functionTitle: 'Operation Planner',
    costCenter: 'C93056',
    isShiftWorker: false,
    isActive: true,
  }
];

export const INITIAL_SHIFT_CODES: ShiftCode[] = [
  {
    code: 'D',
    department: 'ALL',
    name: 'Day Shift (ปกติ)',
    startTime: '08:00',
    endTime: '17:00',
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: '#008b99',
    description: 'กะเช้าทำงานปกติ 08:00-17:00 พัก 1 ชม.'
  },
  {
    code: 'D1',
    department: 'ALL',
    name: 'Early Day (กะเช้า 07:00)',
    startTime: '07:00',
    endTime: '16:00',
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: '#0891b2',
    description: 'กะเช้าเข้าก่อนเวลา 07:00-16:00'
  },
  {
    code: 'D2',
    department: 'ALL',
    name: 'Late Day (กะสาย 09:00)',
    startTime: '09:00',
    endTime: '18:00',
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: '#0284c7',
    description: 'กะสายสนับสนุนออฟฟิศ 09:00-18:00'
  },
  {
    code: 'M',
    department: 'RS',
    name: 'Morning Shift (กะเช้าตรู่ RS)',
    startTime: '06:00',
    endTime: '14:30',
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: '#06b6d4',
    description: 'กะเตรียมขบวนรถเช้าตรู่ 06:00-14:30'
  },
  {
    code: 'M1',
    department: 'RS',
    name: 'Depot Morning (กะตรวจซ่อมขบวนรถ)',
    startTime: '05:30',
    endTime: '14:00',
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: '#3b82f6',
    description: 'กะเข้าอู่ตรวจซ่อมขบวนรถ 05:30-14:00'
  },
  {
    code: 'A',
    department: 'RS',
    name: 'Afternoon Shift (กะบ่าย RS)',
    startTime: '14:00',
    endTime: '22:30',
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: '#f59e0b',
    description: 'กะบ่ายคุมขบวนรถ 14:00-22:30'
  },
  {
    code: 'A1',
    department: 'SIG',
    name: 'Afternoon Signalling (กะบ่ายอาณัติสัญญาณ)',
    startTime: '13:30',
    endTime: '22:00',
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: '#ea580c',
    description: 'กะบ่ายระบบอาณัติสัญญาณ 13:30-22:00'
  },
  {
    code: 'N',
    department: 'ALL',
    name: 'Night Shift (กะดึกทั่วไป)',
    startTime: '20:00',
    endTime: '05:00',
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: '#6366f1',
    description: 'กะดึก 20:00-05:00 มีเบี้ยเลี้ยงกะ'
  },
  {
    code: 'N1',
    department: 'SIG',
    name: 'Night Track Work (กะดึกทางวิ่ง)',
    startTime: '22:00',
    endTime: '06:30',
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: '#7c3aed',
    description: 'กะดึกตรวจเช็คระบบรางและอาณัติสัญญาณ 22:00-06:30'
  },
  {
    code: 'N2',
    department: 'RS',
    name: 'Night Overhaul (กะดึกซ่อมบำรุงหนัก)',
    startTime: '23:00',
    endTime: '07:30',
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: '#4f46e5',
    description: 'กะดึกซ่อมบำรุงใหญ่ขบวนรถไฟฟ้า 23:00-07:30'
  },
  {
    code: 'S1',
    department: 'SIG',
    name: 'Special Signalling (กะพิเศษ)',
    startTime: '07:30',
    endTime: '16:30',
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: '#10b981',
    description: 'กะพิเศษตรวจสอบระบบอาณัติสัญญาณ 07:30-16:30'
  },
  {
    code: 'ST1',
    department: 'STN',
    name: 'Station Early (สถานีกะเช้า)',
    startTime: '05:45',
    endTime: '14:15',
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: '#14b8a6',
    description: 'กะเปิดสถานีและควบคุมผู้โดยสาร 05:45-14:15'
  },
  {
    code: 'ST2',
    department: 'STN',
    name: 'Station Late (สถานีกะบ่าย-ปิด)',
    startTime: '13:45',
    endTime: '22:15',
    breakMinutes: 30,
    workingHours: 8,
    isWorkingDay: true,
    color: '#d97706',
    description: 'กะปิดสถานีและเคลียร์อุปกรณ์ 13:45-22:15'
  },
  {
    code: 'SBY',
    department: 'ALL',
    name: 'Standby On-Call (สแตนด์บายฉุกเฉิน)',
    startTime: '08:00',
    endTime: '08:00',
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: true,
    color: '#8b5cf6',
    description: 'เวร Standby พร้อมปฏิบัติหน้าที่ฉุกเฉิน 24 ชม.'
  },
  {
    code: 'OFF',
    department: 'ALL',
    name: 'Day Off (วันหยุดสัปดาห์)',
    startTime: '00:00',
    endTime: '00:00',
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: false,
    color: '#6b7280',
    description: 'วันหยุดประจำสัปดาห์ตามตารางกะ'
  },
  {
    code: 'H',
    department: 'ALL',
    name: 'Holiday (วันหยุดประเพณี/นักขัตฤกษ์)',
    startTime: '00:00',
    endTime: '00:00',
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: false,
    color: '#ef4444',
    description: 'วันหยุดประเพณีตามปฏิทินบริษัท'
  },
  {
    code: 'AL',
    department: 'ALL',
    name: 'Annual Leave (ลาพักร้อน)',
    startTime: '00:00',
    endTime: '00:00',
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: false,
    color: '#ec4899',
    description: 'ลาพักผ่อนประจำปีที่ได้รับการอนุมัติ'
  },
  {
    code: 'SL',
    department: 'ALL',
    name: 'Sick Leave (ลาป่วย)',
    startTime: '00:00',
    endTime: '00:00',
    breakMinutes: 0,
    workingHours: 0,
    isWorkingDay: false,
    color: '#f43f5e',
    description: 'ลาป่วยตามระเบียบบริษัท'
  },
  {
    code: 'TR',
    department: 'ALL',
    name: 'Training (อบรม/พัฒนาทักษะ)',
    startTime: '08:30',
    endTime: '16:30',
    breakMinutes: 60,
    workingHours: 8,
    isWorkingDay: true,
    color: '#059669',
    description: 'เข้ารับการฝึกอบรมหรือทดสอบความปลอดภัย'
  }
];

export const INITIAL_RAW_PUNCHES_TEXT = `0149   I 260128 0442 01
0149   I 260128 0450 01
0094   I 260128 0518 01
1442   I 260128 0530 01
0077   I 260128 0532 01
0315   I 260128 0536 01
1234   I 260128 0544 01
1477   I 260128 0547 01
0950   I 260505 0739 01
0950   O 260505 1729 01
0950   I 260506 0741 01
0950   O 260506 1742 01
0950   I 260507 0737 01
0950   O 260507 1850 01
0950   I 260508 0800 01
0950   O 260508 1832 01
0950   I 260511 0731 01
0950   O 260511 1703 01
0950   I 260512 0741 01
0950   I 260513 0740 01
0950   O 260513 1706 01
0950   I 260514 0733 01
0950   O 260514 1810 01
0950   I 260515 0730 01
0950   O 260515 1734 01
0950   I 260518 0731 01
0950   O 260518 1708 01
0950   I 260519 0728 01
0950   O 260519 1710 01
0950   I 260520 0729 01
0950   I 260520 1731 01
0950   I 260521 0743 01
0950   O 260521 1818 01
0950   I 260522 0740 01
0950   O 260522 1717 01
0950   I 260525 0735 01
0950   O 260525 1716 01
0950   I 260526 0734 01
0950   I 260526 1723 01
0950   I 260527 0750 01
0950   O 260527 1744 01
0950   I 260528 0738 01
0950   O 260528 1715 01
0950   I 260529 0746 01
0950   O 260529 1734 01
Z0057PUI 260128 0757 01
Z0057PUO 260128 1701 01
0149   O 260128 1536 01
0094   O 260128 1532 01
1442   O 260128 1610 01
0077   O 260128 1540 01
0315   O 260128 1713 01`;

export const INITIAL_OT_RECORDS: OTRecord[] = [
  {
    id: 'ot-1',
    empNo: '0950',
    gid: 'Z00430UZ',
    date: '2026-05-20',
    originalDate: '2026-05-20',
    startTime: '17:30',
    endTime: '20:30',
    hours: 3.0,
    rate: 1.5,
    reason: 'support for random Narcotics and Intoxicant Testing for operation staff',
    approvedBy: 'Ops Manager',
    isRetroactive: false,
    status: 'Approved'
  },
  {
    id: 'ot-retro-1',
    empNo: '0149',
    gid: 'Z00149TH',
    date: '2026-04-29',
    originalDate: '2026-04-29',
    startTime: '18:00',
    endTime: '22:00',
    hours: 4.0,
    rate: 1.5,
    reason: 'Emergency bogie inspection after track maintenance delay',
    approvedBy: 'RS Depot Chief',
    isRetroactive: true, // From previous month! Requires Admin date assignment
    retroactiveTargetDate: '2026-05-02',
    status: 'Pending_Admin_Review'
  },
  {
    id: 'ot-2',
    empNo: '1442',
    gid: 'Z00144TH',
    date: '2026-05-15',
    originalDate: '2026-05-15',
    startTime: '17:00',
    endTime: '21:00',
    hours: 4.0,
    rate: 1.5,
    reason: 'Signal point machine testing at Mo Chit interchange',
    approvedBy: 'SIG Super',
    isRetroactive: false,
    status: 'Approved'
  }
];

export const INITIAL_OTHER_ALLOWANCES: OtherAllowance[] = [
  {
    id: 'allw-1',
    empNo: '0950',
    gid: 'Z00430UZ',
    monthYear: '2026-05',
    teamEmergency: 0,
    shiftAllowance: 0,
    standbyAllowance: 0,
    remark: 'No shift allowance'
  },
  {
    id: 'allw-2',
    empNo: '0149',
    gid: 'Z00149TH',
    monthYear: '2026-05',
    teamEmergency: 800,
    shiftAllowance: 1200,
    standbyAllowance: 500,
    remark: 'Night shift maintenance allowance + Depot emergency team'
  },
  {
    id: 'allw-3',
    empNo: '1234',
    gid: 'Z0057PU',
    monthYear: '2026-05',
    teamEmergency: 600,
    shiftAllowance: 900,
    standbyAllowance: 400,
    remark: 'Emergency standby coverage'
  }
];
