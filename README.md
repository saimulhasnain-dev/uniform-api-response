# uniform-api-response

Every endpoint in your API should answer in the same shape. `uniform-api-response` gives your Node.js API one JSON envelope for success and errors, so frontend, mobile and partner teams write one response parser instead of one per endpoint.

## What it does

It standardises three things: the **success envelope**, the **error envelope** (stable machine-readable `code`, human `message`, optional `details`), and **pagination meta**. It also ships Express-compatible middleware (`res.ok`, `res.created`, `res.paginated`, a global error handler, a 404 handler and request IDs). Unexpected 5xx errors never leak internals. Zero dependencies, TypeScript types included.

```json
{ "success": true,  "data": { "id": 1 }, "error": null, "meta": { "timestamp": "2026-01-01T10:00:00.000Z", "requestId": "..." } }
{ "success": false, "data": null, "error": { "code": "NOT_FOUND", "message": "User 7 not found" }, "meta": { "timestamp": "...", "requestId": "..." } }
```

## Install

```sh
npm install uniform-api-response
```

## Usage

```js
import { success, failure, paginated, notFound, errorToResponse } from 'uniform-api-response';

success({ id: 1 });                                   // { success: true, data: { id: 1 }, error: null, meta: {...} }
failure('OUT_OF_STOCK', 'No stock left');              // { success: false, data: null, error: { code, message }, meta }
paginated(rows, { page: 2, limit: 20, total: 95 });    // meta.pagination = { page, limit, total, totalPages, hasNext, hasPrev }
errorToResponse(notFound('User 7 not found'));         // { status: 404, body: { success: false, ... } }
```

## API

- `success(data?, meta?)` / `failure(code, message?, { details?, ...meta })` build envelopes. `failure` throws `TypeError` without a code.
- `paginated(items, { page, limit, total }, meta?)` computes `totalPages`, `hasNext`, `hasPrev`. Throws `TypeError` / `RangeError` on bad input.
- `ApiError(status, code, message, details)` and helpers `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `validationFailed` (422), `tooManyRequests`, `internal`. Each takes `(message?, details?, code?)`.
- `errorToResponse(err, { requestId?, expose? })` returns `{ status, body }`. `ApiError` keeps its status and code; other errors with a 4xx `status` keep it; everything else is a 500 with a generic message unless `expose: true`.
- `requestId({ header? })` middleware: reuses a safe incoming `x-request-id` or generates a UUID; sets `req.id` and the response header.
- `responseMiddleware({ expose? })` adds `res.ok(data, meta)`, `res.created(data, meta)`, `res.paginated(items, p, meta)`, `res.noContent()`, `res.fail(err)`.
- `errorHandler({ expose?, onError? })` final error middleware; `notFoundHandler()` turns unmatched routes into a 404 envelope.
- Type `ApiResponse<T>` for your frontend or SDK.

## Where to use it

- A new REST API where you want a response contract from day one.
- An existing API with inconsistent errors (some `{ error: '...' }`, some `{ message }`) that you want to unify gradually.
- Microservices that must return the same envelope so a gateway or mobile app can handle them uniformly.
- Any API where you want the request ID in every response for log tracing.

## Integrate

```js
import express from 'express';
import { requestId, responseMiddleware, errorHandler, notFoundHandler, notFound, paginated } from 'uniform-api-response';

const app = express();
app.use(requestId(), responseMiddleware());

app.get('/users', async (req, res) => {
  const { rows, total } = await db.listUsers({ page: 1, limit: 20 });
  res.paginated(rows, { page: 1, limit: 20, total });
});
app.get('/users/:id', async (req, res) => {
  const user = await db.findUser(req.params.id);
  if (!user) throw notFound(`User ${req.params.id} not found`); // Express 5; in Express 4 call next(err)
  res.ok(user);
});

app.use(notFoundHandler(), errorHandler({ onError: (err) => logger.error(err) }));
```

## Limitations

- It defines its own envelope; it is not JSON:API or RFC 9457 Problem Details.
- Express 4 does not forward errors from `async` handlers: call `next(err)` or use Express 5.
- It does not validate request bodies; combine it with your validator and throw `validationFailed(...)`.
