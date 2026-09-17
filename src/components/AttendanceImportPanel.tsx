import React, { useState, useMemo, useRef } from 'react';
import { 
  Upload, 
  FileText, 
  Clock, 
  FolderOpen, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Search, 
  Filter, 
  HelpCircle,
  Eye,
  SlidersHorizontal,
  ChevronRight,
  Database,
  Calendar,
  FileCheck2,
  X
} from 'lucide-react';
import { 
  Employee, 
  ShiftCode, 
  DailyShiftPlan, 
  BiometricRawPunch, 
  UserAccount 
} from '../types';
import { storage } from '../utils/storage';
import { 
  parseBiometricText, 
  mergeAndDeduplicatePunches, 
  PunchMergeResult, 
  getFilesFromDataTransferItems, 
  isAttendanceFile,
  compareAttendanceVsShiftCodes,
  AttendanceVsShiftComparison
} from '../utils/biometricManager';
import { readFileAsText, readFileAsArrayBuffer, parseSheetToRows } from '../utils/fileParser';

interface AttendanceImportPanelProps {
  currentUser: UserAccount;
  theme: 'dark' | 'light';
  selectedMonthYear: string;
  selectedDepartment: string;
  employees: Employee[];
  shiftCodes: ShiftCode[];
  onDataImported: () => void;
}

export const AttendanceImportPanel: React.FC<AttendanceImportPanelProps> = ({
  currentUser,
  theme,
  selectedMonthYear,
  selectedDepartment,
  employees,
  shiftCodes,
  onDataImported,
}) => {
  const isDark = theme === 'dark';

  // Upload state
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mergeMode, setMergeMode] = useState<'smart-merge' | 'replace-month'>('smart-merge');
  const [lastMergeResult, setLastMergeResult] = useState<PunchMergeResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Hidden file inputs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Verification & Learning Shift Code Comparison state
  const [activeSubTab, setActiveSubTab] = useState<'upload' | 'compare'>('upload');
  const [compareMonth, setCompareMonth] = useState<string>(selectedMonthYear || '2026-08');
  const [compareDept, setCompareDept] = useState<string>(selectedDepartment || 'ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedRowDetails, setSelectedRowDetails] = useState<AttendanceVsShiftComparison | null>(null);

  // Shift plans from storage
  const shiftPlans = useMemo(() => storage.getShiftPlans(), []);
  const currentPunches = useMemo(() => storage.getBiometricPunches(), [statusMessage, lastMergeResult]);

  // Unique months available in punches
  const availablePunchMonths = useMemo(() => {
    const months = new Set<string>();
    currentPunches.forEach(p => {
      if (p.date && p.date.length >= 7) {
        months.add(p.date.substring(0, 7));
      }
    });
    if (selectedMonthYear) months.add(selectedMonthYear);
    return Array.from(months).sort().reverse();
  }, [currentPunches, selectedMonthYear]);

  // Execute processing of multiple or single files
  const processFiles = async (files: File[]) => {
    if (!files || files.length === 0) return;
    setIsProcessing(true);
    setStatusMessage(null);

    try {
      const validFiles = files.filter(isAttendanceFile);
      if (validFiles.length === 0) {
        setStatusMessage({
          type: 'error',
          text: `ไม่พบไฟล์ลงเวลาที่รองรับจาก ${files.length} ไฟล์ที่เลือก (รองรับเฉพาะไฟล์ .txt, .dat, .csv, .xlsx, .xls)`,
        });
        setIsProcessing(false);
        return;
      }

      const allParsedPunches: BiometricRawPunch[] = [];
      const fileErrors: string[] = [];

      for (const file of validFiles) {
        try {
          const fileNameLower = file.name.toLowerCase();
          const isBinaryExcel = fileNameLower.endsWith('.xlsx') || fileNameLower.endsWith('.xls');

          if (isBinaryExcel) {
            // Spreadsheet
            const buffer = await readFileAsArrayBuffer(file);
            const rows = parseSheetToRows(buffer);
            rows.forEach((r, idx) => {
              const emp = String(r['EmpNo'] || r['GID'] || r['empNo'] || r['Emp'] || r['EmployeeNo'] || '').trim();
              const type = String(r['Type'] || r['InOut'] || r['Direction'] || 'I').toUpperCase().includes('O') ? 'O' : 'I';
              const date = String(r['Date'] || r['PunchDate'] || '').trim();
              const time = String(r['Time'] || r['PunchTime'] || '').trim();
              if (emp && date && time) {
                allParsedPunches.push({
                  id: `punch-upload-${idx}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                  empIdentifier: emp,
                  type: type as 'I' | 'O',
                  timestamp: `${date} ${time}`,
                  date,
                  time,
                  deviceId: String(r['Device'] || '01'),
                  rawLine: JSON.stringify(r),
                });
              }
            });
          } else {
            // Text-based files (.txt, .TXT, .dat, .DAT, .csv, .CSV, .log, .prn, etc.)
            const text = await readFileAsText(file);
            const parsed = parseBiometricText(text, file.name);
            if (parsed.length > 0) {
              allParsedPunches.push(...parsed);
            } else if (fileNameLower.endsWith('.csv') || text.includes(',')) {
              // Fallback for structured CSV with headers
              try {
                const buffer = await readFileAsArrayBuffer(file);
                const rows = parseSheetToRows(buffer);
                rows.forEach((r, idx) => {
                  const emp = String(r['EmpNo'] || r['GID'] || r['empNo'] || r['Emp'] || r['EmployeeNo'] || '').trim();
                  const type = String(r['Type'] || r['InOut'] || r['Direction'] || 'I').toUpperCase().includes('O') ? 'O' : 'I';
                  const date = String(r['Date'] || r['PunchDate'] || '').trim();
                  const time = String(r['Time'] || r['PunchTime'] || '').trim();
                  if (emp && date && time) {
                    allParsedPunches.push({
                      id: `punch-csv-${idx}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                      empIdentifier: emp,
                      type: type as 'I' | 'O',
                      timestamp: `${date} ${time}`,
                      date,
                      time,
                      deviceId: String(r['Device'] || '01'),
                      rawLine: JSON.stringify(r),
                    });
                  }
                });
              } catch {
                // Ignore fallback error
              }
            }
          }
        } catch (err: any) {
          fileErrors.push(`${file.name}: ${err.message}`);
        }
      }

      if (allParsedPunches.length === 0) {
        const errorDetail = fileErrors.length > 0 ? ` (${fileErrors.join(', ')})` : '';
        setStatusMessage({
          type: 'error',
          text: `ไม่พบรายการเวลาเข้า-ออกในไฟล์ หรือรูปแบบบรรทัดไม่ถูกต้อง${errorDetail} (ตรวจพบ ${validFiles.length} ไฟล์: ${validFiles.map(f => f.name).join(', ')})`,
        });
        setIsProcessing(false);
        return;
      }

      // Smart Merge & Deduplicate
      const existing = storage.getBiometricPunches();
      const result = mergeAndDeduplicatePunches(existing, allParsedPunches, mergeMode);

      // Save to localStorage and trigger background Firestore sync
      await storage.setBiometricPunches(result.merged);
      setLastMergeResult(result);

      if (result.detectedMonths.length > 0) {
        setCompareMonth(result.detectedMonths[0]);
      }

      const modeLabel = mergeMode === 'smart-merge' 
        ? 'รวมข้อมูลอัตโนมัติ (คัดกรองข้อมูลซ้ำซ้อนและยึดข้อมูลล่าสุด)' 
        : 'แทนที่ข้อมูลเดิมในเดือนที่อัปโหลด';

      setStatusMessage({
        type: 'success',
        text: `นำเข้าข้อมูลลงเวลาสำเร็จ! อ่านจาก ${validFiles.length} ไฟล์ • ได้รับ ${allParsedPunches.length} บันทึก • บันทึกใหม่ +${result.newAddedCount} รายการ • อัปเดตทับด้วยข้อมูลล่าสุด ${result.updatedCount} รายการ (${modeLabel})`,
      });

      onDataImported();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `เกิดข้อผิดพลาดในการประมวลผลไฟล์: ${err.message}`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Drag & Drop
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);

    if (e.dataTransfer.items) {
      const files = await getFilesFromDataTransferItems(e.dataTransfer.items);
      await processFiles(files);
    } else if (e.dataTransfer.files) {
      await processFiles(Array.from(e.dataTransfer.files));
    }
  };

  // Multi-files input change
  const handleFilesSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(Array.from(e.target.files));
    }
    e.target.value = '';
  };

  // Folder input change
  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(Array.from(e.target.files));
    }
    e.target.value = '';
  };

  // Comparison data calculation
  const comparisons = useMemo(() => {
    return compareAttendanceVsShiftCodes(
      currentPunches,
      shiftPlans,
      employees,
      shiftCodes,
      compareMonth
    );
  }, [currentPunches, shiftPlans, employees, shiftCodes, compareMonth]);

  // Filtered comparisons
  const filteredComparisons = useMemo(() => {
    return comparisons.filter(item => {
      // Dept filter
      if (compareDept !== 'ALL' && item.department !== compareDept) {
        return false;
      }
      // Status filter
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'auto_resolved') {
          if (!item.hasIrregularity || item.resolutionType === 'standard_in_out' || item.resolutionType === 'no_punches') {
            return false;
          }
        } else if (statusFilter === 'late' && item.status !== 'late') return false;
        else if (statusFilter === 'on_time' && item.status !== 'on_time') return false;
        else if (statusFilter === 'no_stamp' && item.status !== 'no_stamp') return false;
        else if (statusFilter === 'worked_on_off' && item.status !== 'worked_on_off') return false;
        else if (statusFilter === 'leave' && item.status !== 'leave') return false;
      }
      // Search
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matchEmp = item.empNo.toLowerCase().includes(q);
        const matchName = item.empName.toLowerCase().includes(q);
        const matchDept = item.department.toLowerCase().includes(q);
        const matchCode = item.scheduledShiftCode.toLowerCase().includes(q);
        if (!matchEmp && !matchName && !matchDept && !matchCode) return false;
      }
      return true;
    });
  }, [comparisons, compareDept, statusFilter, searchTerm]);

  // Summary statistics for comparison
  const comparisonStats = useMemo(() => {
    let totalPunchesCount = 0;
    let lateCount = 0;
    let onTimeCount = 0;
    let workedOnOffCount = 0;
    let noStampCount = 0;
    let leaveCount = 0;
    let autoResolvedCount = 0;

    comparisons.forEach(c => {
      totalPunchesCount += c.allPunchesCount;
      if (c.hasIrregularity && c.resolutionType !== 'standard_in_out' && c.resolutionType !== 'no_punches') {
        autoResolvedCount++;
      }
      if (c.status === 'late') lateCount++;
      else if (c.status === 'on_time') onTimeCount++;
      else if (c.status === 'worked_on_off') workedOnOffCount++;
      else if (c.status === 'no_stamp') noStampCount++;
      else if (c.status === 'leave') leaveCount++;
    });

    return {
      totalRecords: comparisons.length,
      totalPunchesCount,
      lateCount,
      onTimeCount,
      workedOnOffCount,
      noStampCount,
      leaveCount,
      autoResolvedCount,
    };
  }, [comparisons]);

  return (
    <div className="space-y-5">
      {/* Mode & Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 pb-3">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setActiveSubTab('upload')}
            className={`px-3.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition ${
              activeSubTab === 'upload'
                ? 'bg-[#008b99] text-white shadow'
                : isDark ? 'bg-[#162330] text-slate-300 hover:text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>อัปโหลดข้อมูล (Upload Files & Folders)</span>
          </button>
          <button
            onClick={() => setActiveSubTab('compare')}
            className={`px-3.5 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition ${
              activeSubTab === 'compare'
                ? 'bg-[#008b99] text-white shadow'
                : isDark ? 'bg-[#162330] text-slate-300 hover:text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>ตรวจสอบเทียบกับ Shift Code ({comparisons.length} รายการ)</span>
          </button>
        </div>

        {/* Deduplication Strategy Toggle */}
        <div className={`flex items-center space-x-2 px-3 py-1.5 rounded text-xs border ${
          isDark ? 'bg-[#101923] border-[#223344]' : 'bg-slate-50 border-slate-200'
        }`}>
          <SlidersHorizontal className="w-3.5 h-3.5 text-teal-400" />
          <span className="text-slate-400">รูปแบบการนำเข้า:</span>
          <label className="flex items-center space-x-1 cursor-pointer">
            <input 
              type="radio" 
              name="mergeStrategy" 
              checked={mergeMode === 'smart-merge'} 
              onChange={() => setMergeMode('smart-merge')}
              className="text-teal-500 focus:ring-0"
            />
            <span className={mergeMode === 'smart-merge' ? 'text-teal-300 font-bold' : 'text-slate-400'}>
              รวมข้อมูลและคัดกรองซ้ำ (ยึดข้อมูลล่าสุด)
            </span>
          </label>
          <span className="text-slate-600">|</span>
          <label className="flex items-center space-x-1 cursor-pointer">
            <input 
              type="radio" 
              name="mergeStrategy" 
              checked={mergeMode === 'replace-month'} 
              onChange={() => setMergeMode('replace-month')}
              className="text-amber-500 focus:ring-0"
            />
            <span className={mergeMode === 'replace-month' ? 'text-amber-300 font-bold' : 'text-slate-400'}>
              แทนที่ข้อมูลเดือนที่อัปโหลด
            </span>
          </label>
        </div>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div className={`p-3 rounded border text-xs flex items-start justify-between space-x-2 ${
          statusMessage.type === 'success'
            ? 'bg-teal-950/50 border-teal-500/50 text-teal-200'
            : statusMessage.type === 'error'
            ? 'bg-rose-950/50 border-rose-500/50 text-rose-200'
            : 'bg-sky-950/50 border-sky-500/50 text-sky-200'
        }`}>
          <div className="flex items-start space-x-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-teal-400 mt-0.5 shrink-0" />
            ) : statusMessage.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
            ) : (
              <HelpCircle className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* SUB-TAB 1: UPLOAD AREA */}
      {activeSubTab === 'upload' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Step 1: Format & Guide */}
            <div className={`p-4 rounded border space-y-3 text-xs ${
              isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
            }`}>
              <h2 className="font-bold text-sm text-[#00e5e5] flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span>Step 1: รูปแบบไฟล์ที่รองรับ</span>
              </h2>
              <p className="text-slate-400 leading-relaxed">
                รองรับไฟล์บันทึกเวลาสแกนนิ้ว/รูดบัตรทุกนามสกุล เช่น <code>.txt</code>, <code>.TXT</code>, <code>.dat</code>, <code>.DAT</code>, <code>.csv</code>, <code>.xlsx</code>
              </p>

              <div className={`p-2.5 rounded border font-mono text-[11px] space-y-1 ${
                isDark ? 'bg-[#0a1118] border-[#1e2e3d]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="text-slate-400 text-[10px]">ตัวอย่างรูปแบบในไฟล์:</div>
                <div className="text-teal-400">0082   I 260901 0546 03</div>
                <div className="text-teal-400">0451   O 260802 0725 03</div>
                <div className="text-teal-400">451    I 260901 0601 03</div>
                <div className="text-teal-400">SM549  O 260901 0808 03</div>
                <div className="text-teal-400">0149   I 2026-09-01 07:30 01</div>
              </div>

              <div className={`p-2.5 rounded border text-[11px] space-y-1 leading-relaxed ${
                isDark ? 'bg-[#0a1118]/60 border-[#1e2e3d] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}>
                <span className="font-semibold text-teal-300">💡 การนำเข้าแบบโฟลเดอร์:</span>
                <p>
                  สามารถลากโฟลเดอร์ที่มีไฟล์ <code>.TXT</code> หรือ <code>.DAT</code> จากเครื่องรูดบัตรมาวางได้ทันที ระบบจะค้นหาและรวมข้อมูลให้โดยอัตโนมัติ
                </p>
              </div>
            </div>

            {/* Step 2: Upload Drop Zone (Folder & Multi-file support) */}
            <div 
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`md:col-span-2 p-6 rounded border flex flex-col items-center justify-center text-center space-y-4 border-dashed transition ${
                dragOver 
                  ? 'border-teal-400 bg-teal-950/20 scale-[1.01]' 
                  : isDark ? 'bg-[#121c27] border-[#2f4358]' : 'bg-white border-slate-300'
              }`}
            >
              <div className="p-4 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/30">
                <Clock className="w-8 h-8 animate-pulse" />
              </div>

              <div>
                <h2 className="font-bold text-base text-slate-100">
                  Step 2: อัปโหลดไฟล์บันทึกเวลาเข้า-ออก (นำเข้าทั้ง Folder หรือหลายไฟล์)
                </h2>
                <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                  สามารถ<strong>ลาก Folder หรือหลายไฟล์มาวางที่นี่</strong> หรือคลิกปุ่มด้านล่างเพื่อเลือกไฟล์จากคอมพิวเตอร์
                </p>
                <p className="text-[11px] text-teal-400 mt-1 font-medium">
                  {mergeMode === 'smart-merge' 
                    ? '✨ โหมดรวมข้อมูลอัจฉริยะ: หากอัปโหลดไฟล์ซ้ำ ระบบจะคัดกรองและเลือกข้อมูลล่าสุดให้อัตโนมัติ'
                    : '⚠️ โหมดแทนที่: ระบบจะลบข้อมูลเก่าในเดือนที่ตรวจพบและบันทึกข้อมูลชุดใหม่ลงไปแทน'}
                </p>
              </div>

              {/* Action Buttons: Multi-file & Folder Upload */}
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                {/* Folder Upload Button */}
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isProcessing}
                  className="px-4 py-2.5 rounded font-bold text-xs bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-lg transition flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>เลือกทั้งโฟลเดอร์ (Import Entire Folder)</span>
                </button>

                {/* Multiple Files Upload Button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="px-4 py-2.5 rounded font-bold text-xs bg-[#16293d] hover:bg-[#203a55] border border-teal-500/40 text-teal-300 shadow transition flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>เลือกหลายไฟล์ (Multiple Files)</span>
                </button>
              </div>

              {/* Hidden Inputs */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".txt,.TXT,.dat,.DAT,.csv,.CSV,.xlsx,.XLSX,.xls,.XLS,.log,.LOG,.prn,.PRN"
                onChange={handleFilesSelect}
                className="hidden"
              />
              <input
                ref={folderInputRef}
                type="file"
                // @ts-ignore
                webkitdirectory=""
                directory=""
                multiple
                onChange={handleFolderSelect}
                className="hidden"
              />

              {isProcessing && (
                <div className="flex items-center space-x-2 text-xs text-teal-400 font-medium">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>กำลังประมวลผลและคัดกรองข้อมูลซ้ำซ้อน...</span>
                </div>
              )}
            </div>
          </div>

          {/* Merge Result Banner (if available) */}
          {lastMergeResult && (
            <div className={`p-4 rounded border ${
              isDark ? 'bg-[#0f1b26] border-teal-500/30' : 'bg-teal-50/70 border-teal-200'
            }`}>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <div className="flex items-center space-x-2 font-bold text-xs text-teal-300">
                  <FileCheck2 className="w-4 h-4" />
                  <span>ผลลัพธ์การประมวลผลและการรวมข้อมูลล่าสุด</span>
                </div>
                <span className="text-[11px] text-slate-400">
                  ช่วงวันที่ตรวจพบ: <strong>{lastMergeResult.earliestDate} ถึง {lastMergeResult.latestDate}</strong>
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-2.5 rounded bg-black/20 border border-white/5">
                  <div className="text-slate-400 text-[11px]">รายการใหม่ที่เพิ่มเข้าสู่ระบบ</div>
                  <div className="text-lg font-bold text-teal-400">+{lastMergeResult.newAddedCount}</div>
                </div>
                <div className="p-2.5 rounded bg-black/20 border border-white/5">
                  <div className="text-slate-400 text-[11px]">อัปเดตทับด้วยข้อมูลล่าสุด</div>
                  <div className="text-lg font-bold text-cyan-400">{lastMergeResult.updatedCount}</div>
                </div>
                <div className="p-2.5 rounded bg-black/20 border border-white/5">
                  <div className="text-slate-400 text-[11px]">จำนวนพนักงานที่มีข้อมูล</div>
                  <div className="text-lg font-bold text-slate-200">{lastMergeResult.uniqueEmployeesCount} คน</div>
                </div>
                <div className="p-2.5 rounded bg-black/20 border border-white/5">
                  <div className="text-slate-400 text-[11px]">รวมข้อมูลลงเวลาทั้งหมดในระบบ</div>
                  <div className="text-lg font-bold text-emerald-400">{lastMergeResult.totalAfter} บันทึก</div>
                </div>
              </div>

              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => setActiveSubTab('compare')}
                  className="text-xs text-teal-400 hover:text-teal-300 font-semibold flex items-center gap-1"
                >
                  <span>ไปที่ตารางตรวจสอบเทียบกับ Shift Code</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: VERIFICATION & COMPARISON WITH SHIFT CODE */}
      {activeSubTab === 'compare' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className={`p-3.5 rounded border flex flex-wrap items-center justify-between gap-3 text-xs ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
          }`}>
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Month Picker */}
              <div className="flex items-center space-x-1.5">
                <Calendar className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-slate-400 font-medium">เดือน:</span>
                <select
                  value={compareMonth}
                  onChange={(e) => setCompareMonth(e.target.value)}
                  className={`py-1 px-2.5 rounded border text-xs font-semibold ${
                    isDark ? 'bg-[#162330] border-[#2f4358] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}
                >
                  {availablePunchMonths.map(m => (
                    <option key={m} value={m}>{m} {m === '2026-08' ? '(ข้อมูลเดือน 8 ที่นำเข้า)' : ''}</option>
                  ))}
                </select>
              </div>

              {/* Department Picker */}
              <div className="flex items-center space-x-1.5">
                <span className="text-slate-400 font-medium">แผนก:</span>
                <select
                  value={compareDept}
                  onChange={(e) => setCompareDept(e.target.value)}
                  className={`py-1 px-2.5 rounded border text-xs font-semibold ${
                    isDark ? 'bg-[#162330] border-[#2f4358] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}
                >
                  <option value="ALL">ALL (ทุกแผนก)</option>
                  {Array.from(new Set(employees.map(e => e.department))).sort().map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex items-center space-x-1.5">
                <Filter className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-slate-400 font-medium">สถานะ:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className={`py-1 px-2.5 rounded border text-xs font-semibold ${
                    isDark ? 'bg-[#162330] border-[#2f4358] text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}
                >
                  <option value="ALL">ทุกสถานะ ({comparisons.length})</option>
                  <option value="auto_resolved">🔄 ปรับสถานะตามกะ (I+I / O+O / กะดึก) ({comparisonStats.autoResolvedCount})</option>
                  <option value="late">⚠️ มาสาย ({comparisonStats.lateCount})</option>
                  <option value="on_time">✅ ตรงเวลา ({comparisonStats.onTimeCount})</option>
                  <option value="worked_on_off">💼 มีสแกนในวันหยุด ({comparisonStats.workedOnOffCount})</option>
                  <option value="no_stamp">🔴 ไม่มีสแกน ({comparisonStats.noStampCount})</option>
                  <option value="leave">📋 ลาป่วย/พักร้อน ({comparisonStats.leaveCount})</option>
                </select>
              </div>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="ค้นหารหัส, ชื่อ, กะ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`py-1 pl-8 pr-3 rounded border text-xs w-48 ${
                  isDark ? 'bg-[#162330] border-[#2f4358] text-slate-200 placeholder-slate-500' : 'bg-slate-50 border-slate-300 text-slate-800'
                }`}
              />
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
            <div className={`p-2.5 rounded border ${isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'}`}>
              <div className="text-slate-400 text-[11px]">รายการเปรียบเทียบ</div>
              <div className="text-base font-bold text-slate-200">{filteredComparisons.length} / {comparisons.length}</div>
            </div>
            <div className={`p-2.5 rounded border ${isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'}`}>
              <div className="text-slate-400 text-[11px]">เข้างานตรงเวลา</div>
              <div className="text-base font-bold text-emerald-400">{comparisonStats.onTimeCount}</div>
            </div>
            <div className={`p-2.5 rounded border ${isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'}`}>
              <div className="text-slate-400 text-[11px]">มาสาย (Late)</div>
              <div className="text-base font-bold text-amber-400">{comparisonStats.lateCount}</div>
            </div>
            <div className={`p-2.5 rounded border ${isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'}`}>
              <div className="text-slate-400 text-[11px]">ปรับตามกะ (Auto-Resolved)</div>
              <div className="text-base font-bold text-cyan-400">{comparisonStats.autoResolvedCount}</div>
            </div>
            <div className={`p-2.5 rounded border ${isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'}`}>
              <div className="text-slate-400 text-[11px]">สแกนในวันหยุด (OFF/H)</div>
              <div className="text-base font-bold text-teal-400">{comparisonStats.workedOnOffCount}</div>
            </div>
            <div className={`p-2.5 rounded border ${isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'}`}>
              <div className="text-slate-400 text-[11px]">ลาป่วย / พักร้อน</div>
              <div className="text-base font-bold text-purple-400">{comparisonStats.leaveCount}</div>
            </div>
          </div>

          {/* Comparison Table */}
          <div className={`rounded border overflow-hidden ${
            isDark ? 'bg-[#121c27] border-[#223344]' : 'bg-white border-slate-200'
          }`}>
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-left text-xs border-collapse">
                <thead className={`sticky top-0 z-10 text-[11px] font-bold uppercase tracking-wider ${
                  isDark ? 'bg-[#162330] text-slate-300 border-b border-[#2f4358]' : 'bg-slate-100 text-slate-700 border-b border-slate-300'
                }`}>
                  <tr>
                    <th className="py-2.5 px-3">วันที่ (Date)</th>
                    <th className="py-2.5 px-3">รหัสพนักงาน (EmpNo)</th>
                    <th className="py-2.5 px-3">ชื่อ - สกุล</th>
                    <th className="py-2.5 px-3">แผนก</th>
                    <th className="py-2.5 px-3 text-center">รหัสกะ (Shift)</th>
                    <th className="py-2.5 px-3 text-center">เวลากะที่กำหนด</th>
                    <th className="py-2.5 px-3 text-center">เวลาสแกนเข้า (In)</th>
                    <th className="py-2.5 px-3 text-center">เวลาสแกนออก (Out)</th>
                    <th className="py-2.5 px-3 text-center">ผลการเปรียบเทียบ</th>
                    <th className="py-2.5 px-3 text-center">รายละเอียด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {filteredComparisons.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-slate-400">
                        ไม่พบข้อมูลเปรียบเทียบตามเงื่อนไขที่เลือก (กรุณาเลือกเดือน 2026-08 หรืออัปโหลดไฟล์เวลา)
                      </td>
                    </tr>
                  ) : (
                    filteredComparisons.map((row, idx) => (
                      <tr 
                        key={`${row.date}_${row.empNo}_${idx}`}
                        className={`transition hover:bg-teal-500/5 ${
                          row.status === 'late' 
                            ? isDark ? 'bg-amber-950/15' : 'bg-amber-50/50' 
                            : row.status === 'worked_on_off'
                            ? isDark ? 'bg-cyan-950/15' : 'bg-cyan-50/50'
                            : ''
                        }`}
                      >
                        <td className="py-2 px-3 font-mono text-slate-300">{row.date}</td>
                        <td className="py-2 px-3 font-mono font-bold text-teal-400">{row.empNo}</td>
                        <td className="py-2 px-3 font-medium text-slate-200">{row.empName}</td>
                        <td className="py-2 px-3 text-slate-400">{row.department}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                            row.scheduledShiftCode === 'OFF' || row.scheduledShiftCode === 'H'
                              ? 'bg-slate-700 text-slate-300'
                              : row.scheduledShiftCode.startsWith('SL')
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : row.scheduledShiftCode.startsWith('AL')
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-teal-900/60 text-teal-300 border border-teal-700'
                          }`}>
                            {row.scheduledShiftCode}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-slate-300 text-[11px]">
                          {row.shiftHours}
                        </td>
                        <td className="py-2 px-3 text-center font-mono font-semibold text-emerald-400">
                          {row.clockIn || '-'}
                        </td>
                        <td className="py-2 px-3 text-center font-mono font-semibold text-cyan-400">
                          {row.clockOut || '-'}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-semibold inline-block ${
                            row.status === 'on_time'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : row.status === 'late'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800 font-bold'
                              : row.status === 'worked_on_off'
                              ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                              : row.status === 'leave'
                              ? 'bg-purple-950 text-purple-300 border border-purple-800'
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {row.statusLabel}
                          </span>
                          {row.hasIrregularity && row.resolutionType !== 'standard_in_out' && (
                            <span 
                              className={`px-1.5 py-0.2 rounded text-[10px] font-semibold border flex items-center gap-1 mt-1 justify-center ${
                                row.resolutionType === 'dual_in_resolved'
                                  ? 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60'
                                  : row.resolutionType === 'dual_out_resolved'
                                  ? 'bg-amber-950/80 text-amber-300 border-amber-700/60'
                                  : row.resolutionType === 'inverted_resolved'
                                  ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700/60'
                                  : row.resolutionType === 'cross_midnight_resolved'
                                  ? 'bg-purple-950/80 text-purple-300 border-purple-700/60'
                                  : 'bg-teal-950/80 text-teal-300 border-teal-700/60'
                              }`}
                              title={row.resolutionDescription}
                            >
                              {row.resolutionType === 'dual_in_resolved' && '🔄 ปรับ In+In จากกะ'}
                              {row.resolutionType === 'dual_out_resolved' && '🔄 ปรับ Out+Out จากกะ'}
                              {row.resolutionType === 'inverted_resolved' && '🔄 สลับปุ่ม (ตามกะ)'}
                              {row.resolutionType === 'cross_midnight_resolved' && '🌙 ข้ามวัน (กะดึก)'}
                              {row.resolutionType === 'single_in_only' && '⚠️ สแกนเฉพาะ In'}
                              {row.resolutionType === 'single_out_only' && '⚠️ สแกนเฉพาะ Out'}
                              {row.resolutionType === 'shift_time_aligned' && '⚡ ปรับตามกะ'}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            onClick={() => setSelectedRowDetails(row)}
                            className="p-1 rounded text-slate-400 hover:text-teal-300 hover:bg-teal-500/10 transition"
                            title="ดูข้อมูลสแกนดิบทั้งหมดของวันนี้"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Raw Punches Detail Modal */}
      {selectedRowDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-lg rounded border shadow-2xl p-5 space-y-4 ${
            isDark ? 'bg-[#121c27] border-[#294562] text-slate-200' : 'bg-white border-slate-300 text-slate-800'
          }`}>
            <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
              <div className="flex items-center space-x-2 font-bold text-sm text-teal-400">
                <Clock className="w-4 h-4" />
                <span>บันทึกการสแกนจริง: {selectedRowDetails.empName} ({selectedRowDetails.empNo})</span>
              </div>
              <button 
                onClick={() => setSelectedRowDetails(null)} 
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="p-2 rounded bg-black/20 border border-white/5">
                <span className="text-slate-400">วันที่: </span>
                <span className="font-mono font-bold text-slate-200">{selectedRowDetails.date}</span>
              </div>
              <div className="p-2 rounded bg-black/20 border border-white/5">
                <span className="text-slate-400">แผนก: </span>
                <span className="font-bold text-slate-200">{selectedRowDetails.department}</span>
              </div>
              <div className="p-2 rounded bg-black/20 border border-white/5">
                <span className="text-slate-400">รหัสกะ: </span>
                <span className="font-bold text-teal-300">{selectedRowDetails.scheduledShiftCode}</span>
                <span className="text-slate-400 text-[10px] block">({selectedRowDetails.shiftHours})</span>
              </div>
              <div className="p-2 rounded bg-black/20 border border-white/5">
                <span className="text-slate-400">ผลการวิเคราะห์: </span>
                <span className="font-bold text-amber-300">{selectedRowDetails.statusLabel}</span>
              </div>
            </div>

            {selectedRowDetails.hasIrregularity && selectedRowDetails.resolutionDescription && (
              <div className="p-2.5 rounded bg-cyan-950/40 border border-cyan-700/50 text-xs space-y-1">
                <div className="font-bold text-cyan-300 flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>การปรับแก้ตามรหัสกะ (Shift Code Learning & Resolution):</span>
                </div>
                <p className="text-slate-300 leading-relaxed text-[11px]">
                  {selectedRowDetails.resolutionDescription}
                </p>
              </div>
            )}

            <div>
              <h4 className="text-xs font-bold text-slate-300 mb-2">
                รายการสแกนดิบทั้งหมดในวัน ({selectedRowDetails.punchRecords.length} ครั้ง):
              </h4>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {selectedRowDetails.punchRecords.map((p, pIdx) => (
                  <div 
                    key={pIdx}
                    className="p-2 rounded bg-black/30 border border-white/5 flex items-center justify-between font-mono text-xs"
                  >
                    <div className="flex items-center space-x-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        p.type === 'I' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                      }`}>
                        {p.type === 'I' ? 'Punch IN' : 'Punch OUT'}
                      </span>
                      <span className="text-slate-200">{p.time} น.</span>
                      <span className="text-slate-500 text-[10px]">(Device {p.deviceId})</span>
                    </div>
                    {p.rawLine && (
                      <span className="text-slate-500 text-[10px]">{p.rawLine}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedRowDetails(null)}
                className="px-4 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-white font-medium"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
