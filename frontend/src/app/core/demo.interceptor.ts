import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { delay, of, throwError } from 'rxjs';
import { SAMPLE_LOG, demoChat, demoHealth, demoRun, isDemoMode, validateSql } from './demo-backend';

/** In demo mode, answers /api/* in the browser instead of calling FastAPI. */
export const demoInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isDemoMode() || !req.url.startsWith('/api')) return next(req);
  const body = req.body as Record<string, any> | null;
  const ok = (data: unknown) => of(new HttpResponse({ status: 200, body: data })).pipe(delay(350));
  switch (req.url) {
    case '/api/health': return ok(demoHealth());
    case '/api/chat': return ok(demoChat(body?.['message'] ?? '', body?.['intent'] ?? null, body?.['log'] ?? null));
    case '/api/sql/validate': return ok(validateSql(body?.['sql'] ?? ''));
    case '/api/samples/logs': return ok({ 'orders_daily_failed.log': SAMPLE_LOG });
    case '/api/sql/run':
      try { return ok(demoRun(body?.['sql'] ?? '')); }
      catch (e) { return throwError(() => new HttpErrorResponse({ status: 400, error: { detail: (e as Error).message }, url: req.url })); }
    default: return throwError(() => new HttpErrorResponse({ status: 404, url: req.url }));
  }
};
