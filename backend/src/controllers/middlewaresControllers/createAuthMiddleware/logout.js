const mongoose = require('mongoose');

const audit = require('@/auth/audit');

const logout = async (req, res, { userModel }) => {
  const Session = mongoose.model('Session');
  const actor = req[userModel.toLowerCase()];

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extract the token

  if (token) {
    await Session.deleteOne({ tokenHash: Session.hashToken(token) });
  } else {
    // No token to identify the session, so end every session for this user.
    await Session.deleteMany({ user: actor._id });
  }

  await audit.record(req, {
    action: 'logout',
    entity: userModel,
    entityId: actor._id,
    actor: actor._id,
  });

  return res.json({
    success: true,
    result: {},
    message: 'Successfully logout',
  });
};

module.exports = logout;
