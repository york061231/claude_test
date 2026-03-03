/* ======================================================================
 * 臨時職員 勤務申請システム
 * Google Apps Script + Spreadsheet + HTMLService (SPA)
 *
 * ファイル構成:
 *   Code.gs    - サーバーサイド全ロジック（本ファイル）
 *   index.html - フロントエンドSPA
 *
 * セットアップ手順:
 *   1. Google Spreadsheet を新規作成
 *   2. 拡張機能 > Apps Script を開く
 *   3. Code.gs と index.html を配置
 *   4. Code.gs 先頭の SPREADSHEET_ID に手順1のIDを設定
 *   5. GASエディタで init() を実行（シート初期化）
 *   6. seedSample() を実行（サンプルデータ投入）
 *   7. デプロイ > ウェブアプリ > 実行ユーザー「自分」、アクセス「組織内」
 * ====================================================================== */

// =====================================================================
// 1. 設定定数
// =====================================================================
/** ★ ここにスプレッドシートIDを設定。空ならスクリプトプロパティ SPREADSHEET_ID を参照 */
const SPREADSHEET_ID = '';

const TZ = 'Asia/Tokyo';
const MAX_STEPS = 10;
const SHEET_NAMES = [
  'Settings', 'Employees', 'Roles', 'ApprovalRoutes',
  'TimeEntries', 'Submissions', 'ApprovalActions', 'AuditLog', 'Backups'
];

// =====================================================================
// 2. スプレッドシート ヘルパー
// =====================================================================
function getSS_() {
  var id = SPREADSHEET_ID ||
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
  if (!id) throw new Error('SPREADSHEET_IDが未設定です。Code.gs先頭 または スクリプトプロパティに設定してください。');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  var sheet = getSS_().getSheetByName(name);
  if (!sheet) throw new Error('シート "' + name + '" がありません。init()を実行してください。');
  return sheet;
}

/** シートデータをオブジェクト配列として取得 */
function getSheetData_(name) {
  var sheet = getSheet_(name);
  var all = sheet.getDataRange().getValues();
  if (all.length <= 1) return [];
  var headers = all[0];
  var results = [];
  for (var i = 1; i < all.length; i++) {
    var row = all[i];
    if (row.every(function(c) { return c === '' || c === null || c === undefined; })) continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      // google.script.run はDateオブジェクトをシリアライズできないため文字列に変換
      if (val instanceof Date) {
        val = Utilities.formatDate(val, TZ, "yyyy-MM-dd'T'HH:mm:ss");
      }
      obj[headers[j]] = val;
    }
    results.push(obj);
  }
  return results;
}

/** シートにオブジェクトを1行追記 */
function appendToSheet_(name, obj) {
  var sheet = getSheet_(name);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
}

/** キー列で行を検索して更新 */
function updateSheetRow_(name, keyCol, keyVal, updates) {
  var sheet = getSheet_(name);
  var all = sheet.getDataRange().getValues();
  var headers = all[0];
  var keyIdx = headers.indexOf(keyCol);
  if (keyIdx < 0) throw new Error('列 "' + keyCol + '" がありません');
  for (var i = 1; i < all.length; i++) {
    if (String(all[i][keyIdx]) === String(keyVal)) {
      var rowNum = i + 1;
      Object.keys(updates).forEach(function(key) {
        var colIdx = headers.indexOf(key);
        if (colIdx >= 0) sheet.getRange(rowNum, colIdx + 1).setValue(updates[key]);
      });
      return true;
    }
  }
  return false;
}

/** キー列で行を削除 */
function deleteSheetRow_(name, keyCol, keyVal) {
  var sheet = getSheet_(name);
  var all = sheet.getDataRange().getValues();
  var headers = all[0];
  var keyIdx = headers.indexOf(keyCol);
  if (keyIdx < 0) return false;
  for (var i = all.length - 1; i >= 1; i--) {
    if (String(all[i][keyIdx]) === String(keyVal)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

/** キー列で複数行を削除 */
function deleteSheetRows_(name, keyCol, keyVal) {
  var sheet = getSheet_(name);
  var all = sheet.getDataRange().getValues();
  var headers = all[0];
  var keyIdx = headers.indexOf(keyCol);
  if (keyIdx < 0) return 0;
  var count = 0;
  for (var i = all.length - 1; i >= 1; i--) {
    if (String(all[i][keyIdx]) === String(keyVal)) {
      sheet.deleteRow(i + 1);
      count++;
    }
  }
  return count;
}

/** boolean値のロバストな判定（スプレッドシートのセル書式による型揺れ対策） */
function toBool_(val) {
  if (val === true || val === 1) return true;
  if (val === false || val === 0 || val === '' || val === null || val === undefined) return false;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  return !!val;
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
}
function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}
function uuid_() {
  return Utilities.getUuid();
}

// =====================================================================
// 3. Web App エントリポイント
// =====================================================================
function doGet(e) {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    return HtmlService.createHtmlOutput('<h2>アクセス権限がありません。組織のGoogleアカウントでログインしてください。</h2>');
  }
  // ロールチェック
  var roles = getSheetData_('Roles');
  var emps = getSheetData_('Employees');
  var hasRole = roles.some(function(r) { return r.email === email; });
  var hasEmp = emps.some(function(e) { return e.email === email; });
  if (!hasRole && !hasEmp) {
    return HtmlService.createHtmlOutput('<h2>このシステムへのアクセス権限がありません。管理者にお問い合わせください。</h2>');
  }
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('勤務申請システム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// =====================================================================
// 4. 認証・認可
// =====================================================================
function getCurrentUserEmail_() {
  return Session.getActiveUser().getEmail();
}

/** 現在のユーザー情報を返す（クライアント呼出し用） */
function getCurrentUser() {
  var email = getCurrentUserEmail_();
  var roles = getSheetData_('Roles').filter(function(r) { return r.email === email; });
  var emp = getSheetData_('Employees').filter(function(e) {
    return e.email === email && toBool_(e.activeFlag);
  });
  var roleNames = roles.map(function(r) { return r.role; });
  return {
    email: email,
    roles: roleNames,
    employee: emp.length > 0 ? emp[0] : null,
    isAdmin: roleNames.indexOf('ADMIN') >= 0,
    isApprover: roleNames.indexOf('ADMIN') >= 0 || roleNames.indexOf('APPROVER') >= 0
  };
}

function requireAdmin_() {
  var u = getCurrentUser();
  if (!u.isAdmin) throw new Error('管理者権限が必要です。');
  return u;
}

function requireApprover_() {
  var u = getCurrentUser();
  if (!u.isApprover) throw new Error('承認者権限が必要です。');
  return u;
}

/** 指定職員のデータへのアクセス権チェック（本人 or 管理者） */
function requireAccessToEmployee_(employeeId) {
  var u = getCurrentUser();
  if (u.isAdmin) return u;
  if (u.employee && u.employee.employeeId === employeeId) return u;
  throw new Error('このデータへのアクセス権限がありません。');
}

// =====================================================================
// 5. 初期化 (init)
// =====================================================================
function init() {
  var id = SPREADSHEET_ID ||
    PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
  if (!id) {
    // アクティブなスプレッドシートを使用
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) {
      id = active.getId();
      PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', id);
      Logger.log('SPREADSHEET_ID を自動設定しました: ' + id);
    } else {
      throw new Error('SPREADSHEET_IDを設定してください。');
    }
  }
  var ss = SpreadsheetApp.openById(id);

  // --- Settings ---
  createSheetIfNotExists_(ss, 'Settings', ['key', 'value', 'description']);
  var settingsDefaults = [
    ['closingDay', '25', '締め日（毎月）'],
    ['periodType', 'B', '締め期間方式: A=1日〜末日, B=前月26日〜当月25日'],
    ['csvCharset', 'UTF-8', 'CSV文字コード: UTF-8 / Shift_JIS'],
    ['pdfTitle', '勤務実績報告書', 'PDF表題'],
    ['backupFolderId', '', 'バックアップ先Google DriveフォルダID（空なら自動作成）'],
    ['orgName', '○○大学', '組織名']
  ];
  var settingsSheet = ss.getSheetByName('Settings');
  var existingSettings = settingsSheet.getDataRange().getValues();
  var existingKeys = existingSettings.slice(1).map(function(r) { return r[0]; });
  settingsDefaults.forEach(function(row) {
    if (existingKeys.indexOf(row[0]) < 0) {
      settingsSheet.appendRow(row);
    }
  });

  // --- Employees ---
  createSheetIfNotExists_(ss, 'Employees', [
    'employeeId', 'email', 'name', 'dept', 'hourlyWageYen', 'commutePerDayYen',
    'activeFlag', 'validFrom', 'validTo', 'createdAt', 'updatedAt'
  ]);

  // --- Roles ---
  createSheetIfNotExists_(ss, 'Roles', ['email', 'role', 'dept']);

  // --- ApprovalRoutes ---
  createSheetIfNotExists_(ss, 'ApprovalRoutes', [
    'routeId', 'scope', 'scopeKey', 'stepNo', 'approverEmail', 'enabled'
  ]);

  // --- TimeEntries ---
  createSheetIfNotExists_(ss, 'TimeEntries', [
    'entryId', 'employeeId', 'workDate', 'startTime', 'endTime', 'breakMin',
    'workMinutes', 'periodKey', 'status', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'
  ]);

  // --- Submissions ---
  createSheetIfNotExists_(ss, 'Submissions', [
    'submissionId', 'employeeId', 'periodKey', 'status',
    'totalWorkMinutes', 'workDays', 'wageYen', 'commuteYen', 'totalYen',
    'currentStepNo', 'submittedAt', 'lastActionAt', 'lockedAt',
    'snapshotJson'
  ]);

  // --- ApprovalActions ---
  createSheetIfNotExists_(ss, 'ApprovalActions', [
    'actionId', 'submissionId', 'stepNo', 'actorEmail', 'action', 'comment', 'actionAt'
  ]);

  // --- AuditLog ---
  createSheetIfNotExists_(ss, 'AuditLog', [
    'logId', 'at', 'actorEmail', 'actorRole', 'targetType', 'targetId',
    'action', 'beforeJson', 'afterJson', 'note'
  ]);

  // --- Backups ---
  createSheetIfNotExists_(ss, 'Backups', [
    'backupId', 'at', 'actorEmail', 'backupType', 'driveFileId', 'note'
  ]);

  Logger.log('初期化が完了しました。');
}

function createSheetIfNotExists_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    Logger.log('シート "' + name + '" を作成しました。');
  }
  return sheet;
}

// =====================================================================
// 6. サンプルデータ投入 (seedSample)
// =====================================================================
function seedSample() {
  var ts = now_();

  // --- Roles ---
  var rolesSheet = getSheet_('Roles');
  if (getSheetData_('Roles').length === 0) {
    var sampleRoles = [
      ['admin1@example.com', 'ADMIN', ''],
      ['admin2@example.com', 'ADMIN', ''],
      ['approver1@example.com', 'APPROVER', '総務部'],
      ['approver2@example.com', 'APPROVER', '経理部']
    ];
    sampleRoles.forEach(function(r) { rolesSheet.appendRow(r); });
    Logger.log('Roles サンプル投入完了');
  }

  // --- Employees ---
  var empSheet = getSheet_('Employees');
  if (getSheetData_('Employees').length === 0) {
    var depts = ['総務部', '経理部'];
    for (var i = 1; i <= 10; i++) {
      var dept = depts[i % 2];
      empSheet.appendRow([
        'EMP' + ('000' + i).slice(-3),
        'staff' + i + '@example.com',
        '臨時職員' + i,
        dept,
        1200 + (i - 1) * 50,
        500,
        true,
        '2026-01-01',
        '2027-03-31',
        ts,
        ts
      ]);
    }
    // 管理者もEmployeesに入れる（閲覧用）
    empSheet.appendRow(['EMP100', 'admin1@example.com', '管理者A', '総務部', 0, 0, true, '2026-01-01', '2027-03-31', ts, ts]);
    Logger.log('Employees サンプル投入完了');
  }

  // --- ApprovalRoutes ---
  var routeSheet = getSheet_('ApprovalRoutes');
  if (getSheetData_('ApprovalRoutes').length === 0) {
    // 総務部ルート（3段）
    routeSheet.appendRow([uuid_(), 'DEPT', '総務部', 1, 'approver1@example.com', true]);
    routeSheet.appendRow([uuid_(), 'DEPT', '総務部', 2, 'admin1@example.com', true]);
    routeSheet.appendRow([uuid_(), 'DEPT', '総務部', 3, 'admin2@example.com', true]);
    // 経理部ルート（2段）
    routeSheet.appendRow([uuid_(), 'DEPT', '経理部', 1, 'approver2@example.com', true]);
    routeSheet.appendRow([uuid_(), 'DEPT', '経理部', 2, 'admin1@example.com', true]);
    Logger.log('ApprovalRoutes サンプル投入完了');
  }

  Logger.log('サンプルデータ投入が完了しました。');
}

// =====================================================================
// 7. 設定 (Settings)
// =====================================================================
function getSettings() {
  var data = getSheetData_('Settings');
  var obj = {};
  data.forEach(function(r) { obj[r.key] = r.value; });
  return obj;
}

function updateSetting(key, value) {
  var user = requireAdmin_();
  var before = getSettings();
  var sheet = getSheet_('Settings');
  var all = sheet.getDataRange().getValues();
  for (var i = 1; i < all.length; i++) {
    if (all[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      writeAuditLog_('Settings', key, 'UPDATE', JSON.stringify({ key: key, value: before[key] }), JSON.stringify({ key: key, value: value }), '');
      return true;
    }
  }
  // 存在しなければ追記
  sheet.appendRow([key, value, '']);
  writeAuditLog_('Settings', key, 'CREATE', '', JSON.stringify({ key: key, value: value }), '');
  return true;
}

function updateSettingsBulk(updates) {
  var user = requireAdmin_();
  Object.keys(updates).forEach(function(key) {
    updateSetting(key, updates[key]);
  });
  return getSettings();
}

// =====================================================================
// 8. 職員管理 (Employees)
// =====================================================================
function getEmployees() {
  var u = getCurrentUser();
  if (!u.isAdmin) {
    // 一般ユーザーは自分のみ
    return getSheetData_('Employees').filter(function(e) { return e.email === u.email; });
  }
  return getSheetData_('Employees');
}

function getEmployeeById_(employeeId) {
  return getSheetData_('Employees').filter(function(e) { return e.employeeId === employeeId; })[0] || null;
}

function saveEmployee(data) {
  var user = requireAdmin_();
  var ts = now_();
  if (data.employeeId) {
    // 更新
    var before = getEmployeeById_(data.employeeId);
    data.updatedAt = ts;
    updateSheetRow_('Employees', 'employeeId', data.employeeId, data);
    writeAuditLog_('Employees', data.employeeId, 'UPDATE',
      JSON.stringify(before), JSON.stringify(data), '');
    return { success: true, employeeId: data.employeeId };
  } else {
    // 新規
    data.employeeId = 'EMP' + uuid_().substring(0, 8).toUpperCase();
    data.activeFlag = data.activeFlag !== false;
    data.createdAt = ts;
    data.updatedAt = ts;
    appendToSheet_('Employees', data);
    writeAuditLog_('Employees', data.employeeId, 'CREATE', '', JSON.stringify(data), '');
    return { success: true, employeeId: data.employeeId };
  }
}

function deleteEmployee(employeeId) {
  var user = requireAdmin_();
  var before = getEmployeeById_(employeeId);
  // 論理削除（activeFlag = false）
  updateSheetRow_('Employees', 'employeeId', employeeId, { activeFlag: false, updatedAt: now_() });
  writeAuditLog_('Employees', employeeId, 'DEACTIVATE', JSON.stringify(before), '', '');
  return { success: true };
}

// =====================================================================
// 9. ロール管理 (Roles)
// =====================================================================
function getRoles() {
  requireAdmin_();
  return getSheetData_('Roles');
}

function saveRole(data) {
  requireAdmin_();
  var existing = getSheetData_('Roles');
  var found = existing.filter(function(r) {
    return r.email === data.email && r.role === data.role;
  });
  if (found.length > 0) {
    // 更新（dept変更）- 同一email+roleの行を特定して更新
    var sheet = getSheet_('Roles');
    var all = sheet.getDataRange().getValues();
    for (var i = all.length - 1; i >= 1; i--) {
      if (all[i][0] === data.email && all[i][1] === data.role) {
        sheet.getRange(i + 1, 3).setValue(data.dept || '');
        break;
      }
    }
    writeAuditLog_('Roles', data.email, 'UPDATE', '', JSON.stringify(data), '');
  } else {
    appendToSheet_('Roles', data);
    writeAuditLog_('Roles', data.email, 'CREATE', '', JSON.stringify(data), '');
  }
  return { success: true };
}

function deleteRole(email, role) {
  requireAdmin_();
  var sheet = getSheet_('Roles');
  var all = sheet.getDataRange().getValues();
  for (var i = all.length - 1; i >= 1; i--) {
    if (all[i][0] === email && all[i][1] === role) {
      sheet.deleteRow(i + 1);
      writeAuditLog_('Roles', email, 'DELETE', JSON.stringify({ email: email, role: role }), '', '');
      return { success: true };
    }
  }
  return { success: false, message: '該当データが見つかりません' };
}

// =====================================================================
// 10. 承認ルート管理 (ApprovalRoutes)
// =====================================================================
function getApprovalRoutes() {
  requireAdmin_();
  return getSheetData_('ApprovalRoutes');
}

function getApprovalRouteForEmployee_(employeeId) {
  var emp = getEmployeeById_(employeeId);
  if (!emp) return [];
  var routes = getSheetData_('ApprovalRoutes').filter(function(r) { return r.enabled === true; });
  // 職員単位ルートを優先
  var empRoutes = routes.filter(function(r) {
    return r.scope === 'EMPLOYEE' && r.scopeKey === employeeId;
  });
  if (empRoutes.length > 0) {
    empRoutes.sort(function(a, b) { return a.stepNo - b.stepNo; });
    return empRoutes;
  }
  // 部署単位ルート
  var deptRoutes = routes.filter(function(r) {
    return r.scope === 'DEPT' && r.scopeKey === emp.dept;
  });
  deptRoutes.sort(function(a, b) { return a.stepNo - b.stepNo; });
  return deptRoutes;
}

function saveApprovalRoute(data) {
  requireAdmin_();
  if (data.routeId) {
    var before = getSheetData_('ApprovalRoutes').filter(function(r) { return r.routeId === data.routeId; })[0];
    updateSheetRow_('ApprovalRoutes', 'routeId', data.routeId, data);
    writeAuditLog_('ApprovalRoutes', data.routeId, 'UPDATE', JSON.stringify(before), JSON.stringify(data), '');
  } else {
    data.routeId = uuid_();
    data.enabled = data.enabled !== false;
    appendToSheet_('ApprovalRoutes', data);
    writeAuditLog_('ApprovalRoutes', data.routeId, 'CREATE', '', JSON.stringify(data), '');
  }
  return { success: true, routeId: data.routeId };
}

function deleteApprovalRoute(routeId) {
  requireAdmin_();
  var before = getSheetData_('ApprovalRoutes').filter(function(r) { return r.routeId === routeId; })[0];
  deleteSheetRow_('ApprovalRoutes', 'routeId', routeId);
  writeAuditLog_('ApprovalRoutes', routeId, 'DELETE', JSON.stringify(before), '', '');
  return { success: true };
}

// =====================================================================
// 11. 期間 (Period) ヘルパー
// =====================================================================
/** 設定に基づいて期間の開始日と終了日を返す */
function getPeriodDates(periodKey, optSettings) {
  var settings = optSettings || getSettings();
  var parts = periodKey.split('-');
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  var pType = settings.periodType || 'B';
  if (pType === 'A') {
    var start = new Date(year, month - 1, 1);
    var end = new Date(year, month, 0); // 月末
    return { start: fmtDate_(start), end: fmtDate_(end) };
  } else {
    // 方式B: 前月26日〜当月25日
    var start = new Date(year, month - 2, 26);
    var end = new Date(year, month - 1, 25);
    return { start: fmtDate_(start), end: fmtDate_(end) };
  }
}

/** 日付からperiodKeyを算出 */
function dateToPeriodKey_(dateStr) {
  var settings = getSettings();
  var d = new Date(dateStr);
  var pType = settings.periodType || 'B';
  if (pType === 'A') {
    return Utilities.formatDate(d, TZ, 'yyyy-MM');
  } else {
    // 方式B: 26日以降は翌月
    var day = d.getDate();
    var year = d.getFullYear();
    var month = d.getMonth() + 1;
    if (day >= 26) {
      month++;
      if (month > 12) { month = 1; year++; }
    }
    return year + '-' + ('0' + month).slice(-2);
  }
}

function fmtDate_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/** 選択可能な期間リストを生成 */
function getAvailablePeriods() {
  var settings = getSettings();
  var now = new Date();
  var results = [];
  for (var i = -6; i <= 2; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    var key = Utilities.formatDate(d, TZ, 'yyyy-MM');
    var dates = getPeriodDates(key, settings);
    results.push({ periodKey: key, label: key, startDate: dates.start, endDate: dates.end });
  }
  return results;
}

/** 初期化用: ユーザー情報と期間一覧を一括取得（ラウンドトリップ削減） */
function initializeApp() {
  var user = getCurrentUser();
  var periods = getAvailablePeriods();
  return { user: user, periods: periods };
}

// =====================================================================
// 12. 勤務明細 (TimeEntries)
// =====================================================================
function getTimeEntries(employeeId, periodKey) {
  requireAccessToEmployee_(employeeId);
  return getSheetData_('TimeEntries').filter(function(e) {
    return e.employeeId === employeeId && e.periodKey === periodKey;
  });
}

function saveTimeEntry(data) {
  var email = getCurrentUserEmail_();
  var u = getCurrentUser();

  // 代理入力チェック
  if (data.employeeId) {
    if (!u.isAdmin && (!u.employee || u.employee.employeeId !== data.employeeId)) {
      throw new Error('このデータへのアクセス権限がありません。');
    }
  } else if (u.employee) {
    data.employeeId = u.employee.employeeId;
  } else {
    throw new Error('職員情報が見つかりません。');
  }

  // 申請ステータスチェック（LOCKED状態では編集不可）
  var sub = getSubmissionByEmployeePeriod_(data.employeeId, data.periodKey || dateToPeriodKey_(data.workDate));
  if (sub && (sub.status === 'LOCKED' || sub.status === 'APPROVED' || sub.status === 'IN_REVIEW' || sub.status === 'SUBMITTED')) {
    throw new Error('この期間は現在「' + sub.status + '」状態のため編集できません。');
  }

  // バリデーション
  validateTimeEntry_(data);

  // periodKey算出
  if (!data.periodKey) {
    data.periodKey = dateToPeriodKey_(data.workDate);
  }

  // 勤務分計算
  data.workMinutes = calcWorkMinutes_(data.startTime, data.endTime, parseInt(data.breakMin, 10) || 0);
  data.status = 'ACTIVE';

  var ts = now_();
  if (data.entryId) {
    // 更新
    var before = getSheetData_('TimeEntries').filter(function(e) { return e.entryId === data.entryId; })[0];
    data.updatedBy = email;
    data.updatedAt = ts;
    updateSheetRow_('TimeEntries', 'entryId', data.entryId, data);
    var isProxy = u.isAdmin && (!u.employee || u.employee.employeeId !== data.employeeId);
    writeAuditLog_('TimeEntries', data.entryId, 'UPDATE',
      JSON.stringify({ startTime: before.startTime, endTime: before.endTime, breakMin: before.breakMin }),
      JSON.stringify({ startTime: data.startTime, endTime: data.endTime, breakMin: data.breakMin }),
      isProxy ? '代理入力: ' + email + ' → ' + data.employeeId : '');
    return { success: true, entryId: data.entryId };
  } else {
    // 新規
    data.entryId = uuid_();
    data.createdBy = email;
    data.createdAt = ts;
    data.updatedBy = email;
    data.updatedAt = ts;
    appendToSheet_('TimeEntries', data);
    var isProxy = u.isAdmin && (!u.employee || u.employee.employeeId !== data.employeeId);
    writeAuditLog_('TimeEntries', data.entryId, 'CREATE', '',
      JSON.stringify({ workDate: data.workDate, startTime: data.startTime, endTime: data.endTime, breakMin: data.breakMin }),
      isProxy ? '代理入力: ' + email + ' → ' + data.employeeId : '');
    return { success: true, entryId: data.entryId };
  }
}

function deleteTimeEntry(entryId) {
  var email = getCurrentUserEmail_();
  var entry = getSheetData_('TimeEntries').filter(function(e) { return e.entryId === entryId; })[0];
  if (!entry) throw new Error('明細が見つかりません。');
  requireAccessToEmployee_(entry.employeeId);

  // ステータスチェック
  var sub = getSubmissionByEmployeePeriod_(entry.employeeId, entry.periodKey);
  if (sub && (sub.status === 'LOCKED' || sub.status === 'APPROVED' || sub.status === 'IN_REVIEW' || sub.status === 'SUBMITTED')) {
    throw new Error('この期間は現在「' + sub.status + '」状態のため削除できません。');
  }

  deleteSheetRow_('TimeEntries', 'entryId', entryId);
  writeAuditLog_('TimeEntries', entryId, 'DELETE',
    JSON.stringify({ workDate: entry.workDate, startTime: entry.startTime, endTime: entry.endTime }),
    '', '');
  return { success: true };
}

function validateTimeEntry_(data) {
  if (!data.workDate) throw new Error('出社日を入力してください。');
  if (!data.startTime) throw new Error('開始時刻を入力してください。');
  if (!data.endTime) throw new Error('終了時刻を入力してください。');

  var breakMin = parseInt(data.breakMin, 10);
  if (isNaN(breakMin) || breakMin < 0) throw new Error('休憩分は0以上の整数を入力してください。');

  // 開始 < 終了
  var start = timeToMin_(data.startTime);
  var end = timeToMin_(data.endTime);
  if (start >= end) throw new Error('開始時刻は終了時刻より前にしてください。');

  // 勤務分チェック
  var workMin = (end - start) - breakMin;
  if (workMin < 0) throw new Error('休憩時間が勤務時間を超えています。');
}

function timeToMin_(timeStr) {
  var parts = String(timeStr).split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function calcWorkMinutes_(startTime, endTime, breakMin) {
  var start = timeToMin_(startTime);
  var end = timeToMin_(endTime);
  return (end - start) - breakMin;
}

// =====================================================================
// 13. 計算エンジン
// =====================================================================
/** 指定期間の集計を算出 */
function calculateSummary(employeeId, periodKey) {
  requireAccessToEmployee_(employeeId);
  var entries = getSheetData_('TimeEntries').filter(function(e) {
    return e.employeeId === employeeId && e.periodKey === periodKey && e.status === 'ACTIVE';
  });
  var emp = getEmployeeById_(employeeId);
  if (!emp) throw new Error('職員情報が見つかりません。');

  var totalMinutes = 0;
  var dayMap = {};
  entries.forEach(function(e) {
    var min = parseInt(e.workMinutes, 10) || 0;
    totalMinutes += min;
    if (min > 0) {
      dayMap[e.workDate] = (dayMap[e.workDate] || 0) + min;
    }
  });

  // 出社日数: 合計勤務分 > 0 の日
  var workDays = 0;
  Object.keys(dayMap).forEach(function(d) {
    if (dayMap[d] > 0) workDays++;
  });

  var hourlyWage = parseInt(emp.hourlyWageYen, 10) || 0;
  var commutePerDay = parseInt(emp.commutePerDayYen, 10) || 0;

  // 給与 = floor(総勤務分 * 時給 / 60)
  var wageYen = Math.floor(totalMinutes * hourlyWage / 60);
  var commuteYen = workDays * commutePerDay;
  var totalYen = wageYen + commuteYen;

  var hours = Math.floor(totalMinutes / 60);
  var mins = totalMinutes % 60;

  return {
    employeeId: employeeId,
    periodKey: periodKey,
    totalWorkMinutes: totalMinutes,
    totalTimeDisplay: hours + ':' + ('0' + mins).slice(-2),
    workDays: workDays,
    hourlyWage: hourlyWage,
    commutePerDay: commutePerDay,
    wageYen: wageYen,
    commuteYen: commuteYen,
    totalYen: totalYen,
    entries: entries
  };
}

// =====================================================================
// 14. 申請 (Submissions)
// =====================================================================
function getSubmissionByEmployeePeriod_(employeeId, periodKey) {
  var subs = getSheetData_('Submissions').filter(function(s) {
    return s.employeeId === employeeId && s.periodKey === periodKey;
  });
  return subs.length > 0 ? subs[0] : null;
}

function getSubmission(employeeId, periodKey) {
  requireAccessToEmployee_(employeeId);
  return getSubmissionByEmployeePeriod_(employeeId, periodKey);
}

function getMySubmissions() {
  var u = getCurrentUser();
  if (!u.employee) return [];
  return getSheetData_('Submissions').filter(function(s) {
    return s.employeeId === u.employee.employeeId;
  });
}

function getAllSubmissions(periodKey) {
  requireAdmin_();
  var subs = getSheetData_('Submissions');
  if (periodKey) {
    subs = subs.filter(function(s) { return s.periodKey === periodKey; });
  }
  return subs;
}

/** 下書き保存（Submissionレコードを作成/更新し集計値を保存） */
function saveDraft(employeeId, periodKey) {
  requireAccessToEmployee_(employeeId);
  var summary = calculateSummary(employeeId, periodKey);
  var existing = getSubmissionByEmployeePeriod_(employeeId, periodKey);
  var ts = now_();

  if (existing) {
    if (existing.status !== 'DRAFT' && existing.status !== 'RETURNED' && existing.status !== 'REOPENED') {
      throw new Error('現在のステータス「' + existing.status + '」では下書き保存できません。');
    }
    updateSheetRow_('Submissions', 'submissionId', existing.submissionId, {
      status: 'DRAFT',
      totalWorkMinutes: summary.totalWorkMinutes,
      workDays: summary.workDays,
      wageYen: summary.wageYen,
      commuteYen: summary.commuteYen,
      totalYen: summary.totalYen,
      lastActionAt: ts
    });
    writeAuditLog_('Submissions', existing.submissionId, 'SAVE_DRAFT', '', '', '');
    return { success: true, submissionId: existing.submissionId };
  } else {
    var subId = uuid_();
    var sub = {
      submissionId: subId,
      employeeId: employeeId,
      periodKey: periodKey,
      status: 'DRAFT',
      totalWorkMinutes: summary.totalWorkMinutes,
      workDays: summary.workDays,
      wageYen: summary.wageYen,
      commuteYen: summary.commuteYen,
      totalYen: summary.totalYen,
      currentStepNo: 0,
      submittedAt: '',
      lastActionAt: ts,
      lockedAt: '',
      snapshotJson: ''
    };
    appendToSheet_('Submissions', sub);
    writeAuditLog_('Submissions', subId, 'CREATE_DRAFT', '', '', '');
    return { success: true, submissionId: subId };
  }
}

/** 提出（承認フローへ） */
function submitForApproval(employeeId, periodKey) {
  requireAccessToEmployee_(employeeId);
  var existing = getSubmissionByEmployeePeriod_(employeeId, periodKey);
  if (!existing) {
    // まず下書き保存
    saveDraft(employeeId, periodKey);
    existing = getSubmissionByEmployeePeriod_(employeeId, periodKey);
  }
  if (existing.status !== 'DRAFT' && existing.status !== 'RETURNED' && existing.status !== 'REOPENED') {
    throw new Error('現在のステータス「' + existing.status + '」では提出できません。');
  }

  // 明細チェック
  var entries = getTimeEntries(employeeId, periodKey);
  if (entries.length === 0) {
    throw new Error('勤務明細がありません。');
  }

  // 集計再計算
  var summary = calculateSummary(employeeId, periodKey);

  // 承認ルート取得
  var route = getApprovalRouteForEmployee_(employeeId);
  if (route.length === 0) {
    throw new Error('承認ルートが設定されていません。管理者にお問い合わせください。');
  }

  var ts = now_();
  var newStatus = 'SUBMITTED';
  var nextStep = 1;

  updateSheetRow_('Submissions', 'submissionId', existing.submissionId, {
    status: newStatus,
    totalWorkMinutes: summary.totalWorkMinutes,
    workDays: summary.workDays,
    wageYen: summary.wageYen,
    commuteYen: summary.commuteYen,
    totalYen: summary.totalYen,
    currentStepNo: nextStep,
    submittedAt: ts,
    lastActionAt: ts
  });

  writeAuditLog_('Submissions', existing.submissionId, 'SUBMIT', '', '', '');

  // 最初の承認者に通知
  notifyNextApprover_(existing.submissionId, employeeId, periodKey, nextStep);

  return { success: true, submissionId: existing.submissionId };
}

// =====================================================================
// 15. 承認ワークフロー
// =====================================================================
/** 自分の承認待ち一覧 */
function getMyPendingApprovals() {
  var u = getCurrentUser();
  if (!u.isApprover) return [];
  var email = u.email;
  var subs = getSheetData_('Submissions').filter(function(s) {
    return s.status === 'SUBMITTED' || s.status === 'IN_REVIEW';
  });

  var pending = [];
  subs.forEach(function(sub) {
    var route = getApprovalRouteForEmployee_(sub.employeeId);
    var currentStep = parseInt(sub.currentStepNo, 10) || 1;
    var stepRoute = route.filter(function(r) { return parseInt(r.stepNo, 10) === currentStep; })[0];
    if (stepRoute && stepRoute.approverEmail === email) {
      var emp = getEmployeeById_(sub.employeeId);
      pending.push({
        submission: sub,
        employee: emp,
        currentStep: currentStep,
        totalSteps: route.length
      });
    }
  });
  return pending;
}

/** 承認 */
function approveSubmission(submissionId, comment) {
  var u = requireApprover_();
  var sub = getSheetData_('Submissions').filter(function(s) { return s.submissionId === submissionId; })[0];
  if (!sub) throw new Error('申請が見つかりません。');
  if (sub.status !== 'SUBMITTED' && sub.status !== 'IN_REVIEW') {
    throw new Error('承認可能なステータスではありません。');
  }

  var route = getApprovalRouteForEmployee_(sub.employeeId);
  var currentStep = parseInt(sub.currentStepNo, 10) || 1;
  var stepRoute = route.filter(function(r) { return parseInt(r.stepNo, 10) === currentStep; })[0];
  if (!stepRoute || stepRoute.approverEmail !== u.email) {
    throw new Error('あなたはこの承認ステップの承認者ではありません。');
  }

  // 承認アクション記録
  var actionId = uuid_();
  var ts = now_();
  appendToSheet_('ApprovalActions', {
    actionId: actionId,
    submissionId: submissionId,
    stepNo: currentStep,
    actorEmail: u.email,
    action: 'APPROVE',
    comment: comment || '',
    actionAt: ts
  });

  // 次ステップ or 最終承認
  var nextStep = currentStep + 1;
  var nextRoute = route.filter(function(r) { return parseInt(r.stepNo, 10) === nextStep; })[0];

  if (nextRoute) {
    // 次の承認ステップへ
    updateSheetRow_('Submissions', 'submissionId', submissionId, {
      status: 'IN_REVIEW',
      currentStepNo: nextStep,
      lastActionAt: ts
    });
    writeAuditLog_('Submissions', submissionId, 'APPROVE_STEP', '', JSON.stringify({ step: currentStep, nextStep: nextStep }), '');
    notifyNextApprover_(submissionId, sub.employeeId, sub.periodKey, nextStep);
  } else {
    // 最終承認
    updateSheetRow_('Submissions', 'submissionId', submissionId, {
      status: 'APPROVED',
      currentStepNo: currentStep,
      lastActionAt: ts
    });
    writeAuditLog_('Submissions', submissionId, 'FINAL_APPROVE', '', '', '');
    notifyEmployee_(sub.employeeId, sub.periodKey, '申請が最終承認されました。');
  }

  return { success: true };
}

/** 差戻し */
function returnSubmission(submissionId, comment) {
  var u = requireApprover_();
  if (!comment || comment.trim() === '') {
    throw new Error('差戻しにはコメントが必須です。');
  }

  var sub = getSheetData_('Submissions').filter(function(s) { return s.submissionId === submissionId; })[0];
  if (!sub) throw new Error('申請が見つかりません。');
  if (sub.status !== 'SUBMITTED' && sub.status !== 'IN_REVIEW') {
    throw new Error('差戻し可能なステータスではありません。');
  }

  var route = getApprovalRouteForEmployee_(sub.employeeId);
  var currentStep = parseInt(sub.currentStepNo, 10) || 1;
  var stepRoute = route.filter(function(r) { return parseInt(r.stepNo, 10) === currentStep; })[0];
  if (!stepRoute || stepRoute.approverEmail !== u.email) {
    throw new Error('あなたはこの承認ステップの承認者ではありません。');
  }

  var actionId = uuid_();
  var ts = now_();
  appendToSheet_('ApprovalActions', {
    actionId: actionId,
    submissionId: submissionId,
    stepNo: currentStep,
    actorEmail: u.email,
    action: 'RETURN',
    comment: comment,
    actionAt: ts
  });

  updateSheetRow_('Submissions', 'submissionId', submissionId, {
    status: 'RETURNED',
    lastActionAt: ts
  });

  writeAuditLog_('Submissions', submissionId, 'RETURN', '', JSON.stringify({ step: currentStep, comment: comment }), '');
  notifyEmployee_(sub.employeeId, sub.periodKey, '申請が差戻されました。\n理由: ' + comment);

  return { success: true };
}

/** 承認アクション履歴取得 */
function getApprovalActions(submissionId) {
  // 権限チェック: 自分が関連する申請 or 管理者/承認者のみ
  var u = getCurrentUser();
  if (!u.isAdmin && !u.isApprover) {
    var sub = getSheetData_('Submissions').filter(function(s) { return s.submissionId === submissionId; })[0];
    if (!sub || !u.employee || sub.employeeId !== u.employee.employeeId) {
      throw new Error('アクセス権限がありません。');
    }
  }
  return getSheetData_('ApprovalActions').filter(function(a) {
    return a.submissionId === submissionId;
  });
}

// =====================================================================
// 16. 締め (Lock / Reopen / Relock)
// =====================================================================
/** 締め実行 */
function lockPeriod(periodKey) {
  var user = requireAdmin_();
  var ts = now_();
  var subs = getSheetData_('Submissions').filter(function(s) { return s.periodKey === periodKey; });
  var lockedCount = 0;

  subs.forEach(function(sub) {
    if (sub.status === 'APPROVED') {
      // スナップショット作成
      var summary = calculateSummary(sub.employeeId, periodKey);
      var snapshot = JSON.stringify(summary);
      updateSheetRow_('Submissions', 'submissionId', sub.submissionId, {
        status: 'LOCKED',
        lockedAt: ts,
        lastActionAt: ts,
        snapshotJson: snapshot
      });
      writeAuditLog_('Submissions', sub.submissionId, 'LOCK', '', '', '締め実行: ' + periodKey);
      lockedCount++;
    }
  });

  return { success: true, lockedCount: lockedCount };
}

/** 再締め（ロック解除） */
function reopenSubmission(submissionId, reason) {
  var user = requireAdmin_();
  if (!reason || reason.trim() === '') {
    throw new Error('解除理由は必須です。');
  }

  var sub = getSheetData_('Submissions').filter(function(s) { return s.submissionId === submissionId; })[0];
  if (!sub) throw new Error('申請が見つかりません。');
  if (sub.status !== 'LOCKED') throw new Error('ロック状態の申請のみ解除可能です。');

  var ts = now_();
  updateSheetRow_('Submissions', 'submissionId', submissionId, {
    status: 'REOPENED',
    lastActionAt: ts
  });

  writeAuditLog_('Submissions', submissionId, 'REOPEN', '', JSON.stringify({ reason: reason }), '解除理由: ' + reason);
  return { success: true };
}

/** 再ロック */
function relockSubmission(submissionId) {
  var user = requireAdmin_();
  var sub = getSheetData_('Submissions').filter(function(s) { return s.submissionId === submissionId; })[0];
  if (!sub) throw new Error('申請が見つかりません。');
  if (sub.status !== 'APPROVED' && sub.status !== 'REOPENED') {
    throw new Error('現在のステータスでは再ロックできません。');
  }

  var ts = now_();
  var summary = calculateSummary(sub.employeeId, sub.periodKey);
  var snapshot = JSON.stringify(summary);

  updateSheetRow_('Submissions', 'submissionId', submissionId, {
    status: 'LOCKED',
    lockedAt: ts,
    lastActionAt: ts,
    snapshotJson: snapshot
  });

  writeAuditLog_('Submissions', submissionId, 'RELOCK', '', '', '');
  return { success: true };
}

// =====================================================================
// 17. PDF出力
// =====================================================================
function exportPdf(employeeId, periodKey) {
  var u = getCurrentUser();
  if (!u.isAdmin) requireAccessToEmployee_(employeeId);

  var emp = getEmployeeById_(employeeId);
  if (!emp) throw new Error('職員情報が見つかりません。');
  var summary = calculateSummary(employeeId, periodKey);
  var periodDates = getPeriodDates(periodKey);
  var settings = getSettings();
  var route = getApprovalRouteForEmployee_(employeeId);

  // 日付順にソート
  var entries = summary.entries.slice().sort(function(a, b) {
    return (a.workDate + a.startTime).localeCompare(b.workDate + b.startTime);
  });

  // HTML生成
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
  html += '<style>';
  html += 'body{font-family:"Noto Sans JP",sans-serif;font-size:11px;margin:20px 30px;}';
  html += 'h1{text-align:center;font-size:16px;margin-bottom:5px;}';
  html += '.header-info{display:flex;justify-content:space-between;margin-bottom:10px;font-size:10px;}';
  html += '.header-info div{margin-bottom:2px;}';
  html += 'table{width:100%;border-collapse:collapse;margin-bottom:10px;}';
  html += 'th,td{border:1px solid #333;padding:3px 6px;text-align:center;font-size:10px;}';
  html += 'th{background:#e0e0e0;}';
  html += '.summary-table td{text-align:right;font-weight:bold;}';
  html += '.stamp-area{display:flex;justify-content:flex-end;margin-top:15px;}';
  html += '.stamp-box{border:1px solid #333;width:60px;height:60px;text-align:center;margin-left:5px;font-size:9px;display:inline-block;vertical-align:top;}';
  html += '.stamp-box .label{border-bottom:1px solid #333;padding:2px;background:#f0f0f0;}';
  html += '.right{text-align:right;}';
  html += '</style></head><body>';

  html += '<h1>' + (settings.pdfTitle || '勤務実績報告書') + '</h1>';
  html += '<div class="header-info"><div>';
  html += '<div>氏名: ' + emp.name + '</div>';
  html += '<div>所属: ' + emp.dept + '</div>';
  html += '<div>対象期間: ' + periodDates.start + ' ～ ' + periodDates.end + '</div>';
  html += '</div><div>';
  html += '<div>時給: ¥' + Number(emp.hourlyWageYen).toLocaleString() + '</div>';
  html += '<div>交通費単価: ¥' + Number(emp.commutePerDayYen).toLocaleString() + '/日</div>';
  html += '<div>作成日: ' + today_() + '</div>';
  html += '</div></div>';

  // 明細テーブル
  html += '<table><thead><tr><th>日付</th><th>開始</th><th>終了</th><th>休憩(分)</th><th>勤務(分)</th></tr></thead><tbody>';
  entries.forEach(function(e) {
    html += '<tr><td>' + e.workDate + '</td><td>' + e.startTime + '</td><td>' + e.endTime + '</td>';
    html += '<td>' + e.breakMin + '</td><td>' + e.workMinutes + '</td></tr>';
  });
  html += '</tbody></table>';

  // 集計テーブル
  html += '<table class="summary-table"><tr><td>出社日数</td><td>' + summary.workDays + ' 日</td>';
  html += '<td>総勤務時間</td><td>' + summary.totalTimeDisplay + '</td></tr>';
  html += '<tr><td>給与</td><td>¥' + summary.wageYen.toLocaleString() + '</td>';
  html += '<td>交通費</td><td>¥' + summary.commuteYen.toLocaleString() + '</td></tr>';
  html += '<tr><td>総支給額</td><td colspan="3" class="right">¥' + summary.totalYen.toLocaleString() + '</td></tr></table>';

  // 押印欄
  html += '<div class="stamp-area">';
  route.forEach(function(r) {
    html += '<div class="stamp-box"><div class="label">承認' + r.stepNo + '</div><div style="height:45px;"></div></div>';
  });
  html += '<div class="stamp-box"><div class="label">申請者</div><div style="height:45px;"></div></div>';
  html += '</div>';

  html += '</body></html>';

  // Google Doc経由でPDF変換
  var tempDoc = DocumentApp.create('_temp_doc_' + uuid_());
  var docBody = tempDoc.getBody();
  docBody.clear();
  // シンプルなテキストベースのPDF（HTML直接変換は制限があるため）
  docBody.appendParagraph(settings.pdfTitle || '勤務実績報告書')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);

  docBody.appendParagraph('氏名: ' + emp.name + '    所属: ' + emp.dept);
  docBody.appendParagraph('対象期間: ' + periodDates.start + ' ～ ' + periodDates.end);
  docBody.appendParagraph('時給: ¥' + emp.hourlyWageYen + '    交通費単価: ¥' + emp.commutePerDayYen + '/日');
  docBody.appendParagraph('作成日: ' + today_());
  docBody.appendParagraph('');

  // テーブル
  var tableData = [['日付', '開始', '終了', '休憩(分)', '勤務(分)']];
  entries.forEach(function(e) {
    tableData.push([e.workDate, e.startTime, e.endTime, String(e.breakMin), String(e.workMinutes)]);
  });
  if (tableData.length > 1) {
    var table = docBody.appendTable(tableData);
    var headerRow = table.getRow(0);
    for (var c = 0; c < headerRow.getNumCells(); c++) {
      headerRow.getCell(c).setBackgroundColor('#e0e0e0');
    }
  }

  docBody.appendParagraph('');
  docBody.appendParagraph('出社日数: ' + summary.workDays + ' 日    総勤務時間: ' + summary.totalTimeDisplay);
  docBody.appendParagraph('給与: ¥' + summary.wageYen + '    交通費: ¥' + summary.commuteYen);
  docBody.appendParagraph('総支給額: ¥' + summary.totalYen)
    .setBold(true);

  // 押印欄
  docBody.appendParagraph('');
  var stampRow = [['申請者']];
  route.forEach(function(r) { stampRow[0].push('承認' + r.stepNo); });
  var stampTable = docBody.appendTable(stampRow);
  // 空行追加（署名スペース）
  var emptyTableRow = stampTable.appendTableRow();
  for (var si = 0; si < stampRow[0].length; si++) {
    emptyTableRow.appendTableCell('　\n　\n　');
  }

  tempDoc.saveAndClose();

  // PDF変換
  var pdfBlob = DriveApp.getFileById(tempDoc.getId()).getAs('application/pdf');
  pdfBlob.setName(emp.name + '_勤務報告_' + periodKey + '.pdf');

  // 一時ファイル削除
  DriveApp.getFileById(tempDoc.getId()).setTrashed(true);

  // Driveに保存
  var folderId = getOrCreateBackupFolder_();
  var savedFile = DriveApp.getFolderById(folderId).createFile(pdfBlob);

  writeAuditLog_('Export', savedFile.getId(), 'PDF_EXPORT', '', JSON.stringify({ employeeId: employeeId, periodKey: periodKey }), '');

  return { success: true, fileId: savedFile.getId(), url: savedFile.getUrl(), name: pdfBlob.getName() };
}

// =====================================================================
// 18. CSV出力
// =====================================================================
/** 月次サマリCSV（1行=1人） */
function exportCsvSummary(periodKey) {
  requireAdmin_();
  var settings = getSettings();
  var emps = getSheetData_('Employees').filter(function(e) { return toBool_(e.activeFlag); });
  var lines = [];
  lines.push(['employeeId', 'name', 'dept', 'periodKey', 'workDays', 'totalWorkMinutes', 'totalTimeDisplay', 'hourlyWage', 'wageYen', 'commutePerDay', 'commuteYen', 'totalYen'].join(','));

  emps.forEach(function(emp) {
    try {
      var s = calculateSummary(emp.employeeId, periodKey);
      lines.push([
        emp.employeeId, '"' + emp.name + '"', '"' + emp.dept + '"', periodKey,
        s.workDays, s.totalWorkMinutes, '"' + s.totalTimeDisplay + '"',
        s.hourlyWage, s.wageYen, s.commutePerDay, s.commuteYen, s.totalYen
      ].join(','));
    } catch (e) {
      // 明細がない職員はスキップまたは0行
      lines.push([
        emp.employeeId, '"' + emp.name + '"', '"' + emp.dept + '"', periodKey,
        0, 0, '"0:00"', emp.hourlyWageYen, 0, emp.commutePerDayYen, 0, 0
      ].join(','));
    }
  });

  var csvContent = lines.join('\n');
  // UTF-8 BOM
  var bom = '\uFEFF';
  var blob = Utilities.newBlob(bom + csvContent, 'text/csv', '月次サマリ_' + periodKey + '.csv');

  var folderId = getOrCreateBackupFolder_();
  var file = DriveApp.getFolderById(folderId).createFile(blob);
  writeAuditLog_('Export', file.getId(), 'CSV_SUMMARY_EXPORT', '', JSON.stringify({ periodKey: periodKey }), '');

  return { success: true, fileId: file.getId(), url: file.getUrl(), name: blob.getName() };
}

/** 明細CSV（1行=1枠） */
function exportCsvDetail(periodKey) {
  requireAdmin_();
  var entries = getSheetData_('TimeEntries').filter(function(e) {
    return e.periodKey === periodKey && e.status === 'ACTIVE';
  });

  var lines = [];
  lines.push(['entryId', 'employeeId', 'employeeName', 'dept', 'workDate', 'startTime', 'endTime', 'breakMin', 'workMinutes'].join(','));

  entries.forEach(function(e) {
    var emp = getEmployeeById_(e.employeeId);
    lines.push([
      e.entryId, e.employeeId, '"' + (emp ? emp.name : '') + '"', '"' + (emp ? emp.dept : '') + '"',
      e.workDate, e.startTime, e.endTime, e.breakMin, e.workMinutes
    ].join(','));
  });

  var csvContent = lines.join('\n');
  var bom = '\uFEFF';
  var blob = Utilities.newBlob(bom + csvContent, 'text/csv', '明細_' + periodKey + '.csv');

  var folderId = getOrCreateBackupFolder_();
  var file = DriveApp.getFolderById(folderId).createFile(blob);
  writeAuditLog_('Export', file.getId(), 'CSV_DETAIL_EXPORT', '', JSON.stringify({ periodKey: periodKey }), '');

  return { success: true, fileId: file.getId(), url: file.getUrl(), name: blob.getName() };
}

// =====================================================================
// 19. Excel出力 (.xlsx)
// =====================================================================
function exportExcel(periodKey) {
  requireAdmin_();
  var settings = getSettings();
  var emps = getSheetData_('Employees').filter(function(e) { return toBool_(e.activeFlag); });

  // 一時スプレッドシート作成
  var tempSS = SpreadsheetApp.create('勤務報告_' + periodKey + '_' + uuid_().substring(0, 6));

  // --- サマリシート ---
  var summarySheet = tempSS.getActiveSheet();
  summarySheet.setName('月次サマリ');
  summarySheet.appendRow(['職員ID', '氏名', '所属', '期間', '出社日数', '総勤務分', '総勤務時間', '時給', '給与', '交通費単価', '交通費', '総支給額']);
  summarySheet.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#e0e0e0');

  emps.forEach(function(emp) {
    try {
      var s = calculateSummary(emp.employeeId, periodKey);
      summarySheet.appendRow([
        emp.employeeId, emp.name, emp.dept, periodKey,
        s.workDays, s.totalWorkMinutes, s.totalTimeDisplay,
        s.hourlyWage, s.wageYen, s.commutePerDay, s.commuteYen, s.totalYen
      ]);
    } catch (e) {
      summarySheet.appendRow([emp.employeeId, emp.name, emp.dept, periodKey, 0, 0, '0:00', emp.hourlyWageYen, 0, emp.commutePerDayYen, 0, 0]);
    }
  });

  // --- 明細シート ---
  var detailSheet = tempSS.insertSheet('明細');
  detailSheet.appendRow(['明細ID', '職員ID', '氏名', '所属', '出社日', '開始', '終了', '休憩(分)', '勤務(分)']);
  detailSheet.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#e0e0e0');

  var entries = getSheetData_('TimeEntries').filter(function(e) {
    return e.periodKey === periodKey && e.status === 'ACTIVE';
  });
  entries.sort(function(a, b) {
    var cmp = a.employeeId.localeCompare(b.employeeId);
    return cmp !== 0 ? cmp : (a.workDate + a.startTime).localeCompare(b.workDate + b.startTime);
  });
  entries.forEach(function(e) {
    var emp = getEmployeeById_(e.employeeId);
    detailSheet.appendRow([
      e.entryId, e.employeeId, emp ? emp.name : '', emp ? emp.dept : '',
      e.workDate, e.startTime, e.endTime, e.breakMin, e.workMinutes
    ]);
  });

  SpreadsheetApp.flush();

  // xlsx変換
  var url = 'https://docs.google.com/spreadsheets/d/' + tempSS.getId() + '/export?format=xlsx';
  var token = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    DriveApp.getFileById(tempSS.getId()).setTrashed(true);
    throw new Error('Excel出力に失敗しました。');
  }

  var xlsxBlob = response.getBlob().setName('勤務報告_' + periodKey + '.xlsx');
  var folderId = getOrCreateBackupFolder_();
  var file = DriveApp.getFolderById(folderId).createFile(xlsxBlob);

  // 一時SS削除
  DriveApp.getFileById(tempSS.getId()).setTrashed(true);

  writeAuditLog_('Export', file.getId(), 'EXCEL_EXPORT', '', JSON.stringify({ periodKey: periodKey }), '');

  return { success: true, fileId: file.getId(), url: file.getUrl(), name: xlsxBlob.getName() };
}

// =====================================================================
// 20. バックアップ
// =====================================================================
function getOrCreateBackupFolder_() {
  var settings = getSettings();
  var folderId = settings.backupFolderId;
  if (folderId) {
    try {
      DriveApp.getFolderById(folderId);
      return folderId;
    } catch (e) {
      // フォルダが見つからない場合は作成
    }
  }
  var folder = DriveApp.createFolder('勤務申請_バックアップ_' + uuid_().substring(0, 6));
  updateSetting('backupFolderId', folder.getId());
  return folder.getId();
}

/** 手動バックアップ */
function createManualBackup() {
  var user = requireAdmin_();
  return createBackup_('manual', user.email);
}

/** 自動バックアップ（トリガーから呼出し） */
function createAutoBackup() {
  return createBackup_('auto', 'SYSTEM');
}

function createBackup_(type, actor) {
  var ss = getSS_();
  var folderId = getOrCreateBackupFolder_();
  var folder = DriveApp.getFolderById(folderId);

  // スプレッドシートをコピー
  var backupFile = DriveApp.getFileById(ss.getId()).makeCopy(
    'バックアップ_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss'),
    folder
  );

  var backupId = uuid_();
  appendToSheet_('Backups', {
    backupId: backupId,
    at: now_(),
    actorEmail: actor,
    backupType: type,
    driveFileId: backupFile.getId(),
    note: type === 'auto' ? '定期自動バックアップ' : '手動バックアップ'
  });

  writeAuditLog_('Backups', backupId, 'BACKUP_' + type.toUpperCase(), '', JSON.stringify({ driveFileId: backupFile.getId() }), '');

  return { success: true, backupId: backupId, fileId: backupFile.getId(), url: backupFile.getUrl() };
}

/** バックアップ一覧 */
function getBackups() {
  requireAdmin_();
  return getSheetData_('Backups');
}

/** バックアップトリガー設定 */
function setupAutoBackupTrigger() {
  requireAdmin_();
  // 既存トリガー削除
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'createAutoBackup') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // 毎日深夜2時に実行
  ScriptApp.newTrigger('createAutoBackup')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .inTimezone(TZ)
    .create();
  return { success: true, message: '自動バックアップトリガーを設定しました（毎日2:00）' };
}

// =====================================================================
// 21. 監査ログ (AuditLog)
// =====================================================================
function writeAuditLog_(targetType, targetId, action, beforeJson, afterJson, note) {
  var email = '';
  var role = '';
  try {
    email = getCurrentUserEmail_();
    var u = getCurrentUser();
    role = u.roles.join(',');
  } catch (e) {
    email = 'SYSTEM';
    role = 'SYSTEM';
  }
  appendToSheet_('AuditLog', {
    logId: uuid_(),
    at: now_(),
    actorEmail: email,
    actorRole: role,
    targetType: targetType,
    targetId: targetId,
    action: action,
    beforeJson: truncateJson_(beforeJson),
    afterJson: truncateJson_(afterJson),
    note: note || ''
  });
}

function truncateJson_(json) {
  if (!json) return '';
  var str = String(json);
  // 50000文字を超える場合は切り詰め
  if (str.length > 50000) {
    return str.substring(0, 50000) + '...(truncated)';
  }
  return str;
}

function getAuditLogs(limit, offset) {
  requireAdmin_();
  var all = getSheetData_('AuditLog');
  // 新しい順
  all.reverse();
  var start = offset || 0;
  var count = limit || 100;
  return all.slice(start, start + count);
}

// =====================================================================
// 22. メール通知
// =====================================================================
function notifyNextApprover_(submissionId, employeeId, periodKey, stepNo) {
  try {
    var route = getApprovalRouteForEmployee_(employeeId);
    var step = route.filter(function(r) { return parseInt(r.stepNo, 10) === stepNo; })[0];
    if (!step) return;
    var emp = getEmployeeById_(employeeId);
    var empName = emp ? emp.name : employeeId;
    var subject = '【勤務申請】承認依頼: ' + empName + ' (' + periodKey + ')';
    var body = empName + ' さんの勤務申請（' + periodKey + '）の承認をお願いします。\n';
    body += '承認ステップ: ' + stepNo + '\n';
    body += 'システムにログインして承認してください。';
    MailApp.sendEmail(step.approverEmail, subject, body);
  } catch (e) {
    Logger.log('通知メール送信エラー: ' + e.message);
  }
}

function notifyEmployee_(employeeId, periodKey, message) {
  try {
    var emp = getEmployeeById_(employeeId);
    if (!emp || !emp.email) return;
    var subject = '【勤務申請】通知: ' + periodKey;
    MailApp.sendEmail(emp.email, subject, message);
  } catch (e) {
    Logger.log('通知メール送信エラー: ' + e.message);
  }
}

// =====================================================================
// 23. 管理者向け一括取得
// =====================================================================
/** 管理ダッシュボード用データ */
function getAdminDashboard(periodKey) {
  requireAdmin_();
  var emps = getSheetData_('Employees');
  var subs = getSheetData_('Submissions');
  if (periodKey) {
    subs = subs.filter(function(s) { return s.periodKey === periodKey; });
  }
  return {
    employees: emps,
    submissions: subs,
    settings: getSettings()
  };
}

/** 全職員の指定期間サマリ */
function getAllSummaries(periodKey) {
  requireAdmin_();
  var emps = getSheetData_('Employees').filter(function(e) { return toBool_(e.activeFlag); });
  var results = [];
  emps.forEach(function(emp) {
    try {
      var s = calculateSummary(emp.employeeId, periodKey);
      var sub = getSubmissionByEmployeePeriod_(emp.employeeId, periodKey);
      results.push({
        employee: emp,
        summary: s,
        submission: sub
      });
    } catch (e) {
      results.push({
        employee: emp,
        summary: null,
        submission: null
      });
    }
  });
  return results;
}

// =====================================================================
// 24. 代理入力用
// =====================================================================
/** 管理者が職員を指定して明細一覧を取得 */
function getTimeEntriesForProxy(employeeId, periodKey) {
  requireAdmin_();
  return getSheetData_('TimeEntries').filter(function(e) {
    return e.employeeId === employeeId && e.periodKey === periodKey;
  });
}

/** 管理者が職員を指定してサマリを取得 */
function calculateSummaryForProxy(employeeId, periodKey) {
  requireAdmin_();
  return calculateSummary(employeeId, periodKey);
}
