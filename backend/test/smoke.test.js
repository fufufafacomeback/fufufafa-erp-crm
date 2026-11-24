const { test, before, after } = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api } = require('./helpers/server');
const { createAndLogin } = require('./helpers/auth');

before(startServer);
after(stopServer);

test('unauthenticated request is rejected with 401', async () => {
  const res = await api('GET', '/api/client/list');
  assert.strictEqual(res.status, 401);
});

test('login with a seeded admin returns a token', async () => {
  const { token } = await createAndLogin({ email: 'smoke@test.com' });
  assert.ok(token, 'expected a token');
});

test('authenticated request reaches the API', async () => {
  const { token } = await createAndLogin({ email: 'smoke2@test.com' });
  const res = await api('GET', '/api/client/list', { token });
  // 203 is this API's "collection is empty" response.
  assert.ok([200, 203].includes(res.status), `unexpected status ${res.status}`);
});

test('unknown route returns 404 once authenticated', async () => {
  const { token } = await createAndLogin({ email: 'smoke3@test.com' });
  const res = await api('GET', '/api/does-not-exist', { token });
  assert.strictEqual(res.status, 404);
});
