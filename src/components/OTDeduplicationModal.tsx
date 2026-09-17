import React, { useState, useMemo } from 'react';
import { 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Search, 
  Filter, 
  X, 
  Clock, 
  ArrowRight, 
  Users, 
  FileSpreadsheet,
  Check
} from 'lucide-react';
import { OTMergeResult, OTMergeDetail } from '../utils/otManager';

interface OTDeduplicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: OTMergeResult | null;
  isDark: boolean;
  selectedMonthYear: string;
  selectedRate: 1.5 | 3.0 | 'ALL';
}

export const OTDeduplicationModal: React.FC<OTDeduplicationModalProps> = ({
  isOpen,
  onClose,
  result,
  isDark,
  selectedMonthYear,
  selectedRate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PREVENTED_DUPLICATE' | 'NEW_ADDED' | 'UPDATED_HOURS'>('ALL');

  if (!isOpen || !result) return null;

  const filteredDetails = useMemo(() => {
    return result.details.filter(d => {
      // Status filter
      if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchEmpNo = d.empNo.toLowerCase().includes(q);
        const matchGid = d.gid.toLowerCase().includes(q);
        const matchName = d.empName.toLowerCase().includes(q);
        const matchDept = d.department.toLowerCase().includes(q);
        const matchDate = d.date.toLowerCase().includes(q);
        const matchReason = d.reason.toLowerCase().includes(q);
        if (!matchEmpNo && !matchGid && !matchName && !matchDept && !matchDate && !matchReason) {
          return false;
        }
      }

      return true;
    });
  }, [result.details, statusFilter, searchQuery]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs overflow-y-auto">
      <div className={`w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden ${
        isDark ? 'bg-[#0f1923] border-[#25394d] text-white' : 'bg-white border-slate-300 text-slate-900'
      }`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${
          isDark ? 'bg-[#152434] border-[#223548]' : 'bg-slate-100 border-slate-200'
        }`}>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-teal-500/20 text-[#00e5e5] flex items-center justify-center border border-teal-500/30">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-bold text-base flex items-center gap-2">
                <span>สรุปผลการนำเข้าและป้องกันข้อมูลซ้ำ (OT Deduplication Report)</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-teal-500/20 text-[#00e5e5] border border-teal-500/30">
                  {selectedRate === 3.0 ? 'OT 3.0' : selectedRate === 1.5 ? 'OT 1.5' : 'All Rates'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                รอบเดือน: <span className="font-mono text-teal-300">{selectedMonthYear}</span> • 
                ระบบตรวจสอบข้อมูลรายบุคคลและรายวัน เพื่อป้องกันการบันทึกชั่วโมงทำงานซ้ำซ้อน
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Total In File */}
            <div className={`p-3 rounded-lg border ${
              isDark ? 'bg-[#142232] border-[#203346]' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="text-[11px] text-slate-400">รายการในไฟล์</div>
              <div className="text-xl font-bold font-mono text-slate-200 mt-0.5">
                {result.totalIncoming} <span className="text-xs font-normal text-slate-400">แถว</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-1">ไฟล์รายงาน Power BI</div>
            </div>

            {/* Prevented Duplicates */}
            <div className={`p-3 rounded-lg border ${
              isDark ? 'bg-amber-950/20 border-amber-500/30 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}>
              <div className="text-[11px] font-semibold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>ป้องกันข้อมูลซ้ำ</span>
              </div>
              <div className="text-xl font-bold font-mono mt-0.5">
                {result.duplicatePreventedCount} <span className="text-xs font-normal opacity-75">รายการ</span>
              </div>
              <div className="text-[10px] opacity-80 mt-1">ตรงกับข้อมูลเดิม (ไม่บันทึกซ้ำ)</div>
            </div>

            {/* New Added / Late Approvals */}
            <div className={`p-3 rounded-lg border ${
              isDark ? 'bg-teal-950/20 border-teal-500/30 text-teal-300' : 'bg-teal-50 border-teal-200 text-teal-800'
            }`}>
              <div className="text-[11px] font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
                <span>เพิ่มรายการใหม่</span>
              </div>
              <div className="text-xl font-bold font-mono mt-0.5">
                {result.addedCount} <span className="text-xs font-normal opacity-75">รายการ</span>
              </div>
              <div className="text-[10px] opacity-80 mt-1">รายการอนุมัติใหม่ / อนุมัติย้อนหลัง</div>
            </div>

            {/* Updated Hours */}
            <div className={`p-3 rounded-lg border ${
              isDark ? 'bg-blue-950/20 border-blue-500/30 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}>
              <div className="text-[11px] font-semibold flex items-center gap-1">
                <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                <span>อัปเดตชั่วโมง</span>
              </div>
              <div className="text-xl font-bold font-mono mt-0.5">
                {result.updatedCount} <span className="text-xs font-normal opacity-75">รายการ</span>
              </div>
              <div className="text-[10px] opacity-80 mt-1">ปรับปรุงข้อมูลล่าสุด</div>
            </div>
          </div>

          {/* Non-doubling hours verification banner */}
          <div className={`p-3.5 rounded-lg border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs ${
            isDark ? 'bg-[#122332] border-[#224458]' : 'bg-teal-50/70 border-teal-200'
          }`}>
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-teal-500/20 text-[#00e5e5] flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-slate-100 flex items-center gap-1.5">
                  <span>การตรวจสอบยอดชั่วโมงทำงานสุทธิ (Net Working Hours Reconciliation)</span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
                    VERIFIED
                  </span>
                </div>
                <div className="text-slate-400 text-[11px] mt-0.5">
                  ชั่วโมงรวมก่อนนำเข้า: <span className="font-mono font-bold text-slate-300">{result.totalHoursBefore.toFixed(1)} ชม.</span> 
                  {' → '} หลังนำเข้า: <span className="font-mono font-bold text-teal-300">{result.totalHoursAfter.toFixed(1)} ชม.</span>
                  {' '}(ส่วนต่างสุทธิ: <span className="font-mono font-bold text-[#00e5e5]">{result.netHoursDelta >= 0 ? `+${result.netHoursDelta.toFixed(1)}` : result.netHoursDelta.toFixed(1)} ชม.</span>)
                </div>
              </div>
            </div>
            <div className="text-[11px] text-teal-300 bg-teal-500/10 px-3 py-1.5 rounded border border-teal-500/20 whitespace-nowrap self-stretch sm:self-auto text-center font-medium">
              ✓ พนักงานที่เกี่ยวข้อง: {result.impactedEmployeeCount} คน
            </div>
          </div>

          {/* Filter Tabs & Search Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
            {/* Status Filter Tabs */}
            <div className="flex items-center space-x-1 overflow-x-auto pb-1 sm:pb-0">
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                  statusFilter === 'ALL'
                    ? 'bg-teal-500 text-white font-bold'
                    : isDark
                      ? 'bg-[#182635] text-slate-300 hover:bg-[#203244]'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                ทั้งหมด ({result.details.length})
              </button>
              <button
                onClick={() => setStatusFilter('PREVENTED_DUPLICATE')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap flex items-center space-x-1.5 ${
                  statusFilter === 'PREVENTED_DUPLICATE'
                    ? 'bg-amber-500 text-slate-900 font-bold'
                    : isDark
                      ? 'bg-[#182635] text-amber-400 hover:bg-[#203244]'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>ป้องกันซ้ำ ({result.duplicatePreventedCount})</span>
              </button>
              <button
                onClick={() => setStatusFilter('NEW_ADDED')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap flex items-center space-x-1.5 ${
                  statusFilter === 'NEW_ADDED'
                    ? 'bg-emerald-600 text-white font-bold'
                    : isDark
                      ? 'bg-[#182635] text-emerald-400 hover:bg-[#203244]'
                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>เพิ่มใหม่ ({result.addedCount})</span>
              </button>
              {result.updatedCount > 0 && (
                <button
                  onClick={() => setStatusFilter('UPDATED_HOURS')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap flex items-center space-x-1.5 ${
                    statusFilter === 'UPDATED_HOURS'
                      ? 'bg-blue-600 text-white font-bold'
                      : isDark
                        ? 'bg-[#182635] text-blue-400 hover:bg-[#203244]'
                        : 'bg-blue-50 text-blue-800 hover:bg-blue-100'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>อัปเดต ({result.updatedCount})</span>
                </button>
              )}
            </div>

            {/* Search Box */}
            <div className="relative min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="ค้นหา รหัส, ชื่อ, วันที่, เหตุผล..."
                className={`w-full pl-8 pr-3 py-1.5 rounded-lg text-xs border ${
                  isDark
                    ? 'bg-[#142232] border-[#223548] text-white placeholder-slate-500 focus:border-[#00e5e5]'
                    : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-teal-600'
                } outline-hidden`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Details Table */}
          <div className={`rounded-lg border overflow-hidden ${
            isDark ? 'border-[#223548]' : 'border-slate-200'
          }`}>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className={`sticky top-0 z-10 text-[11px] uppercase tracking-wider font-semibold ${
                  isDark ? 'bg-[#142332] text-slate-400 border-b border-[#24374c]' : 'bg-slate-100 text-slate-600 border-b border-slate-200'
                }`}>
                  <tr>
                    <th className="py-2.5 px-3">สถานะตรวจสอบ</th>
                    <th className="py-2.5 px-3">พนักงาน</th>
                    <th className="py-2.5 px-3">วันที่</th>
                    <th className="py-2.5 px-3">อัตรา</th>
                    <th className="py-2.5 px-3 text-right">ชั่วโมงเดิม → ใหม่</th>
                    <th className="py-2.5 px-3">ช่วงเวลา</th>
                    <th className="py-2.5 px-3">เหตุผล / ชื่องาน</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-[#1e2f42]' : 'divide-slate-200'}`}>
                  {filteredDetails.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                        ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา
                      </td>
                    </tr>
                  ) : (
                    filteredDetails.map((item, idx) => (
                      <tr 
                        key={`${item.empNo}-${item.date}-${idx}`}
                        className={`transition ${
                          isDark 
                            ? 'hover:bg-[#152332] odd:bg-[#0c141d]/50' 
                            : 'hover:bg-slate-50 odd:bg-slate-50/50'
                        }`}
                      >
                        {/* Status */}
                        <td className="py-2 px-3 whitespace-nowrap">
                          {item.status === 'PREVENTED_DUPLICATE' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              <ShieldCheck className="w-3 h-3" />
                              <span>ป้องกันซ้ำ</span>
                            </span>
                          )}
                          {item.status === 'NEW_ADDED' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>อนุมัติใหม่</span>
                            </span>
                          )}
                          {item.status === 'UPDATED_HOURS' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                              <RefreshCw className="w-3 h-3" />
                              <span>อัปเดต</span>
                            </span>
                          )}
                        </td>

                        {/* Employee */}
                        <td className="py-2 px-3">
                          <div className="font-mono font-bold text-teal-300">
                            {item.empNo || item.gid}
                          </div>
                          {item.empName && (
                            <div className="text-[10px] text-slate-400 truncate max-w-[120px]">
                              {item.empName}
                            </div>
                          )}
                        </td>

                        {/* Date */}
                        <td className="py-2 px-3 whitespace-nowrap font-mono">
                          {item.date}
                        </td>

                        {/* Rate */}
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                            item.rate === 3.0
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                          }`}>
                            OT {item.rate}
                          </span>
                        </td>

                        {/* Hours */}
                        <td className="py-2 px-3 text-right whitespace-nowrap font-mono">
                          {item.status === 'PREVENTED_DUPLICATE' && (
                            <span className="font-bold text-slate-300">
                              {item.newHours} ชม. (คงเดิม)
                            </span>
                          )}
                          {item.status === 'NEW_ADDED' && (
                            <span className="font-bold text-emerald-400">
                              +{item.newHours} ชม.
                            </span>
                          )}
                          {item.status === 'UPDATED_HOURS' && (
                            <span className="font-bold text-blue-300">
                              {item.oldHours} → {item.newHours} ชม.
                            </span>
                          )}
                        </td>

                        {/* Time slot */}
                        <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px] text-slate-400">
                          {item.timeSlot && item.timeSlot !== '-' ? item.timeSlot : '17:30-20:30'}
                        </td>

                        {/* Reason */}
                        <td className="py-2 px-3 text-slate-300 max-w-[160px] truncate" title={item.reason}>
                          {item.reason || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className={`px-5 py-3.5 border-t flex flex-col sm:flex-row items-center justify-between gap-3 ${
          isDark ? 'bg-[#142332] border-[#223548]' : 'bg-slate-100 border-slate-200'
        }`}>
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Check className="w-4 h-4 text-[#00e5e5]" />
            <span>ข้อมูลได้รับการตรวจสอบและบันทึกลงใน Time Sheet ของพนักงานแต่ละคนเรียบร้อยแล้ว</span>
          </div>

          <button
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2 rounded-lg text-xs font-bold bg-[#008b99] hover:bg-[#00a3a6] text-white shadow transition"
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  );
};
