/**
 * Export.gs - PDF, CSV, and Excel export functionality.
 * Generates files in Google Drive and returns download URLs.
 */

/* ============================================================
   PDF Export
   ============================================================ */

/**
 * Generate a PDF report for a single employee/period.
 * Returns { fileId, url, fileName }
 */
function exportPdf(employeeId, periodKey, actorEmail) {
  var emp = getEmployeeById(employeeId);
  if (!emp) throw new Error('職員が見つかりません');
  var entries = getTimeEntries(employeeId, periodKey);
  var summary = calcPeriodSummary(entries, emp.hourlyWageYen, emp.commutePerDayYen);
  var range = getPeriodRange(periodKey);
  var settings = getAllSettings();
  var title = settings['PDF_TITLE'] || '勤務実績報告書';

  // Build HTML for PDF
  var html = '<html><head><meta charset="UTF-8">';
  html += '<style>';
  html += 'body { font-family: "Noto Sans JP", "Hiragino Sans", sans-serif; font-size: 10px; margin: 20px; }';
  html += 'h1 { text-align: center; font-size: 16px; margin-bottom: 5px; }';
  html += '.header-table { width: 100%; margin-bottom: 10px; font-size: 10px; }';
  html += '.header-table td { padding: 2px 8px; }';
  html += 'table.detail { width: 100%; border-collapse: collapse; font-size: 9px; margin-bottom: 10px; }';
  html += 'table.detail th, table.detail td { border: 1px solid #333; padding: 3px 6px; text-align: center; }';
  html += 'table.detail th { background: #e8e8e8; }';
  html += '.summary-table { width: 60%; margin: 10px auto; border-collapse: collapse; font-size: 10px; }';
  html += '.summary-table td { border: 1px solid #333; padding: 4px 10px; }';
  html += '.summary-table .label { background: #f0f0f0; font-weight: bold; width: 40%; }';
  html += '.stamp-area { margin-top: 20px; display: flex; justify-content: flex-end; }';
  html += '.stamp-box { border: 1px solid #333; width: 60px; height: 60px; text-align: center; margin-left: 10px; font-size: 8px; }';
  html += '.stamp-box .title { border-bottom: 1px solid #333; padding: 2px; background: #f0f0f0; }';
  html += '.footer { margin-top: 10px; font-size: 8px; color: #666; text-align: right; }';
  html += '</style></head><body>';

  // Title
  html += '<h1>' + escapeHtml_(title) + '</h1>';

  // Stamp area (right-aligned approval stamps)
  html += '<div style="text-align: right; margin-bottom: 10px;">';
  html += '<table style="display: inline-table; border-collapse: collapse;">';
  html += '<tr>';
  var route = getApprovalRoute(employeeId);
  // Add stamp boxes for each approval step + applicant
  var stampLabels = ['申請者'];
  route.forEach(function(r, i) { stampLabels.push('承認' + (i + 1)); });
  stampLabels.forEach(function(lbl) {
    html += '<td style="border: 1px solid #333; width: 55px; text-align: center;">';
    html += '<div style="border-bottom: 1px solid #333; padding: 1px; background: #f0f0f0; font-size: 8px;">' + lbl + '</div>';
    html += '<div style="height: 45px;"></div>';
    html += '</td>';
  });
  html += '</tr></table></div>';

  // Header info
  html += '<table class="header-table"><tr>';
  html += '<td><b>氏名:</b> ' + escapeHtml_(emp.name) + '</td>';
  html += '<td><b>所属:</b> ' + escapeHtml_(emp.dept) + '</td>';
  html += '</tr><tr>';
  html += '<td><b>対象期間:</b> ' + range.start + ' ~ ' + range.end + '</td>';
  html += '<td><b>時給:</b> ' + Number(emp.hourlyWageYen).toLocaleString() + '円</td>';
  html += '</tr><tr>';
  html += '<td><b>交通費単価:</b> ' + Number(emp.commutePerDayYen).toLocaleString() + '円/日</td>';
  html += '<td><b>作成日:</b> ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd') + '</td>';
  html += '</tr></table>';

  // Detail table
  html += '<table class="detail">';
  html += '<tr><th>日付</th><th>開始</th><th>終了</th><th>休憩(分)</th><th>勤務(分)</th></tr>';

  summary.dailyDetails.forEach(function(day) {
    day.slots.forEach(function(slot, idx) {
      html += '<tr>';
      if (idx === 0) {
        html += '<td rowspan="' + day.slots.length + '">' + day.workDate + '</td>';
      }
      html += '<td>' + slot.startTime + '</td>';
      html += '<td>' + slot.endTime + '</td>';
      html += '<td>' + slot.breakMin + '</td>';
      html += '<td>' + slot.workMinutes + '</td>';
      html += '</tr>';
    });
  });
  html += '</table>';

  // Summary table
  html += '<table class="summary-table">';
  html += '<tr><td class="label">出社日数</td><td>' + summary.workDays + '日</td></tr>';
  html += '<tr><td class="label">総勤務時間</td><td>' + formatMinutesHM(summary.totalWorkMinutes) + ' (' + summary.totalWorkMinutes + '分)</td></tr>';
  html += '<tr><td class="label">給与</td><td>' + summary.wageYen.toLocaleString() + '円</td></tr>';
  html += '<tr><td class="label">交通費</td><td>' + summary.commuteYen.toLocaleString() + '円 (' + summary.workDays + '日 × ' + Number(emp.commutePerDayYen).toLocaleString() + '円)</td></tr>';
  html += '<tr><td class="label">総支給額</td><td><b>' + summary.totalYen.toLocaleString() + '円</b></td></tr>';
  html += '</table>';

  // Footer
  html += '<div class="footer">出力日時: ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss') + '</div>';
  html += '</body></html>';

  // Create PDF blob
  var blob = HtmlService.createHtmlOutput(html).getBlob()
    .setName(emp.name + '_' + periodKey + '_勤務報告.pdf')
    .getAs('application/pdf');

  var file = DriveApp.createFile(blob);
  var fileId = file.getId();

  // Audit
  audit({
    actorEmail: actorEmail,
    targetType: 'Export',
    targetId:   employeeId + '/' + periodKey,
    action:     'EXPORT_PDF',
    after:      { fileId: fileId, fileName: file.getName() }
  });

  return { fileId: fileId, url: file.getUrl(), fileName: file.getName() };
}

/* ============================================================
   CSV Export
   ============================================================ */

/**
 * Export monthly summary CSV (1 row per employee).
 */
function exportCsvSummary(periodKey, actorEmail, charset) {
  charset = charset || getSetting('CSV_CHARSET') || 'UTF-8';

  var subs = getSubmissionsByPeriod(periodKey);
  var rows = [['職員ID', '氏名', '所属', '出社日数', '総勤務分', '時給', '給与', '交通費単価', '交通費', '総支給']];

  subs.forEach(function(sub) {
    var emp = getEmployeeById(sub.employeeId);
    if (!emp) return;
    rows.push([
      sub.employeeId, emp.name, emp.dept,
      sub.workDays, sub.totalWorkMinutes, emp.hourlyWageYen,
      sub.wageYen, emp.commutePerDayYen, sub.commuteYen, sub.totalYen
    ]);
  });

  var csv = rows.map(function(r) {
    return r.map(function(c) {
      var s = String(c === undefined || c === null ? '' : c);
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',');
  }).join('\r\n');

  var blob;
  if (charset === 'Shift_JIS') {
    // GAS does not natively support Shift_JIS encoding,
    // so we create UTF-8 and note the limitation.
    // For true Shift_JIS, an external library or conversion service would be needed.
    blob = Utilities.newBlob('').setDataFromString(csv, 'UTF-8')
      .setName('summary_' + periodKey + '.csv')
      .setContentType('text/csv');
  } else {
    // BOM for Excel compatibility
    var bom = '\uFEFF';
    blob = Utilities.newBlob('').setDataFromString(bom + csv, 'UTF-8')
      .setName('summary_' + periodKey + '.csv')
      .setContentType('text/csv');
  }

  var file = DriveApp.createFile(blob);

  audit({
    actorEmail: actorEmail,
    targetType: 'Export',
    targetId:   periodKey,
    action:     'EXPORT_CSV_SUMMARY',
    after:      { fileId: file.getId(), charset: charset }
  });

  return { fileId: file.getId(), url: file.getUrl(), fileName: file.getName() };
}

/**
 * Export detail CSV (1 row per time entry slot).
 */
function exportCsvDetail(periodKey, actorEmail, charset) {
  charset = charset || getSetting('CSV_CHARSET') || 'UTF-8';

  // Gather all entries for the period
  var allEntries = getSheetData_('TimeEntries').filter(function(e) {
    return e.periodKey === periodKey;
  });

  var rows = [['職員ID', '氏名', '所属', '出社日', '開始', '終了', '休憩分', '勤務分']];

  allEntries.sort(function(a, b) {
    if (a.employeeId !== b.employeeId) return a.employeeId < b.employeeId ? -1 : 1;
    if (a.workDate !== b.workDate) return a.workDate < b.workDate ? -1 : 1;
    return a.startTime < b.startTime ? -1 : 1;
  });

  allEntries.forEach(function(e) {
    var emp = getEmployeeById(e.employeeId);
    rows.push([
      e.employeeId, emp ? emp.name : '', emp ? emp.dept : '',
      e.workDate, e.startTime, e.endTime, e.breakMin, e.workMinutes
    ]);
  });

  var csv = rows.map(function(r) {
    return r.map(function(c) {
      var s = String(c === undefined || c === null ? '' : c);
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',');
  }).join('\r\n');

  var bom = '\uFEFF';
  var blob = Utilities.newBlob('').setDataFromString(bom + csv, 'UTF-8')
    .setName('detail_' + periodKey + '.csv')
    .setContentType('text/csv');

  var file = DriveApp.createFile(blob);

  audit({
    actorEmail: actorEmail,
    targetType: 'Export',
    targetId:   periodKey,
    action:     'EXPORT_CSV_DETAIL',
    after:      { fileId: file.getId(), charset: charset }
  });

  return { fileId: file.getId(), url: file.getUrl(), fileName: file.getName() };
}

/* ============================================================
   Excel (.xlsx) Export
   ============================================================ */

/**
 * Export Excel file with summary + detail on separate sheets.
 * Creates a temporary spreadsheet, populates it, exports as xlsx, then deletes temp file.
 */
function exportExcel(periodKey, actorEmail) {
  // Create temp spreadsheet
  var tempSS = SpreadsheetApp.create('勤務報告_' + periodKey + '_' + new Date().getTime());
  var ssId = tempSS.getId();

  try {
    // --- Summary sheet ---
    var summarySheet = tempSS.getActiveSheet();
    summarySheet.setName('月次サマリ');
    var summaryHeaders = ['職員ID', '氏名', '所属', '出社日数', '総勤務分', '総勤務時間', '時給', '給与', '交通費単価', '交通費', '総支給'];
    summarySheet.getRange(1, 1, 1, summaryHeaders.length).setValues([summaryHeaders]).setFontWeight('bold');

    var subs = getSubmissionsByPeriod(periodKey);
    var summaryData = [];
    subs.forEach(function(sub) {
      var emp = getEmployeeById(sub.employeeId);
      if (!emp) return;
      summaryData.push([
        sub.employeeId, emp.name, emp.dept,
        sub.workDays, sub.totalWorkMinutes,
        formatMinutesHM(Number(sub.totalWorkMinutes) || 0),
        emp.hourlyWageYen, sub.wageYen,
        emp.commutePerDayYen, sub.commuteYen, sub.totalYen
      ]);
    });
    if (summaryData.length > 0) {
      summarySheet.getRange(2, 1, summaryData.length, summaryHeaders.length).setValues(summaryData);
    }

    // --- Detail sheet ---
    var detailSheet = tempSS.insertSheet('明細');
    var detailHeaders = ['職員ID', '氏名', '所属', '出社日', '開始', '終了', '休憩分', '勤務分'];
    detailSheet.getRange(1, 1, 1, detailHeaders.length).setValues([detailHeaders]).setFontWeight('bold');

    var allEntries = getSheetData_('TimeEntries').filter(function(e) {
      return e.periodKey === periodKey;
    }).sort(function(a, b) {
      if (a.employeeId !== b.employeeId) return a.employeeId < b.employeeId ? -1 : 1;
      if (a.workDate !== b.workDate) return a.workDate < b.workDate ? -1 : 1;
      return a.startTime < b.startTime ? -1 : 1;
    });

    var detailData = [];
    allEntries.forEach(function(e) {
      var emp = getEmployeeById(e.employeeId);
      detailData.push([
        e.employeeId, emp ? emp.name : '', emp ? emp.dept : '',
        e.workDate, e.startTime, e.endTime, e.breakMin, e.workMinutes
      ]);
    });
    if (detailData.length > 0) {
      detailSheet.getRange(2, 1, detailData.length, detailHeaders.length).setValues(detailData);
    }

    // Force flush
    SpreadsheetApp.flush();

    // Export as xlsx
    var url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=xlsx';
    var token = ScriptApp.getOAuthToken();
    var response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });

    var xlsxBlob = response.getBlob().setName('勤務報告_' + periodKey + '.xlsx');
    var file = DriveApp.createFile(xlsxBlob);

    audit({
      actorEmail: actorEmail,
      targetType: 'Export',
      targetId:   periodKey,
      action:     'EXPORT_EXCEL',
      after:      { fileId: file.getId() }
    });

    return { fileId: file.getId(), url: file.getUrl(), fileName: file.getName() };

  } finally {
    // Clean up temp spreadsheet
    try { DriveApp.getFileById(ssId).setTrashed(true); } catch(e) {}
  }
}

/* ============================================================
   Utility
   ============================================================ */

function escapeHtml_(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
