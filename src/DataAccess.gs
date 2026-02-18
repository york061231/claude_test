/**
 * DataAccess.gs - Generic CRUD helpers + domain-specific data access
 * All sheet I/O is centralized here for consistency and performance.
 */

/* ============================================================
   Generic Sheet Helpers
   ============================================================ */

/**
 * Get all rows from a sheet as an array of objects keyed by header names.
 */
function getSheetData_(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    obj._row = i + 1; // 1-indexed row number in sheet
    rows.push(obj);
  }
  return rows;
}

/**
 * Get header index map for a sheet: { headerName: colIndex(0-based) }.
 */
function getHeaderMap_(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  headers.forEach(function(h, i) { map[h] = i; });
  return map;
}

/**
 * Append a row to a sheet given an object and header list.
 */
function appendRow_(sheetName, obj, headers) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var row = headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
  return obj;
}

/**
 * Update a specific cell in a sheet.
 */
function updateCell_(sheetName, rowNum, colName, value) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var hMap = getHeaderMap_(sheetName);
  var colIdx = hMap[colName];
  if (colIdx === undefined) throw new Error('Column not found: ' + colName);
  sheet.getRange(rowNum, colIdx + 1).setValue(value);
}

/**
 * Update multiple columns in a row.
 */
function updateRow_(sheetName, rowNum, updates) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var hMap = getHeaderMap_(sheetName);
  Object.keys(updates).forEach(function(col) {
    var colIdx = hMap[col];
    if (colIdx !== undefined) {
      sheet.getRange(rowNum, colIdx + 1).setValue(updates[col]);
    }
  });
}

/**
 * Find rows matching a filter object { colName: value }.
 */
function findRows_(sheetName, filters) {
  var all = getSheetData_(sheetName);
  return all.filter(function(row) {
    return Object.keys(filters).every(function(k) {
      return String(row[k]) === String(filters[k]);
    });
  });
}

/**
 * Find a single row by primary key column.
 */
function findRowByKey_(sheetName, keyCol, keyVal) {
  var results = findRows_(sheetName, keyColToFilter_(keyCol, keyVal));
  return results.length > 0 ? results[0] : null;
}

function keyColToFilter_(keyCol, keyVal) {
  var f = {};
  f[keyCol] = keyVal;
  return f;
}

/**
 * Delete a row by row number.
 */
function deleteRow_(sheetName, rowNum) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  sheet.deleteRow(rowNum);
}

/* ============================================================
   Settings
   ============================================================ */

function getSetting(key) {
  var rows = findRows_('Settings', { key: key });
  return rows.length > 0 ? rows[0].value : null;
}

function setSetting(key, value) {
  var rows = findRows_('Settings', { key: key });
  if (rows.length > 0) {
    updateCell_('Settings', rows[0]._row, 'value', value);
  } else {
    appendRow_('Settings', { key: key, value: value }, ['key', 'value']);
  }
}

function getAllSettings() {
  var rows = getSheetData_('Settings');
  var map = {};
  rows.forEach(function(r) { map[r.key] = r.value; });
  return map;
}

/* ============================================================
   Employees
   ============================================================ */

var EMP_HEADERS = SHEET_DEFS.Employees.headers;

function getEmployeeByEmail(email) {
  var rows = findRows_('Employees', { email: email });
  return rows.length > 0 ? rows[0] : null;
}

function getEmployeeById(employeeId) {
  return findRowByKey_('Employees', 'employeeId', employeeId);
}

function getActiveEmployees() {
  return findRows_('Employees', { activeFlag: 'TRUE' }).concat(
    findRows_('Employees', { activeFlag: true })
  );
}

function getAllEmployees() {
  return getSheetData_('Employees');
}

function saveEmployee(data) {
  var existing = findRowByKey_('Employees', 'employeeId', data.employeeId);
  var now = new Date().toISOString();
  if (existing) {
    data.updatedAt = now;
    updateRow_('Employees', existing._row, data);
    return data;
  } else {
    data.createdAt = now;
    data.updatedAt = now;
    return appendRow_('Employees', data, EMP_HEADERS);
  }
}

/* ============================================================
   Roles
   ============================================================ */

function getUserRoles(email) {
  return findRows_('Roles', { email: email });
}

function isAdmin(email) {
  return getUserRoles(email).some(function(r) { return r.role === 'ADMIN'; });
}

function isApprover(email) {
  return getUserRoles(email).some(function(r) {
    return r.role === 'APPROVER' || r.role === 'ADMIN';
  });
}

function getUserRole(email) {
  var roles = getUserRoles(email);
  if (roles.some(function(r) { return r.role === 'ADMIN'; })) return 'ADMIN';
  if (roles.some(function(r) { return r.role === 'APPROVER'; })) return 'APPROVER';
  if (roles.some(function(r) { return r.role === 'CLERK'; })) return 'CLERK';
  return null;
}

function getAllRoles() {
  return getSheetData_('Roles');
}

function saveRole(email, role, dept) {
  var existing = getSheetData_('Roles').filter(function(r) {
    return r.email === email && r.role === role;
  });
  if (existing.length > 0) {
    updateRow_('Roles', existing[0]._row, { email: email, role: role, dept: dept || '' });
  } else {
    appendRow_('Roles', { email: email, role: role, dept: dept || '' }, ['email', 'role', 'dept']);
  }
}

function deleteRole(email, role) {
  var rows = getSheetData_('Roles').filter(function(r) {
    return r.email === email && r.role === role;
  });
  if (rows.length > 0) {
    deleteRow_('Roles', rows[0]._row);
  }
}

/* ============================================================
   Approval Routes
   ============================================================ */

var ROUTE_HEADERS = SHEET_DEFS.ApprovalRoutes.headers;

function getApprovalRoute(employeeId) {
  var emp = getEmployeeById(employeeId);
  if (!emp) return [];

  // First check for employee-specific route
  var empRoutes = findRows_('ApprovalRoutes', { scope: 'EMPLOYEE', scopeKey: employeeId, enabled: 'TRUE' })
    .concat(findRows_('ApprovalRoutes', { scope: 'EMPLOYEE', scopeKey: employeeId, enabled: true }));
  if (empRoutes.length > 0) {
    return empRoutes.sort(function(a, b) { return Number(a.stepNo) - Number(b.stepNo); });
  }

  // Fall back to dept route
  var deptRoutes = findRows_('ApprovalRoutes', { scope: 'DEPT', scopeKey: emp.dept, enabled: 'TRUE' })
    .concat(findRows_('ApprovalRoutes', { scope: 'DEPT', scopeKey: emp.dept, enabled: true }));
  return deptRoutes.sort(function(a, b) { return Number(a.stepNo) - Number(b.stepNo); });
}

function getAllApprovalRoutes() {
  return getSheetData_('ApprovalRoutes');
}

function saveApprovalRoutes(routes) {
  // Replace all routes for a given routeId
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ApprovalRoutes');
  // Clear existing data (keep header)
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  // Write all routes
  if (routes.length > 0) {
    var data = routes.map(function(r) {
      return ROUTE_HEADERS.map(function(h) { return r[h] !== undefined ? r[h] : ''; });
    });
    sheet.getRange(2, 1, data.length, ROUTE_HEADERS.length).setValues(data);
  }
}

/* ============================================================
   Time Entries
   ============================================================ */

var TE_HEADERS = SHEET_DEFS.TimeEntries.headers;

function getTimeEntries(employeeId, periodKey) {
  return getSheetData_('TimeEntries').filter(function(r) {
    return r.employeeId === employeeId && r.periodKey === periodKey;
  });
}

function getTimeEntryById(entryId) {
  return findRowByKey_('TimeEntries', 'entryId', entryId);
}

function saveTimeEntry(data) {
  var existing = findRowByKey_('TimeEntries', 'entryId', data.entryId);
  var now = new Date().toISOString();
  if (existing) {
    data.updatedAt = now;
    updateRow_('TimeEntries', existing._row, data);
    return data;
  } else {
    if (!data.entryId) data.entryId = Utilities.getUuid();
    data.createdAt = now;
    data.updatedAt = now;
    appendRow_('TimeEntries', data, TE_HEADERS);
    return data;
  }
}

function deleteTimeEntry(entryId) {
  var existing = findRowByKey_('TimeEntries', 'entryId', entryId);
  if (existing) {
    deleteRow_('TimeEntries', existing._row);
    return true;
  }
  return false;
}

/* ============================================================
   Submissions
   ============================================================ */

var SUB_HEADERS = SHEET_DEFS.Submissions.headers;

function getSubmission(employeeId, periodKey) {
  var rows = getSheetData_('Submissions').filter(function(r) {
    return r.employeeId === employeeId && r.periodKey === periodKey;
  });
  return rows.length > 0 ? rows[0] : null;
}

function getSubmissionById(submissionId) {
  return findRowByKey_('Submissions', 'submissionId', submissionId);
}

function saveSubmission(data) {
  var existing = findRowByKey_('Submissions', 'submissionId', data.submissionId);
  if (existing) {
    updateRow_('Submissions', existing._row, data);
    return data;
  } else {
    if (!data.submissionId) data.submissionId = Utilities.getUuid();
    appendRow_('Submissions', data, SUB_HEADERS);
    return data;
  }
}

function getSubmissionsForApprover(approverEmail) {
  var allSubs = getSheetData_('Submissions');
  return allSubs.filter(function(sub) {
    if (sub.status !== 'SUBMITTED' && sub.status !== 'IN_REVIEW') return false;
    var route = getApprovalRoute(sub.employeeId);
    var currentStep = Number(sub.currentStepNo) || 1;
    var stepEntry = route.filter(function(r) { return Number(r.stepNo) === currentStep; })[0];
    return stepEntry && stepEntry.approverEmail === approverEmail;
  });
}

function getAllSubmissions() {
  return getSheetData_('Submissions');
}

function getSubmissionsByPeriod(periodKey) {
  return findRows_('Submissions', { periodKey: periodKey });
}

/* ============================================================
   Approval Actions
   ============================================================ */

var AA_HEADERS = SHEET_DEFS.ApprovalActions.headers;

function addApprovalAction(data) {
  if (!data.actionId) data.actionId = Utilities.getUuid();
  if (!data.actionAt) data.actionAt = new Date().toISOString();
  appendRow_('ApprovalActions', data, AA_HEADERS);
  return data;
}

function getApprovalActions(submissionId) {
  return findRows_('ApprovalActions', { submissionId: submissionId })
    .sort(function(a, b) { return a.actionAt < b.actionAt ? -1 : 1; });
}

/* ============================================================
   Audit Log
   ============================================================ */

var AL_HEADERS = SHEET_DEFS.AuditLog.headers;

function appendAuditLog(data) {
  if (!data.logId) data.logId = Utilities.getUuid();
  if (!data.at) data.at = new Date().toISOString();
  appendRow_('AuditLog', data, AL_HEADERS);
}

function getAuditLogs(targetType, targetId) {
  if (targetType && targetId) {
    return getSheetData_('AuditLog').filter(function(r) {
      return r.targetType === targetType && r.targetId === targetId;
    });
  }
  return getSheetData_('AuditLog');
}

/* ============================================================
   Backups
   ============================================================ */

var BK_HEADERS = SHEET_DEFS.Backups.headers;

function addBackupRecord(data) {
  if (!data.backupId) data.backupId = Utilities.getUuid();
  if (!data.at) data.at = new Date().toISOString();
  appendRow_('Backups', data, BK_HEADERS);
  return data;
}

function getBackupRecords() {
  return getSheetData_('Backups');
}

/* ============================================================
   Period Key Helpers
   ============================================================ */

/**
 * Compute the periodKey for a given date based on settings.
 * Mode A (1st~end): "2026-02" for any date in Feb 2026
 * Mode B (26~25):   "2026-02" means 2026/01/26~2026/02/25
 */
function computePeriodKey(dateStr) {
  var mode = getSetting('PERIOD_MODE') || 'B';
  var closeDay = parseInt(getSetting('CLOSE_DAY') || '25', 10);
  var d = new Date(dateStr + 'T00:00:00+09:00');
  var y = d.getFullYear();
  var m = d.getMonth() + 1; // 1-based
  var day = d.getDate();

  if (mode === 'A') {
    return y + '-' + ('0' + m).slice(-2);
  } else {
    // Mode B: if day > closeDay, it belongs to next month's period
    if (day > closeDay) {
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return y + '-' + ('0' + m).slice(-2);
  }
}

/**
 * Get the date range for a periodKey.
 * Returns { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
 */
function getPeriodRange(periodKey) {
  var mode = getSetting('PERIOD_MODE') || 'B';
  var closeDay = parseInt(getSetting('CLOSE_DAY') || '25', 10);
  var parts = periodKey.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);

  if (mode === 'A') {
    var lastDay = new Date(y, m, 0).getDate();
    return {
      start: y + '-' + ('0' + m).slice(-2) + '-01',
      end: y + '-' + ('0' + m).slice(-2) + '-' + ('0' + lastDay).slice(-2)
    };
  } else {
    // Mode B: prev month closeDay+1 ~ this month closeDay
    var prevM = m - 1;
    var prevY = y;
    if (prevM < 1) { prevM = 12; prevY--; }
    var startDay = closeDay + 1;
    // Handle months where prev month doesn't have enough days
    var prevLastDay = new Date(prevY, prevM, 0).getDate();
    if (startDay > prevLastDay) startDay = prevLastDay;

    var endLastDay = new Date(y, m, 0).getDate();
    var endDay = Math.min(closeDay, endLastDay);

    return {
      start: prevY + '-' + ('0' + prevM).slice(-2) + '-' + ('0' + startDay).slice(-2),
      end: y + '-' + ('0' + m).slice(-2) + '-' + ('0' + endDay).slice(-2)
    };
  }
}

/**
 * Get a list of available period keys (past 12 months + current).
 */
function getAvailablePeriods() {
  var mode = getSetting('PERIOD_MODE') || 'B';
  var now = new Date();
  var currentPK = computePeriodKey(Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd'));
  var periods = [];
  for (var i = -12; i <= 1; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    var pk = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
    var range = getPeriodRange(pk);
    periods.push({
      periodKey: pk,
      label: pk + ' (' + range.start + ' ~ ' + range.end + ')',
      start: range.start,
      end: range.end,
      isCurrent: pk === currentPK
    });
  }
  return periods;
}
