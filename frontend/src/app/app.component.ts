import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { CopilotService } from './core/copilot.service';
import { ChatTurn, CopilotResponse, Health, Intent, OpStatus, QueryResult } from './core/models';

interface Mode { value: Intent | null; label: string; }

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private api = inject(CopilotService);

  readonly title = 'AI-Powered Data Engineering Copilot';
  readonly modes: Mode[] = [
    { value: null, label: 'Auto' },
    { value: 'sql', label: 'SQL' },
    { value: 'rag', label: 'Docs' },
    { value: 'dbt', label: 'dbt' },
    { value: 'data_quality', label: 'Data quality' },
    { value: 'pipeline', label: 'Pipeline' },
  ];
  readonly examples = [
    'Explain the fct_orders model',
    'Check nulls and duplicates in fct_orders',
    'Explain what to do about missing object errors',
    'Why did the orders_daily DAG fail?',
    'How many orders and revenue per country?',
  ];

  health = signal<Health | null>(null);
  turns = signal<ChatTurn[]>([]);
  mode = signal<Intent | null>(null);
  message = '';
  log = '';
  loading = signal(false);

  // SQL workbench
  sql = signal('');
  sqlStatus = signal<OpStatus | null>(null);
  sqlErrors = signal<string[]>([]);
  result = signal<QueryResult | null>(null);
  latest = computed<CopilotResponse | undefined>(() =>
    [...this.turns()].reverse().find((t) => t.response)?.response);

  ngOnInit(): void {
    this.api.health().subscribe({
      next: (h) => this.health.set(h),
      error: () => this.health.set(null),
    });
  }

  send(text = this.message): void {
    const msg = text.trim();
    if (!msg || this.loading()) return;
    this.turns.update((t) => [...t, { role: 'user', text: msg }]);
    this.message = '';
    this.loading.set(true);
    this.api.chat(msg, this.mode(), this.log || null).subscribe({
      next: (res) => {
        this.turns.update((t) => [...t, { role: 'assistant', text: res.answer, response: res }]);
        if (res.sql) {
          this.sql.set(res.sql);
          this.sqlStatus.set(res.status === 'failed' ? 'failed' : 'proposed');
          this.sqlErrors.set(res.validation?.errors ?? []);
          this.result.set(null);
        }
        this.loading.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.turns.update((t) => [...t, { role: 'assistant', text: `Backend error: ${e.message}` }]);
        this.loading.set(false);
      },
    });
  }

  loadSampleLog(): void {
    this.api.sampleLogs().subscribe((logs) => {
      this.log = Object.values(logs)[0] ?? '';
      this.mode.set('pipeline');
    });
  }

  validate(): void {
    this.api.validateSql(this.sql()).subscribe((v) => {
      this.sqlErrors.set(v.errors);
      this.sqlStatus.set(v.is_valid ? 'approved' : 'failed');
      if (v.is_valid) this.sql.set(v.sql);
    });
  }

  /** Explicit, user-triggered execution. The backend re-validates before running. */
  run(): void {
    this.sqlStatus.set('running');
    this.api.runSql(this.sql()).subscribe({
      next: (r) => { this.result.set(r); this.sqlStatus.set('succeeded'); this.sqlErrors.set([]); },
      error: (e: HttpErrorResponse) => {
        this.sqlStatus.set('failed');
        this.sqlErrors.set([e.error?.detail ?? e.message]);
      },
    });
  }

  onSqlEdit(value: string): void {
    this.sql.set(value);
    this.sqlStatus.set('proposed'); // edited SQL must be re-validated before Run
    this.result.set(null);
  }

  cell(row: Record<string, unknown>, col: string): string {
    const v = row[col];
    return v === null || v === undefined ? '∅' : String(v);
  }
}
