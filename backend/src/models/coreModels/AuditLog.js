const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: { type: String, required: true, index: true },
  entity: { type: String, index: true },
  entityId: { type: String },
  actor: { type: String, index: true },
  actorEmail: { type: String },
  outcome: { type: String, enum: ['success', 'failure'], default: 'success' },
  detail: { type: mongoose.Schema.Types.Mixed },
  ip: { type: String },
  userAgent: { type: String },
  created: { type: Date, default: Date.now, index: true },
});

// Audit rows are append-only: block updates through the model.
auditLogSchema.pre('findOneAndUpdate', function () {
  throw new Error('Audit log entries are immutable');
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
