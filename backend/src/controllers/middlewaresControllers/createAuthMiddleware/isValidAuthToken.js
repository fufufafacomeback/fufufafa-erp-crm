const jwt = require('jsonwebtoken');

const mongoose = require('mongoose');

const isValidAuthToken = async (req, res, next, { userModel, jwtSecret = 'JWT_SECRET' }) => {
  try {
    const User = mongoose.model(userModel);
    const Session = mongoose.model('Session');

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Extract the token

    if (!token)
      return res.status(401).json({
        success: false,
        result: null,
        message: 'No authentication token, authorization denied.',
        jwtExpired: true,
      });

    const verified = jwt.verify(token, process.env[jwtSecret]);

    if (!verified)
      return res.status(401).json({
        success: false,
        result: null,
        message: 'Token verification failed, authorization denied.',
        jwtExpired: true,
      });

    // The token must still have a live session. This is what makes logout and
    // revocation take effect immediately instead of at token expiry.
    const session = await Session.findOne({
      tokenHash: Session.hashToken(token),
      user: verified.id,
      expiresAt: { $gt: new Date() },
    });

    if (!session)
      return res.status(401).json({
        success: false,
        result: null,
        message: 'Session expired or logged out, authorization denied.',
        jwtExpired: true,
      });

    const user = await User.findOne({ _id: verified.id, removed: false });

    if (!user)
      return res.status(401).json({
        success: false,
        result: null,
        message: "User doesn't Exist, authorization denied.",
        jwtExpired: true,
      });

    req[userModel.toLowerCase()] = user;
    return next();
  } catch (error) {
    const isTokenError =
      error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError';

    return res.status(isTokenError ? 401 : 500).json({
      success: false,
      result: null,
      message: isTokenError
        ? 'Invalid or expired token, authorization denied.'
        : error.message,
      jwtExpired: true,
    });
  }
};

module.exports = isValidAuthToken;
