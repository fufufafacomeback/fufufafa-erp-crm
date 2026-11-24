// One place to enforce password rules. Used by setup, create, reset and update
// so the policy cannot drift between entry points.
const MIN_LENGTH = 10;

function validatePassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return { valid: false, message: 'Password is required.' };
  }
  if (password.length < MIN_LENGTH) {
    return {
      valid: false,
      message: `The password needs to be at least ${MIN_LENGTH} characters long.`,
    };
  }
  return { valid: true };
}

module.exports = { validatePassword, MIN_LENGTH };
