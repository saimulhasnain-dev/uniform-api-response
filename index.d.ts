export interface ApiMeta { timestamp: string; requestId?: string; pagination?: Pagination; [key: string]: unknown }
export interface Pagination { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean }
export interface ApiErrorBody { code: string; message: string; details?: unknown }
export type ApiResponse<T = unknown> =
  | { success: true; data: T; error: null; meta: ApiMeta }
  | { success: false; data: null; error: ApiErrorBody; meta: ApiMeta };

export class ApiError extends Error {
  readonly status: number; readonly code: string; readonly details?: unknown;
  constructor(status: number, code?: string, message?: string, details?: unknown);
}
type Factory = (message?: string, details?: unknown, code?: string) => ApiError;
export const badRequest: Factory, unauthorized: Factory, forbidden: Factory, notFound: Factory, conflict: Factory,
  validationFailed: Factory, tooManyRequests: Factory, internal: Factory;

export function success<T>(data?: T, meta?: Record<string, unknown>): ApiResponse<T>;
export function failure(code: string, message?: string, options?: { details?: unknown; [meta: string]: unknown }): ApiResponse<never>;
export function paginated<T>(items: T[], p: { page: number; limit: number; total: number }, meta?: Record<string, unknown>): ApiResponse<T[]>;
export function errorToResponse(err: unknown, options?: { requestId?: string; expose?: boolean }): { status: number; body: ApiResponse<never> };
export function requestId(options?: { header?: string }): (req: any, res: any, next: (err?: unknown) => void) => void;
export function responseMiddleware(options?: { expose?: boolean }): (req: any, res: any, next: (err?: unknown) => void) => void;
export function errorHandler(options?: { expose?: boolean; onError?: (err: unknown, req: any) => void }): (err: unknown, req: any, res: any, next: (err?: unknown) => void) => void;
export function notFoundHandler(): (req: any, res: any, next: (err?: unknown) => void) => void;
