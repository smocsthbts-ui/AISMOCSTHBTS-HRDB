import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TimeSheetSummary } from '../types';

export interface PDFExportProgress {
  current: number;
  total: number;
  percent: number;
  currentEmpName: string;
  department: string;
  status: 'processing' | 'saving' | 'completed' | 'cancelled' | 'error';
}

/**
 * Generate official Siemens-standard TimeSheet PDF with async chunking & progress tracking.
 * Yields back to the browser event loop between pages to prevent UI freezing / "Page unresponsive" dialogs.
 */
export async function exportTimeSheetsToPDF(
  summaries: TimeSheetSummary[],
  titlePrefix = 'Siemens_TimeSheet',
  onProgress?: (progress: PDFExportProgress) => void,
  shouldCancel?: () => boolean
): Promise<boolean> {
  if (!summaries || summaries.length === 0) return false;

  // Create landscape A4 document
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const total = summaries.length;

  for (let pageIndex = 0; pageIndex < total; pageIndex++) {
    // Check for cancellation request
    if (shouldCancel && shouldCancel()) {
      onProgress?.({
        current: pageIndex,
        total,
        percent: Math.round((pageIndex / total) * 100),
        currentEmpName: '',
        department: '',
        status: 'cancelled',
      });
      return false;
    }

    const summary = summaries[pageIndex];
    const { employee, monthYear, rows } = summary;

    const empFullName = `${employee.firstName || ''} ${employee.familyName || ''}`.trim() || employee.empNo || 'พนักงาน';
    const empDisplay = `${empFullName} (${employee.empNo || employee.gid})`;

    // Notify progress update
    onProgress?.({
      current: pageIndex + 1,
      total,
      percent: Math.round(((pageIndex + 1) / total) * 100),
      currentEmpName: empDisplay,
      department: employee.department || '',
      status: 'processing',
    });

    // Yield control to the browser so UI updates, progress bar animates, and no unresponsive freeze occurs
    await new Promise(resolve => setTimeout(resolve, 8));

    if (pageIndex > 0) {
      doc.addPage('a4', 'landscape');
    }

    // Header Colors
    const siemensTeal = '#00646e';
    const darkGray = '#333333';

    // 1. Top Brand Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(siemensTeal);
    doc.text('SIEMENS', 14, 13);

    doc.setFontSize(14);
    doc.setTextColor(darkGray);
    doc.text('Time Sheet', 52, 13);

    // Warning note in red (as in Time Sheet.png)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(200, 30, 30);
    doc.text('Notice: Any manual adjustments must be crossed out (not erased) and counter-signed.', 95, 12.5);

    // Division in bold on the right
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text(employee.division || 'MO CS BTS', 280, 13, { align: 'right' });

    // Header divider line
    doc.setDrawColor(0, 100, 110);
    doc.setLineWidth(0.6);
    doc.line(14, 15, 283, 15);

    // 2. Metadata Grid (Boxed Header details)
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);

    const startY = 19;
    const lineHeight = 4.2;

    // Col 1
    doc.text(`Empno. / GID :  ${employee.empNo}  /  ${employee.gid}`, 14, startY);
    doc.text(`Division :  ${employee.division || 'MO CS BTS'}`, 14, startY + lineHeight);

    // Col 2
    doc.text(`Firstname :  ${employee.firstName}`, 80, startY);
    doc.text(`Shift Status :  ${employee.isShiftWorker ? 'Yes (Shift)' : 'No'}`, 80, startY + lineHeight);

    // Col 3
    doc.text(`Familyname :  ${employee.familyName}`, 140, startY);
    doc.text(`Function :  ${employee.functionTitle || '-'}`, 140, startY + lineHeight);

    // Col 4
    doc.text(`Department :  ${employee.department}`, 215, startY);
    doc.text(`Cost Center :  ${employee.costCenter || 'C93056'}`, 215, startY + lineHeight);

    // Month indicator badge
    doc.setFont('helvetica', 'bold');
    doc.text(`Period : ${monthYear}`, 280, startY, { align: 'right' });

    // 3. Main Timesheet Table
    // Multi-tier headers matching Time Sheet.png
    const head: any[] = [
      [
        { content: 'Date', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'Shift\nCode', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'Shift\nIn', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'Real Time I', colSpan: 2, styles: { halign: 'center' } },
        { content: 'Diff. I\n(H)', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'Late\n(H)', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'Real Time II', colSpan: 2, styles: { halign: 'center' } },
        { content: 'Diff. II\n(H)', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'Working Hours', colSpan: 3, styles: { halign: 'center' } },
        { content: 'Stand by\nAllowance', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'Emergency\nAllowance', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'Code\nLeave', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'Remark', rowSpan: 2, styles: { halign: 'left', valign: 'middle' } }
      ],
      [
        { content: 'In', styles: { halign: 'center' } },
        { content: 'Out', styles: { halign: 'center' } },
        { content: 'In', styles: { halign: 'center' } },
        { content: 'Out', styles: { halign: 'center' } },
        { content: 'Total', styles: { halign: 'center' } },
        { content: 'OT 1.5', styles: { halign: 'center' } },
        { content: 'OT 3.0', styles: { halign: 'center' } }
      ]
    ];

    const formatHours = (h: number | undefined | null): string => {
      if (!h || h === 0) return '0';
      return Number.isInteger(h) ? String(h) : h.toFixed(1);
    };

    const formatRemark = (remark: string | undefined | null): string => {
      if (!remark) return '';
      const clean = remark.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      // Prevent long remarks from distorting A4 layout by cleanly capping length with ellipsis
      return clean.length > 50 ? clean.substring(0, 47) + '...' : clean;
    };

    const body = rows.map(r => {
      return [
        r.dayString,
        r.shiftCode || '',
        r.shiftIn || '',
        r.realTime1In || '',
        r.realTime1Out || '',
        (r.realTime1In || r.realTime1Out) ? (r.diff1 || '') : '',
        (r.realTime1In || r.realTime1Out) && r.late !== '00:00' ? r.late : '',
        r.realTime2In || '',
        r.realTime2Out || '',
        (r.realTime2In || r.realTime2Out) ? (r.diff2 || '') : '',
        formatHours(r.totalWorkHours),
        formatHours(r.ot1_5),
        formatHours(r.ot3_0),
        r.standbyAllowance ? String(r.standbyAllowance) : '0',
        r.emergencyAllowance ? String(r.emergencyAllowance) : '0',
        r.codeLeave || '',
        formatRemark(r.remark)
      ];
    });

    // Summary bottom row
    const foot = [
      [
        'Total :',
        '',
        '',
        String(summary.totalWorkDays),
        '',
        summary.totalDiffTime,
        summary.totalLateTime,
        '',
        '',
        '',
        formatHours(summary.totalWorkHours),
        formatHours(summary.totalOT1_5),
        formatHours(summary.totalOT3_0),
        summary.totalStandby ? String(summary.totalStandby) : '0',
        summary.totalEmergency ? String(summary.totalEmergency) : '0',
        summary.totalLeaveDays ? String(summary.totalLeaveDays) : '0',
        ''
      ]
    ];

    autoTable(doc, {
      head,
      body,
      foot,
      startY: 28,
      margin: { left: 14, right: 14 },
      tableWidth: 269,
      theme: 'grid',
      styles: {
        fontSize: 6.5,
        cellPadding: 0.8,
        lineColor: [40, 50, 60],
        lineWidth: 0.15,
        textColor: [20, 20, 20],
      },
      headStyles: {
        fillColor: [240, 244, 248],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        lineWidth: 0.2,
      },
      footStyles: {
        fillColor: [230, 238, 244],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        lineWidth: 0.25,
      },
      columnStyles: {
        0: { cellWidth: 22, fontStyle: 'bold' }, // Date
        1: { cellWidth: 10, halign: 'center' },  // Shift Code
        2: { cellWidth: 12, halign: 'center' },  // Shift In
        3: { cellWidth: 12, halign: 'center' },  // Real Time I In
        4: { cellWidth: 12, halign: 'center' },  // Real Time I Out
        5: { cellWidth: 13, halign: 'center' },  // Diff I
        6: { cellWidth: 11, halign: 'center' },  // Late
        7: { cellWidth: 12, halign: 'center' },  // Real Time II In
        8: { cellWidth: 12, halign: 'center' },  // Real Time II Out
        9: { cellWidth: 13, halign: 'center' },  // Diff II
        10: { cellWidth: 11, halign: 'center' }, // Total
        11: { cellWidth: 11, halign: 'center' }, // OT 1.5
        12: { cellWidth: 11, halign: 'center' }, // OT 3.0
        13: { cellWidth: 16, halign: 'center' }, // Standby
        14: { cellWidth: 16, halign: 'center' }, // Emergency
        15: { cellWidth: 11, halign: 'center' }, // Leave
        16: { cellWidth: 64, halign: 'left', overflow: 'ellipsize' } // Remark (single line truncated with ... to guarantee perfect A4 layout)
      },
      didParseCell: function(data) {
        // Shading for weekends/holidays
        if (data.section === 'body') {
          const rowData = rows[data.row.index];
          if (rowData && (rowData.dayOfWeek === 'Sat' || rowData.dayOfWeek === 'Sun' || rowData.shiftCode === 'H' || rowData.shiftCode === 'OFF')) {
            data.cell.styles.fillColor = [228, 233, 238];
          }
        }
      }
    });

    // 4. Footer Note and Signatures
    // @ts-ignore
    const finalY = (doc as any).lastAutoTable?.finalY || 172;

    // Remark Legend box
    const legendY = Math.min(finalY + 1.5, 180);
    const legendHeight = 7;

    doc.setFontSize(6.2);
    doc.setDrawColor(60, 70, 80);
    doc.setLineWidth(0.2);
    doc.rect(14, legendY, 269, legendHeight);

    doc.text(
      'Remark : A-Annual Leave, C-Casual Leave, S-Sick Leave, O-Other Leave / X-Forgot to use the Card, Y-Forgot to bring the Card, O-Others',
      16,
      legendY + 4.5
    );

    // Signatures
    const sigY = Math.min(legendY + legendHeight + 8, 196);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');

    // Originator signature line
    doc.line(130, sigY, 190, sigY);
    doc.text('Signature Originator/Date', 160, sigY + 4, { align: 'center' });

    // Approver signature line
    doc.line(220, sigY, 280, sigY);
    doc.text('Approval Signature/Date', 250, sigY + 4, { align: 'center' });
  }

  // Notify saving status
  onProgress?.({
    current: total,
    total,
    percent: 100,
    currentEmpName: 'กำลังจัดเตรียมไฟล์และเริ่มดาวน์โหลด...',
    department: '',
    status: 'saving',
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  // Save the PDF
  const filename = `${titlePrefix}_${summaries.length === 1 ? summaries[0].empNo : 'Batch'}_${Date.now()}.pdf`;
  doc.save(filename);

  onProgress?.({
    current: total,
    total,
    percent: 100,
    currentEmpName: 'ดาวน์โหลดไฟล์เรียบร้อยแล้ว',
    department: '',
    status: 'completed',
  });

  return true;
}
