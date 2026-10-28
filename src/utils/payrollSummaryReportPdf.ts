import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TimeSheetSummary } from '../types';
import { registerThaiFont } from './thaiFont';
import { isMLRDepartment, filterPayrollEligibleSummaries } from './fileParser';

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Format "2026-09" to "September-2026" matching the Siemens official report format
 */
export function formatMonthYearHeader(monthYear: string): string {
  if (!monthYear) return '';
  const parts = monthYear.trim().split('-');
  if (parts.length === 2) {
    const y = parts[0];
    const m = parseInt(parts[1], 10);
    if (m >= 1 && m <= 12) {
      return `${MONTH_NAMES_EN[m - 1]}-${y}`;
    }
  }
  return monthYear;
}

/**
 * Number formatters matching the official report in image.png
 */
function formatHours(val: number): string {
  return Number(val || 0).toFixed(2);
}

function formatMoney(val: number): string {
  return Number(val || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export interface PayrollSummaryPDFOptions {
  summaries: TimeSheetSummary[];
  monthYear: string;
  scopeType: 'all_except_mlr' | 'mlr_only' | 'all' | 'custom';
  subTitle?: string;
  division?: string;
  fileName?: string;
}

/**
 * Draw Siemens standard header on a given page
 */
function drawPageHeader(
  doc: jsPDF,
  monthYear: string,
  division: string,
  scopeLabel?: string
) {
  const pageWidth = 297;
  const marginX = 12;
  const contentWidth = pageWidth - marginX * 2; // 273mm

  // 1. SIEMENS Brand
  doc.setFont('Sarabun', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text('SIEMENS', marginX, 13);

  // 2. Report Title: Time Sheet Summary Report  /  Month-Year
  doc.setFontSize(13);
  doc.setFont('Sarabun', 'bold');
  const monthDisplay = formatMonthYearHeader(monthYear);
  const mainTitle = `Time Sheet Summary Report  /   ${monthDisplay}`;
  doc.text(mainTitle, pageWidth / 2, 13, { align: 'center' });

  // Optional Scope indicator below title if specified
  if (scopeLabel) {
    doc.setFontSize(8.5);
    doc.setFont('Sarabun', 'bold');
    doc.setTextColor(0, 100, 110);
    doc.text(`[ ${scopeLabel} ]`, pageWidth / 2, 17, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }

  // 3. Division on the right: MO CS BTS
  doc.setFontSize(14);
  doc.setFont('Sarabun', 'bold');
  doc.text(division || 'MO CS BTS', pageWidth - marginX, 13, { align: 'right' });

  // 4. Black Divider Line
  const lineY = scopeLabel ? 18.5 : 15.5;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.7);
  doc.line(marginX, lineY, marginX + contentWidth, lineY);
}

/**
 * Draw Enclosed 3-Column Signature Box exactly matching the official sample
 */
function drawSignatureBox(doc: jsPDF, boxY: number) {
  const marginX = 12;
  const boxWidth = 273;
  const boxHeight = 22;

  // Outer border box
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.rect(marginX, boxY, boxWidth, boxHeight);

  // 3 Columns inside box
  const colWidth = boxWidth / 3;
  const lineY = boxY + 13;

  doc.setFont('Sarabun', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  doc.setLineWidth(0.3);

  // Column 1: Prepared by / Date
  const col1Center = marginX + colWidth * 0.5;
  doc.line(col1Center - 32, lineY, col1Center + 32, lineY);
  doc.text('Prepared by / Date', col1Center, boxY + 18, { align: 'center' });

  // Column 2: Checked by / Date
  const col2Center = marginX + colWidth * 1.5;
  doc.line(col2Center - 32, lineY, col2Center + 32, lineY);
  doc.text('Checked by / Date', col2Center, boxY + 18, { align: 'center' });

  // Column 3: Approval Signature / Date
  const col3Center = marginX + colWidth * 2.5;
  doc.line(col3Center - 38, lineY, col3Center + 38, lineY);
  doc.text('Approval Signature / Date', col3Center, boxY + 18, { align: 'center' });
}

/**
 * Core function to generate and download official Payroll Summary Report PDF
 * Strictly adheres to the Siemens BTS layout shown in image.png
 */
export async function generatePayrollSummaryReportPDF(options: PayrollSummaryPDFOptions): Promise<boolean> {
  const {
    summaries,
    monthYear,
    scopeType,
    subTitle,
    division = 'MO CS BTS',
    fileName
  } = options;

  // Filter only employees with extra income (OT or Allowances)
  const eligibleSummaries = filterPayrollEligibleSummaries(summaries);

  if (eligibleSummaries.length === 0) {
    return false;
  }

  // Sort by Department, then by EmpNo
  const sortedSummaries = [...eligibleSummaries].sort((a, b) => {
    const deptA = (a.employee?.department || '').toUpperCase();
    const deptB = (b.employee?.department || '').toUpperCase();
    if (deptA !== deptB) return deptA.localeCompare(deptB);
    const empNoA = (a.employee?.empNo || a.empNo || '').toUpperCase();
    const empNoB = (b.employee?.empNo || b.empNo || '').toUpperCase();
    return empNoA.localeCompare(empNoB, undefined, { numeric: true });
  });

  // Create Landscape A4 jsPDF document
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  // Register Sarabun Thai font for Unicode support
  registerThaiFont(doc);
  doc.setFont('Sarabun', 'normal');

  const scopeLabel = subTitle || (
    scopeType === 'all_except_mlr'
      ? 'แผนกทั้งหมดยกเว้น MLR (All Departments except MLR)'
      : scopeType === 'mlr_only'
      ? 'เฉพาะแผนก MLR (MLR Department Only)'
      : scopeType === 'all'
      ? 'ทุกแผนก (All Departments)'
      : ''
  );

  // Draw header for page 1
  drawPageHeader(doc, monthYear, division, scopeLabel);

  // Compute Grand Totals
  let grandTotalOT = 0;
  let grandOT1_5 = 0;
  let grandOT2_0 = 0;
  let grandOT3_0 = 0;
  let grandMeal = 0;
  let grandStandby = 0;
  let grandEmergency = 0;
  let grandTotalAllowance = 0;

  // Build Table Body Rows
  const bodyRows = sortedSummaries.map(s => {
    const empNoRaw = s.employee?.empNo || s.empNo || '';
    const empNoDigits = empNoRaw.replace(/\D/g, '');
    const empNoFormatted = empNoDigits && empNoDigits.length <= 4 
      ? empNoDigits.padStart(4, '0') 
      : empNoRaw;

    const dept = s.employee?.department || '';
    const firstName = s.employee?.firstName || '';
    const lastName = s.employee?.familyName || '';

    const ot1_5 = Number(s.totalOT1_5 || 0);
    const ot2_0 = Number((s as any).totalOT2_0 || 0);
    const ot3_0 = Number(s.totalOT3_0 || 0);
    const ot1_0 = Number((s as any).totalOT1_0 || 0);
    const totalOT = Number((ot1_5 + ot2_0 + ot3_0 + ot1_0).toFixed(2));

    const meal = Number((s as any).totalMealAllowance || 0);
    const standby = Number(s.totalStandby || 0);
    const emergency = Number(s.totalEmergency || 0);
    const totalAllowance = Number((meal + standby + emergency).toFixed(2));

    grandTotalOT += totalOT;
    grandOT1_5 += ot1_5;
    grandOT2_0 += ot2_0;
    grandOT3_0 += ot3_0;
    grandMeal += meal;
    grandStandby += standby;
    grandEmergency += emergency;
    grandTotalAllowance += totalAllowance;

    // Specific requirement: For PDF Summary Report, Remark column is left blank (no data populated)
    const remark = '';

    return [
      empNoFormatted,
      dept,
      firstName,
      lastName,
      formatHours(totalOT),
      formatHours(ot1_5),
      formatHours(ot2_0),
      formatHours(ot3_0),
      formatMoney(meal),
      formatMoney(standby),
      formatMoney(emergency),
      formatMoney(totalAllowance),
      remark
    ];
  });

  // Two-tier Table Header exactly matching image.png
  const head = [
    [
      { content: 'Empno.', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Dep.', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Firstname', rowSpan: 2, styles: { halign: 'left' as const, valign: 'middle' as const } },
      { content: 'Lastname', rowSpan: 2, styles: { halign: 'left' as const, valign: 'middle' as const } },
      { content: 'OT', colSpan: 4, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Meal\nAllowance', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Stand by\nAllowance', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Emergency\nAllowance', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Total\nAllowance', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'Remark', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
    ],
    [
      { content: 'Total', styles: { halign: 'center' as const } },
      { content: 'OT 1.5', styles: { halign: 'center' as const } },
      { content: 'OT 2.0', styles: { halign: 'center' as const } },
      { content: 'OT 3.0', styles: { halign: 'center' as const } },
    ]
  ];

  // Footer / Total Row exactly matching image.png
  const foot = [
    [
      { content: 'Total', colSpan: 4, styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      { content: formatHours(grandTotalOT), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      { content: formatHours(grandOT1_5), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      { content: formatHours(grandOT2_0), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      { content: formatHours(grandOT3_0), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      { content: formatMoney(grandMeal), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      { content: formatMoney(grandStandby), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      { content: formatMoney(grandEmergency), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      { content: formatMoney(grandTotalAllowance), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      { content: '', styles: { halign: 'center' as const } }
    ]
  ];

  const startY = scopeLabel ? 20.5 : 18;

  autoTable(doc, {
    head,
    body: bodyRows,
    foot,
    startY,
    margin: { left: 12, right: 12, top: startY, bottom: 28 },
    theme: 'plain',
    styles: {
      font: 'Sarabun',
      fontSize: 7.5,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      cellPadding: { top: 1.2, bottom: 1.2, left: 1.5, right: 1.5 },
    },
    headStyles: {
      font: 'Sarabun',
      fontStyle: 'bold',
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.35,
      valign: 'middle',
    },
    footStyles: {
      font: 'Sarabun',
      fontStyle: 'bold',
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.35,
    },
    columnStyles: {
      0: { cellWidth: 16, halign: 'center' }, // Empno.
      1: { cellWidth: 16, halign: 'center' }, // Dep.
      2: { cellWidth: 32, halign: 'left' },   // Firstname
      3: { cellWidth: 34, halign: 'left' },   // Lastname
      4: { cellWidth: 18, halign: 'right' },  // Total OT
      5: { cellWidth: 16, halign: 'right' },  // OT 1.5
      6: { cellWidth: 16, halign: 'right' },  // OT 2.0
      7: { cellWidth: 16, halign: 'right' },  // OT 3.0
      8: { cellWidth: 20, halign: 'right' },  // Meal Allowance
      9: { cellWidth: 23, halign: 'right' },  // Stand by Allowance
      10: { cellWidth: 24, halign: 'right' }, // Emergency Allowance
      11: { cellWidth: 24, halign: 'right' }, // Total Allowance
      12: { cellWidth: 24, halign: 'left' },  // Remark
    },
    didDrawPage: (data) => {
      // Re-draw header on pages 2+
      if (data.pageNumber > 1) {
        drawPageHeader(doc, monthYear, division, scopeLabel);
      }

      // Page numbers at bottom right
      doc.setFontSize(7);
      doc.setFont('Sarabun', 'normal');
      doc.setTextColor(100, 100, 100);
      const pageStr = `Page ${data.pageNumber}`;
      doc.text(pageStr, 285, 205, { align: 'right' });
    }
  });

  // Check where the table finished
  const finalY = (doc as any).lastAutoTable?.finalY || 160;

  // Signature box requires ~24mm height. If page exceeds 178mm, add a clean final page
  if (finalY + 25 > 195) {
    doc.addPage('a4', 'landscape');
    drawPageHeader(doc, monthYear, division, scopeLabel);
    drawSignatureBox(doc, 30);
  } else {
    // Draw directly below table, with comfortable spacing
    const sigY = Math.max(finalY + 4, 172);
    drawSignatureBox(doc, sigY);
  }

  // Save the generated PDF
  const defaultFileName = fileName || `Siemens_TimeSheet_Summary_Report_${scopeType}_${monthYear}.pdf`;
  doc.save(defaultFileName);

  return true;
}

/**
 * Dedicated export for All Departments except MLR
 */
export async function exportAllExceptMLRPayrollPDF(
  allSummaries: TimeSheetSummary[],
  monthYear: string,
  division?: string
): Promise<boolean> {
  const nonMLR = allSummaries.filter(s => !isMLRDepartment(s.employee?.department));
  return await generatePayrollSummaryReportPDF({
    summaries: nonMLR,
    monthYear,
    scopeType: 'all_except_mlr',
    subTitle: 'แผนกทั้งหมดยกเว้น MLR (All Departments except MLR)',
    division,
    fileName: `Siemens_TimeSheet_Summary_Report_AllExceptMLR_${monthYear}.pdf`
  });
}

/**
 * Dedicated export for MLR department only
 */
export async function exportMLROnlyPayrollPDF(
  allSummaries: TimeSheetSummary[],
  monthYear: string,
  division?: string
): Promise<boolean> {
  const mlr = allSummaries.filter(s => isMLRDepartment(s.employee?.department));
  return await generatePayrollSummaryReportPDF({
    summaries: mlr,
    monthYear,
    scopeType: 'mlr_only',
    subTitle: 'เฉพาะแผนก MLR (MLR Department Only)',
    division,
    fileName: `Siemens_TimeSheet_Summary_Report_MLR_${monthYear}.pdf`
  });
}

/**
 * Trigger both separated PDFs sequentially (All Except MLR + MLR)
 */
export async function exportBothSeparatedPayrollPDF(
  allSummaries: TimeSheetSummary[],
  monthYear: string,
  division?: string
): Promise<{ nonMLROk: boolean; mlrOk: boolean }> {
  // 1. Export Non-MLR
  const nonMLROk = await exportAllExceptMLRPayrollPDF(allSummaries, monthYear, division);
  // Wait 700ms so browser downloads cleanly without blocking popup blocker
  await new Promise(r => setTimeout(r, 700));
  // 2. Export MLR
  const mlrOk = await exportMLROnlyPayrollPDF(allSummaries, monthYear, division);
  return { nonMLROk, mlrOk };
}
