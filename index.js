import { randomUUID } from 'node:crypto';

const STATUS_CODES = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT',
  422: 'VALIDATION_FAILED', 429: 'TOO_MANY_REQUESTS', 500: 'INTERNAL_ERROR', 502: 'BAD_GATEWAY', 503: 'SERVICE_UNAVAILABLE',
};

/** An error that carries an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    if (!Number.isInteger(status) || status < 400 || status > 599) throw new TypeError('ApiError status must be an HTTP error status (400-599)');
    super(message ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code ?? STATUS_CODES[status] ?? 'ERROR';
    this.details = details;
  }
}
const make = (status) => (message, details, code) => new ApiError(status, code ?? STATUS_CODES[status], message ?? STATUS_CODES[status], details);
export const badRequest = make(400);
export const unauthorized = make(401);
export const forbidden = make(403);
export const notFound = make(404);
export const conflict = make(409);
export const validationFailed = make(422);
export const tooManyRequests = make(429);
export const internal = make(500);

/** Build the success envelope. */
export function success(data = null, meta = {}) {
  return { success: true, data, error: null, meta: { timestamp: new Date().toISOString(), ...meta } };
}

/** Build the error envelope. */
export function failure(code, message, { details, ...meta } = {}) {
  if (typeof code !== 'string' || !code) throw new TypeError('failure needs an error code string');
  const error = { code, message: message ?? code };
  if (details !== undefined) error.details = details;
  return { success: false, data: null, error, meta: { timestamp: new Date().toISOString(), ...meta } };
}

/** Success envelope for a list, with computed pagination meta. */
export function paginated(items, { page, limit, total }, meta = {}) {
  if (!Array.isArray(items)) throw new TypeError('paginated expects an array of items');
  if (![page, limit, total].every((n) => Number.isInteger(n) && n >= 0) || limit < 1 || page < 1) throw new RangeError('page and limit must be >= 1 and total >= 0 integers');
  const totalPages = Math.ceil(total / limit);
  return success(items, { ...meta, pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 } });
}

/** Convert any thrown value to { status, body }. Details of unexpected (5xx) errors are never exposed unless `expose` is true. */
export function errorToResponse(err, { requestId, expose = false } = {}) {
  const meta = requestId ? { requestId } : {};
  if (err instanceof ApiError) {
    const hide = err.status >= 500 && !expose;
    return { status: err.status, body: failure(err.code, hide ? 'Internal server error' : err.message, { ...meta, details: hide ? undefined : err.details }) };
  }
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  const known = status < 500;
  return { status, body: failure(STATUS_CODES[status] ?? 'ERROR', known || expose ? String(err?.message ?? 'Error') : 'Internal server error', meta) };
}

/** Express/Connect-style middleware: sets req.id and the x-request-id header. */
export function requestId({ header = 'x-request-id' } = {}) {
  return (req, res, next) => {
    const incoming = req.headers?.[header];
    req.id = typeof incoming === 'string' && /^[\w.-]{1,128}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader?.(header, req.id);
    next();
  };
}

/** Adds res.ok(data, meta), res.created(data), res.paginated(items, p), res.noContent(), res.fail(err). */
export function responseMiddleware({ expose = false } = {}) {
  return (req, res, next) => {
    const withId = (m) => (req.id ? { requestId: req.id, ...m } : m);
    res.ok = (data, meta) => res.status(200).json(success(data, withId(meta)));
    res.created = (data, meta) => res.status(201).json(success(data, withId(meta)));
    res.paginated = (items, p, meta) => res.status(200).json(paginated(items, p, withId(meta)));
    res.noContent = () => res.status(204).end();
    res.fail = (err) => { const r = errorToResponse(err, { requestId: req.id, expose }); return res.status(r.status).json(r.body); };
    next();
  };
}

/** Final error-handling middleware (4 arguments, as Express requires) and a 404 handler. */
export function errorHandler({ expose = false, onError } = {}) {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    onError?.(err, req);
    const r = errorToResponse(err, { requestId: req.id, expose });
    res.status(r.status).json(r.body);
  };
}
export function notFoundHandler() {
  return (req, res, next) => next(new ApiError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl ?? req.url} not found`));
}
