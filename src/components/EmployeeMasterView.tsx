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
  Briefcase
} from 'lucide-react';
import { readFileAsArrayBuffer, parseSheetToRows, downloadBlob } from '../utils/fileParser';
import { isDemoDepartment, firestoreSync } from '../firebase';
import * as XLSX from 'xlsx';

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
  const [isNew, setIsNew] = useState(false);
  const [activeTab, setActiveTab] = useState<'employees' | 'departments'>('employees');

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

    // 3. From employee data
    employees.forEach(e => {
      const code = (e.department || '').trim().toUpperCase();
      if (code && code !== 'ALL' && !isDemoDepartment(code) && !map.has(code)) {
        map.set(code, { code, name: code });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [departments, employees]);

  // Employee counts per section
  const sectionCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: employees.length };
    employees.forEach(emp => {
      const dept = (emp.department || '').trim().toUpperCase();
      counts[dept] = (counts[dept] || 0) + 1;
    });
    return counts;
  }, [employees]);

  // Form state
  const [empForm, setEmpForm] = useState<Partial<Employee>>({
    empNo: '',
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

  // Department State
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [isNewDept, setIsNewDept] = useState(false);
  const [deptForm, setDeptForm] = useState<Partial<Department>>({
    code: '',
    name: ''
  });

  const filteredEmployees = useMemo(() => {
    return employees.filter(e => {
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
    setEmpForm({
      empNo: '',
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
    setEditingEmp(emp);
    setEmpForm({ ...emp });
  };

  // Toggle Activate / Deactivate (Rule 2: "สามรถอับเดทแก้ไข Activate หรือ Deactivate ได้ด้วย Admin")
  const handleToggleActive = (emp: Employee) => {
    if (!isAdmin) return;
    const list = storage.getEmployees();
    const idx = list.findIndex(e => e.empNo === emp.empNo);
    if (idx >= 0) {
      list[idx].isActive = !list[idx].isActive;
      storage.setEmployees(list);
      onDataChanged();
    }
  };

  // Save Employee
  const handleSaveEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!empForm.empNo || !empForm.gid || !empForm.firstName) return;

    const list = storage.getEmployees();
    if (isNew) {
      // Check duplicate
      const duplicate = list.some(
        e => e.empNo.toLowerCase() === empForm.empNo?.toLowerCase() || e.gid.toLowerCase() === empForm.gid?.toLowerCase()
      );
      if (duplicate) {
        alert('รหัสพนักงาน (EmpNo) หรือ GID นี้มีอยู่ในระบบแล้ว');
        return;
      }
      list.push({
        id: `emp-${empForm.empNo}`,
        empNo: empForm.empNo.trim(),
        gid: empForm.gid.trim(),
        firstName: empForm.firstName.trim(),
        familyName: empForm.familyName?.trim() || '',
        department: empForm.department || 'GM',
        division: empForm.division || 'MO CS BTS',
        functionTitle: empForm.functionTitle || '',
        costCenter: empForm.costCenter || 'C93056',
        isShiftWorker: Boolean(empForm.isShiftWorker),
        isActive: empForm.isActive !== undefined ? empForm.isActive : true,
      });
    } else {
      const idx = list.findIndex(e => e.empNo === editingEmp?.empNo);
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          ...empForm,
          empNo: empForm.empNo?.trim() || list[idx].empNo,
          gid: empForm.gid?.trim() || list[idx].gid,
        } as Employee;
      }
    }

    storage.setEmployees(list);
    setEditingEmp(null);
    onDataChanged();
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

  const handleSaveDept = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !deptForm.code || !deptForm.name) return;

    const list = [...departments];
    if (isNewDept) {
      if (list.some(d => d.code.toLowerCase() === deptForm.code?.toLowerCase())) {
        alert('รหัสแผนกนี้มีอยู่ในระบบแล้ว');
        return;
      }
      list.push({ code: deptForm.code.trim().toUpperCase(), name: deptForm.name.trim() });
    } else {
      const idx = list.findIndex(d => d.code === editingDept?.code);
      if (idx >= 0) {
        list[idx] = { ...list[idx], name: deptForm.name.trim() };
      }
    }
    storage.setDepartments(list);
    setEditingDept(null);
    onDataChanged();
  };

  const handleDeleteDept = async (code: string) => {
    if (!isAdmin) return;
    const upper = code.trim().toUpperCase();
    const affectedEmployees = employees.filter(e => (e.department || '').trim().toUpperCase() === upper);
    let promptMsg = `คุณต้องการลบแผนก ${code} หรือไม่?`;
    if (affectedEmployees.length > 0) {
      promptMsg += `\n(มีพนักงาน ${affectedEmployees.length} คนสังกัดแผนกนี้ ระบบจะย้ายพนักงานไปสังกัดแผนก RST อัตโนมัติ เพื่อไม่ให้ข้อมูลพนักงานสูญหาย)`;
    }
    if (confirm(promptMsg)) {
      if (affectedEmployees.length > 0) {
        const updatedEmployees = employees.map(e => 
          (e.department || '').trim().toUpperCase() === upper
            ? { ...e, department: 'RST' }
            : e
        );
        await storage.setEmployees(updatedEmployees);
      }
      const list = departments.filter(d => (d.code || '').trim().toUpperCase() !== upper);
      await storage.setDepartments(list);
      await firestoreSync.deleteDepartment(upper);
      onDataChanged();
    }
  };

  // Batch Upload Employees
  const handleBatchUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAdmin) return;
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const rows = parseSheetToRows(buffer);

      const list = storage.getEmployees();
      const empMap = new Map<string, Employee>();
      list.forEach(item => {
        empMap.set(item.empNo.toLowerCase(), item);
      });

      let added = 0;
      let updated = 0;

      rows.forEach(r => {
        const empNo = String(r['EmpNo'] || r['Emp No'] || '').trim();
        const gid = String(r['GID'] || r['gid'] || '').trim();
        const firstName = String(r['FirstName'] || r['First Name'] || r['Name'] || '').trim();
        const familyName = String(r['FamilyName'] || r['Family Name'] || '').trim();
        const dept = String(r['Department'] || 'GM').trim().toUpperCase();
        const division = String(r['Division'] || 'MO CS BTS').trim();
        const func = String(r['Function'] || r['FunctionTitle'] || '').trim();
        const costCenter = String(r['CostCenter'] || r['Cost Center'] || 'C93056').trim();
        const isShift = String(r['IsShiftWorker'] || r['Shift']).toLowerCase() === 'true' || String(r['IsShiftWorker'] || r['Shift']).toLowerCase() === 'yes';

        if (!empNo || !gid || !firstName) return;

        const existing = empMap.get(empNo.toLowerCase());
        if (existing) {
          existing.gid = gid;
          existing.firstName = firstName;
          existing.familyName = familyName;
          existing.department = dept;
          existing.division = division;
          existing.functionTitle = func;
          existing.costCenter = costCenter;
          existing.isShiftWorker = isShift;
          updated++;
        } else {
          const newEmp: Employee = {
            id: `emp-${empNo}`,
            empNo,
            gid,
            firstName,
            familyName,
            department: dept,
            division,
            functionTitle: func,
            costCenter,
            isShiftWorker: isShift,
            isActive: true,
          };
          empMap.set(empNo.toLowerCase(), newEmp);
          added++;
        }
      });

      storage.setEmployees(Array.from(empMap.values()));
      alert(`อัปโหลดพนักงานเรียบร้อย! เพิ่มใหม่ ${added} คน, อัปเดตข้อมูล ${updated} คน`);
      onDataChanged();
    } catch (err: any) {
      alert(`ข้อผิดพลาดในการอัปโหลด: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  };

  // Download Employee Template
  const handleDownloadTemplate = () => {
    const rows = employees.map(e => ({
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
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    const csv = XLSX.utils.sheet_to_csv(ws);
    downloadBlob(csv, 'Siemens_Employee_Master_Database.csv', 'text/csv;charset=utf-8;');
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
              เชื่อมโยงข้อมูลด้วย GID และ Employee No., กำหนดการเข้ากะ (Shift Status), และจัดการสถานะ Activate / Deactivate
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

          <button
            onClick={handleDownloadTemplate}
            className={`flex items-center space-x-1 px-3 py-1.5 rounded border text-xs font-medium transition ${
              isDark ? 'bg-[#1a2838] border-[#2e4257] hover:bg-[#233549]' : 'bg-slate-100 border-slate-300 hover:bg-slate-200'
            }`}
          >
            <Download className="w-3.5 h-3.5 text-teal-400" />
            <span>Export ข้อมูลพนักงาน</span>
          </button>

          {isAdmin && (
            <>
              <label className="cursor-pointer flex items-center space-x-1 px-3 py-1.5 rounded border border-slate-600 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium transition">
                <Upload className="w-3.5 h-3.5" />
                <span>นำเข้า Excel/CSV</span>
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
                className="flex items-center space-x-1 px-3 py-1.5 rounded font-semibold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>เพิ่มพนักงานใหม่</span>
              </button>
            </>
          )}
        </div>
      </div>

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
              {filteredEmployees.map(emp => (
                <tr key={emp.empNo} className={`border-b border-slate-700/30 transition hover:bg-teal-500/5 ${
                  !emp.isActive ? 'opacity-50 bg-slate-900/30' : ''
                }`}>
                  <td className="p-2.5 font-mono font-bold text-teal-300 border-r border-slate-700/30">
                    {emp.empNo}
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
                    <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                      emp.isShiftWorker 
                        ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' 
                        : 'bg-slate-700/30 text-slate-400'
                    }`}>
                      {emp.isShiftWorker ? 'Shift' : 'Office'}
                    </span>
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
                      <button
                        onClick={() => handleOpenEdit(emp)}
                        className="p-1 rounded text-teal-400 hover:text-white hover:bg-teal-500/20"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit/Create Employee Modal */}
      {editingEmp && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className={`w-full max-w-lg rounded-lg border shadow-2xl p-5 ${
            isDark ? 'bg-[#142230] border-[#294058] text-white' : 'bg-white border-slate-300 text-slate-900'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-teal-400" />
                {isNew ? 'เพิ่มพนักงานใหม่ (Add Employee)' : `แก้ไขข้อมูลพนักงาน: ${empForm.empNo}`}
              </h3>
              <button onClick={() => setEditingEmp(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleSaveEmployee} className="my-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Employee No. (รหัสพนักงาน) *</label>
                  <input
                    type="text"
                    required
                    disabled={!isNew}
                    value={empForm.empNo || ''}
                    onChange={e => setEmpForm(prev => ({ ...prev, empNo: e.target.value }))}
                    placeholder="เช่น 0950"
                    className={`w-full p-2 rounded border font-mono ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">GID (Global ID) *</label>
                  <input
                    type="text"
                    required
                    value={empForm.gid || ''}
                    onChange={e => setEmpForm(prev => ({ ...prev, gid: e.target.value }))}
                    placeholder="เช่น Z00430UZ"
                    className={`w-full p-2 rounded border font-mono ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Firstname (ชื่อจริง) *</label>
                  <input
                    type="text"
                    required
                    value={empForm.firstName || ''}
                    onChange={e => setEmpForm(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="Napassawan"
                    className={`w-full p-2 rounded border ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Familyname (นามสกุล)</label>
                  <input
                    type="text"
                    value={empForm.familyName || ''}
                    onChange={e => setEmpForm(prev => ({ ...prev, familyName: e.target.value }))}
                    placeholder="Ngamsomsong"
                    className={`w-full p-2 rounded border ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Department (แผนก)</label>
                  <select
                    value={empForm.department || 'GM'}
                    onChange={e => setEmpForm(prev => ({ ...prev, department: e.target.value }))}
                    className={`w-full p-2 rounded border font-mono font-semibold ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  >
                    {departments.map(d => (
                      <option key={d.code} value={d.code}>{d.code} - {d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Function (ตำแหน่ง)</label>
                  <input
                    type="text"
                    value={empForm.functionTitle || ''}
                    onChange={e => setEmpForm(prev => ({ ...prev, functionTitle: e.target.value }))}
                    placeholder="Safety Professional"
                    className={`w-full p-2 rounded border ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Division</label>
                  <input
                    type="text"
                    value={empForm.division || 'MO CS BTS'}
                    onChange={e => setEmpForm(prev => ({ ...prev, division: e.target.value }))}
                    className={`w-full p-2 rounded border ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Cost Center</label>
                  <input
                    type="text"
                    value={empForm.costCenter || 'C93056'}
                    onChange={e => setEmpForm(prev => ({ ...prev, costCenter: e.target.value }))}
                    className={`w-full p-2 rounded border font-mono ${
                      isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                    }`}
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center space-x-6">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(empForm.isShiftWorker)}
                    onChange={e => setEmpForm(prev => ({ ...prev, isShiftWorker: e.target.checked }))}
                    className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span className="font-semibold text-slate-200">พนักงานทำงานเข้ากะ (Shift Worker)</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(empForm.isActive)}
                    onChange={e => setEmpForm(prev => ({ ...prev, isActive: e.target.checked }))}
                    className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span className="font-semibold text-slate-200">เปิดใช้งาน (Active Status)</span>
                </label>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setEditingEmp(null)}
                  className="px-3 py-1.5 rounded text-xs text-slate-300 hover:text-white"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded text-xs font-semibold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow"
                >
                  บันทึกข้อมูล
                </button>
              </div>
            </form>
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
                  <th className="p-2.5 border-b border-slate-700 w-1/4 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((dept, idx) => (
                  <tr key={dept.code} className={`border-b ${
                    isDark ? 'border-slate-800 hover:bg-[#1a2838]' : 'border-slate-200 hover:bg-slate-50'
                  }`}>
                    <td className="p-2.5 border-r border-slate-700 font-mono font-semibold text-teal-400">{dept.code}</td>
                    <td className="p-2.5 border-r border-slate-700">{dept.name}</td>
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
                ))}
                {departments.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-slate-400">
                      ไม่พบข้อมูลแผนก
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Edit Department Modal */}
          {editingDept && (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
              <div className={`w-full max-w-sm rounded-lg shadow-xl p-5 ${
                isDark ? 'bg-[#121c27] border border-[#273a4e]' : 'bg-white'
              }`}>
                <h3 className="text-base font-bold mb-4">
                  {isNewDept ? 'เพิ่มแผนกใหม่' : 'แก้ไขแผนก'}
                </h3>
                <form onSubmit={handleSaveDept} className="space-y-4">
                  <div>
                    <label className="block text-slate-400 mb-1">รหัสแผนก (Code) *</label>
                    <input
                      type="text"
                      required
                      disabled={!isNewDept}
                      value={deptForm.code}
                      onChange={e => setDeptForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                      className={`w-full p-2 rounded border font-mono ${
                        isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                      } ${!isNewDept ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">ชื่อแผนก (Name) *</label>
                    <input
                      type="text"
                      required
                      value={deptForm.name}
                      onChange={e => setDeptForm(prev => ({ ...prev, name: e.target.value }))}
                      className={`w-full p-2 rounded border ${
                        isDark ? 'bg-[#0f1722] border-[#273a4e] text-white' : 'bg-slate-50 border-slate-300'
                      }`}
                    />
                  </div>
                  <div className="flex items-center justify-end space-x-2 pt-4 border-t border-slate-700">
                    <button
                      type="button"
                      onClick={() => setEditingDept(null)}
                      className="px-3 py-1.5 rounded text-xs text-slate-300 hover:text-white"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white shadow"
                    >
                      บันทึก
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
