/**
 * Audit.gs - Audit logging for all system operations.
 * Every significant action is recorded with before/after state.
 */

/**
 * Write an audit log entry.
 * @param {Object} params
 *   actorEmail  - who performed the action
 *   targetType  - 'TimeEntry', 'Submission', 'Employee', 'ApprovalRoute', 'Settings', 'Export', etc.
 *   targetId    - ID of the target record
 *   action      - 'CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'APPROVE', 'RETURN',
 *                 'LOCK', 'REOPEN', 'RELOCK', 'EXPORT', 'BACKUP', 'MASTER_CHANGE', etc.
 *   before      - object/string of state before change (null for create)
 *   after       - object/string of state after change (null for delete)
 *   note        - additional info (e.g., proxy input, reopen reason)
 */
function audit(params) {
  var actorEmail = params.actorEmail || '';
  var actorRole  = '';
  try {
    actorRole = getUserRole(actorEmail) || '';
  } catch(e) { /* ignore */ }

  var beforeJson = '';
  var afterJson = '';

  try {
    if (params.before !== null && params.before !== undefined) {
      beforeJson = typeof params.before === 'string'
        ? params.before
        : JSON.stringify(summarizeForAudit_(params.before));
    }
  } catch(e) { beforeJson = String(params.before); }

  try {
    if (params.after !== null && params.after !== undefined) {
      afterJson = typeof params.after === 'string'
        ? params.after
        : JSON.stringify(summarizeForAudit_(params.after));
    }
  } catch(e) { afterJson = String(params.after); }

  appendAuditLog({
    actorEmail: actorEmail,
    actorRole:  actorRole,
    targetType: params.targetType || '',
    targetId:   params.targetId || '',
    action:     params.action || '',
    beforeJson: beforeJson,
    afterJson:  afterJson,
    ip:         params.ip || '',
    note:       params.note || ''
  });
}

/**
 * Summarize an object for audit logging.
 * Removes internal fields (_row) and truncates large fields.
 */
function summarizeForAudit_(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  var summary = {};
  Object.keys(obj).forEach(function(k) {
    if (k === '_row') return;
    var val = obj[k];
    if (typeof val === 'string' && val.length > 500) {
      summary[k] = val.substring(0, 500) + '...(truncated)';
    } else {
      summary[k] = val;
    }
  });
  return summary;
}

/**
 * Compute diff between two objects for audit purposes.
 * Returns only changed fields.
 */
function auditDiff(before, after) {
  if (!before) return { _new: true, data: summarizeForAudit_(after) };
  if (!after)  return { _deleted: true, data: summarizeForAudit_(before) };

  var diff = {};
  var allKeys = {};
  Object.keys(before).forEach(function(k) { allKeys[k] = true; });
  Object.keys(after).forEach(function(k) { allKeys[k] = true; });

  Object.keys(allKeys).forEach(function(k) {
    if (k === '_row') return;
    if (String(before[k]) !== String(after[k])) {
      diff[k] = { from: before[k], to: after[k] };
    }
  });
  return diff;
}

/**
 * Log a proxy (代理) action with clear attribution.
 */
function auditProxy(actorEmail, targetEmployeeId, action, targetType, targetId, before, after) {
  audit({
    actorEmail: actorEmail,
    targetType: targetType,
    targetId:   targetId,
    action:     action,
    before:     before,
    after:      after,
    note:       '代理操作: 操作者=' + actorEmail + ', 対象職員=' + targetEmployeeId
  });
}
