const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const audit = require('@/auth/audit');

const authUser = async (req, res, { user, databasePassword, password }) => {
  const isMatch = await bcrypt.compare(databasePassword.salt + password, databasePassword.password);

  if (!isMatch) {
    await audit.record(req, {
      action: 'login_failed',
      entity: 'Admin',
      entityId: user._id,
      actor: user._id,
      outcome: 'failure',
      detail: { email: user.email },
    });

    return res.status(403).json({
      success: false,
      result: null,
      message: 'Invalid credentials.',
    });
  }

  const remember = Boolean(req.body.remember);
  const expiresInSeconds = remember ? 365 * 24 * 60 * 60 : 24 * 60 * 60;

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: expiresInSeconds,
  });

  // Store only a hash of the token; the raw JWT lives with the client.
  const Session = mongoose.model('Session');
  await Session.create({
    user: user._id,
    tokenHash: Session.hashToken(token),
    ip: audit.clientIp(req),
    userAgent: req.headers?.['user-agent'],
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  });

  await audit.record(req, {
    action: 'login',
    entity: 'Admin',
    entityId: user._id,
    actor: user._id,
    detail: { email: user.email },
  });

  return res.status(200).json({
    success: true,
    result: {
      _id: user._id,
      name: user.name,
      surname: user.surname,
      role: user.role,
      email: user.email,
      photo: user.photo,
      token: token,
      maxAge: remember ? 365 : null,
    },
    message: 'Successfully login user',
  });
};

module.exports = authUser;
