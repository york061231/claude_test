/**
 * Trigger.gs - Time-based triggers for automated backups and notifications.
 */

/* ============================================================
   Trigger Setup
   ============================================================ */

/**
 * Install all required triggers. Run once during setup.
 * Safe to call multiple times — removes existing triggers first.
 */
function installTriggers() {
  // Remove existing project triggers
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'dailyAutoBackup' || fn === 'monthlyCloseReminder') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Daily backup at 2:00 AM JST
  ScriptApp.newTrigger('dailyAutoBackup')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .nearMinute(0)
    .inTimezone('Asia/Tokyo')
    .create();

  // Monthly close reminder on the 24th (day before close day)
  ScriptApp.newTrigger('monthlyCloseReminder')
    .timeBased()
    .onMonthDay(24)
    .atHour(9)
    .nearMinute(0)
    .inTimezone('Asia/Tokyo')
    .create();

  Logger.log('Triggers installed successfully.');
}

/**
 * Remove all project triggers.
 */
function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });
  Logger.log('All triggers removed.');
}

/* ============================================================
   Auto Backup
   ============================================================ */

/**
 * Automatic daily backup. Called by time trigger.
 * Copies the entire spreadsheet to the backup folder.
 */
function dailyAutoBackup() {
  performBackup_('SYSTEM', 'auto', '自動日次バックアップ');
}

/**
 * Manual backup. Called from admin UI.
 */
function manualBackup(actorEmail) {
  if (!isAdmin(actorEmail)) throw new Error('管理者権限が必要です');
  return performBackup_(actorEmail, 'manual', '手動バックアップ');
}

/**
 * Internal backup implementation.
 */
function performBackup_(actorEmail, backupType, note) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var folderId = getSetting('BACKUP_FOLDER_ID');

  // Ensure backup folder exists
  var folder;
  if (folderId) {
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch(e) {
      folder = null;
    }
  }
  if (!folder) {
    folder = DriveApp.createFolder('勤務申請_バックアップ');
    setSetting('BACKUP_FOLDER_ID', folder.getId());
    folderId = folder.getId();
  }

  // Create backup copy
  var timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
  var backupName = ss.getName() + '_backup_' + timestamp;
  var backupFile = DriveApp.getFileById(ss.getId()).makeCopy(backupName, folder);

  // Record in Backups sheet
  var record = addBackupRecord({
    at:         new Date().toISOString(),
    actorEmail: actorEmail,
    backupType: backupType,
    driveFileId: backupFile.getId(),
    note:       note
  });

  // Audit
  audit({
    actorEmail: actorEmail,
    targetType: 'Backup',
    targetId:   record.backupId,
    action:     'BACKUP',
    after:      { driveFileId: backupFile.getId(), backupType: backupType }
  });

  return {
    success: true,
    backupId: record.backupId,
    fileId: backupFile.getId(),
    fileName: backupName
  };
}

/* ============================================================
   Close Reminder
   ============================================================ */

/**
 * Send reminder to employees who haven't submitted for the current period.
 * Called on the 24th (day before close).
 */
function monthlyCloseReminder() {
  var now = new Date();
  var periodKey = computePeriodKey(Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd'));

  var employees = getActiveEmployees();
  var settings = getAllSettings();
  var sysName = settings['SYSTEM_NAME'] || '勤務申請システム';

  employees.forEach(function(emp) {
    var sub = getSubmission(emp.employeeId, periodKey);
    if (!sub || sub.status === 'DRAFT') {
      try {
        MailApp.sendEmail({
          to: emp.email,
          subject: '[' + sysName + '] 締め日前日リマインダ (' + periodKey + ')',
          body: emp.name + ' さん\n\n' +
            '対象期間 ' + periodKey + ' の勤務申請がまだ提出されていません。\n' +
            '締め日前にシステムにログインして提出をお願いします。\n\n' +
            sysName
        });
      } catch(e) {
        Logger.log('リマインダ送信エラー: ' + emp.email + ' - ' + e.message);
      }
    }
  });
}
