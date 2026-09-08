import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Employee, ShiftCode } from '../types';
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

  // Auto-focus search input when opened
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setActiveCategory('dept');
      setRangeOption('single');
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Top Most-used Favorites
  const quickFavorites = useMemo(() => {
    const favCodes = ['D', 'M', 'A', 'N', 'OFF', 'H'];
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
        const matchesCode = sc.code.toLowerCase().includes(q);
        const matchesName = sc.name.toLowerCase().includes(q);
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

        {/* Quick 1-Click Favorites Bar */}
        <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 overflow-x-auto ${
          isDark ? 'bg-[#182635] border-[#25394e]' : 'bg-slate-100/70 border-slate-200'
        }`}>
          <div className="flex items-center space-x-1.5 text-xs text-slate-400 shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-semibold text-slate-300 text-[11px]">กะด่วนยอดนิยม:</span>
          </div>

          <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
            {quickFavorites.map(fav => (
              <button
                key={fav.code}
                onClick={() => onApplyShift(fav.code, rangeOption)}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-bold transition hover:scale-105 active:scale-95 shadow-xs cursor-pointer ${
                  fav.code === currentShiftCode ? 'ring-2 ring-white ring-offset-1 ring-offset-[#14202c]' : ''
                }`}
                style={{ backgroundColor: fav.color, color: '#ffffff' }}
                title={`${fav.code}: ${fav.name} (${fav.startTime}-${fav.endTime}) คลิกเพื่อเปลี่ยนทันที`}
              >
                <span>{fav.code}</span>
                <span className="text-[10px] font-normal opacity-90 hidden sm:inline">
                  {fav.code === 'OFF' ? 'หยุด' : fav.startTime}
                </span>
              </button>
            ))}
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
              placeholder="พิมพ์ค้นหา Shift Code เช่น D, N, RS, 07:00 หรือชื่อกะ (เช้า, บ่าย, ดึก)..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
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
          {filteredShifts.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              ไม่พบ Shift Code ที่ตรงกับ &quot;{searchTerm}&quot;
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filteredShifts.map(sc => {
                const isSelected = sc.code === currentShiftCode;

                return (
                  <div
                    key={sc.code}
                    onClick={() => onApplyShift(sc.code, rangeOption)}
                    className={`p-2.5 rounded-lg border flex items-start justify-between gap-2.5 transition cursor-pointer ${
                      isSelected
                        ? isDark 
                          ? 'border-[#00e5e5] bg-teal-500/15 shadow-sm' 
                          : 'border-teal-500 bg-teal-50 shadow-sm'
                        : isDark
                          ? 'border-slate-800 bg-[#0f1722]/80 hover:border-slate-600 hover:bg-[#182635]'
                          : 'border-slate-200 bg-white hover:border-teal-400 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start space-x-2.5 min-w-0">
                      {/* Color Tag Badge */}
                      <span
                        className="w-8 h-8 rounded-lg text-xs font-mono font-bold text-white flex items-center justify-center shrink-0 shadow-xs"
                        style={{ backgroundColor: sc.color }}
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
