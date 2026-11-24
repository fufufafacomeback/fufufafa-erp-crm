// Sessions store a hash of the JWT, never the token itself, so a database
// leak cannot be replayed as a login. TTL index expires rows automatically.
const mongoose = require('mongoose');
const crypto = require('crypto');

const sessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  ip: { type: String },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});

// 0 means "expire when expiresAt passes" per MongoDB TTL semantics.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = mongoose.model('Session', sessionSchema);
module.exports.hashToken = hashToken;
