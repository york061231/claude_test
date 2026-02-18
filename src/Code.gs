/**
 * Code.gs - Entry point, API routing, authentication, and authorization.
 * All client requests go through api() which dispatches to the appropriate handler.
 */

/* ============================================================
   Web App Entry Points
   ============================================================ */

/**
 * Serve the SPA.
 * Restricts access to authorized users only.
 */
function doGet(e) {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    return HtmlService.createHtmlOutput('<h2>アクセスが拒否されました</h2><p>Googleアカウントでログインしてください。</p>');
  }

  // Check if user has any role
  var role = getUserRole(email);
  if (!role) {
    // Also check if they're an employee
    var emp = getEmployeeByEmail(email);
    if (!emp) {
      return HtmlService.createHtmlOutput(
        '<h2>アクセスが拒否されました</h2>' +
        '<p>このシステムへのアクセス権限がありません。</p>' +
        '<p>管理者にお問い合わせください。</p>' +
        '<p>ログインユーザー: ' + email + '</p>'
      );
    }
  }

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('臨時職員勤務申請システム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ============================================================
   API Dispatcher
   ============================================================ */

/**
 * Main API endpoint called by google.script.run.
 * All client operations go through this single function.
 * @param {string} action - API action name
 * @param {Object} params - parameters
 * @returns {Object} result
 */
function api(action, params) {
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error('認証エラー: ログインが必要です');

  params = params || {};
  params._actorEmail = email;

  try {
    switch (action) {

      // === User Info ===
      case 'getCurrentUser':
        return getCurrentUser_(email);

      // === Period ===
      case 'getAvailablePeriods':
        return getAvailablePeriods();

      case 'getPeriodRange':
        return getPeriodRange(params.periodKey);

      // === Time Entries ===
      case 'getMyTimeEntries':
        return getMyTimeEntries_(email, params);

      case 'saveTimeEntry':
        return saveTimeEntryApi_(email, params);

      case 'deleteTimeEntry':
        return deleteTimeEntryApi_(email, params);

      case 'validateEntry':
        return validateTimeEntry(params.startTime, params.endTime, params.breakMin);

      // === Submissions ===
      case 'getMySubmission':
        return getMySubmission_(email, params);

      case 'submit':
        return submitApi_(email, params);

      case 'getMySubmissions':
        return getMySubmissions_(email);

      // === Approval ===
      case 'getApprovalQueue':
        return getApprovalQueue_(email);

      case 'getSubmissionDetail':
        return getSubmissionDetail_(email, params);

      case 'approve':
        return approveApi_(email, params);

      case 'returnSubmission':
        return returnApi_(email, params);

      // === Admin: Employees ===
      case 'getAllEmployees':
        requireAdmin_(email);
        return getAllEmployees();

      case 'saveEmployee':
        requireAdmin_(email);
        return saveEmployeeApi_(email, params);

      // === Admin: Roles ===
      case 'getAllRoles':
        requireAdmin_(email);
        return getAllRoles();

      case 'saveRole':
        requireAdmin_(email);
        return saveRoleApi_(email, params);

      case 'deleteRole':
        requireAdmin_(email);
        return deleteRoleApi_(email, params);

      // === Admin: Approval Routes ===
      case 'getAllApprovalRoutes':
        requireAdmin_(email);
        return getAllApprovalRoutes();

      case 'saveApprovalRoutes':
        requireAdmin_(email);
        return saveApprovalRoutesApi_(email, params);

      // === Admin: Lock/Reopen ===
      case 'lockPeriod':
        return lockPeriodAction(params.periodKey, email);

      case 'reopenSubmission':
        return reopenAction(params.submissionId, email, params.reason);

      case 'relockSubmission':
        return relockAction(params.submissionId, email);

      // === Admin: All Submissions ===
      case 'getAllSubmissions':
        requireAdmin_(email);
        return getAllSubmissionsApi_(params);

      // === Admin: Proxy Input ===
      case 'getEmployeesForProxy':
        requireAdmin_(email);
        return getActiveEmployees();

      case 'getProxyTimeEntries':
        requireAdmin_(email);
        return getTimeEntries(params.employeeId, params.periodKey);

      case 'saveProxyTimeEntry':
        return saveProxyTimeEntryApi_(email, params);

      // === Admin: Settings ===
      case 'getSettings':
        requireAdmin_(email);
        return getAllSettings();

      case 'saveSetting':
        requireAdmin_(email);
        return saveSettingApi_(email, params);

      // === Export ===
      case 'exportPdf':
        return exportPdfApi_(email, params);

      case 'exportCsvSummary':
        requireAdmin_(email);
        return exportCsvSummary(params.periodKey, email, params.charset);

      case 'exportCsvDetail':
        requireAdmin_(email);
        return exportCsvDetail(params.periodKey, email, params.charset);

      case 'exportExcel':
        requireAdmin_(email);
        return exportExcel(params.periodKey, email);

      // === Backup ===
      case 'manualBackup':
        return manualBackup(email);

      case 'getBackupRecords':
        requireAdmin_(email);
        return getBackupRecords();

      // === Audit ===
      case 'getAuditLogs':
        requireAdmin_(email);
        return getAuditLogs(params.targetType, params.targetId);

      default:
        throw new Error('不明なアクション: ' + action);
    }
  } catch (e) {
    Logger.log('API Error [' + action + ']: ' + e.message);
    throw e; // Re-throw so client sees the error
  }
}

/* ============================================================
   Authorization Helpers
   ============================================================ */

function requireAdmin_(email) {
  if (!isAdmin(email)) {
    throw new Error('管理者権限が必要です');
  }
}

function requireApproverOrAdmin_(email) {
  if (!isApprover(email)) {
    throw new Error('承認者または管理者権限が必要です');
  }
}

/* ============================================================
   API Implementation Functions
   ============================================================ */

function getCurrentUser_(email) {
  var role = getUserRole(email);
  var emp = getEmployeeByEmail(email);
  return {
    email: email,
    role: role || (emp ? 'CLERK' : null),
    employee: emp,
    isAdmin: role === 'ADMIN',
    isApprover: role === 'ADMIN' || role === 'APPROVER'
  };
}

// --- Time Entries ---

function getMyTimeEntries_(email, params) {
  var emp = getEmployeeByEmail(email);
  if (!emp) throw new Error('職員情報が見つかりません');
  var entries = getTimeEntries(emp.employeeId, params.periodKey);
  var summary = calcPeriodSummary(entries, emp.hourlyWageYen, emp.commutePerDayYen);
  return { entries: entries, summary: summary };
}

function saveTimeEntryApi_(email, params) {
  var emp = getEmployeeByEmail(email);
  if (!emp) throw new Error('職員情報が見つかりません');

  // Verify this entry belongs to the user
  if (params.entryId) {
    var existing = getTimeEntryById(params.entryId);
    if (existing && existing.employeeId !== emp.employeeId) {
      throw new Error('他の職員の明細は編集できません');
    }
  }

  return saveTimeEntryAction({
    entryId:     params.entryId || null,
    employeeId:  emp.employeeId,
    workDate:    params.workDate,
    startTime:   params.startTime,
    endTime:     params.endTime,
    breakMin:    params.breakMin,
    actorEmail:  email
  });
}

function deleteTimeEntryApi_(email, params) {
  var entry = getTimeEntryById(params.entryId);
  if (!entry) throw new Error('明細が見つかりません');

  var emp = getEmployeeByEmail(email);
  if (!emp || entry.employeeId !== emp.employeeId) {
    throw new Error('他の職員の明細は削除できません');
  }

  return deleteTimeEntryAction(params.entryId, email);
}

// --- Submissions ---

function getMySubmission_(email, params) {
  var emp = getEmployeeByEmail(email);
  if (!emp) throw new Error('職員情報が見つかりません');
  var sub = getSubmission(emp.employeeId, params.periodKey);
  var entries = getTimeEntries(emp.employeeId, params.periodKey);
  var summary = calcPeriodSummary(entries, emp.hourlyWageYen, emp.commutePerDayYen);
  var actions = sub ? getApprovalActions(sub.submissionId) : [];
  var route = getApprovalRoute(emp.employeeId);
  return {
    submission: sub,
    entries: entries,
    summary: summary,
    actions: actions,
    route: route
  };
}

function submitApi_(email, params) {
  var emp = getEmployeeByEmail(email);
  if (!emp) throw new Error('職員情報が見つかりません');
  ensureDraftSubmission(emp.employeeId, params.periodKey);
  return submitAction(emp.employeeId, params.periodKey, email);
}

function getMySubmissions_(email) {
  var emp = getEmployeeByEmail(email);
  if (!emp) return [];
  var allSubs = getSheetData_('Submissions');
  return allSubs.filter(function(s) { return s.employeeId === emp.employeeId; })
    .sort(function(a, b) { return a.periodKey > b.periodKey ? -1 : 1; });
}

// --- Approval ---

function getApprovalQueue_(email) {
  requireApproverOrAdmin_(email);
  var pending = getSubmissionsForApprover(email);
  return pending.map(function(sub) {
    var emp = getEmployeeById(sub.employeeId);
    return {
      submissionId: sub.submissionId,
      employeeId:   sub.employeeId,
      employeeName: emp ? emp.name : '',
      dept:         emp ? emp.dept : '',
      periodKey:    sub.periodKey,
      status:       sub.status,
      currentStepNo: sub.currentStepNo,
      totalWorkMinutes: sub.totalWorkMinutes,
      totalYen:     sub.totalYen,
      submittedAt:  sub.submittedAt
    };
  });
}

function getSubmissionDetail_(email, params) {
  var sub = getSubmissionById(params.submissionId);
  if (!sub) throw new Error('申請が見つかりません');

  // Verify access: admin, approver in route, or the employee themselves
  var emp = getEmployeeById(sub.employeeId);
  var myEmp = getEmployeeByEmail(email);
  var isOwner = myEmp && myEmp.employeeId === sub.employeeId;
  var isAdm = isAdmin(email);

  if (!isOwner && !isAdm) {
    // Check if this user is in the approval route
    var route = getApprovalRoute(sub.employeeId);
    var inRoute = route.some(function(r) { return r.approverEmail === email; });
    if (!inRoute) throw new Error('この申請へのアクセス権限がありません');
  }

  var entries = getTimeEntries(sub.employeeId, sub.periodKey);
  var summary = calcPeriodSummary(entries, emp.hourlyWageYen, emp.commutePerDayYen);
  var actions = getApprovalActions(sub.submissionId);
  var route = getApprovalRoute(sub.employeeId);

  return {
    submission: sub,
    employee:   emp,
    entries:    entries,
    summary:    summary,
    actions:    actions,
    route:      route
  };
}

function approveApi_(email, params) {
  return approveAction(params.submissionId, email, params.comment || '');
}

function returnApi_(email, params) {
  return returnAction(params.submissionId, email, params.comment);
}

// --- Admin: Employees ---

function saveEmployeeApi_(email, params) {
  var before = params.employeeId ? getEmployeeById(params.employeeId) : null;
  var result = saveEmployee(params);
  audit({
    actorEmail: email,
    targetType: 'Employee',
    targetId:   params.employeeId,
    action:     before ? 'UPDATE' : 'CREATE',
    before:     before,
    after:      result
  });
  return result;
}

// --- Admin: Roles ---

function saveRoleApi_(email, params) {
  saveRole(params.email, params.role, params.dept);
  audit({
    actorEmail: email,
    targetType: 'Role',
    targetId:   params.email,
    action:     'MASTER_CHANGE',
    after:      { email: params.email, role: params.role, dept: params.dept }
  });
  return { success: true };
}

function deleteRoleApi_(email, params) {
  var before = { email: params.targetEmail, role: params.role };
  deleteRole(params.targetEmail, params.role);
  audit({
    actorEmail: email,
    targetType: 'Role',
    targetId:   params.targetEmail,
    action:     'DELETE',
    before:     before,
    after:      null
  });
  return { success: true };
}

// --- Admin: Approval Routes ---

function saveApprovalRoutesApi_(email, params) {
  var before = getAllApprovalRoutes();
  saveApprovalRoutes(params.routes);
  audit({
    actorEmail: email,
    targetType: 'ApprovalRoute',
    targetId:   'ALL',
    action:     'MASTER_CHANGE',
    before:     { count: before.length },
    after:      { count: params.routes.length }
  });
  return { success: true };
}

// --- Admin: All Submissions ---

function getAllSubmissionsApi_(params) {
  if (params.periodKey) {
    var subs = getSubmissionsByPeriod(params.periodKey);
    return subs.map(function(sub) {
      var emp = getEmployeeById(sub.employeeId);
      return {
        submissionId: sub.submissionId,
        employeeId:   sub.employeeId,
        employeeName: emp ? emp.name : '',
        dept:         emp ? emp.dept : '',
        periodKey:    sub.periodKey,
        status:       sub.status,
        totalWorkMinutes: sub.totalWorkMinutes,
        workDays:     sub.workDays,
        wageYen:      sub.wageYen,
        commuteYen:   sub.commuteYen,
        totalYen:     sub.totalYen,
        lockedAt:     sub.lockedAt
      };
    });
  }
  return getAllSubmissions();
}

// --- Admin: Proxy ---

function saveProxyTimeEntryApi_(email, params) {
  requireAdmin_(email);
  var emp = getEmployeeById(params.employeeId);
  if (!emp) throw new Error('職員が見つかりません');

  var result = saveTimeEntryAction({
    entryId:     params.entryId || null,
    employeeId:  params.employeeId,
    workDate:    params.workDate,
    startTime:   params.startTime,
    endTime:     params.endTime,
    breakMin:    params.breakMin,
    actorEmail:  email
  });

  // Additional proxy audit is handled inside saveTimeEntryAction
  return result;
}

// --- Admin: Settings ---

function saveSettingApi_(email, params) {
  var before = getSetting(params.key);
  setSetting(params.key, params.value);
  audit({
    actorEmail: email,
    targetType: 'Settings',
    targetId:   params.key,
    action:     'MASTER_CHANGE',
    before:     { key: params.key, value: before },
    after:      { key: params.key, value: params.value }
  });
  return { success: true };
}

// --- Export ---

function exportPdfApi_(email, params) {
  // Allow employee to export their own, or admin to export any
  var emp = getEmployeeByEmail(email);
  if (emp && emp.employeeId === params.employeeId) {
    return exportPdf(params.employeeId, params.periodKey, email);
  }
  requireAdmin_(email);
  return exportPdf(params.employeeId, params.periodKey, email);
}
