import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { CopilotService } from './core/copilot.service';
import { ChatTurn, CopilotResponse, Health, Intent, OpStatus, QueryResult } from './core/models';
import { highlightSql } from './core/sql-highlight';

interface Agent { value: Intent | null; label: string; icon: string; blurb: string; }
interface TraceStep { label: string; detail: string; state: 'ok' | 'warn' | 'fail'; }
interface GuardCheck { label: string; ok: boolean | null; }

const AGENTS: Agent[] = [
  { value: null, label: 'Auto', icon: '🧭', blurb: 'LangGraph router picks the agent' },
  { value: 'sql', label: 'SQL', icon: '🧮', blurb: 'Plain English → safe Snowflake SQL' },
  { value: 'rag', label: 'Docs', icon: '📚', blurb: 'Answers grounded in runbooks' },
  { value: 'dbt', label: 'dbt', icon: '🧬', blurb: 'Lineage, materialization, tests' },
  { value: 'data_quality', label: 'Data quality', icon: '🧪', blurb: 'Null & duplicate diagnostics' },
  { value: 'pipeline', label: 'Pipeline', icon: '🛠️', blurb: 'Airflow failure root cause' },
];

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  private api = inject(CopilotService);
  private input = viewChild<ElementRef<HTMLInputElement>>('composerInput');
  private messagesEl = viewChild<ElementRef<HTMLElement>>('messages');
  private timers: ReturnType<typeof setInterval>[] = [];

  readonly title = 'AI-Powered Data Engineering Copilot';
  readonly agents = AGENTS;
  readonly examples: { icon: string; text: string }[] = [
    { icon: '🧬', text: 'Explain the fct_orders model' },
    { icon: '🧪', text: 'Check nulls and duplicates in fct_orders' },
    { icon: '📚', text: 'Explain what to do about missing object errors' },
    { icon: '🛠️', text: 'Why did the orders_daily DAG fail?' },
    { icon: '🧮', text: 'How many orders and revenue per country?' },
  ];
  readonly stats = [
    { value: '5', label: 'specialist agents' },
    { value: '5', label: 'SQL guardrails' },
    { value: '0', label: 'writes to prod' },
  ];

  health = signal<Health | null>(null);
  turns = signal<ChatTurn[]>([]);
  mode = signal<Intent | null>(null);
  message = '';
  log = '';
  loading = signal(false);
  theme = signal<'dark' | 'light'>(this.initialTheme());

  // SQL workbench
  sql = signal('');
  editing = signal(false);
  copied = signal(false);
  sqlStatus = signal<OpStatus | null>(null);
  sqlErrors = signal<string[]>([]);
  result = signal<QueryResult | null>(null);
  view = signal<'chart' | 'table'>('chart');

  latest = computed<CopilotResponse | undefined>(() =>
    [...this.turns()].reverse().find((t) => t.response)?.response);
  activeAgent = computed(() => AGENTS.find((a) => a.value === this.mode()) ?? AGENTS[0]);
  highlighted = computed(() => highlightSql(this.sql()));

  /** Live guardrail checklist derived from validation errors. */
  guards = computed<GuardCheck[]>(() => {
    const s = this.sqlStatus();
    const errs = this.sqlErrors().join(' ').toLowerCase();
    const known = s === 'approved' || s === 'running' || s === 'succeeded' || (s === 'failed' && errs.length > 0);
    const check = (needle: RegExp) => (known ? !needle.test(errs) : null);
    return [
      { label: 'Single statement', ok: check(/exactly one/) },
      { label: 'Read-only (no DML / DDL)', ok: check(/blocked|only read-only/) },
      { label: 'Known tables only', ok: check(/unknown table/) },
      { label: 'Schema allowlist', ok: check(/allowlist|schema-qualified/) },
      { label: 'Row limit enforced', ok: known ? s !== 'failed' : null },
    ];
  });

  /** Bar chart from the first text column + first numeric column of the result. */
  chart = computed(() => {
    const r = this.result();
    if (!r?.rows.length) return null;
    const isNum = (c: string) => r.rows.every((row) => typeof row[c] === 'number');
    const valueCol = [...r.columns].reverse().find(isNum);
    const labelCol = r.columns.find((c) => !isNum(c)) ?? r.columns[0];
    if (!valueCol) return null;
    const max = Math.max(...r.rows.map((row) => Number(row[valueCol]))) || 1;
    return {
      labelCol, valueCol,
      bars: r.rows.map((row) => ({
        label: String(row[labelCol]),
        value: Number(row[valueCol]),
        pct: Math.max(2, (Number(row[valueCol]) / max) * 100),
      })),
    };
  });

  constructor() {
    // Keep the newest message in view as replies stream in.
    effect(() => {
      this.turns();
      this.loading();
      const el = this.messagesEl()?.nativeElement;
      if (el) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
    });
  }

  ngOnInit(): void {
    this.applyTheme();
    this.api.health().subscribe({
      next: (h) => this.health.set(h),
      error: () => this.health.set(null),
    });
  }

  ngOnDestroy(): void {
    this.timers.forEach(clearInterval);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const typing = ['INPUT', 'TEXTAREA'].includes(target?.tagName);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      this.input()?.nativeElement.focus();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && this.sqlStatus() === 'approved') this.run();
  }

  send(text = this.message): void {
    const msg = text.trim();
    if (!msg || this.loading()) return;
    this.turns.update((t) => [...t, { role: 'user', text: msg }]);
    this.message = '';
    this.loading.set(true);
    this.api.chat(msg, this.mode(), this.log || null).subscribe({
      next: (res) => {
        this.addAssistantTurn(res.answer, res);
        if (res.sql) {
          this.sql.set(res.sql);
          this.editing.set(false);
          this.sqlStatus.set(res.status === 'failed' ? 'failed' : 'proposed');
          this.sqlErrors.set(res.validation?.errors ?? []);
          this.result.set(null);
        }
        this.loading.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.addAssistantTurn(`Backend error: ${e.message}`);
        this.loading.set(false);
      },
    });
  }

  /** Adds the reply and reveals it word by word for a live "typing" feel. */
  private addAssistantTurn(text: string, response?: CopilotResponse): void {
    const words = text.split(/(\s+)/);
    const turn: ChatTurn = { role: 'assistant', text, response, shown: '' };
    this.turns.update((t) => [...t, turn]);
    let i = 0;
    const timer = setInterval(() => {
      i = Math.min(words.length, i + 3);
      turn.shown = words.slice(0, i).join('');
      this.turns.update((t) => [...t]);
      if (i >= words.length) {
        turn.shown = undefined;
        this.turns.update((t) => [...t]);
        clearInterval(timer);
      }
    }, 18);
    this.timers.push(timer);
  }

  trace(r: CopilotResponse): TraceStep[] {
    const agent = AGENTS.find((a) => a.value === r.intent);
    const steps: TraceStep[] = [
      { label: 'Router', detail: `intent → ${agent?.label ?? r.intent}`, state: 'ok' },
      { label: `${agent?.icon ?? '🤖'} ${agent?.label ?? r.agent} agent`, detail: r.status, state: r.status === 'failed' ? 'fail' : 'ok' },
    ];
    if (r.validation || r.checks) {
      const valid = r.validation ? r.validation.is_valid : r.checks!.every((c) => c.valid);
      steps.push({ label: 'SQL guard', detail: valid ? 'read-only ✓' : 'blocked', state: valid ? 'ok' : 'fail' });
    }
    if (r.sources) steps.push({ label: 'Retrieval', detail: `${r.sources.length} source${r.sources.length === 1 ? '' : 's'}`, state: r.sources.length ? 'ok' : 'warn' });
    if (r.requires_approval?.length) steps.push({ label: 'Human approval', detail: 'required for retries', state: 'warn' });
    return steps;
  }

  pickAgent(a: Agent): void {
    this.mode.set(a.value);
    this.input()?.nativeElement.focus();
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
      if (v.is_valid) { this.sql.set(v.sql); this.editing.set(false); }
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
    this.sqlErrors.set([]);
    this.result.set(null);
  }

  loadCheck(sql: string): void {
    this.onSqlEdit(sql);
    this.editing.set(false);
  }

  copySql(): void {
    navigator.clipboard?.writeText(this.sql()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1400);
    }).catch(() => undefined);
  }

  toggleTheme(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
    this.applyTheme();
    try { localStorage.setItem('copilot-theme', this.theme()); } catch { /* storage unavailable */ }
  }

  cell(row: Record<string, unknown>, col: string): string {
    const v = row[col];
    if (v === null || v === undefined) return '∅';
    return typeof v === 'number' ? v.toLocaleString() : String(v);
  }

  fmt(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
  }

  private initialTheme(): 'dark' | 'light' {
    try {
      const saved = localStorage.getItem('copilot-theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch { /* storage unavailable */ }
    return 'dark';
  }

  private applyTheme(): void {
    document.documentElement.setAttribute('data-theme', this.theme());
  }
}
