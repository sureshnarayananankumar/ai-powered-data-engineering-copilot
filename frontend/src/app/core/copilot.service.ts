import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CopilotResponse, Health, Intent, QueryResult, SqlValidation } from './models';

/** All backend calls live here. The base URL is proxied to FastAPI in dev (proxy.conf.json). */
@Injectable({ providedIn: 'root' })
export class CopilotService {
  private http = inject(HttpClient);
  private base = '/api';

  health(): Observable<Health> {
    return this.http.get<Health>(`${this.base}/health`);
  }

  chat(message: string, intent?: Intent | null, log?: string | null): Observable<CopilotResponse> {
    return this.http.post<CopilotResponse>(`${this.base}/chat`, { message, intent: intent ?? null, log: log ?? null });
  }

  validateSql(sql: string): Observable<SqlValidation> {
    return this.http.post<SqlValidation>(`${this.base}/sql/validate`, { sql });
  }

  /** Only called from the explicit Run button after the user reviews the SQL. */
  runSql(sql: string): Observable<QueryResult> {
    return this.http.post<QueryResult>(`${this.base}/sql/run`, { sql });
  }

  sampleLogs(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>(`${this.base}/samples/logs`);
  }
}
