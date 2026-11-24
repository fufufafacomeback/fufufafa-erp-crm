// Test server helper: boots the real app on an ephemeral port against a
// throwaway database, and drops that database on teardown.
require('module-alias/register');

const mongoose = require('mongoose');
const { globSync } = require('glob');
const path = require('path');

// Load the real .env so we inherit the same credentials/host as dev, then
// swap only the database name. This keeps auth working locally (the dev Mongo
// requires credentials) while CI can pass TEST_DATABASE directly.
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const TEST_DB = 'idurar_test';

function buildTestDatabaseUrl() {
  if (process.env.TEST_DATABASE) return process.env.TEST_DATABASE;

  const base = process.env.DATABASE;
  if (!base) return `mongodb://localhost:27017/${TEST_DB}`;

  // The dev URI may or may not include a database name, so parse rather than
  // regex the whole string: split the query off, then look for a path segment
  // only after the "//" authority.
  const [uri, query] = base.split('?');
  const authorityEnd = uri.indexOf('//') + 2;
  const slashAfterHost = uri.indexOf('/', authorityEnd);
  const withoutDb = slashAfterHost === -1 ? uri : uri.slice(0, slashAfterHost);

  // Adding a db name changes the default authSource from "admin" to that db,
  // so pin it explicitly when the caller did not.
  const params = query ? query : '';
  const authSource = /(^|&)authSource=/.test(params) ? '' : 'authSource=admin';
  const allParams = [params, authSource].filter(Boolean).join('&');

  return `${withoutDb}/${TEST_DB}${allParams ? `?${allParams}` : ''}`;
}

// Must be set before any module reads process.env.DATABASE.
process.env.NODE_ENV = 'test';
process.env.DATABASE = buildTestDatabaseUrl();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-for-production';

let server;
let baseUrl;

async function startServer() {
  await mongoose.connect(process.env.DATABASE);

  // server.js normally loads every model by glob before requiring app.
  for (const file of globSync('./src/models/**/*.js')) {
    require(path.resolve(file));
  }

  const app = require('../../src/app');
  app.set('port', 0);

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

async function stopServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
}

// Thin wrapper so tests read as `await api('POST', '/api/login', { body })`.
async function api(method, route, { body, token, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };

  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (token) init.headers.Authorization = `Bearer ${token}`;

  const res = await fetch(baseUrl + route, init);
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  return { status: res.status, body: json, headers: res.headers, text };
}

module.exports = { startServer, stopServer, api, getBaseUrl: () => baseUrl };
