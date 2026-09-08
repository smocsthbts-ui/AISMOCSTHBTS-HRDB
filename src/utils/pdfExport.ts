import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TimeSheetSummary } from '../types';

/**
 * Generate official Siemens-standard TimeSheet PDF
 */
export function exportTimeSheetsToPDF(
  summaries: TimeSheetSummary[],
  titlePrefix = 'Siemens_TimeSheet'
) {
  if (!summaries || summaries.length === 0) return;

  // Create landscape A4 document
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  summaries.forEach((summary, pageIndex) => {
    if (pageIndex > 0) {
      doc.addPage('a4', 'landscape');
    }

    const { employee, monthYear, rows } = summary;

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

    const body = rows.map(r => {
      const isWeekendOrHoliday = r.dayOfWeek === 'Sat' || r.dayOfWeek === 'Sun' || r.shiftCode === 'H' || r.shiftCode === 'OFF';
      return [
        r.dayString,
        r.shiftCode || '',
        r.shiftIn || '',
        r.realTime1In || '',
        r.realTime1Out || '',
        r.diff1 || '',
        r.late !== '00:00' ? r.late : '',
        r.realTime2In || '',
        r.realTime2Out || '',
        r.diff2 || '',
        r.totalWorkHours ? r.totalWorkHours.toFixed(0) : '0',
        r.ot1_5 ? r.ot1_5.toFixed(0) : '0',
        r.ot3_0 ? r.ot3_0.toFixed(0) : '0',
        r.standbyAllowance ? String(r.standbyAllowance) : '0',
        r.emergencyAllowance ? String(r.emergencyAllowance) : '0',
        r.codeLeave || '',
        r.remark || ''
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
        summary.totalWorkHours.toFixed(0),
        summary.totalOT1_5.toFixed(0),
        summary.totalOT3_0.toFixed(0),
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
      theme: 'grid',
      styles: {
        fontSize: 6.5,
        cellPadding: 0.9,
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
        0: { cellWidth: 24, fontStyle: 'bold' }, // Date
        1: { cellWidth: 10, halign: 'center' },  // Shift Code
        2: { cellWidth: 12, halign: 'center' },  // Shift In
        3: { cellWidth: 12, halign: 'center' },  // Real Time I In
        4: { cellWidth: 12, halign: 'center' },  // Real Time I Out
        5: { cellWidth: 14, halign: 'center' },  // Diff I
        6: { cellWidth: 12, halign: 'center' },  // Late
        7: { cellWidth: 12, halign: 'center' },  // Real Time II In
        8: { cellWidth: 12, halign: 'center' },  // Real Time II Out
        9: { cellWidth: 14, halign: 'center' },  // Diff II
        10: { cellWidth: 12, halign: 'center' }, // Total
        11: { cellWidth: 12, halign: 'center' }, // OT 1.5
        12: { cellWidth: 12, halign: 'center' }, // OT 3.0
        13: { cellWidth: 16, halign: 'center' }, // Standby
        14: { cellWidth: 16, halign: 'center' }, // Emergency
        15: { cellWidth: 12, halign: 'center' }, // Leave
        16: { cellWidth: 'auto', halign: 'left' } // Remark
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
    const finalY = (doc as any).lastAutoTable?.finalY || 178;

    // Remark Legend box
    doc.setFontSize(6.5);
    doc.setDrawColor(60, 70, 80);
    doc.setLineWidth(0.2);
    doc.rect(14, finalY + 2, 269, 8);

    doc.text(
      'Remark : A-Annual Leave, C-Casual Leave, S-Sick Leave, O-Other Leave / X-Forgot to use the Card, Y-Forgot to bring the Card, O-Others',
      16,
      finalY + 7
    );

    // Signatures
    const sigY = finalY + 18;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');

    // Originator signature line
    doc.line(130, sigY, 190, sigY);
    doc.text('Signature Originator/Date', 160, sigY + 4, { align: 'center' });

    // Approver signature line
    doc.line(220, sigY, 280, sigY);
    doc.text('Approval Signature/Date', 250, sigY + 4, { align: 'center' });
  });

  // Save the PDF
  const filename = `${titlePrefix}_${summaries.length === 1 ? summaries[0].empNo : 'Batch'}_${Date.now()}.pdf`;
  doc.save(filename);
}
