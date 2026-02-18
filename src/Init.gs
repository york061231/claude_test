/**
 * Init.gs - Sheet initialization and seed data
 * Handles creation of all required sheets with proper headers,
 * and provides sample data seeding for testing.
 */

/* ============================================================
   Sheet Definitions
   ============================================================ */
var SHEET_DEFS = {
  Settings: {
    headers: ['key', 'value'],
    defaults: [
      ['CLOSE_DAY', '25'],
      ['PERIOD_MODE', 'B'],             // A = 1st~end, B = prev26~25
      ['CSV_CHARSET', 'UTF-8'],
      ['PDF_TITLE', '勤務実績報告書'],
      ['BACKUP_FOLDER_ID', ''],
      ['TIMEZONE', 'Asia/Tokyo'],
      ['MAX_APPROVAL_STEPS', '10'],
      ['SYSTEM_NAME', '臨時職員勤務申請システム']
    ]
  },
  Employees: {
    headers: [
      'employeeId', 'email', 'name', 'dept',
      'hourlyWageYen', 'commutePerDayYen',
      'activeFlag', 'validFrom', 'validTo',
      'createdAt', 'updatedAt'
    ]
  },
  Roles: {
    headers: ['email', 'role', 'dept']
  },
  ApprovalRoutes: {
    headers: [
      'routeId', 'scope', 'scopeKey',
      'stepNo', 'approverEmail', 'enabled'
    ]
  },
  TimeEntries: {
    headers: [
      'entryId', 'employeeId', 'workDate',
      'startTime', 'endTime', 'breakMin',
      'workMinutes', 'periodKey', 'status',
      'createdBy', 'createdAt', 'updatedBy', 'updatedAt'
    ]
  },
  Submissions: {
    headers: [
      'submissionId', 'employeeId', 'periodKey', 'status',
      'totalWorkMinutes', 'workDays', 'wageYen', 'commuteYen', 'totalYen',
      'currentStepNo', 'submittedAt', 'lastActionAt', 'lockedAt',
      'snapshotJson'
    ]
  },
  ApprovalActions: {
    headers: [
      'actionId', 'submissionId', 'stepNo',
      'actorEmail', 'action', 'comment', 'actionAt'
    ]
  },
  AuditLog: {
    headers: [
      'logId', 'at', 'actorEmail', 'actorRole',
      'targetType', 'targetId', 'action',
      'beforeJson', 'afterJson', 'ip', 'note'
    ]
  },
  Backups: {
    headers: [
      'backupId', 'at', 'actorEmail',
      'backupType', 'driveFileId', 'note'
    ]
  }
};

/**
 * Initialize all sheets. Safe to run repeatedly — skips existing sheets.
 */
function init() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var existingSheets = {};
  ss.getSheets().forEach(function(s) { existingSheets[s.getName()] = s; });

  Object.keys(SHEET_DEFS).forEach(function(name) {
    var def = SHEET_DEFS[name];
    var sheet;

    if (existingSheets[name]) {
      sheet = existingSheets[name];
      // Ensure headers exist
      var firstCell = sheet.getRange(1, 1).getValue();
      if (firstCell === '' || firstCell !== def.headers[0]) {
        sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
      }
    } else {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
    }

    // Bold + freeze header row
    sheet.getRange(1, 1, 1, def.headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);

    // Insert default values for Settings sheet
    if (name === 'Settings' && def.defaults && sheet.getLastRow() <= 1) {
      sheet.getRange(2, 1, def.defaults.length, 2).setValues(def.defaults);
    }
  });

  // Remove the default "Sheet1" if it exists and is empty
  var sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('シート1');
  if (sheet1 && sheet1.getLastRow() <= 1 && sheet1.getLastColumn() <= 1) {
    try { ss.deleteSheet(sheet1); } catch(e) { /* ignore if only sheet */ }
  }

  Logger.log('All sheets initialized successfully.');
}

/**
 * Seed sample master data for testing.
 * Creates sample employees, roles, and approval routes.
 */
function seedSample() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var now = new Date().toISOString();

  // --- Employees ---
  var empSheet = ss.getSheetByName('Employees');
  if (empSheet.getLastRow() <= 1) {
    var employees = [];
    var depts = ['総務部', '経理部', '学務課'];
    for (var i = 1; i <= 10; i++) {
      var dept = depts[(i - 1) % depts.length];
      employees.push([
        'EMP' + ('000' + i).slice(-3),                       // employeeId
        'staff' + i + '@example.ac.jp',                       // email
        'テスト職員' + i,                                       // name
        dept,                                                  // dept
        (1000 + i * 50),                                       // hourlyWageYen
        (500 + (i % 3) * 100),                                // commutePerDayYen
        'TRUE',                                                // activeFlag
        '2026-01-01',                                          // validFrom
        '2027-03-31',                                          // validTo
        now,                                                   // createdAt
        now                                                    // updatedAt
      ]);
    }
    empSheet.getRange(2, 1, employees.length, employees[0].length).setValues(employees);
  }

  // --- Roles ---
  var rolesSheet = ss.getSheetByName('Roles');
  if (rolesSheet.getLastRow() <= 1) {
    var roles = [
      ['admin1@example.ac.jp', 'ADMIN', ''],
      ['admin2@example.ac.jp', 'ADMIN', ''],
      ['admin3@example.ac.jp', 'ADMIN', '総務部'],
      ['admin4@example.ac.jp', 'ADMIN', '経理部'],
      ['approver1@example.ac.jp', 'APPROVER', '総務部'],
      ['approver2@example.ac.jp', 'APPROVER', '経理部'],
      ['approver3@example.ac.jp', 'APPROVER', '学務課']
    ];
    // Also add staff as CLERK
    for (var j = 1; j <= 10; j++) {
      roles.push(['staff' + j + '@example.ac.jp', 'CLERK', depts[(j - 1) % depts.length]]);
    }
    rolesSheet.getRange(2, 1, roles.length, roles[0].length).setValues(roles);
  }

  // --- ApprovalRoutes (dept-based, 3-step) ---
  var routeSheet = ss.getSheetByName('ApprovalRoutes');
  if (routeSheet.getLastRow() <= 1) {
    var routes = [
      // 総務部: 3-step
      ['ROUTE001', 'DEPT', '総務部', 1, 'approver1@example.ac.jp', 'TRUE'],
      ['ROUTE001', 'DEPT', '総務部', 2, 'admin3@example.ac.jp', 'TRUE'],
      ['ROUTE001', 'DEPT', '総務部', 3, 'admin1@example.ac.jp', 'TRUE'],
      // 経理部: 3-step
      ['ROUTE002', 'DEPT', '経理部', 1, 'approver2@example.ac.jp', 'TRUE'],
      ['ROUTE002', 'DEPT', '経理部', 2, 'admin4@example.ac.jp', 'TRUE'],
      ['ROUTE002', 'DEPT', '経理部', 3, 'admin2@example.ac.jp', 'TRUE'],
      // 学務課: 2-step
      ['ROUTE003', 'DEPT', '学務課', 1, 'approver3@example.ac.jp', 'TRUE'],
      ['ROUTE003', 'DEPT', '学務課', 2, 'admin1@example.ac.jp', 'TRUE']
    ];
    routeSheet.getRange(2, 1, routes.length, routes[0].length).setValues(routes);
  }

  Logger.log('Sample data seeded successfully.');
}

/**
 * Full setup: init sheets then seed sample data.
 */
function setupAll() {
  init();
  seedSample();
}
