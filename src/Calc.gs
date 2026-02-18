/**
 * Calc.gs - Calculation logic for work minutes, wages, and commute.
 * Server-side is the source of truth; UI uses these for display.
 */

/**
 * Calculate work minutes for a single time entry.
 * Returns integer minutes, or throws on validation error.
 */
function calcWorkMinutes(startTime, endTime, breakMin) {
  var startParts = String(startTime).split(':');
  var endParts   = String(endTime).split(':');
  if (startParts.length < 2 || endParts.length < 2) {
    throw new Error('時間形式が不正です (HH:MM)');
  }
  var startMin = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
  var endMin   = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);
  var brk      = parseInt(breakMin, 10) || 0;

  if (isNaN(startMin) || isNaN(endMin)) {
    throw new Error('時間の数値が不正です');
  }
  if (endMin <= startMin) {
    throw new Error('終了時間は開始時間より後にしてください');
  }
  if (brk < 0) {
    throw new Error('休憩分は0以上にしてください');
  }
  var work = endMin - startMin - brk;
  if (work < 0) {
    throw new Error('休憩時間が勤務時間を超えています');
  }
  return work;
}

/**
 * Calculate summary for a period.
 * @param {Array} entries - TimeEntry objects for the period
 * @param {number} hourlyWageYen - hourly wage
 * @param {number} commutePerDayYen - commute cost per work day
 * @returns {Object} { totalWorkMinutes, workDays, wageYen, commuteYen, totalYen, dailyDetails }
 */
function calcPeriodSummary(entries, hourlyWageYen, commutePerDayYen) {
  var hourly = parseInt(hourlyWageYen, 10) || 0;
  var commute = parseInt(commutePerDayYen, 10) || 0;

  // Group by workDate
  var byDate = {};
  entries.forEach(function(e) {
    var d = String(e.workDate).substring(0, 10); // YYYY-MM-DD
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(e);
  });

  var totalWorkMinutes = 0;
  var dailyDetails = [];

  Object.keys(byDate).sort().forEach(function(date) {
    var dayEntries = byDate[date];
    var dayMinutes = 0;
    var slots = [];
    dayEntries.forEach(function(e) {
      var wm = parseInt(e.workMinutes, 10) || 0;
      dayMinutes += wm;
      slots.push({
        entryId: e.entryId,
        startTime: e.startTime,
        endTime: e.endTime,
        breakMin: parseInt(e.breakMin, 10) || 0,
        workMinutes: wm
      });
    });
    totalWorkMinutes += dayMinutes;
    dailyDetails.push({
      workDate: date,
      slots: slots,
      dayMinutes: dayMinutes
    });
  });

  // Work days: count of distinct dates where total > 0
  var workDays = dailyDetails.filter(function(d) { return d.dayMinutes > 0; }).length;

  // Wage: floor( totalWorkMinutes * hourlyWage / 60 )
  var wageYen = Math.floor(totalWorkMinutes * hourly / 60);

  // Commute: workDays * commutePerDay
  var commuteYen = workDays * commute;

  // Total
  var totalYen = wageYen + commuteYen;

  return {
    totalWorkMinutes: totalWorkMinutes,
    workDays: workDays,
    wageYen: wageYen,
    commuteYen: commuteYen,
    totalYen: totalYen,
    dailyDetails: dailyDetails,
    hourlyWageYen: hourly,
    commutePerDayYen: commute
  };
}

/**
 * Format minutes as "Xh YYm" string.
 */
function formatMinutesHM(minutes) {
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  return h + ':' + ('0' + m).slice(-2);
}

/**
 * Validate a single time entry input.
 * Returns { valid: bool, error: string|null, workMinutes: number|null }
 */
function validateTimeEntry(startTime, endTime, breakMin) {
  try {
    var wm = calcWorkMinutes(startTime, endTime, breakMin);
    return { valid: true, error: null, workMinutes: wm };
  } catch (e) {
    return { valid: false, error: e.message, workMinutes: null };
  }
}

/**
 * Recalculate and update summary for a submission.
 * Called after any time entry change.
 */
function recalcSubmission(employeeId, periodKey) {
  var entries = getTimeEntries(employeeId, periodKey);
  var emp = getEmployeeById(employeeId);
  if (!emp) throw new Error('職員が見つかりません: ' + employeeId);

  var summary = calcPeriodSummary(entries, emp.hourlyWageYen, emp.commutePerDayYen);

  var sub = getSubmission(employeeId, periodKey);
  if (sub) {
    saveSubmission({
      submissionId: sub.submissionId,
      totalWorkMinutes: summary.totalWorkMinutes,
      workDays: summary.workDays,
      wageYen: summary.wageYen,
      commuteYen: summary.commuteYen,
      totalYen: summary.totalYen
    });
  }
  return summary;
}
