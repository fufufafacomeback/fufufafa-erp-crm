// Audit trail for security-relevant events. Fire-and-forget: a logging failure
// must never break the request it is recording.
const mongoose = require('mongoose');

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

// action: 'login' | 'login_failed' | 'logout' | 'password_change' | 'delete' | ...
async function record(req, { action, entity, entityId, actor, outcome = 'success', detail }) {
  try {
    const AuditLog = mongoose.models.AuditLog;
    if (!AuditLog) return;

    await AuditLog.create({
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      actor: actor ? String(actor) : undefined,
      actorEmail: req?.admin?.email,
      outcome,
      detail,
      ip: req ? clientIp(req) : undefined,
      userAgent: req?.headers?.['user-agent'],
    });
  } catch (error) {
    // Never let audit failures surface to the caller.
    if (process.env.NODE_ENV !== 'test') {
      console.error('audit log failed:', error.message);
    }
  }
}

module.exports = { record, clientIp };
