import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar, History } from 'lucide-react';

interface MonthYearFilterProps {
  selectedMonthYear: string; // Format: "YYYY-MM"
  onChange: (monthYear: string) => void;
  theme: 'dark' | 'light';
  label?: string;
  idPrefix?: string;
}

const MONTH_NAMES_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
  'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
  'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

const MONTH_NAMES_EN = [
  'Jan', 'Feb', 'Mar', 'Apr',
  'May', 'Jun', 'Jul', 'Aug',
  'Sep', 'Oct', 'Nov', 'Dec'
];

export const MonthYearFilter: React.FC<MonthYearFilterProps> = ({
  selectedMonthYear,
  onChange,
  theme,
  label = 'เดือน-ปี (ดูย้อนหลัง):',
  idPrefix = 'my-filter',
}) => {
  const isDark = theme === 'dark';

  // Parse current year & month
  const [currentYear, currentMonth] = useMemo(() => {
    const parts = (selectedMonthYear || '2026-05').split('-');
    return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
  }, [selectedMonthYear]);

  // Limit future options to strictly 12 months in advance from current date (or next year)
  const maxFutureVal = useMemo(() => {
    const now = new Date();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth() + 1;
    const maxFutureObj = new Date(nowYear, nowMonth - 1 + 12, 1);
    const maxFutureYear = maxFutureObj.getFullYear();
    const maxFutureMonth = maxFutureObj.getMonth() + 1;
    return `${maxFutureYear}-${String(maxFutureMonth).padStart(2, '0')}`;
  }, []);

  // Generate dynamic list of months covering past years down to 2024 and max 12 months in advance (next year)
  const monthOptions = useMemo(() => {
    const list: { value: string; label: string; year: number; month: number }[] = [];
    const maxFutureParts = maxFutureVal.split('-');
    const maxFutureYear = parseInt(maxFutureParts[0], 10);

    const maxYear = Math.max(maxFutureYear, currentYear);
    const minYear = 2024;

    for (let y = maxYear; y >= minYear; y--) {
      for (let m = 12; m >= 1; m--) {
        const mStr = String(m).padStart(2, '0');
        const value = `${y}-${mStr}`;

        // Limit future options to max 12 months in advance from today
        // (unless it matches the currently selected month)
        if (value > maxFutureVal && value !== selectedMonthYear) {
          continue;
        }

        const thName = MONTH_NAMES_TH[m - 1];
        const enName = MONTH_NAMES_EN[m - 1];
        const thaiYear = y + 543;
        list.push({
          value,
          label: `${value} • ${thName} ${thaiYear} (${enName} ${y})`,
          year: y,
          month: m,
        });
      }
    }
    // If selectedMonthYear is outside this range, prepend it
    if (!list.some(item => item.value === selectedMonthYear)) {
      const thName = MONTH_NAMES_TH[currentMonth - 1] || '';
      const thaiYear = currentYear + 543;
      list.unshift({
        value: selectedMonthYear,
        label: `${selectedMonthYear} • ${thName} ${thaiYear} (${currentYear})`,
        year: currentYear,
        month: currentMonth,
      });
    }
    return list;
  }, [selectedMonthYear, currentYear, currentMonth, maxFutureVal]);

  // Handle previous month (ดูย้อนหลัง)
  const handlePrevMonth = () => {
    let newYear = currentYear;
    let newMonth = currentMonth - 1;
    if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    onChange(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  // Handle next month (จำกัดล่วงหน้าไม่เกิน 12 เดือน)
  const handleNextMonth = () => {
    let newYear = currentYear;
    let newMonth = currentMonth + 1;
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }
    const nextVal = `${newYear}-${String(newMonth).padStart(2, '0')}`;
    if (nextVal > maxFutureVal && nextVal !== selectedMonthYear) {
      return;
    }
    onChange(nextVal);
  };

  // Check if viewing historical period (before 2026-05)
  const isHistorical = selectedMonthYear < '2026-05';

  return (
    <div className="flex items-center space-x-1.5 shrink-0">
      <div className="flex items-center space-x-1">
        <div className="p-1 rounded bg-teal-500/10 text-teal-400">
          <Calendar className="w-3.5 h-3.5" />
        </div>
        {label && (
          <label 
            htmlFor={`${idPrefix}-select`}
            className="text-xs font-semibold text-slate-300 whitespace-nowrap hidden sm:inline"
          >
            {label}
          </label>
        )}
      </div>

      <div className="inline-flex items-center rounded border overflow-hidden shadow-xs">
        {/* Step backward (Previous month / ดูย้อนหลัง) */}
        <button
          type="button"
          onClick={handlePrevMonth}
          title="ดูเดือนก่อนหน้า (ย้อนหลัง 1 เดือน)"
          className={`px-1.5 py-1.5 border-r transition flex items-center justify-center ${
            isDark 
              ? 'bg-[#14202c] border-[#273a4e] text-slate-300 hover:text-white hover:bg-[#1a2838]' 
              : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        {/* Dropdown Select with formatted month names */}
        <select
          id={`${idPrefix}-select`}
          aria-label="เลือกเดือน-ปีเพื่อดูย้อนหลัง"
          value={selectedMonthYear}
          onChange={e => onChange(e.target.value)}
          className={`px-2.5 py-1.5 text-xs font-medium cursor-pointer outline-none transition min-w-[170px] ${
            isDark 
              ? 'bg-[#14202c] text-white border-0 focus:ring-1 focus:ring-[#00e5e5]' 
              : 'bg-white text-slate-900 border-0 focus:ring-1 focus:ring-[#008b99]'
          }`}
        >
          {monthOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Step forward (Next month - จำกัดล่วงหน้า 12 เดือน) */}
        <button
          type="button"
          onClick={handleNextMonth}
          disabled={selectedMonthYear >= maxFutureVal}
          title={selectedMonthYear >= maxFutureVal ? "จำกัดการแสดงผลล่วงหน้าสูงสุด 12 เดือน (หรือปีถัดไป)" : "ดูเดือนถัดไป"}
          className={`px-1.5 py-1.5 border-l transition flex items-center justify-center ${
            selectedMonthYear >= maxFutureVal
              ? 'opacity-40 cursor-not-allowed bg-slate-800/40 text-slate-500'
              : isDark 
                ? 'bg-[#14202c] border-[#273a4e] text-slate-300 hover:text-white hover:bg-[#1a2838]' 
                : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Direct HTML month picker for arbitrary jump */}
      <input
        type="month"
        id={`${idPrefix}-input-native`}
        title="เลือกเดือน-ปีโดยตรงจากปฏิทิน"
        aria-label="เลือกเดือน-ปีจากปฏิทิน"
        max={maxFutureVal}
        value={selectedMonthYear}
        onChange={e => {
          if (e.target.value) {
            const chosen = e.target.value;
            if (chosen > maxFutureVal) {
              onChange(maxFutureVal);
            } else {
              onChange(chosen);
            }
          }
        }}
        className={`w-7 h-7 p-1 rounded border cursor-pointer text-xs transition ${
          isDark 
            ? 'bg-[#14202c] border-[#273a4e] text-teal-400 hover:border-teal-400' 
            : 'bg-white border-slate-300 text-teal-600 hover:border-teal-600'
        }`}
      />

      {/* Historical indicator badge */}
      {isHistorical && (
        <span 
          title="กำลังดูข้อมูลประวัติย้อนหลัง"
          className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1 whitespace-nowrap"
        >
          <History className="w-2.5 h-2.5" />
          ย้อนหลัง
        </span>
      )}
    </div>
  );
};
