import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Employee, ShiftCode } from '../types';
import { getShiftCategoryColor } from '../utils/timeCalc';
import { 
  Search, 
  X, 
  Clock, 
  Calendar, 
  Check, 
  Sparkles,
  Layers,
  ChevronRight,
  Sun,
  Sunset,
  Moon,
  Coffee,
  HeartPulse
} from 'lucide-react';

interface ShiftPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee: Employee | null;
  dateStr: string;
  currentShiftCode: string;
  shiftCodes: ShiftCode[];
  onApplyShift: (newCode: string, rangeType: 'single' | 'weekday' | 'next7' | 'endOfMonth') => void;
  theme: 'dark' | 'light';
}

export const ShiftPickerModal: React.FC<ShiftPickerModalProps> = ({
  isOpen,
  onClose,
  employee,
  dateStr,
  currentShiftCode,
  shiftCodes,
  onApplyShift,
  theme,
}) => {
  const isDark = theme === 'dark';
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('dept');
  const [rangeOption, setRangeOption] = useState<'single' | 'weekday' | 'next7' | 'endOfMonth'>('single');
  const [includeStandby, setIncludeStandby] = useState<boolean>(false);
  const [includeEmergency, setIncludeEmergency] = useState<boolean>(false);

  // Auto-focus search input when opened
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setActiveCategory('dept');
      setRangeOption('single');
      // Initialize allowance tags from current shift if already present
      const currUpper = (currentShiftCode || '').toUpperCase();
      setIncludeStandby(currUpper.includes('-X'));
      setIncludeEmergency(currUpper.includes('-ET'));
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, currentShiftCode]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Compute final shift code with allowance tags
  const applyCodeWithTags = (baseCode: string) => {
    let clean = baseCode.replace(/-X/gi, '').replace(/-ET/gi, '').trim();
    if (includeStandby) clean += '-X';
    if (includeEmergency) clean += '-ET';
    onApplyShift(clean, rangeOption);
  };

  // Top Most-used Favorites
  const quickFavorites = useMemo(() => {
    const favCodes = ['D', 'D1', 'E', 'M', 'A', 'N', 'T', 'W', 'AL', 'AL2', 'CL', 'SL', 'SL2', 'SLO', 'OFF', 'H'];
    return favCodes
      .map(code => shiftCodes.find(s => s.code === code))
      .filter((s): s is ShiftCode => !!s);
  }, [shiftCodes]);

  // Filter shifts based on Category and Search Term
  const filteredShifts = useMemo(() => {
    return shiftCodes.filter(sc => {
      // Search text filter
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const qClean = q.replace(/-x/gi, '').replace(/-et/gi, '').trim();
        const baseCodeLower = sc.code.toLowerCase();
        
        const matchesCode = baseCodeLower.includes(q) || (qClean && (baseCodeLower.includes(qClean) || qClean.includes(baseCodeLower)));
        const matchesName = sc.name.toLowerCase().includes(q) || (qClean && sc.name.toLowerCase().includes(qClean));
        const matchesDesc = (sc.description || '').toLowerCase().includes(q);
        const matchesTime = `${sc.startTime} ${sc.endTime}`.includes(q);
        if (!matchesCode && !matchesName && !matchesDesc && !matchesTime) return false;
      }

      // Category tabs filter
      if (activeCategory === 'dept') {
        // Only show shifts that match employee's department or ALL
        if (!employee) return true;
        return sc.department === 'ALL' || sc.department === employee.department;
      } else if (activeCategory === 'day') {
        // Morning or regular day shifts (start before 12:00 and working day)
        const hour = parseInt(sc.startTime.split(':')[0], 10);
        return sc.isWorkingDay && hour < 12;
      } else if (activeCategory === 'afternoon') {
        // Afternoon shifts (start between 12:00 and 18:00)
        const hour = parseInt(sc.startTime.split(':')[0], 10);
        return sc.isWorkingDay && hour >= 12 && hour < 18;
      } else if (activeCategory === 'night') {
        // Night shifts (start after 18:00 or overnight)
        const hour = parseInt(sc.startTime.split(':')[0], 10);
        return sc.isWorkingDay && (hour >= 18 || hour < 5 || sc.code.startsWith('N'));
      } else if (activeCategory === 'off') {
        // Off, Holiday, Leave
        return !sc.isWorkingDay || ['OFF', 'H', 'AL', 'SL'].includes(sc.code);
      }

      return true; // 'all'
    });
  }, [shiftCodes, searchTerm, activeCategory, employee]);

  if (!isOpen || !employee) return null;

  // Format display date
  const dateObj = new Date(dateStr);
  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];
  const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const formattedDate = !isNaN(dateObj.getTime())
    ? `วัน${dayNames[dateObj.getDay()]}ที่ ${dateObj.getDate()} ${thaiMonths[dateObj.getMonth()]} ${dateObj.getFullYear()}`
    : dateStr;

  const currentShift = shiftCodes.find(s => s.code === currentShiftCode);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs">
      <div 
        className={`w-full max-w-2xl rounded-xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-all animate-in fade-in zoom-in-95 duration-150 ${
          isDark ? 'bg-[#14202c] border-[#29425b] text-white' : 'bg-white border-slate-300 text-slate-900'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className={`p-4 border-b flex items-start justify-between ${
          isDark ? 'bg-[#0f1722] border-[#203244]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-teal-500/20 text-[#00e5e5] border border-teal-500/30">
                {employee.department}
              </span>
              <h2 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-1.5">
                <span>{employee.firstName} {employee.familyName}</span>
                <span className="text-xs font-normal text-slate-400 font-mono">({employee.gid})</span>
              </h2>
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 text-slate-300">
                <Calendar className="w-3.5 h-3.5 text-[#00e5e5]" />
                {formattedDate}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                กะปัจจุบัน: 
                <strong 
                  className="px-1.5 py-0.2 rounded font-mono text-white text-[11px]" 
                  style={{ backgroundColor: currentShift?.color || '#6b7280' }}
                >
                  {currentShiftCode}
                </strong>
                <span className="text-slate-400">({currentShift?.name || 'ไม่ได้ระบุ'})</span>
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/40 transition cursor-pointer"
            title="ปิดหน้าต่าง (ESC)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick 1-Click Favorites Bar & Allowance Tag Modifiers */}
        <div className={`px-4 py-2.5 border-b space-y-2 ${
          isDark ? 'bg-[#182635] border-[#25394e]' : 'bg-slate-100/70 border-slate-200'
        }`}>
          {/* Allowance Suffix Modifiers */}
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-slate-300 text-[11px] flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                เงื่อนไขเบี้ยเลี้ยงพิเศษ:
              </span>
              <label className="flex items-center space-x-1.5 cursor-pointer select-none bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded text-amber-300 hover:bg-amber-500/20 transition">
                <input
                  type="checkbox"
                  checked={includeStandby}
                  onChange={e => setIncludeStandby(e.target.checked)}
                  className="rounded border-amber-500 text-amber-500 focus:ring-0 w-3.5 h-3.5"
                />
                <span className="font-mono font-bold">-X</span>
                <span className="text-[10px] opacity-90">(Standby +300฿)</span>
              </label>

              <label className="flex items-center space-x-1.5 cursor-pointer select-none bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 rounded text-rose-300 hover:bg-rose-500/20 transition">
                <input
                  type="checkbox"
                  checked={includeEmergency}
                  onChange={e => setIncludeEmergency(e.target.checked)}
                  className="rounded border-rose-500 text-rose-500 focus:ring-0 w-3.5 h-3.5"
                />
                <span className="font-mono font-bold">-ET</span>
                <span className="text-[10px] opacity-90">(Emergency +300฿)</span>
              </label>
            </div>

            {/* Quick Suffix Presets */}
            <div className="flex items-center space-x-1">
              <span className="text-[10px] text-slate-400">ด่วน:</span>
              <button
                type="button"
                onClick={() => onApplyShift('AD1-X', rangeOption)}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:scale-105 transition cursor-pointer"
                title="AD1-X: กะ D1 + Standby Allowance 300฿"
              >
                AD1-X
              </button>
              <button
                type="button"
                onClick={() => onApplyShift('E-ET', rangeOption)}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-200 border border-rose-500/40 hover:scale-105 transition cursor-pointer"
                title="E-ET: กะ E + Emergency Allowance 300฿"
              >
                E-ET
              </button>
              <button
                type="button"
                onClick={() => onApplyShift('D-X', rangeOption)}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-teal-500/20 text-teal-200 border border-teal-500/40 hover:scale-105 transition cursor-pointer"
                title="D-X: กะ D + Standby Allowance 300฿"
              >
                D-X
              </button>
            </div>
          </div>

          {/* Favorites Shift Row */}
          <div className="flex items-center space-x-1 flex-wrap gap-1 pt-1 border-t border-slate-700/30">
            <span className="font-semibold text-slate-400 text-[10px] mr-1">กะหลัก:</span>
            {quickFavorites.map((fav, idx) => {
              const timeDesc = fav.startTime === '00:00' && fav.endTime === '00:00'
                ? (fav.isWorkingDay ? 'เต็มวัน' : 'วันหยุด/การลา')
                : `${fav.startTime} - ${fav.endTime}`;
              return (
                <button
                  key={`${fav.code}_${fav.department || 'ALL'}_${idx}`}
                  onClick={() => applyCodeWithTags(fav.code)}
                  className={`min-w-[28px] h-7 px-2 flex items-center justify-center rounded-md text-xs font-mono font-bold transition hover:scale-105 active:scale-95 shadow-xs cursor-pointer ${
                    fav.code === currentShiftCode ? 'ring-2 ring-white ring-offset-1 ring-offset-[#14202c] font-extrabold' : ''
                  }`}
                  style={{ backgroundColor: getShiftCategoryColor(fav.code, fav.color), color: '#ffffff' }}
                  title={`${fav.code}: ${fav.name} (${timeDesc}) - คลิกเพื่อเปลี่ยนทันที${includeStandby ? ' (รวม -X +300฿)' : ''}${includeEmergency ? ' (รวม -ET +300฿)' : ''}`}
                >
                  <span>{fav.code}{includeStandby ? '-X' : ''}{includeEmergency ? '-ET' : ''}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Search & Category Filter */}
        <div className="p-3 sm:p-4 space-y-3">
          {/* Instant Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="พิมพ์ค้นหา Shift Code เช่น D, N, RS, 07:00 หรือชื่อกะ (กด Enter เพื่อเลือก)..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (filteredShifts.length > 0) {
                    applyCodeWithTags(filteredShifts[0].code);
                  } else if (searchTerm.trim()) {
                    applyCodeWithTags(searchTerm.trim().toUpperCase());
                  }
                }
              }}
              className={`w-full pl-9 pr-8 py-2 rounded-lg border text-xs outline-none transition ${
                isDark 
                  ? 'bg-[#0f1722] border-[#29425b] text-white placeholder-slate-500 focus:border-[#00e5e5] focus:ring-1 focus:ring-[#00e5e5]' 
                  : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-[#008b99]'
              }`}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs border-b border-slate-700/40">
            <button
              onClick={() => setActiveCategory('dept')}
              className={`px-2.5 py-1.5 rounded-t text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
                activeCategory === 'dept'
                  ? 'border-b-2 border-[#00e5e5] text-[#00e5e5] bg-teal-500/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>แผนก {employee.department} & กะหลัก</span>
            </button>
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-2.5 py-1.5 rounded-t text-xs font-semibold whitespace-nowrap transition ${
                activeCategory === 'all'
                  ? 'border-b-2 border-[#00e5e5] text-[#00e5e5] bg-teal-500/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ทั้งหมด ({shiftCodes.length})
            </button>
            <button
              onClick={() => setActiveCategory('day')}
              className={`px-2.5 py-1.5 rounded-t text-xs font-semibold whitespace-nowrap transition flex items-center gap-1 ${
                activeCategory === 'day'
                  ? 'border-b-2 border-[#00e5e5] text-[#00e5e5] bg-teal-500/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>กะกลางวัน (Day)</span>
            </button>
            <button
              onClick={() => setActiveCategory('afternoon')}
              className={`px-2.5 py-1.5 rounded-t text-xs font-semibold whitespace-nowrap transition flex items-center gap-1 ${
                activeCategory === 'afternoon'
                  ? 'border-b-2 border-[#00e5e5] text-[#00e5e5] bg-teal-500/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sunset className="w-3.5 h-3.5 text-orange-400" />
              <span>กะบ่าย (Afternoon)</span>
            </button>
            <button
              onClick={() => setActiveCategory('night')}
              className={`px-2.5 py-1.5 rounded-t text-xs font-semibold whitespace-nowrap transition flex items-center gap-1 ${
                activeCategory === 'night'
                  ? 'border-b-2 border-[#00e5e5] text-[#00e5e5] bg-teal-500/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
              <span>กะดึก (Night)</span>
            </button>
            <button
              onClick={() => setActiveCategory('off')}
              className={`px-2.5 py-1.5 rounded-t text-xs font-semibold whitespace-nowrap transition flex items-center gap-1 ${
                activeCategory === 'off'
                  ? 'border-b-2 border-[#00e5e5] text-[#00e5e5] bg-teal-500/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Coffee className="w-3.5 h-3.5 text-rose-400" />
              <span>วันหยุด / ลางาน</span>
            </button>
          </div>
        </div>

        {/* Shift Code List Cards Grid */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 max-h-[42vh] scrollbar-thin">
          {/* If user typed a search term, show direct typed action card */}
          {searchTerm.trim() && (
            <div className={`mb-2.5 p-2.5 rounded-lg border flex items-center justify-between gap-2 shadow-xs ${
              isDark ? 'bg-[#18293d] border-[#00e5e5]/40 text-slate-100' : 'bg-teal-50 border-teal-300 text-slate-900'
            }`}>
              <div className="flex items-center space-x-2 min-w-0">
                <span className="px-2 py-1 rounded bg-[#008b99] text-white font-mono font-bold text-xs uppercase shrink-0">
                  {searchTerm.trim().toUpperCase()}
                </span>
                <div className="text-xs">
                  <div className="font-semibold text-teal-300">ใส่รหัสกะตามที่พิมพ์ทันที</div>
                  <div className="text-[10px] text-slate-400">
                    {searchTerm.toUpperCase().includes('-X') && <span className="text-amber-300 font-bold mr-1.5">• รวม Stand by 300฿</span>}
                    {searchTerm.toUpperCase().includes('-ET') && <span className="text-rose-300 font-bold mr-1.5">• รวม Emergency 300฿</span>}
                    {!searchTerm.toUpperCase().includes('-X') && !searchTerm.toUpperCase().includes('-ET') && <span>กดเลือกเพื่อบันทึกกะนี้</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onApplyShift(searchTerm.trim().toUpperCase(), rangeOption)}
                  className="px-2.5 py-1 rounded text-xs font-semibold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow-xs transition cursor-pointer"
                >
                  เลือกกะนี้
                </button>
                {!searchTerm.toUpperCase().includes('-X') && (
                  <button
                    type="button"
                    onClick={() => onApplyShift(`${searchTerm.trim().toUpperCase()}-X`, rangeOption)}
                    className="px-2 py-1 rounded text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition cursor-pointer"
                    title="ใส่กะนี้พร้อม Stand by Allowance 300฿"
                  >
                    + Stand by (-X)
                  </button>
                )}
                {!searchTerm.toUpperCase().includes('-ET') && (
                  <button
                    type="button"
                    onClick={() => onApplyShift(`${searchTerm.trim().toUpperCase()}-ET`, rangeOption)}
                    className="px-2 py-1 rounded text-[11px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition cursor-pointer"
                    title="ใส่กะนี้พร้อม Emergency Allowance 300฿"
                  >
                    + Emergency (-ET)
                  </button>
                )}
              </div>
            </div>
          )}

          {filteredShifts.length === 0 && !searchTerm.trim() ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              ไม่พบ Shift Code ในหมวดหมู่นี้
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filteredShifts.map((sc, idx) => {
                const isSelected = sc.code === currentShiftCode;

                return (
                  <div
                    key={`${sc.code}_${sc.department}_${idx}`}
                    className={`p-2.5 rounded-lg border flex flex-col justify-between gap-2 transition ${
                      isSelected
                        ? isDark 
                          ? 'border-[#00e5e5] bg-teal-500/15 shadow-sm' 
                          : 'border-teal-500 bg-teal-50 shadow-sm'
                        : isDark
                          ? 'border-slate-800 bg-[#0f1722]/80 hover:border-slate-600 hover:bg-[#182635]'
                          : 'border-slate-200 bg-white hover:border-teal-400 hover:bg-slate-50'
                    }`}
                  >
                    <div 
                      onClick={() => applyCodeWithTags(sc.code)}
                      className="flex items-start justify-between gap-2 cursor-pointer"
                      title={`คลิกเพื่อเลือกกะ ${sc.code}${includeStandby ? '-X (+300฿)' : ''}${includeEmergency ? '-ET (+300฿)' : ''}`}
                    >
                      <div className="flex items-start space-x-2.5 min-w-0">
                        {/* Color Tag Badge */}
                        <span
                          className="w-8 h-8 rounded-lg text-xs font-mono font-bold text-white flex items-center justify-center shrink-0 shadow-xs"
                          style={{ backgroundColor: getShiftCategoryColor(sc.code, sc.color) }}
                        >
                          {sc.code}
                        </span>

                        <div className="min-w-0">
                          <div className="font-semibold text-xs text-slate-100 truncate flex items-center gap-1.5">
                            <span>{sc.name}</span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                            )}
                          </div>

                          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                            <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="font-mono">
                              {sc.startTime} - {sc.endTime}
                            </span>
                            {sc.workingHours > 0 && (
                              <span className="text-[10px] opacity-75">({sc.workingHours} ชม.)</span>
                            )}
                          </div>

                          {sc.description && (
                            <div className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                              {sc.description}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 flex flex-col items-end">
                        <span className="text-[9px] px-1 py-0.2 rounded font-mono font-bold bg-slate-700/40 text-slate-300">
                          {sc.department}
                        </span>
                      </div>
                    </div>

                    {/* Direct 1-Click Allowance Action Buttons on Card */}
                    <div className="pt-2 border-t border-slate-700/30 flex items-center justify-between gap-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() => onApplyShift(sc.code, rangeOption)}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium transition cursor-pointer ${
                          isDark 
                            ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700' 
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300'
                        }`}
                        title={`เลือกกะปกติ: ${sc.code}`}
                      >
                        ปกติ ({sc.code})
                      </button>

                      <div className="flex items-center space-x-1">
                        <button
                          type="button"
                          onClick={() => onApplyShift(`${sc.code}-X`, rangeOption)}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition cursor-pointer"
                          title={`ใส่กะ ${sc.code} พร้อม Stand by Allowance 300฿ (${sc.code}-X)`}
                        >
                          + Standby (-X)
                        </button>

                        <button
                          type="button"
                          onClick={() => onApplyShift(`${sc.code}-ET`, rangeOption)}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition cursor-pointer"
                          title={`ใส่กะ ${sc.code} พร้อม Emergency Allowance 300฿ (${sc.code}-ET)`}
                        >
                          + Emergency (-ET)
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer: Batch Range Selection (นำไปใช้เป็นช่วง) */}
        <div className={`p-3 sm:p-4 border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
          isDark ? 'bg-[#0f1722] border-[#203244]' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-slate-400 font-semibold text-[11px] shrink-0">
              นำไปใช้กับ:
            </span>
            <div className="flex items-center gap-1 flex-wrap">
              <button
                type="button"
                onClick={() => setRangeOption('single')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                  rangeOption === 'single'
                    ? 'bg-teal-600 text-white font-bold'
                    : isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                เฉพาะวันนี้ (1 วัน)
              </button>
              <button
                type="button"
                onClick={() => setRangeOption('weekday')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                  rangeOption === 'weekday'
                    ? 'bg-teal-600 text-white font-bold'
                    : isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-700'
                }`}
                title="ใช้กะนี้กับวันจันทร์-ศุกร์ ในสัปดาห์นี้"
              >
                ทั้งสัปดาห์ (จ.-ศ.)
              </button>
              <button
                type="button"
                onClick={() => setRangeOption('next7')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                  rangeOption === 'next7'
                    ? 'bg-teal-600 text-white font-bold'
                    : isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-700'
                }`}
                title="ใช้กะนี้กับ 7 วันถัดไปนับจากวันนี้"
              >
                7 วันถัดไป
              </button>
              <button
                type="button"
                onClick={() => setRangeOption('endOfMonth')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                  rangeOption === 'endOfMonth'
                    ? 'bg-teal-600 text-white font-bold'
                    : isDark ? 'bg-slate-800 text-slate-400 hover:text-white' : 'bg-slate-200 text-slate-700'
                }`}
                title="ใช้กะนี้จนถึงวันสิ้นสุดของเดือนนี้"
              >
                ถึงสิ้นเดือน
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className={`px-3 py-1.5 rounded text-xs font-medium border transition cursor-pointer ${
                isDark 
                  ? 'border-slate-700 text-slate-300 hover:bg-slate-800' 
                  : 'border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              ยกเลิก (ESC)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
