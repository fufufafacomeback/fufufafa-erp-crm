// Seeds users and returns tokens, for authorization tests.
const mongoose = require('mongoose');
const { generate: uniqueId } = require('shortid');
const { api } = require('./server');

const DEFAULT_PASSWORD = 'test-password-123';

// Creates an Admin + AdminPassword pair directly, bypassing the API.
async function createAdmin({ email, name = 'Test', role = 'owner', enabled = true }) {
  const Admin = mongoose.model('Admin');
  const AdminPassword = mongoose.model('AdminPassword');

  const admin = await new Admin({ email, name, surname: 'User', role, enabled }).save();

  const salt = uniqueId();
  const passwordHash = new AdminPassword().generateHash(salt, DEFAULT_PASSWORD);
  await new AdminPassword({
    password: passwordHash,
    salt,
    user: admin._id,
    emailVerified: true,
  }).save();

  return admin;
}

async function loginAs(email, password = DEFAULT_PASSWORD) {
  const res = await api('POST', '/api/login', { body: { email, password } });
  if (res.status !== 200 || !res.body?.result?.token) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.result.token;
}

// Convenience: create + log in, returning { admin, token }.
async function createAndLogin(opts) {
  const admin = await createAdmin(opts);
  const token = await loginAs(opts.email);
  return { admin, token };
}

module.exports = { createAdmin, loginAs, createAndLogin, DEFAULT_PASSWORD };
