/**
 * Workflow.gs - Submission, approval, return, lock, and reopen logic.
 * Manages the full lifecycle: DRAFT -> SUBMITTED -> IN_REVIEW -> APPROVED -> LOCKED
 * with RETURNED and REOPENED as exception paths.
 */

/* ============================================================
   Save / Update Time Entries
   ============================================================ */

/**
 * Save a time entry (create or update).
 * Validates input, recalculates summary, logs audit.
 * @param {Object} params - { entryId?, employeeId, workDate, startTime, endTime, breakMin, actorEmail }
 * @returns {Object} saved entry + recalculated summary
 */
function saveTimeEntryAction(params) {
  var actorEmail = params.actorEmail;
  var employeeId = params.employeeId;

  // Validate
  var vResult = validateTimeEntry(params.startTime, params.endTime, params.breakMin);
  if (!vResult.valid) throw new Error(vResult.error);

  // Check submission status — cannot edit if LOCKED or APPROVED
  var periodKey = computePeriodKey(params.workDate);
  var sub = getSubmission(employeeId, periodKey);
  if (sub && (sub.status === 'LOCKED' || sub.status === 'APPROVED')) {
    throw new Error('この期間は' + sub.status + '状態のため編集できません');
  }

  var before = params.entryId ? getTimeEntryById(params.entryId) : null;

  var entry = {
    entryId:     params.entryId || Utilities.getUuid(),
    employeeId:  employeeId,
    workDate:    params.workDate,
    startTime:   params.startTime,
    endTime:     params.endTime,
    breakMin:    parseInt(params.breakMin, 10) || 0,
    workMinutes: vResult.workMinutes,
    periodKey:   periodKey,
    status:      'ACTIVE',
    updatedBy:   actorEmail
  };
  if (!before) {
    entry.createdBy = actorEmail;
  }

  var saved = saveTimeEntry(entry);

  // If submission was RETURNED, keep it in RETURNED so user can re-edit
  if (sub && sub.status === 'SUBMITTED') {
    // Reset to DRAFT if editing after submit (before approval starts)
    saveSubmission({ submissionId: sub.submissionId, status: 'DRAFT', currentStepNo: 0 });
  }

  // Recalculate
  var summary = recalcSubmission(employeeId, periodKey);

  // Audit
  var isProxy = actorEmail !== getEmployeeById(employeeId).email;
  if (isProxy) {
    auditProxy(actorEmail, employeeId,
      before ? 'UPDATE' : 'CREATE', 'TimeEntry', saved.entryId, before, saved);
  } else {
    audit({
      actorEmail: actorEmail,
      targetType: 'TimeEntry',
      targetId:   saved.entryId,
      action:     before ? 'UPDATE' : 'CREATE',
      before:     before,
      after:      saved
    });
  }

  return { entry: saved, summary: summary };
}

/**
 * Delete a time entry.
 */
function deleteTimeEntryAction(entryId, actorEmail) {
  var entry = getTimeEntryById(entryId);
  if (!entry) throw new Error('明細が見つかりません');

  var sub = getSubmission(entry.employeeId, entry.periodKey);
  if (sub && (sub.status === 'LOCKED' || sub.status === 'APPROVED')) {
    throw new Error('この期間は編集できません');
  }

  deleteTimeEntry(entryId);

  // Recalculate
  var summary = recalcSubmission(entry.employeeId, entry.periodKey);

  // Audit
  audit({
    actorEmail: actorEmail,
    targetType: 'TimeEntry',
    targetId:   entryId,
    action:     'DELETE',
    before:     entry,
    after:      null
  });

  return summary;
}

/* ============================================================
   Draft Save
   ============================================================ */

/**
 * Ensure a submission record exists in DRAFT status.
 */
function ensureDraftSubmission(employeeId, periodKey) {
  var sub = getSubmission(employeeId, periodKey);
  if (!sub) {
    var emp = getEmployeeById(employeeId);
    var entries = getTimeEntries(employeeId, periodKey);
    var summary = calcPeriodSummary(entries, emp.hourlyWageYen, emp.commutePerDayYen);
    sub = {
      submissionId:    Utilities.getUuid(),
      employeeId:      employeeId,
      periodKey:       periodKey,
      status:          'DRAFT',
      totalWorkMinutes: summary.totalWorkMinutes,
      workDays:        summary.workDays,
      wageYen:         summary.wageYen,
      commuteYen:      summary.commuteYen,
      totalYen:        summary.totalYen,
      currentStepNo:   0,
      submittedAt:     '',
      lastActionAt:    new Date().toISOString(),
      lockedAt:        '',
      snapshotJson:    ''
    };
    saveSubmission(sub);
  }
  return sub;
}

/* ============================================================
   Submit
   ============================================================ */

/**
 * Submit a period for approval.
 */
function submitAction(employeeId, periodKey, actorEmail) {
  var sub = ensureDraftSubmission(employeeId, periodKey);

  if (sub.status !== 'DRAFT' && sub.status !== 'RETURNED') {
    throw new Error('下書きまたは差戻し状態でないと提出できません (現在: ' + sub.status + ')');
  }

  // Recalculate before submit
  var entries = getTimeEntries(employeeId, periodKey);
  if (entries.length === 0) {
    throw new Error('勤務明細がありません');
  }
  var emp = getEmployeeById(employeeId);
  var summary = calcPeriodSummary(entries, emp.hourlyWageYen, emp.commutePerDayYen);

  var route = getApprovalRoute(employeeId);
  if (route.length === 0) {
    throw new Error('承認ルートが設定されていません');
  }

  var before = JSON.parse(JSON.stringify(sub));

  saveSubmission({
    submissionId:    sub.submissionId,
    employeeId:      employeeId,
    periodKey:       periodKey,
    status:          'SUBMITTED',
    totalWorkMinutes: summary.totalWorkMinutes,
    workDays:        summary.workDays,
    wageYen:         summary.wageYen,
    commuteYen:      summary.commuteYen,
    totalYen:        summary.totalYen,
    currentStepNo:   1,
    submittedAt:     new Date().toISOString(),
    lastActionAt:    new Date().toISOString(),
    lockedAt:        '',
    snapshotJson:    ''
  });

  // Notify first approver
  var firstApprover = route[0].approverEmail;
  notifyApprover_(firstApprover, emp.name, periodKey, '新規提出');

  // Audit
  audit({
    actorEmail: actorEmail,
    targetType: 'Submission',
    targetId:   sub.submissionId,
    action:     'SUBMIT',
    before:     before,
    after:      { status: 'SUBMITTED', currentStepNo: 1 }
  });

  return { success: true, submissionId: sub.submissionId };
}

/* ============================================================
   Approve
   ============================================================ */

/**
 * Approve a submission at the current step.
 */
function approveAction(submissionId, actorEmail, comment) {
  var sub = getSubmissionById(submissionId);
  if (!sub) throw new Error('申請が見つかりません');
  if (sub.status !== 'SUBMITTED' && sub.status !== 'IN_REVIEW') {
    throw new Error('承認可能な状態ではありません (現在: ' + sub.status + ')');
  }

  var route = getApprovalRoute(sub.employeeId);
  var currentStep = Number(sub.currentStepNo) || 1;
  var stepEntry = route.filter(function(r) { return Number(r.stepNo) === currentStep; })[0];

  if (!stepEntry || stepEntry.approverEmail !== actorEmail) {
    throw new Error('この承認段階の承認者ではありません');
  }

  // Record action
  addApprovalAction({
    submissionId: submissionId,
    stepNo:       currentStep,
    actorEmail:   actorEmail,
    action:       'approve',
    comment:      comment || ''
  });

  var maxStep = Math.max.apply(null, route.map(function(r) { return Number(r.stepNo); }));

  var before = { status: sub.status, currentStepNo: currentStep };

  if (currentStep >= maxStep) {
    // Final approval
    saveSubmission({
      submissionId: submissionId,
      status:       'APPROVED',
      currentStepNo: currentStep,
      lastActionAt: new Date().toISOString()
    });

    // Notify employee
    var emp = getEmployeeById(sub.employeeId);
    notifyEmployee_(emp.email, sub.periodKey, '最終承認完了');

    audit({
      actorEmail: actorEmail,
      targetType: 'Submission',
      targetId:   submissionId,
      action:     'APPROVE_FINAL',
      before:     before,
      after:      { status: 'APPROVED', currentStepNo: currentStep }
    });
  } else {
    // Advance to next step
    var nextStep = currentStep + 1;
    saveSubmission({
      submissionId: submissionId,
      status:       'IN_REVIEW',
      currentStepNo: nextStep,
      lastActionAt: new Date().toISOString()
    });

    // Notify next approver
    var nextApprover = route.filter(function(r) { return Number(r.stepNo) === nextStep; })[0];
    if (nextApprover) {
      var emp2 = getEmployeeById(sub.employeeId);
      notifyApprover_(nextApprover.approverEmail, emp2.name, sub.periodKey, '承認待ち (段階' + nextStep + ')');
    }

    audit({
      actorEmail: actorEmail,
      targetType: 'Submission',
      targetId:   submissionId,
      action:     'APPROVE',
      before:     before,
      after:      { status: 'IN_REVIEW', currentStepNo: nextStep }
    });
  }

  return { success: true };
}

/* ============================================================
   Return (差戻し)
   ============================================================ */

/**
 * Return a submission to the applicant.
 * Comment is mandatory.
 */
function returnAction(submissionId, actorEmail, comment) {
  if (!comment || comment.trim() === '') {
    throw new Error('差戻し時はコメントが必須です');
  }

  var sub = getSubmissionById(submissionId);
  if (!sub) throw new Error('申請が見つかりません');
  if (sub.status !== 'SUBMITTED' && sub.status !== 'IN_REVIEW') {
    throw new Error('差戻し可能な状態ではありません');
  }

  var route = getApprovalRoute(sub.employeeId);
  var currentStep = Number(sub.currentStepNo) || 1;
  var stepEntry = route.filter(function(r) { return Number(r.stepNo) === currentStep; })[0];

  if (!stepEntry || stepEntry.approverEmail !== actorEmail) {
    throw new Error('この承認段階の承認者ではありません');
  }

  addApprovalAction({
    submissionId: submissionId,
    stepNo:       currentStep,
    actorEmail:   actorEmail,
    action:       'return',
    comment:      comment
  });

  var before = { status: sub.status, currentStepNo: currentStep };

  saveSubmission({
    submissionId: submissionId,
    status:       'RETURNED',
    currentStepNo: 0,
    lastActionAt: new Date().toISOString()
  });

  // Notify employee
  var emp = getEmployeeById(sub.employeeId);
  notifyEmployee_(emp.email, sub.periodKey, '差戻し: ' + comment);

  audit({
    actorEmail: actorEmail,
    targetType: 'Submission',
    targetId:   submissionId,
    action:     'RETURN',
    before:     before,
    after:      { status: 'RETURNED', comment: comment }
  });

  return { success: true };
}

/* ============================================================
   Lock (締め)
   ============================================================ */

/**
 * Lock (締め) all approved submissions for a period.
 * Only admin can execute.
 */
function lockPeriodAction(periodKey, actorEmail) {
  if (!isAdmin(actorEmail)) throw new Error('管理者権限が必要です');

  var subs = getSubmissionsByPeriod(periodKey);
  var lockedCount = 0;

  subs.forEach(function(sub) {
    if (sub.status === 'APPROVED') {
      // Create snapshot
      var entries = getTimeEntries(sub.employeeId, sub.periodKey);
      var emp = getEmployeeById(sub.employeeId);
      var summary = calcPeriodSummary(entries, emp.hourlyWageYen, emp.commutePerDayYen);
      var snapshot = {
        employee:  { name: emp.name, dept: emp.dept, hourlyWageYen: emp.hourlyWageYen, commutePerDayYen: emp.commutePerDayYen },
        summary:   summary,
        entries:   entries.map(function(e) {
          return { workDate: e.workDate, startTime: e.startTime, endTime: e.endTime, breakMin: e.breakMin, workMinutes: e.workMinutes };
        }),
        lockedAt:  new Date().toISOString()
      };

      saveSubmission({
        submissionId: sub.submissionId,
        status:       'LOCKED',
        lockedAt:     new Date().toISOString(),
        lastActionAt: new Date().toISOString(),
        snapshotJson: JSON.stringify(snapshot)
      });

      audit({
        actorEmail: actorEmail,
        targetType: 'Submission',
        targetId:   sub.submissionId,
        action:     'LOCK',
        before:     { status: 'APPROVED' },
        after:      { status: 'LOCKED' }
      });

      lockedCount++;
    }
  });

  return { success: true, lockedCount: lockedCount };
}

/* ============================================================
   Reopen (再締め解除)
   ============================================================ */

/**
 * Reopen a locked submission for correction.
 * Admin only, reason is mandatory.
 */
function reopenAction(submissionId, actorEmail, reason) {
  if (!isAdmin(actorEmail)) throw new Error('管理者権限が必要です');
  if (!reason || reason.trim() === '') throw new Error('解除理由が必須です');

  var sub = getSubmissionById(submissionId);
  if (!sub) throw new Error('申請が見つかりません');
  if (sub.status !== 'LOCKED') throw new Error('ロック状態の申請のみ解除できます');

  var before = { status: 'LOCKED', lockedAt: sub.lockedAt };

  saveSubmission({
    submissionId: submissionId,
    status:       'REOPENED',
    lockedAt:     '',
    lastActionAt: new Date().toISOString()
  });

  audit({
    actorEmail: actorEmail,
    targetType: 'Submission',
    targetId:   submissionId,
    action:     'REOPEN',
    before:     before,
    after:      { status: 'REOPENED', reason: reason },
    note:       '再締め解除理由: ' + reason
  });

  return { success: true };
}

/**
 * Re-lock a reopened submission after corrections.
 * Admin only.
 */
function relockAction(submissionId, actorEmail) {
  if (!isAdmin(actorEmail)) throw new Error('管理者権限が必要です');

  var sub = getSubmissionById(submissionId);
  if (!sub) throw new Error('申請が見つかりません');
  if (sub.status !== 'REOPENED' && sub.status !== 'APPROVED') {
    throw new Error('再ロック可能な状態ではありません (現在: ' + sub.status + ')');
  }

  // Recalculate and create new snapshot
  var entries = getTimeEntries(sub.employeeId, sub.periodKey);
  var emp = getEmployeeById(sub.employeeId);
  var summary = calcPeriodSummary(entries, emp.hourlyWageYen, emp.commutePerDayYen);
  var snapshot = {
    employee:  { name: emp.name, dept: emp.dept, hourlyWageYen: emp.hourlyWageYen, commutePerDayYen: emp.commutePerDayYen },
    summary:   summary,
    entries:   entries.map(function(e) {
      return { workDate: e.workDate, startTime: e.startTime, endTime: e.endTime, breakMin: e.breakMin, workMinutes: e.workMinutes };
    }),
    lockedAt:  new Date().toISOString()
  };

  saveSubmission({
    submissionId:    submissionId,
    status:          'LOCKED',
    totalWorkMinutes: summary.totalWorkMinutes,
    workDays:        summary.workDays,
    wageYen:         summary.wageYen,
    commuteYen:      summary.commuteYen,
    totalYen:        summary.totalYen,
    lockedAt:        new Date().toISOString(),
    lastActionAt:    new Date().toISOString(),
    snapshotJson:    JSON.stringify(snapshot)
  });

  audit({
    actorEmail: actorEmail,
    targetType: 'Submission',
    targetId:   submissionId,
    action:     'RELOCK',
    before:     { status: sub.status },
    after:      { status: 'LOCKED', summary: summary }
  });

  return { success: true };
}

/* ============================================================
   Notifications (Email)
   ============================================================ */

function notifyApprover_(email, employeeName, periodKey, subject) {
  try {
    var settings = getAllSettings();
    var sysName = settings['SYSTEM_NAME'] || '勤務申請システム';
    MailApp.sendEmail({
      to:      email,
      subject: '[' + sysName + '] ' + subject,
      body:    employeeName + ' さんの勤務申請 (' + periodKey + ') が承認待ちです。\n\nシステムにログインして確認してください。'
    });
  } catch(e) {
    Logger.log('メール送信エラー (approver): ' + e.message);
  }
}

function notifyEmployee_(email, periodKey, message) {
  try {
    var settings = getAllSettings();
    var sysName = settings['SYSTEM_NAME'] || '勤務申請システム';
    MailApp.sendEmail({
      to:      email,
      subject: '[' + sysName + '] 勤務申請通知 (' + periodKey + ')',
      body:    message + '\n\n対象期間: ' + periodKey + '\n\nシステムにログインして確認してください。'
    });
  } catch(e) {
    Logger.log('メール送信エラー (employee): ' + e.message);
  }
}
