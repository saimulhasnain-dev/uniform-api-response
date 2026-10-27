import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ApiError, badRequest, errorHandler, errorToResponse, failure, notFound, notFoundHandler, paginated, requestId, responseMiddleware, success, validationFailed } from './index.js';

test('success envelope has the fixed shape', () => {
  const r = success({ id: 1 }, { requestId: 'r1' });
  assert.equal(r.success, true);
  assert.deepEqual(r.data, { id: 1 });
  assert.equal(r.error, null);
  assert.equal(r.meta.requestId, 'r1');
  assert.ok(!Number.isNaN(Date.parse(r.meta.timestamp)));
});

test('failure envelope has code, message and optional details', () => {
  const r = failure('OUT_OF_STOCK', 'No stock', { details: { sku: 'a' }, requestId: 'r2' });
  assert.equal(r.success, false);
  assert.equal(r.data, null);
  assert.deepEqual(r.error, { code: 'OUT_OF_STOCK', message: 'No stock', details: { sku: 'a' } });
  assert.equal(r.meta.requestId, 'r2');
  assert.throws(() => failure(''), TypeError);
});

test('paginated computes totalPages, hasNext and hasPrev', () => {
  const r = paginated([1, 2], { page: 2, limit: 2, total: 5 });
  assert.deepEqual(r.meta.pagination, { page: 2, limit: 2, total: 5, totalPages: 3, hasNext: true, hasPrev: true });
  assert.equal(paginated([], { page: 1, limit: 10, total: 0 }).meta.pagination.hasNext, false);
  assert.throws(() => paginated('x', { page: 1, limit: 1, total: 1 }), TypeError);
  assert.throws(() => paginated([], { page: 0, limit: 1, total: 1 }), RangeError);
});

test('ApiError helpers set status and default codes', () => {
  assert.equal(notFound().status, 404);
  assert.equal(notFound().code, 'NOT_FOUND');
  assert.equal(validationFailed('bad', [{ field: 'x' }]).details[0].field, 'x');
  assert.equal(badRequest('x', undefined, 'MY_CODE').code, 'MY_CODE');
  assert.throws(() => new ApiError(200), TypeError);
});

test('errorToResponse maps ApiError and hides 5xx internals', () => {
  const a = errorToResponse(notFound('no user'), { requestId: 'q' });
  assert.equal(a.status, 404);
  assert.equal(a.body.error.message, 'no user');
  assert.equal(a.body.meta.requestId, 'q');
  const hidden = errorToResponse(new Error('password=hunter2 in stack'));
  assert.equal(hidden.status, 500);
  assert.equal(hidden.body.error.message, 'Internal server error');
  const shown = errorToResponse(new Error('boom'), { expose: true });
  assert.equal(shown.body.error.message, 'boom');
  const withStatus = errorToResponse(Object.assign(new Error('bad json'), { status: 400 }));
  assert.equal(withStatus.status, 400);
  assert.equal(withStatus.body.error.code, 'BAD_REQUEST');
});

// A tiny Express-like pipeline so we can test the middleware without depending on Express.
function run(handlers, req = {}) {
  const res = { headers: {}, headersSent: false, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; }, end() { this.headersSent = true; return this; } };
  req = { headers: {}, method: 'GET', url: '/x', ...req };
  let i = 0, error;
  const next = (err) => { if (err) error = err; step(); };
  const step = () => {
    const h = handlers[i++];
    if (!h) return;
    if (error ? h.length === 4 : h.length < 4) { try { error ? h(error, req, res, (e) => { error = e; step(); }) : h(req, res, next); } catch (e) { error = e; step(); } }
    else step();
  };
  step();
  return { req, res };
}

test('requestId reuses a safe incoming id and otherwise generates one', () => {
  const a = run([requestId()], { headers: { 'x-request-id': 'abc-123' } });
  assert.equal(a.req.id, 'abc-123');
  assert.equal(a.res.headers['x-request-id'], 'abc-123');
  const b = run([requestId()], { headers: { 'x-request-id': 'bad id\nwith newline' } });
  assert.match(b.req.id, /^[0-9a-f-]{36}$/);
});

test('res.ok / res.created / res.paginated send the envelope', () => {
  const { res } = run([requestId(), responseMiddleware(), (req, res) => res.ok({ a: 1 })]);
  assert.equal(res.code, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.meta.requestId.length, 36);
  const c = run([responseMiddleware(), (req, res) => res.created({ id: 9 })]);
  assert.equal(c.res.code, 201);
  const p = run([responseMiddleware(), (req, res) => res.paginated([1], { page: 1, limit: 1, total: 3 })]);
  assert.equal(p.res.body.meta.pagination.totalPages, 3);
});

test('errorHandler turns thrown errors and unknown routes into the error envelope', () => {
  const seen = [];
  const thrown = run([requestId(), () => { throw validationFailed('Invalid', [{ field: 'email' }]); }, errorHandler({ onError: (e) => seen.push(e.code) })]);
  assert.equal(thrown.res.code, 422);
  assert.equal(thrown.res.body.error.code, 'VALIDATION_FAILED');
  assert.deepEqual(seen, ['VALIDATION_FAILED']);
  const missing = run([notFoundHandler(), errorHandler()], { method: 'POST', url: '/nope' });
  assert.equal(missing.res.code, 404);
  assert.match(missing.res.body.error.message, /POST \/nope/);
});

test('real HTTP server returns a correct JSON error response', async () => {
  const server = http.createServer((req, res) => {
    const r = errorToResponse(notFound('Missing'));
    res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
