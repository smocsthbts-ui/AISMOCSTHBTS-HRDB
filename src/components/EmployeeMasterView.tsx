import React, { useState, useMemo, useEffect } from 'react';
import { Employee, UserAccount, Department } from '../types';
import { storage } from '../utils/storage';
import { 
  Users, 
  UserPlus, 
  Search, 
  Edit2, 
  CheckCircle2, 
  XCircle, 
  Upload, 
  Download, 
  Lock,
  Building2,
  Filter,
  RotateCcw,
  X,
  Layers,
  Briefcase,
  ArrowLeftRight,
  Cloud,
  Check,
  Trash2,
  AlertTriangle,
  FileSpreadsheet,
  FileCheck,
  ShieldCheck
} from 'lucide-react';
import { readFileAsArrayBuffer, parseSheetToRows, downloadBlob, downloadWorkbook, generateEmployeeMasterTemplate, parseEmployeeNameParts } from '../utils/fileParser';
import { isDemoDepartment, isDemoEmployee, firestoreSync } from '../firebase';
import * as XLSX from 'xlsx';

// Models for batch upload change tracking
interface EmployeeFieldChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

interface EmployeeUpdateLog {
  empNo: string;
  empCode?: string;
  gid: string;
  name: string;
  isNew: boolean;
  matchType?: string;
  changes: EmployeeFieldChange[];
}

export interface DuplicateEmployeeMatch {
  employee: Employee;
  field: 'empNo' | 'empCode' | 'gid';
  fieldLabel: string;
  matchedValue: string;
  reason: string;
}

/**
 * Strict Uniqueness Checker:
 * Checks whether an employee with matching Employee No, EmpCode (8 digits), or GID already exists.
 * Returns the matched employee and human-readable explanation if duplicate found.
 */
export const findDuplicateEmployee = (
  empNoInput?: string,
  empCodeInput?: string,
  gidInput?: string,
  employeeList: Employee[] = [],
  excludeId?: string,
  excludeEmpNo?: string,
  excludeGid?: string
): DuplicateEmployeeMatch | null => {
  const cleanEmpNo = (empNoInput || '').trim().toUpperCase();
  const numEmpNo = /^\d+$/.test(cleanEmpNo) ? parseInt(cleanEmpNo, 10) : null;
  const cleanEmpCode = (empCodeInput || '').replace(/\D/g, '');
  const cleanGid = (gidInput || '').trim().toUpperCase();

  const excludeIdClean = (excludeId || '').trim();
  const excludeEmpNoClean = (excludeEmpNo || '').trim().toUpperCase();
  const excludeNumEmpNo = /^\d+$/.test(excludeEmpNoClean) ? parseInt(excludeEmpNoClean, 10) : null;
  const excludeGidClean = (excludeGid || '').trim().toUpperCase();

  for (const emp of employeeList) {
    if (!emp) continue;
    if (isDemoEmployee(emp)) continue;

    const targetId = (emp.id || '').trim();
    const targetEmpNo = (emp.empNo || '').trim().toUpperCase();
    const targetNum = /^\d+$/.test(targetEmpNo) ? parseInt(targetEmpNo, 10) : null;
    const targetGid = (emp.gid || '').trim().toUpperCase();
    const targetEmpCode = (emp.empCode || '').replace(/\D/g, '');

    // Skip self when editing
    const isSelf =
      (excludeIdClean && targetId && targetId === excludeIdClean) ||
      (excludeEmpNoClean && targetEmpNo === excludeEmpNoClean) ||
      (excludeNumEmpNo !== null && targetNum !== null && targetNum === excludeNumEmpNo) ||
      (excludeGidClean && targetGid && targetGid === excludeGidClean);

    if (isSelf) continue;

    // 1. Check Employee No. (Strict uniqueness)
    if (cleanEmpNo && targetEmpNo) {
      if (cleanEmpNo === targetEmpNo) {
        return {
          employee: emp,
          field: 'empNo',
          fieldLabel: 'Employee No.',
          matchedValue: cleanEmpNo,
          reason: `Employee No. "${cleanEmpNo}" ซ้ำกับพนักงาน "${emp.firstName} ${emp.familyName || ''}".trim() (รหัส: ${emp.empNo}, GID: ${emp.gid || '-'})`,
        };
      }
      if (numEmpNo !== null && targetNum !== null && numEmpNo === targetNum) {
        return {
          employee: emp,
          field: 'empNo',
          fieldLabel: 'Employee No.',
          matchedValue: cleanEmpNo,
          reason: `Employee No. "${cleanEmpNo}" (เลขตรงกับ ${emp.empNo}) ซ้ำกับพนักงาน "${emp.firstName} ${emp.familyName || ''}".trim()`,
        };
      }
    }

    // 2. Check EmpCode (8-digit Payroll code - Strict uniqueness)
    if (cleanEmpCode && cleanEmpCode.length >= 4 && targetEmpCode && targetEmpCode.length >= 4) {
      if (cleanEmpCode === targetEmpCode) {
        return {
          employee: emp,
          field: 'empCode',
          fieldLabel: 'EmpCode (8 หลัก)',
          matchedValue: cleanEmpCode,
          reason: `EmpCode "${cleanEmpCode}" ซ้ำกับพนักงาน "${emp.firstName} ${emp.familyName || ''}".trim() (รหัส: ${emp.empNo})`,
        };
      }
    }

    // 3. Check GID (Global ID - Strict uniqueness)
    if (cleanGid && targetGid && cleanGid.length >= 3) {
      if (cleanGid === targetGid) {
        return {
          employee: emp,
          field: 'gid',
          fieldLabel: 'GID (Global ID)',
          matchedValue: cleanGid,
          reason: `GID "${cleanGid}" ซ้ำกับพนักงาน "${emp.firstName} ${emp.familyName || ''}".trim() (รหัส: ${emp.empNo})`,
        };
      }
    }
  }

  return null;
};

interface BatchUploadSummary {
  totalRows: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  costCenterUpdated: number;
  empCodeUpdated: number;
  deptUpdated: number;
  shiftWorkerUpdated: number;
  functionUpdated: number;
  logs: EmployeeUpdateLog[];
  skippedRows: Array<{ row: number; reason: string; raw: string }>;
}

interface EmployeeMasterViewProps {
  departments: Department[];
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  employees: Employee[];
  selectedDepartment: string;
  onSelectDepartment?: (dept: string) => void;
  onDataChanged: () => void;
}

export const EmployeeMasterView: React.FC<EmployeeMasterViewProps> = ({
  departments,
  currentUser,
  theme,
  employees,
  selectedDepartment,
  onSelectDepartment,
  onDataChanged,
}) => {
  const isDark = theme === 'dark';
  const isAdmin = currentUser.role === 'Admin';

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSection, setSelectedSection] = useState<string>(selectedDepartment || 'ALL');
  const [shiftTypeFilter, setShiftTypeFilter] = useState<'ALL' | 'SHIFT' | 'OFFICE'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [activeTab, setActiveTab] = useState<'employees' | 'departments'>('employees');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [uploadSummary, setUploadSummary] = useState<BatchUploadSummary | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<{ text: string; matchedEmp: Employee; fieldLabel: string } | null>(null);

  const showToast = (text: string, type: 'info' | 'success' | 'error' = 'success') => {
    setSyncToast({ text, type });
    setTimeout(() => {
      setSyncToast(null);
    }, 4000);
  };

  /**
   * Auto-switch to Edit Mode if EmpNo, EmpCode, or GID already exists in database
   */
  const checkAndAutoSwitchToEdit = (
    empNoVal?: string,
    empCodeVal?: string,
    gidVal?: string,
    overrideEmployees?: Employee[]
  ): boolean => {
    if (!isNew) return false;
    const list = overrideEmployees || storage.getEmployees();
    const match = findDuplicateEmployee(empNoVal, empCodeVal, gidVal, list);
    if (match) {
      const noticeMsg = `ตรวจพบข้อมูลซ้ำ: ${match.reason} — ระบบได้สลับมายัง "โหมดแก้ไขข้อมูลพนักงาน" ของ ${match.employee.firstName} ให้โดยอัตโนมัติ`;
      setDuplicateNotice({
        text: noticeMsg,
        matchedEmp: match.employee,
        fieldLabel: match.fieldLabel,
      });
      showToast(noticeMsg, 'info');

      // Switch to EDIT mode immediately
      setIsNew(false);
      setEditingEmp(match.employee);
      setEmpForm({
        ...match.employee,
        empCode: match.employee.empCode || (empCodeVal ? empCodeVal.replace(/\D/g, '') : ''),
        gid: match.employee.gid || (gidVal ? gidVal.trim().toUpperCase() : ''),
      });
      return true;
    }
    return false;
  };

  // Synchronize when selectedDepartment changes from props
  useEffect(() => {
    if (selectedDepartment) {
      setSelectedSection(selectedDepartment);
    }
  }, [selectedDepartment]);

  // Handle section filter selection
  const handleSectionChange = (section: string) => {
    setSelectedSection(section);
    if (onSelectDepartment) {
      onSelectDepartment(section);
    }
  };

  // Reset all filters
  const handleResetFilters = () => {
    setSelectedSection('ALL');
    setSearchTerm('');
    setShiftTypeFilter('ALL');
    setStatusFilter('ALL');
    if (onSelectDepartment) {
      onSelectDepartment('ALL');
    }
  };

  // Dynamically compute available sections
  const availableSections = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();

    // 1. From departments list (excluding demo departments)
    departments.forEach(d => {
      const code = (d.code || '').trim().toUpperCase();
      if (code && code !== 'ALL' && !isDemoDepartment(code)) {
        map.set(code, { code, name: d.name || code });
      }
    });

    // 2. From storage.getDepartments()
    try {
      const storedDepts = storage.getDepartments();
      storedDepts.forEach(d => {
        const code = (d.code || '').trim().toUpperCase();
        if (code && code !== 'ALL' && !isDemoDepartment(code) && !map.has(code)) {
          map.set(code, { code, name: d.name || code });
        }
      });
    } catch {}

    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [departments]);

  // Employee counts per section
  const sectionCounts = useMemo(() => {
    const validEmps = employees.filter(e => !isDemoEmployee(e));
    const counts: Record<string, number> = { ALL: validEmps.length };
    validEmps.forEach(emp => {
      const dept = (emp.department || '').trim().toUpperCase();
      counts[dept] = (counts[dept] || 0) + 1;
    });
    return counts;
  }, [employees]);

  // Form state
  const [empForm, setEmpForm] = useState<Partial<Employee>>({
    empNo: '',
    empCode: '',
    gid: '',
    firstName: '',
    familyName: '',
    department: 'GM',
    division: 'MO CS BTS',
    functionTitle: '',
    costCenter: 'C93056',
    isShiftWorker: false,
    isActive: true,
  });

  // State to unlock editing of Employee No (Primary Key) for existing employees
  const [isEmpNoUnlocked, setIsEmpNoUnlocked] = useState<boolean>(false);

  // Department State
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [isNewDept, setIsNewDept] = useState(false);
  const [deptForm, setDeptForm] = useState<Partial<Department>>({
    code: '',
    name: ''
  });

  // Listen for Escape key to quickly close any active modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingDept) setEditingDept(null);
        if (editingEmp) setEditingEmp(null);
        if (employeeToDelete) setEmployeeToDelete(null);
        if (uploadSummary) setUploadSummary(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingDept, editingEmp, employeeToDelete, uploadSummary]);

  const filteredEmployees = useMemo(() => {
    return employees.filter(e => {
      if (isDemoEmployee(e)) return false;
      // 1. Section Filter
      if (selectedSection !== 'ALL') {
        const empDept = (e.department || '').trim().toUpperCase();
        if (empDept !== selectedSection.toUpperCase()) {
          return false;
        }
      }

      // 2. Shift Type Filter
      if (shiftTypeFilter === 'SHIFT' && !e.isShiftWorker) return false;
      if (shiftTypeFilter === 'OFFICE' && e.isShiftWorker) return false;

      // 3. Status Filter
      if (statusFilter === 'ACTIVE' && !e.isActive) return false;
      if (statusFilter === 'INACTIVE' && e.isActive) return false;

      // 4. Search query
      if (searchTerm) {
        const q = searchTerm.toLowerCase().trim();
        return (
          e.firstName.toLowerCase().includes(q) ||
          e.familyName.toLowerCase().includes(q) ||
          e.empNo.toLowerCase().includes(q) ||
          (e.empCode && e.empCode.toLowerCase().includes(q)) ||
          e.gid.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q) ||
          (e.functionTitle && e.functionTitle.toLowerCase().includes(q)) ||
          (e.costCenter && e.costCenter.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [employees, selectedSection, shiftTypeFilter, statusFilter, searchTerm]);

  const hasActiveFilters = selectedSection !== 'ALL' || searchTerm.trim() !== '' || shiftTypeFilter !== 'ALL' || statusFilter !== 'ALL';

  // Open Edit or Create
  const handleOpenCreate = () => {
    setIsNew(true);
    setIsEmpNoUnlocked(false);
    setDuplicateNotice(null);
    setEmpForm({
      empNo: '',
      empCode: '',
      gid: '',
      firstName: '',
      familyName: '',
      department: selectedDepartment !== 'ALL' ? selectedDepartment : 'GM',
      division: 'MO CS BTS',
      functionTitle: '',
      costCenter: 'C93056',
      isShiftWorker: true,
      isActive: true,
    });
    setEditingEmp({} as Employee);
  };

  const handleOpenEdit = (emp: Employee) => {
    setIsNew(false);
    setIsEmpNoUnlocked(false);
    setDuplicateNotice(null);
    setEditingEmp(emp);
    setEmpForm({ ...emp, empCode: emp.empCode || '' });
  };

  // Toggle Shift Worker (Direct 1-Click Toggle for Admins with instant cloud sync)
  const handleToggleShiftWorker = async (emp: Employee) => {
    if (!isAdmin) return;
    const list = storage.getEmployees();
    const idx = list.findIndex(e => e.empNo === emp.empNo);
    if (idx >= 0) {
      const nextVal = !list[idx].isShiftWorker;
      list[idx].isShiftWorker = nextVal;
      setIsSyncing(true);
      showToast(`กำลังบันทึกสถานะ ${nextVal ? 'Shift Worker (เข้ากะ)' : 'Office (ทำงานปกติ)'} ของ ${emp.firstName}...`, 'info');
      const ok = await storage.setEmployees(list);
      setIsSyncing(false);
      if (ok) {
        showToast(`บันทึกและซิงค์คลาวด์: ${emp.firstName} (${emp.empNo}) เป็น ${nextVal ? 'Shift Worker (เข้ากะ)' : 'Office (ทำงานปกติ)'} เรียบร้อยแล้ว`, 'success');
      } else {
        showToast(`บันทึกในเครื่องแล้ว (คลาวด์จะซิงค์ให้อัตโนมัติเมื่อออนไลน์)`, 'info');
      }
      onDataChanged();
    }
  };

  // Toggle Activate / Deactivate (Rule 2: "สามรถอับเดทแก้ไข Activate หรือ Deactivate ได้ด้วย Admin")
  const handleToggleActive = async (emp: Employee) => {
    if (!isAdmin) return;
    const list = storage.getEmployees();
    const idx = list.findIndex(e => e.empNo === emp.empNo);
    if (idx >= 0) {
      const nextVal = !list[idx].isActive;
      list[idx].isActive = nextVal;
      setIsSyncing(true);
      await storage.setEmployees(list);
      setIsSyncing(false);
      showToast(`อัปเดตสถานะ ${nextVal ? 'Active' : 'Deactivated'} ของ ${emp.firstName} เรียบร้อยแล้ว`, 'success');
      onDataChanged();
    }
  };

  // Save Employee with Strict Uniqueness Checking (EmpNo / EmpCode / GID)
  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!empForm.empNo || !empForm.gid || !empForm.firstName) {
      alert('กรุณากรอกข้อมูลสำคัญให้ครบถ้วน: รหัสพนักงาน (EmpNo), GID, และชื่อ (FirstName)');
      return;
    }

    const list = storage.getEmployees();
    let empEmpNo = empForm.empNo.trim();
    // Auto pad numeric EmpNo if 1-3 digits
    if (/^\d{1,3}$/.test(empEmpNo)) {
      empEmpNo = empEmpNo.padStart(4, '0');
    }
    const empGid = empForm.gid.trim().toUpperCase();
    const empFirstName = empForm.firstName.trim();
    let cleanEmpCode = empForm.empCode?.trim() ? empForm.empCode.replace(/\D/g, '') : undefined;
    if (!cleanEmpCode && /^\d{4}$/.test(empEmpNo)) {
      cleanEmpCode = `1000${empEmpNo}`;
    }

    const nowIso = new Date().toISOString();
    const targetDept = (empForm.department || (selectedSection !== 'ALL' ? selectedSection : 'GM')).trim().toUpperCase();

    if (isNew) {
      // 1. Strict Duplicate Check on Add
      const match = findDuplicateEmployee(empEmpNo, cleanEmpCode, empGid, list);
      if (match) {
        // Auto-switch to edit mode for this existing employee
        const noticeMsg = `ตรวจพบข้อมูลซ้ำ: ${match.reason} — ระบบได้สลับมายัง "โหมดแก้ไขข้อมูลพนักงาน" ของ ${match.employee.firstName} ให้โดยอัตโนมัติ`;
        setDuplicateNotice({
          text: noticeMsg,
          matchedEmp: match.employee,
          fieldLabel: match.fieldLabel,
        });
        showToast(noticeMsg, 'info');

        const existingIdx = list.findIndex(
          item =>
            (item.empNo && item.empNo.trim().toUpperCase() === match.employee.empNo.trim().toUpperCase()) ||
            (match.employee.gid && item.gid && item.gid.trim().toUpperCase() === match.employee.gid.trim().toUpperCase())
        );

        if (existingIdx >= 0) {
          list[existingIdx] = {
            ...list[existingIdx],
            empNo: empEmpNo || list[existingIdx].empNo,
            empCode: cleanEmpCode || list[existingIdx].empCode,
            gid: empGid || list[existingIdx].gid,
            firstName: empFirstName,
            familyName: empForm.familyName?.trim() || list[existingIdx].familyName || '',
            department: targetDept,
            division: empForm.division?.trim() || list[existingIdx].division || 'MO CS BTS',
            functionTitle: empForm.functionTitle?.trim() || list[existingIdx].functionTitle || '',
            costCenter: empForm.costCenter?.trim() || list[existingIdx].costCenter || 'C93056',
            isShiftWorker: Boolean(empForm.isShiftWorker),
            isActive: empForm.isActive !== undefined ? empForm.isActive : true,
            updatedAt: nowIso,
          };
        }
      } else {
        // No duplicate found: add brand new employee record
        list.push({
          id: `emp-${empEmpNo}`,
          empNo: empEmpNo,
          empCode: cleanEmpCode,
          gid: empGid,
          firstName: empFirstName,
          familyName: empForm.familyName?.trim() || '',
          department: targetDept,
          division: empForm.division?.trim() || 'MO CS BTS',
          functionTitle: empForm.functionTitle?.trim() || '',
          costCenter: empForm.costCenter?.trim() || 'C93056',
          isShiftWorker: Boolean(empForm.isShiftWorker),
          isActive: empForm.isActive !== undefined ? empForm.isActive : true,
          updatedAt: nowIso,
        });
      }
    } else {
      // 2. Strict Uniqueness Check in Edit Mode (ensure edited values do not collide with another employee)
      const origEmpNo = (editingEmp?.empNo || '').trim();
      const hasEmpNoChanged = Boolean(origEmpNo && origEmpNo.toUpperCase() !== empEmpNo.toUpperCase());

      // If empNo changed and empCode was the default 1000+oldEmpNo, auto-adjust to 1000+newEmpNo
      if (hasEmpNoChanged && (!cleanEmpCode || cleanEmpCode === `1000${origEmpNo}`)) {
        cleanEmpCode = `1000${empEmpNo}`;
      }

      const matchOther = findDuplicateEmployee(
        empEmpNo,
        cleanEmpCode,
        empGid,
        list,
        editingEmp?.id,
        editingEmp?.empNo,
        editingEmp?.gid
      );
      if (matchOther) {
        alert(
          `ไม่สามารถบันทึกได้เนื่องจากข้อมูลซ้ำกับพนักงานท่านอื่น:\n${matchOther.reason}\n\nพนักงานแต่ละคนต้องมี Employee No, EmpCode (8 หลัก), และ GID ที่ไม่ซ้ำกันเด็ดขาด`
        );
        return;
      }
    }

    // Close edit modal immediately so UI remains responsive and never hangs
    setEditingEmp(null);
    setIsEmpNoUnlocked(false);
    setDuplicateNotice(null);
    setIsSyncing(true);

    try {
      const origEmpNo = (editingEmp?.empNo || '').trim();
      const hasEmpNoChanged = Boolean(!isNew && origEmpNo && origEmpNo.toUpperCase() !== empEmpNo.toUpperCase());

      // If Employee No (Primary Key) was changed, perform safe cascade update across shift plans, punches, and OT
      if (hasEmpNoChanged) {
        showToast(`กำลังเปลี่ยนรหัส Employee No. จาก ${origEmpNo} ➔ ${empEmpNo}...`, 'info');
        const renameRes = await storage.changeEmployeeNo(origEmpNo, empEmpNo);
        if (!renameRes.success) {
          showToast(`เปลี่ยนรหัสไม่สำเร็จ: ${renameRes.error}`, 'error');
          alert(`ไม่สามารถเปลี่ยนรหัส Employee No. ได้:\n${renameRes.error}`);
          return;
        }
        showToast(
          `เปลี่ยนรหัสพนักงาน ${origEmpNo} ➔ ${empEmpNo} สำเร็จ (ตารางกะ ${renameRes.updatedPlansCount} รายการ, บันทึกรูดบัตร ${renameRes.updatedPunchesCount} รายการ, OT ${renameRes.updatedOTCount} รายการ)`,
          'success'
        );
      }

      // Refresh list to merge form changes
      const freshList = storage.getEmployees();
      const targetEmpNo = empEmpNo.toUpperCase();
      const targetGid = (editingEmp?.gid || empGid).trim().toUpperCase();

      if (isNew) {
        // Handled above in list
      } else {
        const idx = freshList.findIndex(item => 
          (item.empNo && item.empNo.trim().toUpperCase() === targetEmpNo) ||
          (item.gid && item.gid.trim().toUpperCase() === targetGid)
        );
        if (idx >= 0) {
          freshList[idx] = {
            ...freshList[idx],
            empNo: empEmpNo,
            empCode: cleanEmpCode,
            gid: empGid || freshList[idx].gid,
            firstName: empFirstName || freshList[idx].firstName,
            familyName: empForm.familyName?.trim() ?? freshList[idx].familyName ?? '',
            department: targetDept,
            division: empForm.division?.trim() || freshList[idx].division || 'MO CS BTS',
            functionTitle: empForm.functionTitle?.trim() ?? freshList[idx].functionTitle ?? '',
            costCenter: empForm.costCenter?.trim() || freshList[idx].costCenter || 'C93056',
            isShiftWorker: Boolean(empForm.isShiftWorker),
            isActive: empForm.isActive !== undefined ? empForm.isActive : freshList[idx].isActive,
            updatedAt: nowIso,
          };
        }
        list.length = 0;
        list.push(...freshList);
      }

      const ok = await storage.setEmployees(list);

      // Also synchronize corresponding User account if exists
      try {
        const users = storage.getUsers();
        const targetGidLower = empGid.toLowerCase();
        const targetEmpNoLower = empEmpNo.toLowerCase();
        const matchedUser = users.find(u => 
          u.email && (
            u.email.toLowerCase().includes(targetGidLower) ||
            u.email.toLowerCase().includes(targetEmpNoLower)
          )
        );
        if (matchedUser && matchedUser.department !== targetDept) {
          const updatedUser = {
            ...matchedUser,
            department: targetDept,
            updatedAt: nowIso,
          };
          await storage.saveUser(updatedUser);
        }
      } catch {}

      // If department was changed and filter was set to previous department, auto-switch filter so user immediately sees employee
      if (selectedSection !== 'ALL' && selectedSection.toUpperCase() !== targetDept) {
        handleSectionChange(targetDept);
      }

      if (ok) {
        showToast(`บันทึกข้อมูลพนักงาน ${empFirstName} (${empEmpNo}) เรียบร้อยแล้ว`, 'success');
      } else {
        showToast(`บันทึกข้อมูลในเครื่องเรียบร้อยแล้ว`, 'info');
      }
      onDataChanged();
    } catch (err: any) {
      console.error('handleSaveEmployee caught error:', err);
      showToast(`เกิดข้อผิดพลาดในการบันทึกพนักงาน: ${err?.message || 'โปรดลองใหม่อีกครั้ง'}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // Delete Employee (Admin Only)
  const handleDeleteEmployee = async (emp: Employee) => {
    if (!isAdmin) return;
    setEmployeeToDelete(null); // Close confirmation modal immediately to prevent hanging
    if (editingEmp?.empNo === emp.empNo) {
      setEditingEmp(null);
    }
    setIsSyncing(true);
    showToast(`กำลังลบข้อมูลพนักงาน ${emp.firstName} ${emp.familyName} (${emp.empNo}) ออกจากระบบ...`, 'info');
    try {
      const ok = await storage.deleteEmployee(emp.empNo);
      if (ok) {
        showToast(`ลบพนักงาน ${emp.firstName} ${emp.familyName} (${emp.empNo}) และซิงค์เรียบร้อยแล้ว`, 'success');
      } else {
        showToast(`ลบพนักงาน ${emp.firstName} เรียบร้อยแล้ว`, 'info');
      }
      onDataChanged();
    } catch (err: any) {
      showToast(`เกิดข้อผิดพลาดในการลบพนักงาน: ${err?.message || 'โปรดลองใหม่'}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // Department Handlers
  const handleOpenCreateDept = () => {
    setIsNewDept(true);
    setDeptForm({ code: '', name: '' });
    setEditingDept({ code: '', name: '' });
  };

  const handleEditDept = (dept: Department) => {
    setIsNewDept(false);
    setDeptForm(dept);
    setEditingDept(dept);
  };

  const handleSaveDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !deptForm.code || !deptForm.name) return;

    const deptNameClean = deptForm.name.trim();
    const deptCodeClean = deptForm.code.trim().toUpperCase();
    const nowIso = new Date().toISOString();

    const list = storage.getDepartments();
    const targetCode = (editingDept?.code || '').trim().toUpperCase();
    const hasCodeChanged = !isNewDept && Boolean(targetCode && targetCode !== deptCodeClean);

    if (isNewDept) {
      if (list.some(d => (d.code || '').trim().toUpperCase() === deptCodeClean)) {
        alert('รหัสแผนกนี้มีอยู่ในระบบแล้ว');
        return;
      }
      list.push({ code: deptCodeClean, name: deptNameClean, updatedAt: nowIso });
    } else {
      const idx = list.findIndex(d => (d.code || '').trim().toUpperCase() === targetCode);
      if (idx >= 0) {
        list[idx] = { ...list[idx], code: deptCodeClean, name: deptNameClean, updatedAt: nowIso };
      } else {
        list.push({ code: deptCodeClean, name: deptNameClean, updatedAt: nowIso });
      }
    }

    // 1. Close edit modal immediately for optimal responsiveness (prevents hanging)
    setEditingDept(null);
    setIsSyncing(true);
    showToast(`กำลังบันทึกและซิงค์ชื่อแผนก ${deptCodeClean} (${deptNameClean}) ขึ้นคลาวด์...`, 'info');

    try {
      // If department code was changed, cascade update Employees, Shift Codes, and Users
      if (hasCodeChanged) {
        // Cascade to Employees
        const currentEmps = storage.getEmployees();
        let empsChanged = false;
        const updatedEmps = currentEmps.map(emp => {
          if ((emp.department || '').trim().toUpperCase() === targetCode) {
            empsChanged = true;
            return { ...emp, department: deptCodeClean, updatedAt: nowIso };
          }
          return emp;
        });
        if (empsChanged) {
          await storage.setEmployees(updatedEmps);
        }

        // Cascade to Shift Codes
        const currentCodes = storage.getShiftCodes();
        let codesChanged = false;
        const updatedCodes = currentCodes.map(sc => {
          if ((sc.department || '').trim().toUpperCase() === targetCode) {
            codesChanged = true;
            return { ...sc, department: deptCodeClean, updatedAt: nowIso };
          }
          return sc;
        });
        if (codesChanged) {
          await storage.setShiftCodes(updatedCodes);
        }

        // Cascade to Users
        const currentUsers = storage.getUsers();
        let usersChanged = false;
        const updatedUsers = currentUsers.map(u => {
          if ((u.department || '').trim().toUpperCase() === targetCode) {
            usersChanged = true;
            return { ...u, department: deptCodeClean, updatedAt: nowIso };
          }
          return u;
        });
        if (usersChanged) {
          await storage.setUsers(updatedUsers);
        }

        // Mark old department code as deleted so it never resurrects
        await storage.deleteDepartment(targetCode);
      }

      const ok = await storage.setDepartments(list);
      if (ok) {
        showToast(`บันทึกชื่อแผนก ${deptCodeClean} (${deptNameClean}) ซิงค์ทุกเครื่องเรียบร้อยแล้ว`, 'success');
      } else {
        showToast(`บันทึกแผนกในเครื่องเรียบร้อยแล้ว`, 'info');
      }
      onDataChanged();
    } catch (err: any) {
      console.error('Save department error:', err);
      showToast(`เกิดข้อผิดพลาดในการบันทึกแผนก: ${err?.message || 'โปรดลองอีกครั้ง'}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteDept = async (code: string) => {
    if (!isAdmin) return;
    const upper = code.trim().toUpperCase();
    const affectedEmployees = employees.filter(e => (e.department || '').trim().toUpperCase() === upper);
    const remainingDepts = departments.filter(d => (d.code || '').trim().toUpperCase() !== upper);
    const fallbackDept = remainingDepts.find(d => d.code === 'RST')?.code || remainingDepts[0]?.code || 'GM';

    let promptMsg = `คุณต้องการลบแผนก ${code} หรือไม่?`;
    if (affectedEmployees.length > 0) {
      promptMsg += `\n(มีพนักงาน ${affectedEmployees.length} คนสังกัดแผนกนี้ ระบบจะช่วยย้ายพนักงานไปสังกัดแผนก ${fallbackDept} อัตโนมัติเพื่อไม่ให้ข้อมูลสูญหาย)`;
    }
    if (confirm(promptMsg)) {
      setIsSyncing(true);
      try {
        if (affectedEmployees.length > 0) {
          const updatedEmployees = employees.map(e => 
            (e.department || '').trim().toUpperCase() === upper
              ? { ...e, department: fallbackDept, updatedAt: new Date().toISOString() }
              : e
          );
          await storage.setEmployees(updatedEmployees);
        }

        // Cascade update any shift codes in deleted department
        const currentCodes = storage.getShiftCodes();
        const updatedCodes = currentCodes.map(sc => 
          (sc.department || '').trim().toUpperCase() === upper
            ? { ...sc, department: 'ALL', updatedAt: new Date().toISOString() }
            : sc
        );
        await storage.setShiftCodes(updatedCodes);

        // Cascade update any users assigned to deleted department
        const currentUsers = storage.getUsers();
        const updatedUsers = currentUsers.map(u => 
          (u.department || '').trim().toUpperCase() === upper
            ? { ...u, department: fallbackDept, updatedAt: new Date().toISOString() }
            : u
        );
        await storage.setUsers(updatedUsers);

        await storage.deleteDepartment(upper);
        onDataChanged();
        showToast(`ลบแผนก ${code} และซิงค์ฐานข้อมูลคลาวด์เรียบร้อยแล้ว`, 'success');
      } catch (err: any) {
        showToast(`เกิดข้อผิดพลาดในการลบแผนก: ${err?.message || 'โปรดลองใหม่'}`, 'error');
      } finally {
        setIsSyncing(false);
      }
    }
  };

  // Column Aliases for Flexible Spreadsheet Matching
  const EMP_NO_ALIASES = ['EmpNo', 'Emp No', 'Emp No.', 'Employee No', 'Employee No.', 'EmployeeNo', 'Staff ID', 'Employee ID', 'EmpID', 'ID', 'No.', 'รหัสพนักงาน', 'รหัส', 'No'];
  const EMP_CODE_ALIASES = ['EmpCode', 'Emp Code', 'empCode', 'EmployeeCode', 'Employee Code', 'รหัสพนักงาน8หลัก', 'รหัส 8 หลัก', 'PayrollCode', 'Payroll Code', 'รหัส Payroll', 'Payroll ID', 'Payroll', 'RefCode', 'Ref Code'];
  const GID_ALIASES = ['GID', 'gid', 'Global ID', 'GlobalID', 'Global Id', 'Z-ID', 'ZID', 'รหัส GID', 'Siemens GID', 'GID Code'];
  const FIRST_NAME_ALIASES = ['FirstName', 'First Name', 'Firstname', 'ชื่อจริง', 'ชื่อ', 'Name', 'Employee Name', 'EmployeeName', 'ชื่อพนักงาน'];
  const FAMILY_NAME_ALIASES = ['FamilyName', 'Family Name', 'Familyname', 'LastName', 'Last Name', 'Lastname', 'Surname', 'นามสกุล'];
  const DEPT_ALIASES = ['Department', 'Dept', 'Dept.', 'Department Code', 'แผนก', 'สังกัด', 'ฝ่าย'];
  const DIVISION_ALIASES = ['Division', 'Div', 'Div.', 'Division Code', 'ส่วนงาน', 'ฝ่ายงาน'];
  const FUNCTION_ALIASES = ['Function', 'FunctionTitle', 'Function Title', 'Position', 'Role', 'ตำแหน่ง', 'ตำแหน่งงาน', 'หน้าที่', 'Job Title'];
  const COST_CENTER_ALIASES = ['CostCenter', 'Cost Center', 'Cost Centre', 'CostCentre', 'Cost_Center', 'CC', 'Cost Center Code', 'ศูนย์ต้นทุน', 'รหัสศูนย์ต้นทุน'];
  const SHIFT_WORKER_ALIASES = ['IsShiftWorker', 'ShiftWorker', 'Shift Worker', 'Shift', 'Is Shift Worker', 'พนักงานกะ', 'เข้ากะ', 'กะ', 'Shift / Normal', 'Work Type'];
  const ACTIVE_ALIASES = ['IsActive', 'Active', 'Status', 'สถานะ', 'การทำงาน'];

  const getRowValue = (r: Record<string, any>, aliases: string[]): string | undefined => {
    const keys = Object.keys(r);
    for (const alias of aliases) {
      const cleanAlias = alias.toLowerCase().replace(/[\s_\-\.]/g, '');
      for (const k of keys) {
        const cleanK = k.toLowerCase().replace(/[\s_\-\.]/g, '');
        if (cleanK === cleanAlias) {
          const val = r[k];
          if (val !== undefined && val !== null) {
            const str = String(val).trim();
            if (str !== '') return str;
          }
        }
      }
    }
    return undefined;
  };

  // Robust Batch Upload & Update Employees
  const handleBatchUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAdmin) return;
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsSyncing(true);
      showToast('กำลังอ่านและวิเคราะห์ข้อมูลไฟล์พนักงาน...', 'info');

      const buffer = await readFileAsArrayBuffer(file);
      const rows = parseSheetToRows(buffer);

      if (!rows || rows.length === 0) {
        throw new Error('ไม่พบแถวข้อมูลในไฟล์ กรุณาตรวจสอบไฟล์ที่อัปโหลด');
      }

      // Load fresh copy of current employees
      const currentList = [...storage.getEmployees()];
      const nowIso = new Date().toISOString();

      let addedCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;
      let skippedCount = 0;
      let costCenterUpdated = 0;
      let empCodeUpdated = 0;
      let deptUpdated = 0;
      let shiftWorkerUpdated = 0;
      let functionUpdated = 0;

      const logs: EmployeeUpdateLog[] = [];
      const skippedRows: Array<{ row: number; reason: string; raw: string }> = [];
      const deptChangedEmployees: Array<{ empNo: string; gid: string; newDept: string }> = [];
      const empNoRenamedList: Array<{ oldEmpNo: string; newEmpNo: string }> = [];

      rows.forEach((r, idx) => {
        const rowNum = idx + 2; // +1 for 0-index, +1 for Excel header
        const rawEmpNo = getRowValue(r, EMP_NO_ALIASES);
        const rawEmpCode = getRowValue(r, EMP_CODE_ALIASES);
        const rawGid = getRowValue(r, GID_ALIASES);
        const rawFirstName = getRowValue(r, FIRST_NAME_ALIASES);
        const rawFamilyName = getRowValue(r, FAMILY_NAME_ALIASES);
        const rawDept = getRowValue(r, DEPT_ALIASES);
        const rawDivision = getRowValue(r, DIVISION_ALIASES);
        const rawFunction = getRowValue(r, FUNCTION_ALIASES);
        const rawCostCenter = getRowValue(r, COST_CENTER_ALIASES);
        const rawShiftWorker = getRowValue(r, SHIFT_WORKER_ALIASES);
        const rawActive = getRowValue(r, ACTIVE_ALIASES);

        // Check if row has any relevant data
        const hasAnyData = [
          rawEmpNo, rawEmpCode, rawGid, rawFirstName, rawFamilyName,
          rawDept, rawDivision, rawFunction, rawCostCenter, rawShiftWorker, rawActive
        ].some(Boolean);

        if (!hasAnyData) {
          return; // Ignore empty rows
        }

        // 1. Try to match existing employee in current database via Strict Uniqueness (EmpNo, EmpCode, GID)
        let existingIndex = -1;
        let matchType = '';

        const dupMatch = findDuplicateEmployee(rawEmpNo, rawEmpCode, rawGid, currentList);
        if (dupMatch) {
          existingIndex = currentList.findIndex(
            e =>
              (e.empNo && e.empNo.trim().toUpperCase() === dupMatch.employee.empNo.trim().toUpperCase()) ||
              (dupMatch.employee.gid && e.gid && e.gid.trim().toUpperCase() === dupMatch.employee.gid.trim().toUpperCase())
          );
          if (existingIndex >= 0) {
            matchType = `${dupMatch.fieldLabel} (${dupMatch.matchedValue})`;
          }
        }

        // Secondary fallback: Match by First & Last Name if identifier did not match
        if (existingIndex < 0 && rawFirstName) {
          const cleanFn = rawFirstName.toLowerCase();
          const cleanLn = (rawFamilyName || '').toLowerCase();
          existingIndex = currentList.findIndex(e => {
            const eFn = (e.firstName || '').trim().toLowerCase();
            const eLn = (e.familyName || '').trim().toLowerCase();
            if (cleanLn) {
              return (eFn === cleanFn && eLn === cleanLn) || (eFn === cleanLn && eLn === cleanFn);
            }
            return eFn === cleanFn && eFn.length >= 4;
          });
          if (existingIndex >= 0) {
            matchType = `ชื่อ (${rawFirstName})`;
          }
        }

        // --- IF FOUND: Perform Surgical, Non-Destructive Update ---
        if (existingIndex >= 0) {
          const existing = currentList[existingIndex];
          const changes: EmployeeFieldChange[] = [];

          // 0. EmpNo (if provided and different)
          if (rawEmpNo !== undefined) {
            const cleanEmpNo = String(rawEmpNo).trim().replace(/\.0+$/, '');
            if (cleanEmpNo && cleanEmpNo !== existing.empNo) {
              const oldEmpNo = existing.empNo;
              changes.push({
                field: 'empNo',
                label: 'Employee No. (Primary Key)',
                from: oldEmpNo || '(ไม่มี)',
                to: cleanEmpNo,
              });
              existing.empNo = cleanEmpNo;
              existing.id = `emp-${cleanEmpNo}`;
              if (oldEmpNo) {
                empNoRenamedList.push({ oldEmpNo, newEmpNo: cleanEmpNo });
              }
            }
          }

          // 1. CostCenter (Update or Add)
          if (rawCostCenter !== undefined) {
            const newCostCenter = rawCostCenter.trim();
            if (newCostCenter && newCostCenter !== existing.costCenter) {
              changes.push({
                field: 'costCenter',
                label: 'Cost Center',
                from: existing.costCenter || '(ว่าง)',
                to: newCostCenter,
              });
              existing.costCenter = newCostCenter;
              costCenterUpdated++;
            }
          }

          // 2. EmpCode (Update or Add 8-digit Payroll code)
          if (rawEmpCode !== undefined) {
            const cleanEmpCode = rawEmpCode.replace(/\.0+$/, '').replace(/\s+/g, '');
            if (cleanEmpCode && cleanEmpCode !== (existing.empCode || '')) {
              changes.push({
                field: 'empCode',
                label: 'EmpCode (8 หลัก)',
                from: existing.empCode || '(ไม่มี)',
                to: cleanEmpCode,
              });
              existing.empCode = cleanEmpCode;
              empCodeUpdated++;
            }
          }

          // 3. Department
          if (rawDept !== undefined) {
            const newDept = rawDept.trim().toUpperCase();
            if (newDept && newDept !== existing.department) {
              changes.push({
                field: 'department',
                label: 'แผนก (Department)',
                from: existing.department || '(ไม่มี)',
                to: newDept,
              });
              existing.department = newDept;
              deptUpdated++;
              deptChangedEmployees.push({ empNo: existing.empNo, gid: existing.gid, newDept });
            }
          }

          // 4. Division
          if (rawDivision !== undefined) {
            const newDiv = rawDivision.trim();
            if (newDiv && newDiv !== existing.division) {
              changes.push({
                field: 'division',
                label: 'ส่วนงาน (Division)',
                from: existing.division || '(ไม่มี)',
                to: newDiv,
              });
              existing.division = newDiv;
            }
          }

          // 5. Function / Position
          if (rawFunction !== undefined) {
            const newFunc = rawFunction.trim();
            if (newFunc && newFunc !== existing.functionTitle) {
              changes.push({
                field: 'functionTitle',
                label: 'ตำแหน่ง (Function)',
                from: existing.functionTitle || '(ไม่มี)',
                to: newFunc,
              });
              existing.functionTitle = newFunc;
              functionUpdated++;
            }
          }

          // 6. GID (if provided and different)
          if (rawGid !== undefined) {
            const newGid = rawGid.trim();
            if (newGid && newGid !== existing.gid) {
              changes.push({
                field: 'gid',
                label: 'GID',
                from: existing.gid || '(ไม่มี)',
                to: newGid,
              });
              existing.gid = newGid;
            }
          }

          // 7. FirstName & FamilyName
          if (rawFirstName !== undefined) {
            const newFn = rawFirstName.trim();
            if (newFn && newFn !== existing.firstName) {
              changes.push({
                field: 'firstName',
                label: 'ชื่อจริง',
                from: existing.firstName || '(ไม่มี)',
                to: newFn,
              });
              existing.firstName = newFn;
            }
          }
          if (rawFamilyName !== undefined) {
            const newLn = rawFamilyName.trim();
            if (newLn !== existing.familyName) {
              changes.push({
                field: 'familyName',
                label: 'นามสกุล',
                from: existing.familyName || '(ไม่มี)',
                to: newLn,
              });
              existing.familyName = newLn;
            }
          }

          // 8. IsShiftWorker
          if (rawShiftWorker !== undefined) {
            const lower = rawShiftWorker.toLowerCase();
            const isShift = ['true', 'yes', 'y', '1', 'shift', 'กะ', 'เข้ากะ', 'เข้ากะทำงาน'].includes(lower);
            const isOffice = ['false', 'no', 'n', '0', 'normal', 'office', 'ปกติ', 'ออฟฟิศ', 'ไม่เข้ากะ'].includes(lower);
            if (isShift || isOffice) {
              const targetShift = isShift;
              if (targetShift !== Boolean(existing.isShiftWorker)) {
                changes.push({
                  field: 'isShiftWorker',
                  label: 'สถานะเข้ากะ (Shift Worker)',
                  from: existing.isShiftWorker ? 'เข้ากะ (Shift)' : 'ปกติ (Office)',
                  to: targetShift ? 'เข้ากะ (Shift)' : 'ปกติ (Office)',
                });
                existing.isShiftWorker = targetShift;
                shiftWorkerUpdated++;
              }
            }
          }

          // 9. IsActive
          if (rawActive !== undefined) {
            const lower = rawActive.toLowerCase();
            const isActive = ['true', 'yes', 'y', '1', 'active', 'ปกติ', 'เปิด', 'ทำงาน'].includes(lower);
            const isInactive = ['false', 'no', 'n', '0', 'inactive', 'ลาออก', 'ปิด', 'ระงับ'].includes(lower);
            if (isActive || isInactive) {
              const targetActive = isActive;
              if (targetActive !== (existing.isActive !== false)) {
                changes.push({
                  field: 'isActive',
                  label: 'สถานะการทำงาน',
                  from: existing.isActive !== false ? 'เปิดใช้งาน' : 'ระงับ',
                  to: targetActive ? 'เปิดใช้งาน' : 'ระงับ',
                });
                existing.isActive = targetActive;
              }
            }
          }

          if (changes.length > 0) {
            existing.updatedAt = nowIso;
            updatedCount++;
            logs.push({
              empNo: existing.empNo,
              empCode: existing.empCode,
              gid: existing.gid,
              name: `${existing.firstName} ${existing.familyName}`.trim(),
              isNew: false,
              matchType,
              changes,
            });
          } else {
            unchangedCount++;
          }
        } else {
          // --- NOT FOUND: Check if row can be added as a NEW employee ---
          let cleanEmpNo = rawEmpNo ? String(rawEmpNo).trim().replace(/\.0+$/, '') : '';
          let cleanGid = rawGid ? String(rawGid).trim().toUpperCase() : '';
          let cleanEmpCode = rawEmpCode ? String(rawEmpCode).trim().replace(/\.0+$/, '').replace(/\D/g, '') : '';

          // Auto-derive EmpNo from 8-digit payroll code or pad numeric EmpNo
          if (!cleanEmpNo && cleanEmpCode && cleanEmpCode.length === 8) {
            cleanEmpNo = cleanEmpCode.slice(-4);
          } else if (cleanEmpNo && /^\d{1,3}$/.test(cleanEmpNo)) {
            cleanEmpNo = cleanEmpNo.padStart(4, '0');
          }

          if (!cleanGid && cleanEmpNo) {
            cleanGid = `Z${cleanEmpNo}TH`;
          }

          if (!cleanEmpCode && cleanEmpNo && /^\d{4}$/.test(cleanEmpNo)) {
            cleanEmpCode = `1000${cleanEmpNo}`;
          }

          const identifier = cleanEmpNo || cleanGid || cleanEmpCode;
          let firstName = (rawFirstName || '').trim();
          let familyName = (rawFamilyName || '').trim();

          // If firstName contains full name and familyName is empty, split cleanly
          if (firstName && !familyName) {
            const parts = parseEmployeeNameParts(firstName);
            firstName = parts.firstName;
            familyName = parts.familyName !== '-' ? parts.familyName : '';
          }

          if (identifier && firstName) {
            const finalEmpNo = cleanEmpNo || cleanGid.replace(/^Z/i, '').slice(0, 4) || `E${Date.now().toString().slice(-4)}`;
            const finalGid = cleanGid || `Z${finalEmpNo}TH`;
            const finalEmpCode = cleanEmpCode || undefined;
            const newDept = (rawDept && rawDept.trim().toUpperCase()) || (selectedSection !== 'ALL' ? selectedSection : 'GM');
            const lowerShift = (rawShiftWorker || '').toLowerCase();
            const isShift = ['true', 'yes', 'y', '1', 'shift', 'กะ', 'เข้ากะ'].includes(lowerShift);

            // Double check if final identifiers collide with any employee in currentList (preventing duplicates within file or derived IDs)
            const secondMatch = findDuplicateEmployee(finalEmpNo, finalEmpCode, finalGid, currentList);
            if (secondMatch) {
              const secIdx = currentList.findIndex(
                e =>
                  (e.empNo && e.empNo.trim().toUpperCase() === secondMatch.employee.empNo.trim().toUpperCase()) ||
                  (secondMatch.employee.gid && e.gid && e.gid.trim().toUpperCase() === secondMatch.employee.gid.trim().toUpperCase())
              );
              if (secIdx >= 0) {
                const existing = currentList[secIdx];
                const changes: EmployeeFieldChange[] = [];
                if (finalEmpCode && finalEmpCode !== (existing.empCode || '')) {
                  changes.push({ field: 'empCode', label: 'EmpCode (8 หลัก)', from: existing.empCode || '(ไม่มี)', to: finalEmpCode });
                  existing.empCode = finalEmpCode;
                  empCodeUpdated++;
                }
                if (rawCostCenter && rawCostCenter.trim() !== (existing.costCenter || '')) {
                  changes.push({ field: 'costCenter', label: 'Cost Center', from: existing.costCenter || '(ว่าง)', to: rawCostCenter.trim() });
                  existing.costCenter = rawCostCenter.trim();
                  costCenterUpdated++;
                }
                if (newDept && newDept !== existing.department) {
                  changes.push({ field: 'department', label: 'แผนก (Department)', from: existing.department || '(ไม่มี)', to: newDept });
                  existing.department = newDept;
                  deptUpdated++;
                  deptChangedEmployees.push({ empNo: existing.empNo, gid: existing.gid, newDept });
                }
                if (changes.length > 0) {
                  existing.updatedAt = nowIso;
                  updatedCount++;
                  logs.push({
                    empNo: existing.empNo,
                    empCode: existing.empCode,
                    gid: existing.gid,
                    name: `${existing.firstName} ${existing.familyName}`.trim(),
                    isNew: false,
                    matchType: `ซ้ำ ${secondMatch.fieldLabel} (${secondMatch.matchedValue}) - สลับเป็นอัปเดต`,
                    changes,
                  });
                } else {
                  unchangedCount++;
                }
                return;
              }
            }

            const newEmp: Employee = {
              id: `emp-${finalEmpNo}`,
              empNo: finalEmpNo,
              empCode: finalEmpCode,
              gid: finalGid,
              firstName,
              familyName,
              department: newDept,
              division: rawDivision || 'MO CS BTS',
              functionTitle: rawFunction || '',
              costCenter: rawCostCenter || 'C93056',
              isShiftWorker: isShift,
              isActive: true,
              updatedAt: nowIso,
            };

            currentList.push(newEmp);
            addedCount++;
            if (finalEmpCode) empCodeUpdated++;
            if (rawCostCenter) costCenterUpdated++;

            logs.push({
              empNo: newEmp.empNo,
              empCode: newEmp.empCode,
              gid: newEmp.gid,
              name: `${newEmp.firstName} ${newEmp.familyName}`.trim(),
              isNew: true,
              changes: [
                {
                  field: 'all',
                  label: 'เพิ่มพนักงานใหม่',
                  from: '(ไม่มี)',
                  to: `${newDept} | CostCenter: ${newEmp.costCenter}${finalEmpCode ? ` | EmpCode: ${finalEmpCode}` : ''}`,
                }
              ]
            });
          } else {
            skippedCount++;
            skippedRows.push({
              row: rowNum,
              reason: !identifier
                ? 'ขาดรหัสพนักงาน (EmpNo) หรือ GID — ไม่สามารถจับคู่หรือสร้างพนักงานได้'
                : 'ขาดชื่อพนักงาน (FirstName) สำหรับการเพิ่มพนักงานใหม่',
              raw: JSON.stringify(r),
            });
          }
        }
      });

      // Execute cascade update for any Employee No. (Primary Key) renames across shift plans, punches, and OT
      if (empNoRenamedList.length > 0) {
        for (const ren of empNoRenamedList) {
          await storage.changeEmployeeNo(ren.oldEmpNo, ren.newEmpNo);
        }
      }

      // Synchronize linked user accounts if department changed
      if (deptChangedEmployees.length > 0) {
        const users = storage.getUsers();
        let usersModified = false;
        deptChangedEmployees.forEach(({ empNo, gid, newDept }) => {
          const userIdx = users.findIndex(u => 
            (u.empNo && u.empNo.trim().toUpperCase() === empNo.trim().toUpperCase()) ||
            (u.gid && u.gid.trim().toUpperCase() === gid.trim().toUpperCase())
          );
          if (userIdx >= 0 && users[userIdx].department !== newDept) {
            users[userIdx].department = newDept;
            storage.saveUser(users[userIdx]);
            usersModified = true;
          }
        });
        if (usersModified) {
          showToast('อัปเดตแผนกในบัญชีผู้ใช้งาน (User Accounts) ที่เกี่ยวข้องให้ตรงกันเรียบร้อย', 'info');
        }
      }

      // Save and sync to Cloud
      if (addedCount > 0 || updatedCount > 0) {
        showToast('กำลังบันทึกและซิงค์ข้อมูลพนักงานขึ้นคลาวด์...', 'info');
        await storage.setEmployees(currentList);
        onDataChanged();
      }

      setIsSyncing(false);

      const summary: BatchUploadSummary = {
        totalRows: rows.length,
        addedCount,
        updatedCount,
        unchangedCount,
        skippedCount,
        costCenterUpdated,
        empCodeUpdated,
        deptUpdated,
        shiftWorkerUpdated,
        functionUpdated,
        logs,
        skippedRows,
      };

      setUploadSummary(summary);

      if (addedCount > 0 || updatedCount > 0) {
        showToast(`อัปเดตสำเร็จ! แก้ไข/เพิ่มข้อมูล ${updatedCount} คน, เพิ่มใหม่ ${addedCount} คน (ซิงค์คลาวด์แล้ว)`, 'success');
      } else {
        showToast('ข้อมูลในไฟล์ตรงกับฐานข้อมูลปัจจุบันแล้ว ไม่มีการเปลี่ยนแปลง', 'info');
      }

    } catch (err: any) {
      setIsSyncing(false);
      alert(`ข้อผิดพลาดในการอัปโหลด: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  };

  // Download Employee Template (Blank template with EmpCode 8 digits & instructions)
  const handleDownloadImportTemplate = (format: 'xlsx' | 'csv' = 'xlsx') => {
    const { csvContent, workbook } = generateEmployeeMasterTemplate();
    if (format === 'xlsx') {
      downloadWorkbook(workbook, 'Template_Employee_Master_Import.xlsx');
      showToast('ดาวน์โหลดไฟล์ Template Excel (.xlsx) พร้อมชีตคำแนะนำและคอลัมน์ EmpCode 8 หลัก สำเร็จ', 'success');
    } else {
      downloadBlob(csvContent, 'Template_Employee_Master_Import.csv', 'text/csv;charset=utf-8;');
      showToast('ดาวน์โหลดไฟล์ Template CSV สำเร็จ', 'success');
    }
  };

  // Export full Employee Master Database with EmpCode
  const handleDownloadTemplate = (format: 'xlsx' | 'csv' = 'xlsx') => {
    const { csvContent, workbook } = generateEmployeeMasterTemplate(employees);
    if (format === 'xlsx') {
      downloadWorkbook(workbook, 'Siemens_Employee_Master_Current.xlsx');
      showToast(`ส่งออกข้อมูลพนักงานปัจจุบัน ${employees.length} คน เป็นไฟล์ Excel (.xlsx) สำเร็จ`, 'success');
    } else {
      downloadBlob(csvContent, 'Siemens_Employee_Master_Current.csv', 'text/csv;charset=utf-8;');
      showToast(`ส่งออกข้อมูลพนักงานปัจจุบัน ${employees.length} คน เป็นไฟล์ CSV สำเร็จ`, 'success');
    }
  };

  return (
    <div className={`p-4 flex flex-col space-y-4 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
      {/* Header Banner */}
      <div className={`p-4 rounded border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
        isDark ? 'bg-[#131e29] border-[#223344]' : 'bg-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/30">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold flex items-center gap-2">
              ฐานข้อมูลพนักงาน (Employee Master Database)
            </h1>
            <p className="text-xs text-slate-400">
              {isAdmin 
                ? 'เชื่อมโยงข้อมูลด้วย GID และ Employee No., กำหนดการเข้ากะ (Shift Status), และจัดการสถานะ Activate / Deactivate'
                : `Role User (${currentUser.name}): สิทธิ์เรียกดูฐานข้อมูลพนักงาน กรองแผนก และส่งออกข้อมูล (View, Filter & Export Only) • การเพิ่ม แก้ไข หรือลบข้อมูลพนักงานสงวนไว้สำหรับ Role Admin`}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2 flex-wrap gap-2">
          <div className={`flex items-center rounded border px-2.5 py-1.5 text-xs w-52 ${
            isDark ? 'bg-[#0f1721] border-[#273a4e]' : 'bg-slate-50 border-slate-300'
          }`}>
            <Search className="w-3.5 h-3.5 mr-2 text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder="ค้นหาชื่อ, GID, รหัส..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="bg-transparent outline-none w-full text-xs"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="text-slate-400 hover:text-slate-200 ml-1"
                title="ล้างคำค้นหา"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Template Download (Excel / CSV) */}
          <div className="flex items-center">
            <button
              onClick={() => handleDownloadImportTemplate('xlsx')}
              title="ดาวน์โหลดไฟล์ Template Excel (.xlsx) พร้อมชีตคำแนะนำและคอลัมน์ EmpCode 8 หลัก สำหรับนำเข้าหรือแก้ไขพนักงาน"
              className={`flex items-center space-x-1 px-2.5 py-1.5 rounded-l border text-xs font-medium transition cursor-pointer ${
                isDark ? 'bg-[#1a2838] border-[#2e4257] text-teal-300 hover:bg-[#233549]' : 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-teal-400" />
              <span>Template Excel</span>
            </button>
            <button
              onClick={() => handleDownloadImportTemplate('csv')}
              title="ดาวน์โหลดไฟล์ Template แบบ CSV"
              className={`px-2 py-1.5 rounded-r border border-l-0 text-xs font-medium transition cursor-pointer ${
                isDark ? 'bg-[#1a2838] border-[#2e4257] text-slate-300 hover:bg-[#233549]' : 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100'
              }`}
            >
              CSV
            </button>
          </div>

          {/* Export Employee Database (Excel / CSV) */}
          <div className="flex items-center">
            <button
              onClick={() => handleDownloadTemplate('xlsx')}
              title="ส่งออกฐานข้อมูลพนักงานปัจจุบันทั้งหมด เป็นไฟล์ Excel (.xlsx) รวมคอลัมน์ EmpCode สำหรับอ้างอิง Payroll"
              className={`flex items-center space-x-1 px-2.5 py-1.5 rounded-l border text-xs font-medium transition cursor-pointer ${
                isDark ? 'bg-[#1a2838] border-[#2e4257] text-slate-200 hover:bg-[#233549]' : 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200'
              }`}
            >
              <Download className="w-3.5 h-3.5 text-teal-400" />
              <span>Export Excel</span>
            </button>
            <button
              onClick={() => handleDownloadTemplate('csv')}
              title="ส่งออกฐานข้อมูลพนักงานปัจจุบันทั้งหมด เป็นไฟล์ CSV"
              className={`px-2 py-1.5 rounded-r border border-l-0 text-xs font-medium transition cursor-pointer ${
                isDark ? 'bg-[#1a2838] border-[#2e4257] text-slate-300 hover:bg-[#233549]' : 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200'
              }`}
            >
              CSV
            </button>
          </div>

          {isAdmin && (
            <>
              <label 
                title="อัปโหลดไฟล์ Excel (.xlsx) หรือ CSV เพื่ออัปเดตข้อมูลพนักงาน (เช่น เปลี่ยน CostCenter, เพิ่ม EmpCode 8 หลัก) หรือเพิ่มพนักงานใหม่ โดยคงข้อมูลเดิมไว้"
                className="cursor-pointer flex items-center space-x-1 px-3 py-1.5 rounded border border-teal-600/70 bg-teal-700/80 hover:bg-teal-600 text-white text-xs font-medium shadow-xs transition"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>นำเข้า / อัปเดต Excel/CSV</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleBatchUpload}
                  className="hidden"
                />
              </label>

              <button
                id="btn-add-employee"
                onClick={handleOpenCreate}
                className="flex items-center space-x-1 px-3 py-1.5 rounded font-semibold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>เพิ่มพนักงานใหม่</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Cloud Sync Notification Banner */}
      {syncToast && (
        <div className={`px-4 py-2.5 rounded border text-xs font-medium flex items-center justify-between shadow transition ${
          syncToast.type === 'error'
            ? 'bg-rose-950/40 text-rose-300 border-rose-800/50'
            : syncToast.type === 'info'
            ? 'bg-sky-950/40 text-sky-300 border-sky-800/50'
            : 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50'
        }`}>
          <div className="flex items-center space-x-2">
            <Cloud className={`w-4 h-4 ${syncToast.type === 'info' ? 'animate-pulse text-sky-400' : 'text-emerald-400'}`} />
            <span>{syncToast.text}</span>
          </div>
          <button onClick={() => setSyncToast(null)} className="text-xs opacity-60 hover:opacity-100 ml-4">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Sub Tabs for Employees vs Departments */}
      <div className="flex items-center space-x-1 border-b border-slate-700 pb-2">
        <button
          onClick={() => setActiveTab('employees')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-t text-xs font-semibold transition ${
            activeTab === 'employees' 
              ? (isDark ? 'bg-[#1a2838] text-teal-400 border-b-2 border-teal-400' : 'bg-white text-teal-600 border-b-2 border-teal-600')
              : (isDark ? 'text-slate-400 hover:bg-[#1a2838]/50' : 'text-slate-500 hover:bg-slate-100')
          }`}
        >
          <Users className="w-4 h-4" />
          <span>ข้อมูลพนักงาน (Employees)</span>
        </button>
        <button
          onClick={() => setActiveTab('departments')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-t text-xs font-semibold transition ${
            activeTab === 'departments' 
              ? (isDark ? 'bg-[#1a2838] text-teal-400 border-b-2 border-teal-400' : 'bg-white text-teal-600 border-b-2 border-teal-600')
              : (isDark ? 'text-slate-400 hover:bg-[#1a2838]/50' : 'text-slate-500 hover:bg-slate-100')
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>รหัสแผนก (Departments Master)</span>
        </button>
      </div>

      {/* Employee Content */}
      {activeTab === 'employees' ? (
        <>
          {/* Section & Attribute Filter Toolbar */}
          <div className={`p-3.5 rounded border flex flex-col space-y-3 ${
            isDark ? 'bg-[#0f1722] border-[#203244]' : 'bg-white border-slate-200 shadow-xs'
          }`}>
            {/* Top row: Section Dropdown + Shift Worker Filter + Status Filter + Count & Reset */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
                {/* 1. Section Filter Dropdown */}
                <div className="flex items-center space-x-2 shrink-0">
                  <div className="p-1.5 rounded bg-teal-500/10 text-teal-400 shrink-0 border border-teal-500/20">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <label htmlFor="select-employee-section" className="text-xs font-bold text-teal-400 whitespace-nowrap flex items-center gap-1">
                    <span>Section / แผนก:</span>
                  </label>
                  <select
                    id="select-employee-section"
                    aria-label="เลือก Section หรือแผนก"
                    value={selectedSection}
                    onChange={e => handleSectionChange(e.target.value)}
                    className={`px-3 py-1.5 rounded border text-xs font-medium cursor-pointer outline-none transition min-w-[190px] ${
                      isDark 
                        ? 'bg-[#14202c] border-[#273a4e] text-white focus:border-[#00e5e5]' 
                        : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-[#008b99]'
                    }`}
                  >
                    <option value="ALL">
                      ทุกแผนก (All Sections) ({employees.length} คน)
                    </option>
                    {availableSections.map(s => (
                      <option key={s.code} value={s.code}>
                        {s.code} - {s.name} ({sectionCounts[s.code] || 0} คน)
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Shift Worker Type Filter */}
                <div className={`flex items-center space-x-1 border rounded px-1.5 py-0.5 text-[11px] shrink-0 ${
                  isDark ? 'border-[#273a4e] bg-[#14202c]' : 'border-slate-300 bg-slate-100'
                }`}>
                  <span className="text-slate-400 px-1 font-medium">กะ:</span>
                  <button
                    type="button"
                    onClick={() => setShiftTypeFilter('ALL')}
                    className={`px-2 py-0.5 rounded transition font-medium ${
                      shiftTypeFilter === 'ALL'
                        ? 'bg-teal-600 text-white font-bold shadow-xs'
                        : isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ทั้งหมด
                  </button>
                  <button
                    type="button"
                    onClick={() => setShiftTypeFilter('SHIFT')}
                    className={`px-2 py-0.5 rounded transition font-medium ${
                      shiftTypeFilter === 'SHIFT'
                        ? 'bg-indigo-600 text-white font-bold shadow-xs'
                        : isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    เข้ากะ (Shift)
                  </button>
                  <button
                    type="button"
                    onClick={() => setShiftTypeFilter('OFFICE')}
                    className={`px-2 py-0.5 rounded transition font-medium ${
                      shiftTypeFilter === 'OFFICE'
                        ? 'bg-slate-600 text-white font-bold shadow-xs'
                        : isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ออฟฟิศ
                  </button>
                </div>

                {/* 3. Active Status Filter */}
                <div className={`flex items-center space-x-1 border rounded px-1.5 py-0.5 text-[11px] shrink-0 ${
                  isDark ? 'border-[#273a4e] bg-[#14202c]' : 'border-slate-300 bg-slate-100'
                }`}>
                  <span className="text-slate-400 px-1 font-medium">สถานะ:</span>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('ALL')}
                    className={`px-2 py-0.5 rounded transition font-medium ${
                      statusFilter === 'ALL'
                        ? 'bg-teal-600 text-white font-bold shadow-xs'
                        : isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ทั้งหมด
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('ACTIVE')}
                    className={`px-2 py-0.5 rounded transition font-medium ${
                      statusFilter === 'ACTIVE'
                        ? 'bg-emerald-600 text-white font-bold shadow-xs'
                        : isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('INACTIVE')}
                    className={`px-2 py-0.5 rounded transition font-medium ${
                      statusFilter === 'INACTIVE'
                        ? 'bg-rose-600 text-white font-bold shadow-xs'
                        : isDark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Deactivated
                  </button>
                </div>
              </div>

              {/* Counter and Clear Filter Button */}
              <div className="flex items-center space-x-2 shrink-0">
                <span className={`px-2.5 py-1 rounded text-xs font-mono font-semibold border ${
                  isDark ? 'bg-[#14202c] border-[#273a4e] text-teal-300' : 'bg-slate-100 border-slate-300 text-teal-700'
                }`}>
                  พบ {filteredEmployees.length} จาก {employees.length} คน
                </span>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className={`flex items-center space-x-1 px-2.5 py-1 rounded text-xs transition border cursor-pointer ${
                      isDark 
                        ? 'bg-rose-950/40 border-rose-700/50 text-rose-300 hover:bg-rose-900/50' 
                        : 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100'
                    }`}
                    title="ล้างการกรองทั้งหมด"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>ล้างตัวกรอง</span>
                  </button>
                )}
              </div>
            </div>

            {/* Quick Section Chips (ชิปคลิกเลือก Section / แผนกอย่างรวดเร็ว) */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pt-1 pb-0.5 scrollbar-thin">
              <span className="text-[11px] text-slate-400 shrink-0 mr-1 flex items-center gap-1">
                <Filter className="w-3 h-3 text-teal-400" />
                <span>Quick Filter:</span>
              </span>

              <button
                type="button"
                onClick={() => handleSectionChange('ALL')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition shrink-0 cursor-pointer flex items-center space-x-1.5 ${
                  selectedSection === 'ALL'
                    ? 'bg-teal-500 text-white font-bold shadow-xs'
                    : isDark
                      ? 'bg-[#14202c] hover:bg-[#1a2838] text-slate-300 border border-[#273a4e]'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300'
                }`}
              >
                <span>ทุกแผนก</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  selectedSection === 'ALL' ? 'bg-black/30 text-white' : 'bg-slate-600/30 text-slate-300'
                }`}>
                  {employees.length}
                </span>
              </button>

              {availableSections.map(s => {
                const count = sectionCounts[s.code] || 0;
                const isSelected = selectedSection === s.code;
                return (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => handleSectionChange(s.code)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition shrink-0 cursor-pointer flex items-center space-x-1.5 ${
                      isSelected
                        ? 'bg-teal-500 text-white font-bold shadow-xs ring-1 ring-teal-300'
                        : isDark
                          ? 'bg-[#14202c] hover:bg-[#1a2838] text-slate-300 border border-[#273a4e]'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300'
                    }`}
                    title={`${s.code}: ${s.name} (${count} คน)`}
                  >
                    <span>{s.code}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      isSelected ? 'bg-black/30 text-white' : 'bg-slate-600/30 text-slate-300'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`p-4 rounded border text-xs overflow-hidden ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
          }`}>
            <div className="overflow-x-auto max-h-[65vh] scrollbar-thin">
          <table className="w-full border-collapse text-left">
            <thead className={`sticky top-0 z-10 ${
              isDark ? 'bg-[#0a1118] text-slate-200' : 'bg-slate-100 text-slate-700'
            }`}>
              <tr>
                <th className="p-2.5 border-b border-r border-slate-700">Emp No.</th>
                <th className="p-2.5 border-b border-r border-slate-700">EmpCode (8 หลัก)</th>
                <th className="p-2.5 border-b border-r border-slate-700">GID</th>
                <th className="p-2.5 border-b border-r border-slate-700">ชื่อ - นามสกุล</th>
                <th className="p-2.5 border-b border-r border-slate-700">แผนก (Department)</th>
                <th className="p-2.5 border-b border-r border-slate-700">Function (ตำแหน่ง)</th>
                <th className="p-2.5 border-b border-r border-slate-700">Cost Center</th>
                <th className="p-2.5 border-b border-r border-slate-700 text-center">Shift Worker</th>
                <th className="p-2.5 border-b border-r border-slate-700 text-center">สถานะ (Status)</th>
                {isAdmin && <th className="p-2.5 border-b border-slate-700 text-center">จัดการ</th>}
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 10 : 9} className="p-8 text-center text-slate-400">
                    ไม่พบข้อมูลพนักงานตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(emp => (
                  <tr key={emp.empNo} className={`border-b border-slate-700/30 transition hover:bg-teal-500/5 ${
                    !emp.isActive ? 'opacity-50 bg-slate-900/30' : ''
                  }`}>
                    <td className="p-2.5 font-mono font-bold text-teal-300 border-r border-slate-700/30">
                      {emp.empNo}
                    </td>
                    <td className="p-2.5 font-mono border-r border-slate-700/30">
                      {emp.empCode ? (
                        <span className="font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/30 text-[11px]">
                          {emp.empCode}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px] italic" title="ยังไม่ได้กำหนด EmpCode สำหรับ Payroll">-</span>
                      )}
                    </td>
                    <td className="p-2.5 font-mono text-[#00e5e5] border-r border-slate-700/30">
                      {emp.gid}
                    </td>
                  <td className="p-2.5 font-semibold text-slate-100 border-r border-slate-700/30">
                    {emp.firstName} {emp.familyName}
                  </td>
                  <td className="p-2.5 font-mono font-bold text-slate-300 border-r border-slate-700/30">
                    {emp.department}
                  </td>
                  <td className="p-2.5 border-r border-slate-700/30 text-slate-400">
                    {emp.functionTitle || '-'}
                  </td>
                  <td className="p-2.5 font-mono border-r border-slate-700/30 text-slate-400">
                    {emp.costCenter || 'C93056'}
                  </td>
                  <td className="p-2.5 text-center border-r border-slate-700/30">
                    <button
                      onClick={() => handleToggleShiftWorker(emp)}
                      disabled={!isAdmin || isSyncing}
                      title={isAdmin ? `คลิกเพื่อสลับสถานะ (ปัจจุบัน: ${emp.isShiftWorker ? 'Shift Worker (เข้ากะ)' : 'Office (ทำงานปกติ)'})` : `สถานะ: ${emp.isShiftWorker ? 'Shift Worker (เข้ากะ)' : 'Office (ทำงานปกติ)'}`}
                      className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium transition cursor-pointer flex items-center justify-center space-x-1 mx-auto ${
                        emp.isShiftWorker 
                          ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/40 hover:bg-indigo-500/40' 
                          : 'bg-slate-700/40 text-slate-300 border border-slate-600/30 hover:bg-slate-700/60'
                      }`}
                    >
                      <span>{emp.isShiftWorker ? 'Shift' : 'Office'}</span>
                      {isAdmin && <ArrowLeftRight className="w-2.5 h-2.5 opacity-60 ml-0.5" />}
                    </button>
                  </td>
                  <td className="p-2.5 text-center border-r border-slate-700/30">
                    <button
                      onClick={() => handleToggleActive(emp)}
                      disabled={!isAdmin}
                      title={isAdmin ? 'คลิกเพื่อสลับสถานะ Activate / Deactivate' : ''}
                      className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium transition ${
                        emp.isActive
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-red-500/15 text-red-300 border border-red-500/30'
                      }`}
                    >
                      {emp.isActive ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Active</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3 h-3" />
                          <span>Deactivated</span>
                        </>
                      )}
                    </button>
                  </td>
                  {isAdmin && (
                    <td className="p-2.5 text-center">
                      <div className="flex items-center justify-center space-x-1">
                        <button
                          onClick={() => handleOpenEdit(emp)}
                          title="แก้ไขข้อมูลพนักงาน"
                          className="p-1 rounded text-teal-400 hover:text-white hover:bg-teal-500/20 transition cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEmployeeToDelete(emp)}
                          title="ลบพนักงานออกจากระบบ"
                          className="p-1 rounded text-rose-400 hover:text-white hover:bg-rose-500/20 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit/Create Employee Modal */}
      {editingEmp && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-6 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
          <div className={`w-full max-w-5xl rounded-2xl border shadow-2xl p-6 sm:p-8 lg:p-9 my-auto transition-all max-h-[92vh] flex flex-col ${
            isDark ? 'bg-[#121d2a] border-[#294058] text-white' : 'bg-white border-slate-300 text-slate-900'
          }`}>
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-5 border-b border-slate-700/60 shrink-0">
              <div className="flex items-center gap-3.5">
                <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-500/25 text-teal-400 shadow-xs">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h3 className="font-bold text-lg sm:text-xl tracking-tight">
                      {isNew ? 'เพิ่มพนักงานใหม่ (Add Employee)' : `แก้ไขข้อมูลพนักงาน: ${empForm.empNo || editingEmp.empNo}`}
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-500/15 text-teal-300 border border-teal-500/30">
                      แผนก: {empForm.department || 'GM'}
                    </span>
                    {empForm.isShiftWorker ? (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                        Shift Worker
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-500/15 text-slate-400 border border-slate-500/30">
                        Office Staff
                      </span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    กำหนดข้อมูลประจำตัว สังกัดแผนก สิทธิ์การเข้ากะ และรหัสสำหรับส่งออกข้อมูล Payroll
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setEditingEmp(null)} 
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700/50 transition cursor-pointer"
                title="ปิดหน้าต่าง"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveEmployee} className="mt-6 flex-1 overflow-y-auto pr-1 space-y-6 text-xs sm:text-sm">
              {duplicateNotice && (
                <div className="p-4 rounded-xl border bg-amber-500/15 border-amber-500/40 text-amber-200 flex items-start gap-3 shadow-lg animate-in fade-in duration-150">
                  <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="font-bold text-sm text-amber-300 flex flex-wrap items-center gap-2">
                      <span>ตรวจพบข้อมูลซ้ำในระบบ — สลับมายัง "โหมดแก้ไขข้อมูลพนักงาน" แล้ว</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/30 text-amber-200 border border-amber-500/40 font-mono">
                        {duplicateNotice.fieldLabel}
                      </span>
                    </div>
                    <p className="text-xs text-amber-100/90 leading-relaxed">
                      {duplicateNotice.text}
                    </p>
                    <div className="pt-1.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleOpenCreate}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/25 hover:bg-amber-500/35 text-amber-200 text-xs font-semibold border border-amber-500/50 transition cursor-pointer flex items-center gap-1.5"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>ล้างฟอร์มเพื่อเพิ่มพนักงานคนอื่น (Add Other)</span>
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDuplicateNotice(null)}
                    className="p-1 text-amber-300/70 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
                    title="ปิดการแจ้งเตือน"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Main Asymmetric Grid: 2 Distinct Column Sections */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Column 1 (Left - 5 cols): Identification & Payroll Core */}
                <div className={`lg:col-span-5 p-5 rounded-xl border space-y-4 ${
                  isDark ? 'bg-[#0a121c]/70 border-[#1f3143]' : 'bg-slate-50/80 border-slate-200'
                }`}>
                  <div className="flex items-center justify-between pb-2 border-b border-slate-700/40">
                    <span className="text-xs font-bold uppercase tracking-wider text-teal-400 flex items-center gap-1.5">
                      <Briefcase className="w-3.5 h-3.5" />
                      <span>รหัสประจำตัวและ Payroll</span>
                    </span>
                    <span className="text-[11px] text-slate-400">Identification</span>
                  </div>

                  {/* Employee No */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-slate-300 font-medium">
                        Employee No. <span className="text-rose-400 font-bold">*</span>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-mono">
                          Primary Key
                        </span>
                        {!isNew && isAdmin && (
                          <button
                            type="button"
                            onClick={() => setIsEmpNoUnlocked(prev => !prev)}
                            className={`text-[11px] px-2 py-0.5 rounded font-semibold border transition cursor-pointer flex items-center gap-1 shadow-xs ${
                              isEmpNoUnlocked
                                ? 'bg-amber-500/25 text-amber-300 border-amber-500/50 hover:bg-amber-500/35'
                                : 'bg-slate-800 text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white'
                            }`}
                            title="คลิกเพื่อปลดล็อกแก้ไขรหัสพนักงาน (เช่น เปลี่ยน 1433 เป็น 1432)"
                          >
                            <span>{isEmpNoUnlocked ? '🔓 กำลังแก้ไขรหัส' : '🔒 ปลดล็อกแก้ไขรหัส'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="text"
                      required
                      disabled={!isNew && !isEmpNoUnlocked}
                      value={empForm.empNo || ''}
                      onChange={e => {
                        const val = e.target.value;
                        setEmpForm(prev => ({ ...prev, empNo: val }));
                      }}
                      onBlur={() => {
                        if (isNew && empForm.empNo?.trim()) {
                          checkAndAutoSwitchToEdit(empForm.empNo, empForm.empCode, empForm.gid);
                        }
                      }}
                      placeholder="เช่น 1432 หรือ 0950"
                      className={`w-full h-11 px-3.5 py-2.5 rounded-lg border font-mono font-bold text-sm sm:text-base transition focus:outline-hidden focus:ring-2 focus:ring-teal-500/40 ${
                        isDark ? 'bg-[#0f1722] border-[#273a4e] text-teal-300 placeholder-slate-600' : 'bg-white border-slate-300 text-teal-800 placeholder-slate-400'
                      } ${!isNew && !isEmpNoUnlocked ? 'opacity-75 cursor-not-allowed bg-slate-800/40' : 'ring-2 ring-amber-500/50 border-amber-500'}`}
                    />

                    {!isNew && isEmpNoUnlocked && (
                      <div className="mt-2 p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/35 text-[11px] text-amber-200 leading-relaxed shadow-xs">
                        ⚡ <strong>โหมดแก้ไข Primary Key:</strong> หากเปลี่ยนรหัสจาก <strong>{editingEmp?.empNo}</strong> ➔ <strong>{empForm.empNo || '...'}</strong> เมื่อกดบันทึก ระบบจะปรับปรุงประวัติการเข้ากะ (Shift Plans), เวลาสแกนบัตร (Punches) และรายการ OT ทั้งหมดให้เชื่อมโยงกับรหัสใหม่ให้อัตโนมัติ
                      </div>
                    )}
                    <span className="text-[11px] text-slate-400 block mt-1">รหัสพนักงานประจำแผนกที่ใช้ในองค์กร (ห้ามซ้ำ)</span>
                  </div>

                  {/* EmpCode (8 หลัก) */}
                  <div className={`p-3.5 rounded-lg border ${
                    isDark ? 'bg-[#0d1622] border-[#25394d]' : 'bg-amber-50/40 border-amber-200/60'
                  }`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-slate-300 font-medium">
                        EmpCode (8 หลัก)
                      </label>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-400/15 text-amber-400 font-mono font-bold border border-amber-400/30 whitespace-nowrap">
                        Payroll Export
                      </span>
                    </div>
                    <input
                      type="text"
                      maxLength={8}
                      value={empForm.empCode || ''}
                      onChange={e => {
                        const clean = e.target.value.replace(/\D/g, '');
                        setEmpForm(prev => ({ ...prev, empCode: clean }));
                        if (isNew && clean.length === 8) {
                          checkAndAutoSwitchToEdit(empForm.empNo, clean, empForm.gid);
                        }
                      }}
                      onBlur={() => {
                        if (isNew && empForm.empCode?.trim()) {
                          checkAndAutoSwitchToEdit(empForm.empNo, empForm.empCode, empForm.gid);
                        }
                      }}
                      placeholder="เช่น 10000950"
                      className={`w-full h-11 px-3.5 py-2.5 rounded-lg border font-mono font-bold text-sm sm:text-base transition focus:outline-hidden focus:ring-2 focus:ring-amber-500/40 ${
                        isDark ? 'bg-[#091018] border-[#2a4056] text-amber-300 placeholder-slate-600' : 'bg-white border-slate-300 text-amber-800 placeholder-slate-400'
                      }`}
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <span className={`text-[11px] font-mono ${
                        empForm.empCode && empForm.empCode.length === 8 ? 'text-emerald-400 font-medium' : 'text-slate-400'
                      }`}>
                        {empForm.empCode && empForm.empCode.length === 8 
                          ? '✓ ครบ 8 หลัก (พร้อมส่ง Payroll)' 
                          : empForm.empCode 
                          ? `ระบุ ${empForm.empCode.length}/8 หลัก` 
                          : 'ตัวเลข 8 หลักสำหรับส่งออกไฟล์ (ห้ามซ้ำ)'}
                      </span>
                      {empForm.empCode && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          {empForm.empCode.length}/8
                        </span>
                      )}
                    </div>
                  </div>

                  {/* GID */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-slate-300 font-medium">
                        GID (Global ID) <span className="text-rose-400 font-bold">*</span>
                      </label>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">
                        Siemens Global
                      </span>
                    </div>
                    <input
                      type="text"
                      required
                      value={empForm.gid || ''}
                      onChange={e => {
                        const val = e.target.value.trim().toUpperCase();
                        setEmpForm(prev => ({ ...prev, gid: val }));
                        if (isNew && val.length >= 6) {
                          checkAndAutoSwitchToEdit(empForm.empNo, empForm.empCode, val);
                        }
                      }}
                      onBlur={() => {
                        if (isNew && empForm.gid?.trim()) {
                          checkAndAutoSwitchToEdit(empForm.empNo, empForm.empCode, empForm.gid);
                        }
                      }}
                      placeholder="เช่น Z00430UZ"
                      className={`w-full h-11 px-3.5 py-2.5 rounded-lg border font-mono text-sm sm:text-base transition focus:outline-hidden focus:ring-2 focus:ring-cyan-500/40 ${
                        isDark ? 'bg-[#0f1722] border-[#273a4e] text-cyan-300 placeholder-slate-600' : 'bg-white border-slate-300 text-cyan-800 placeholder-slate-400'
                      }`}
                    />
                    <span className="text-[11px] text-slate-400 block mt-1">รหัส Siemens Global ID ประจำตัวสากล</span>
                  </div>
                </div>

                {/* Column 2 (Right - 7 cols): Personal Info & Organization Assignment */}
                <div className={`lg:col-span-7 p-5 rounded-xl border space-y-5 ${
                  isDark ? 'bg-[#0a121c]/70 border-[#1f3143]' : 'bg-slate-50/80 border-slate-200'
                }`}>
                  <div className="flex items-center justify-between pb-2 border-b border-slate-700/40">
                    <span className="text-xs font-bold uppercase tracking-wider text-teal-400 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      <span>ข้อมูลส่วนบุคคลและสังกัดหน่วยงาน</span>
                    </span>
                    <span className="text-[11px] text-slate-400">Personal & Organization</span>
                  </div>

                  {/* Firstname & Familyname */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-slate-300 font-medium mb-1.5">
                        Firstname (ชื่อจริง) <span className="text-rose-400 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={empForm.firstName || ''}
                        onChange={e => setEmpForm(prev => ({ ...prev, firstName: e.target.value }))}
                        placeholder="เช่น Napassawan"
                        className={`w-full h-11 px-3.5 py-2.5 rounded-lg border text-sm transition focus:outline-hidden focus:ring-2 focus:ring-teal-500/40 ${
                          isDark ? 'bg-[#0f1722] border-[#273a4e] text-white placeholder-slate-600' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 font-medium mb-1.5">
                        Familyname (นามสกุล)
                      </label>
                      <input
                        type="text"
                        value={empForm.familyName || ''}
                        onChange={e => setEmpForm(prev => ({ ...prev, familyName: e.target.value }))}
                        placeholder="เช่น Ngamsomsong"
                        className={`w-full h-11 px-3.5 py-2.5 rounded-lg border text-sm transition focus:outline-hidden focus:ring-2 focus:ring-teal-500/40 ${
                          isDark ? 'bg-[#0f1722] border-[#273a4e] text-white placeholder-slate-600' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Department & Function (Asymmetric split) */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                    <div className="sm:col-span-5">
                      <label className="block text-slate-300 font-medium mb-1.5">
                        Department (สังกัดแผนก) <span className="text-rose-400 font-bold">*</span>
                      </label>
                      <select
                        value={empForm.department || 'GM'}
                        onChange={e => setEmpForm(prev => ({ ...prev, department: e.target.value }))}
                        className={`w-full h-11 px-3.5 py-2 rounded-lg border font-mono font-bold text-sm transition focus:outline-hidden focus:ring-2 focus:ring-teal-500/40 cursor-pointer ${
                          isDark ? 'bg-[#0f1722] border-[#273a4e] text-teal-300' : 'bg-white border-slate-300 text-teal-800'
                        }`}
                      >
                        {departments.map(d => (
                          <option key={d.code} value={d.code}>
                            {d.code} {d.name && d.name !== d.code ? `- ${d.name}` : ''}
                          </option>
                        ))}
                      </select>
                      <span className="text-[11px] text-slate-400 block mt-1">เลือกแผนกหลักที่พนักงานสังกัด</span>
                    </div>

                    <div className="sm:col-span-7">
                      <label className="block text-slate-300 font-medium mb-1.5">
                        Function (ตำแหน่งงาน / บทบาท)
                      </label>
                      <input
                        type="text"
                        value={empForm.functionTitle || ''}
                        onChange={e => setEmpForm(prev => ({ ...prev, functionTitle: e.target.value }))}
                        placeholder="เช่น Safety Professional, Rolling Stock Tech"
                        className={`w-full h-11 px-3.5 py-2.5 rounded-lg border text-sm transition focus:outline-hidden focus:ring-2 focus:ring-teal-500/40 ${
                          isDark ? 'bg-[#0f1722] border-[#273a4e] text-white placeholder-slate-600' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
                        }`}
                      />
                      <span className="text-[11px] text-slate-400 block mt-1">บทบาทหน้าที่ในการปฏิบัติงาน</span>
                    </div>
                  </div>

                  {/* Division & Cost Center */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-slate-300 font-medium mb-1.5">
                        Division (ส่วนงาน)
                      </label>
                      <input
                        type="text"
                        value={empForm.division || 'MO CS BTS'}
                        onChange={e => setEmpForm(prev => ({ ...prev, division: e.target.value }))}
                        placeholder="เช่น MO CS BTS"
                        className={`w-full h-11 px-3.5 py-2.5 rounded-lg border text-sm transition focus:outline-hidden focus:ring-2 focus:ring-teal-500/40 ${
                          isDark ? 'bg-[#0f1722] border-[#273a4e] text-white placeholder-slate-600' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 font-medium mb-1.5">
                        Cost Center (ศูนย์ต้นทุน)
                      </label>
                      <input
                        type="text"
                        value={empForm.costCenter || 'C93056'}
                        onChange={e => setEmpForm(prev => ({ ...prev, costCenter: e.target.value }))}
                        placeholder="เช่น C93056"
                        className={`w-full h-11 px-3.5 py-2.5 rounded-lg border font-mono text-sm transition focus:outline-hidden focus:ring-2 focus:ring-teal-500/40 ${
                          isDark ? 'bg-[#0f1722] border-[#273a4e] text-white placeholder-slate-600' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
                        }`}
                      />
                    </div>
                  </div>

                </div>
              </div>

              {/* Status & Eligibility Cards (Interactive Multi-Select Panels) */}
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-teal-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  <span>สถานะการเข้ากะและการปฏิบัติงาน (Work Eligibility & Status)</span>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Shift Worker Card */}
                  <div 
                    onClick={() => setEmpForm(prev => ({ ...prev, isShiftWorker: !prev.isShiftWorker }))}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 select-none ${
                      empForm.isShiftWorker
                        ? isDark
                          ? 'bg-teal-950/30 border-teal-500/50 shadow-xs'
                          : 'bg-teal-50/80 border-teal-400 shadow-xs'
                        : isDark
                          ? 'bg-[#0b141f]/70 border-[#203244] opacity-75 hover:opacity-100 hover:border-slate-600'
                          : 'bg-slate-50/80 border-slate-200 opacity-75 hover:opacity-100 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(empForm.isShiftWorker)}
                      onChange={e => setEmpForm(prev => ({ ...prev, isShiftWorker: e.target.checked }))}
                      className="mt-1 w-4 h-4 rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
                      onClick={e => e.stopPropagation()}
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-slate-100">พนักงานทำงานเข้ากะ (Shift Worker)</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          empForm.isShiftWorker 
                            ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40' 
                            : 'bg-slate-700/40 text-slate-400'
                        }`}>
                          {empForm.isShiftWorker ? 'เข้ากะ / Standby' : 'Office Standard'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        คำนวณค่ากะดึก/กะบ่าย และเบี้ยเลี้ยง Standby อัตโนมัติใน Shift Plan และ Timesheet
                      </p>
                    </div>
                  </div>

                  {/* Active Status Card */}
                  <div 
                    onClick={() => setEmpForm(prev => ({ ...prev, isActive: !prev.isActive }))}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 select-none ${
                      empForm.isActive !== false
                        ? isDark
                          ? 'bg-emerald-950/30 border-emerald-500/50 shadow-xs'
                          : 'bg-emerald-50/80 border-emerald-400 shadow-xs'
                        : isDark
                          ? 'bg-[#0b141f]/70 border-[#203244] opacity-75 hover:opacity-100 hover:border-slate-600'
                          : 'bg-slate-50/80 border-slate-200 opacity-75 hover:opacity-100 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={empForm.isActive !== false}
                      onChange={e => setEmpForm(prev => ({ ...prev, isActive: e.target.checked }))}
                      className="mt-1 w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      onClick={e => e.stopPropagation()}
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-slate-100">เปิดใช้งาน (Active Status)</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          empForm.isActive !== false 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}>
                          {empForm.isActive !== false ? 'เปิดใช้งาน' : 'ระงับชั่วคราว'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        พร้อมปฏิบัติงานและแสดงในตาราง Timesheet, ตารางเวร และรายงานสรุป
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer Buttons */}
              <div className="flex items-center justify-between pt-5 border-t border-slate-700/60 mt-8 shrink-0">
                <div>
                  {!isNew && editingEmp && (
                    <button
                      type="button"
                      onClick={() => setEmployeeToDelete(editingEmp)}
                      className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium text-rose-400 hover:text-rose-200 hover:bg-rose-500/20 border border-rose-500/30 flex items-center space-x-2 transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>ลบพนักงาน</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() => setEditingEmp(null)}
                    className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer border border-slate-700/60"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={isSyncing}
                    className="px-6 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-md transition cursor-pointer flex items-center space-x-2 disabled:opacity-50"
                  >
                    {isSyncing ? (
                      <>
                        <Cloud className="w-4 h-4 animate-spin" />
                        <span>กำลังซิงค์...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>บันทึกข้อมูลพนักงาน</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload & Update Result Summary Modal */}
      {uploadSummary && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-6 backdrop-blur-xs overflow-y-auto">
          <div className={`w-full max-w-4xl rounded-xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
            isDark ? 'bg-[#101b26] border-[#223547] text-white' : 'bg-white border-slate-300 text-slate-900'
          }`}>
            {/* Modal Header */}
            <div className={`p-4 sm:p-5 border-b flex items-center justify-between ${
              isDark ? 'bg-[#152332] border-[#223547]' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-lg bg-teal-500/20 text-teal-400 border border-teal-500/30">
                  <FileCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-teal-300 flex items-center gap-2">
                    สรุปผลการนำเข้าและอัปเดตข้อมูลพนักงาน
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Batch Upload & Update Summary — บันทึกข้อมูลและซิงค์คลาวด์เรียบร้อยแล้ว
                  </p>
                </div>
              </div>
              <button
                onClick={() => setUploadSummary(null)}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/50 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Stat Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Total */}
                <div className={`p-3 rounded-lg border flex flex-col justify-between ${
                  isDark ? 'bg-[#142230] border-[#223547]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <span className="text-slate-400 font-medium">แถวข้อมูลทั้งหมด</span>
                  <div className="text-xl font-bold font-mono text-slate-100 mt-1">
                    {uploadSummary.totalRows} <span className="text-xs font-normal text-slate-400">แถว</span>
                  </div>
                </div>

                {/* Updated */}
                <div className={`p-3 rounded-lg border flex flex-col justify-between ${
                  isDark ? 'bg-teal-950/30 border-teal-700/50' : 'bg-teal-50 border-teal-200'
                }`}>
                  <span className="text-teal-400 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    อัปเดตข้อมูลพนักงาน
                  </span>
                  <div className="text-xl font-bold font-mono text-teal-300 mt-1">
                    {uploadSummary.updatedCount} <span className="text-xs font-normal text-teal-400">คน</span>
                  </div>
                </div>

                {/* Added */}
                <div className={`p-3 rounded-lg border flex flex-col justify-between ${
                  isDark ? 'bg-emerald-950/30 border-emerald-700/50' : 'bg-emerald-50 border-emerald-200'
                }`}>
                  <span className="text-emerald-400 font-medium flex items-center gap-1">
                    <UserPlus className="w-3.5 h-3.5" />
                    เพิ่มพนักงานใหม่
                  </span>
                  <div className="text-xl font-bold font-mono text-emerald-300 mt-1">
                    {uploadSummary.addedCount} <span className="text-xs font-normal text-emerald-400">คน</span>
                  </div>
                </div>

                {/* Unchanged / Skipped */}
                <div className={`p-3 rounded-lg border flex flex-col justify-between ${
                  uploadSummary.skippedCount > 0
                    ? (isDark ? 'bg-amber-950/30 border-amber-700/50' : 'bg-amber-50 border-amber-200')
                    : (isDark ? 'bg-[#142230] border-[#223547]' : 'bg-slate-50 border-slate-200')
                }`}>
                  <span className={`${uploadSummary.skippedCount > 0 ? 'text-amber-400' : 'text-slate-400'} font-medium`}>
                    {uploadSummary.skippedCount > 0 ? 'ข้าม / ไม่ครบถ้วน' : 'ข้อมูลเดิมตรงกัน'}
                  </span>
                  <div className="text-xl font-bold font-mono mt-1">
                    {uploadSummary.skippedCount > 0 ? (
                      <span className="text-amber-300">{uploadSummary.skippedCount} <span className="text-xs font-normal text-amber-400">แถว</span></span>
                    ) : (
                      <span className="text-slate-400">{uploadSummary.unchangedCount} <span className="text-xs font-normal text-slate-500">คน</span></span>
                    )}
                  </div>
                </div>
              </div>

              {/* Sub-breakdown of updated fields */}
              {uploadSummary.updatedCount > 0 && (
                <div className={`p-3 rounded-lg border flex flex-wrap gap-2 items-center text-[11px] ${
                  isDark ? 'bg-[#131f2b] border-[#1f3042]' : 'bg-slate-100 border-slate-200'
                }`}>
                  <span className="font-semibold text-slate-300 mr-1">ฟิลด์ที่ได้รับการอัปเดต:</span>
                  {uploadSummary.costCenterUpdated > 0 && (
                    <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-medium">
                      Cost Center: {uploadSummary.costCenterUpdated} คน
                    </span>
                  )}
                  {uploadSummary.empCodeUpdated > 0 && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">
                      EmpCode (8 หลัก): {uploadSummary.empCodeUpdated} คน
                    </span>
                  )}
                  {uploadSummary.deptUpdated > 0 && (
                    <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium">
                      แผนก (Department): {uploadSummary.deptUpdated} คน
                    </span>
                  )}
                  {uploadSummary.shiftWorkerUpdated > 0 && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                      สถานะเข้ากะ: {uploadSummary.shiftWorkerUpdated} คน
                    </span>
                  )}
                  {uploadSummary.functionUpdated > 0 && (
                    <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium">
                      ตำแหน่ง: {uploadSummary.functionUpdated} คน
                    </span>
                  )}
                </div>
              )}

              {/* Change Logs Detail List */}
              {uploadSummary.logs.length > 0 ? (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-300 flex items-center justify-between">
                    <span>รายละเอียดรายการที่บันทึก ({uploadSummary.logs.length} คน)</span>
                    <span className="text-[10px] text-slate-400 font-normal">
                      * ข้อมูลเดิมที่ไม่ระบุในไฟล์จะถูกรักษาไว้ตามเดิม
                    </span>
                  </h4>
                  <div className={`divide-y rounded-lg border max-h-72 overflow-y-auto ${
                    isDark ? 'bg-[#0e1620] border-[#223547] divide-[#1d2d3d]' : 'bg-slate-50 border-slate-200 divide-slate-200'
                  }`}>
                    {uploadSummary.logs.map((log, lIdx) => (
                      <div key={lIdx} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center space-x-2.5">
                          <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                            log.isNew
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                          }`}>
                            {log.isNew ? 'เพิ่มใหม่' : 'อัปเดต'}
                          </span>
                          <span className="font-mono font-bold text-teal-400">{log.empNo}</span>
                          {log.empCode && (
                            <span className="font-mono text-amber-400 text-[10px] bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20" title="EmpCode (8 หลัก)">
                              {log.empCode}
                            </span>
                          )}
                          {log.gid && log.gid !== log.empNo && (
                            <span className="font-mono text-slate-400 text-[11px]">({log.gid})</span>
                          )}
                          <span className="font-medium text-slate-200">{log.name}</span>
                          {log.matchType && (
                            <span className="text-[10px] text-slate-400">
                              [{log.matchType}]
                            </span>
                          )}
                        </div>

                        {/* List of changes */}
                        <div className="flex flex-wrap gap-1.5 items-center">
                          {log.changes.map((ch, cIdx) => (
                            <span key={cIdx} className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] flex items-center gap-1">
                              <span className="text-slate-400">{ch.label}:</span>
                              {ch.from && ch.from !== '(ไม่มี)' && ch.from !== '(ว่าง)' ? (
                                <span className="line-through text-slate-500">{ch.from}</span>
                              ) : null}
                              <span className="text-teal-300 font-semibold">{ch.to}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center text-slate-400 border rounded-lg border-dashed border-slate-700">
                  ไม่มีรายการที่เปลี่ยนแปลงหรือเพิ่มใหม่
                </div>
              )}

              {/* Skipped Rows (if any) */}
              {uploadSummary.skippedRows.length > 0 && (
                <div className="p-3 rounded-lg border bg-rose-950/30 border-rose-800/40 text-rose-300 space-y-1.5">
                  <h5 className="font-bold flex items-center gap-1.5 text-xs text-rose-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    แถวที่ไม่สามารถนำเข้าได้ ({uploadSummary.skippedRows.length} แถว):
                  </h5>
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-rose-200">
                    {uploadSummary.skippedRows.map((sk, skIdx) => (
                      <li key={skIdx}>
                        <span className="font-mono font-bold">แถวที่ {sk.row}:</span> {sk.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className={`p-4 border-t flex items-center justify-end ${
              isDark ? 'bg-[#152332] border-[#223547]' : 'bg-slate-50 border-slate-200'
            }`}>
              <button
                onClick={() => setUploadSummary(null)}
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium text-xs shadow transition cursor-pointer"
              >
                รับทราบและปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog Modal for Deleting Employee */}
      {employeeToDelete && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className={`w-full max-w-md rounded-lg border shadow-2xl p-5 ${
            isDark ? 'bg-[#142230] border-[#294058] text-white' : 'bg-white border-slate-300 text-slate-900'
          }`}>
            <div className="flex items-start space-x-3 mb-4">
              <div className="p-2.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 flex-shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-rose-400">ยืนยันการลบพนักงานออกจากระบบ</h3>
                <p className="text-xs text-slate-300 mt-1">
                  คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลพนักงานต่อไปนี้ออกจากระบบฐานข้อมูลและคลาวด์?
                </p>
              </div>
            </div>

            <div className={`p-3 rounded-lg border my-3 text-xs space-y-1.5 ${
              isDark ? 'bg-[#0f1722] border-[#273a4e]' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex justify-between">
                <span className="text-slate-400">ชื่อ - สกุล:</span>
                <span className="font-semibold text-slate-100">{employeeToDelete.firstName} {employeeToDelete.familyName}</span>
              </div>
              <div className="flex justify-between font-mono">
                <span className="text-slate-400">Emp No:</span>
                <span className="font-bold text-teal-400">{employeeToDelete.empNo}</span>
              </div>
              <div className="flex justify-between font-mono">
                <span className="text-slate-400">GID:</span>
                <span className="text-slate-300">{employeeToDelete.gid}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">แผนก:</span>
                <span className="font-semibold text-teal-300">{employeeToDelete.department}</span>
              </div>
            </div>

            <p className="text-[11px] text-amber-400/90 mb-4">
              * การดำเนินการนี้จะลบข้อมูลออกจากทุกเครื่องและฐานข้อมูลคลาวด์ทันที
            </p>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-700/60">
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => setEmployeeToDelete(null)}
                className="px-3.5 py-1.5 rounded text-xs text-slate-300 hover:text-white transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => handleDeleteEmployee(employeeToDelete)}
                className="px-4 py-1.5 rounded text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow flex items-center space-x-1.5 transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isSyncing ? 'กำลังลบ...' : 'ยืนยันลบพนักงาน'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  ) : (
        <div className={`p-4 rounded border text-xs overflow-hidden ${
          isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
        }`}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-bold">รายชื่อแผนกทั้งหมด</h2>
            {isAdmin && (
              <button
                onClick={handleOpenCreateDept}
                className="flex items-center space-x-1 px-3 py-1.5 rounded font-semibold text-xs bg-teal-600 hover:bg-teal-700 text-white shadow transition"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>เพิ่มแผนกใหม่</span>
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className={`sticky top-0 z-10 ${
                isDark ? 'bg-[#0a1118] text-slate-200' : 'bg-slate-100 text-slate-700'
              }`}>
                <tr>
                  <th className="p-2.5 border-b border-r border-slate-700 w-1/4">รหัสแผนก (Code)</th>
                  <th className="p-2.5 border-b border-r border-slate-700 w-2/4">ชื่อแผนก (Name)</th>
                  <th className="p-2.5 border-b border-r border-slate-700 w-1/6 text-center">จำนวนพนักงาน</th>
                  <th className="p-2.5 border-b border-slate-700 w-1/6 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((dept) => {
                  const empCount = employees.filter(e => (e.department || '').trim().toUpperCase() === (dept.code || '').trim().toUpperCase()).length;
                  return (
                    <tr key={dept.code} className={`border-b ${
                      isDark ? 'border-slate-800 hover:bg-[#1a2838]' : 'border-slate-200 hover:bg-slate-50'
                    }`}>
                      <td className="p-2.5 border-r border-slate-700 font-mono font-semibold text-teal-400">{dept.code}</td>
                      <td className="p-2.5 border-r border-slate-700">{dept.name}</td>
                      <td className="p-2.5 border-r border-slate-700 text-center font-mono">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          empCount > 0 ? 'bg-teal-500/10 text-teal-400 border border-teal-500/30' : 'bg-slate-500/10 text-slate-400'
                        }`}>
                          {empCount} คน
                        </span>
                      </td>
                      <td className="p-2.5 text-center flex justify-center space-x-2">
                      <button
                        onClick={() => handleEditDept(dept)}
                        disabled={!isAdmin}
                        className={`p-1.5 rounded ${
                          isAdmin 
                            ? 'text-amber-400 hover:bg-amber-400/10' 
                            : 'text-slate-500 opacity-50 cursor-not-allowed'
                        }`}
                        title="แก้ไขแผนก"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteDept(dept.code)}
                        disabled={!isAdmin}
                        className={`p-1.5 rounded ${
                          isAdmin 
                            ? 'text-red-400 hover:bg-red-400/10' 
                            : 'text-slate-500 opacity-50 cursor-not-allowed'
                        }`}
                        title="ลบแผนก"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {departments.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-slate-400">
                      ไม่พบข้อมูลแผนก
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Edit Department Modal */}
          {editingDept && (
            <div 
              className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in duration-150"
              onClick={(e) => {
                if (e.target === e.currentTarget) setEditingDept(null);
              }}
            >
              <div className={`w-full max-w-sm rounded-xl shadow-2xl p-5 border ${
                isDark ? 'bg-[#121c27] border-[#273a4e] text-white' : 'bg-white border-slate-200 text-slate-800'
              }`}>
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-700/50">
                  <h3 className="text-base font-bold text-teal-400">
                    {isNewDept ? 'เพิ่มแผนกใหม่' : `แก้ไขแผนก (${editingDept.code})`}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditingDept(null)}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <form onSubmit={handleSaveDept} className="space-y-4">
                  <div>
                    <label className="block text-slate-400 mb-1 text-xs font-semibold">รหัสแผนก (Code) *</label>
                    <input
                      type="text"
                      required
                      disabled={!isNewDept}
                      value={deptForm.code}
                      onChange={e => setDeptForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                      className={`w-full p-2.5 rounded-lg border font-mono text-xs ${
                        isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                      } ${!isNewDept ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1 text-xs font-semibold">ชื่อแผนก (Name) *</label>
                    <input
                      type="text"
                      required
                      value={deptForm.name}
                      onChange={e => setDeptForm(prev => ({ ...prev, name: e.target.value }))}
                      className={`w-full p-2.5 rounded-lg border text-xs ${
                        isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                      }`}
                    />
                  </div>
                  <div className="flex items-center justify-end space-x-2 pt-4 border-t border-slate-700/50">
                    <button
                      type="button"
                      onClick={() => setEditingDept(null)}
                      className="px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      disabled={isSyncing}
                      className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{isSyncing ? 'กำลังบันทึก...' : 'บันทึก'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
