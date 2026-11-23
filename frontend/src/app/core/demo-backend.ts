/**
 * DEMO MODE — an in-browser stand-in for the FastAPI backend.
 *
 * Used automatically when the app is hosted on GitHub Pages (or opened with ?demo=1),
 * so people can click around without running Python. It mirrors the backend's
 * offline behaviour on the same synthetic sample data. It is NOT the real backend:
 * no LLM, no Snowflake, and "Run" returns generated sample rows.
 */
import { CopilotResponse, Health, Intent, QueryResult, SqlValidation } from './models';

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.endsWith('github.io') || new URLSearchParams(window.location.search).has('demo');
}

// ---------- sample data (same as /sample_data) ----------
const SCHEMA: Record<string, string[]> = {
  'ANALYTICS.FCT_ORDERS': ['ORDER_ID', 'CUSTOMER_ID', 'ORDER_DATE', 'STATUS', 'AMOUNT'],
  'ANALYTICS.DIM_CUSTOMERS': ['CUSTOMER_ID', 'CUSTOMER_NAME', 'COUNTRY', 'CREATED_AT'],
  'STAGING.STG_PAYMENTS': ['PAYMENT_ID', 'ORDER_ID', 'PAYMENT_METHOD', 'AMOUNT'],
};

const MODELS: Record<string, { desc: string; mat: string; up: string[]; down: string[]; tests: string[] }> = {
  stg_payments: { desc: 'Cleans raw payments and converts cents to dollars.', mat: 'view', up: ['raw.payments'], down: ['fct_orders'], tests: [] },
  fct_orders: { desc: 'Order fact table joining orders with payment totals.', mat: 'incremental', up: ['raw.orders', 'stg_payments'], down: ['dim_customers'], tests: ['unique_fct_orders_order_id', 'not_null_fct_orders_customer_id'] },
  dim_customers: { desc: 'Customer dimension with first/last order dates.', mat: 'table', up: ['raw.customers', 'fct_orders'], down: [], tests: [] },
};

const DOCS: { source: string; section: string; text: string }[] = [
  { source: 'orders_pipeline_runbook.md', section: 'Freshness expectations', text: 'ANALYTICS.FCT_ORDERS should contain orders up to the previous day by 03:00 UTC. If freshness is breached, check the load_fct_orders task first.' },
  { source: 'orders_pipeline_runbook.md', section: 'Missing object errors', text: '"Object does not exist or not authorized" usually means an upstream source was renamed or the dbt role lost SELECT privileges. Confirm with the read-only role before retrying. Retrying or clearing tasks requires approval from the on-call data engineer.' },
  { source: 'orders_pipeline_runbook.md', section: 'Incremental model behaviour', text: 'fct_orders is incremental on ORDER_DATE. A full refresh is only allowed in a maintenance window with approval from the data platform lead.' },
  { source: 'data_quality_standards.md', section: 'Primary keys', text: 'Every fact and dimension table must have a unique, non-null primary key. ORDER_ID is the key of FCT_ORDERS; CUSTOMER_ID is the key of DIM_CUSTOMERS.' },
  { source: 'data_quality_standards.md', section: 'Null thresholds', text: 'Foreign keys such as CUSTOMER_ID in FCT_ORDERS must have zero nulls. Descriptive columns may have up to 1% nulls.' },
];

export const SAMPLE_LOG = `[2026-11-20, 02:00:03 UTC] {taskinstance.py:1157} INFO - Dependencies all met for dag_id=orders_daily, task_id=load_fct_orders, run_id=scheduled__2026-11-19
[2026-11-20, 02:00:04 UTC] {dbt.py:88} INFO - Running: dbt run --select fct_orders
[2026-11-20, 02:03:41 UTC] {dbt.py:120} INFO - 1 of 1 START incremental model ANALYTICS.fct_orders
[2026-11-20, 02:03:52 UTC] {dbt.py:120} ERROR - Database Error in model fct_orders: 002003 (42S02): SQL compilation error: Object 'RAW.PAYMENTS_V2' does not exist or not authorized.
[2026-11-20, 02:03:52 UTC] {taskinstance.py:1937} ERROR - Task failed with exception
[2026-11-20, 02:03:52 UTC] {taskinstance.py:1400} INFO - Marking task as FAILED. dag_id=orders_daily, task_id=load_fct_orders`;

// ---------- agents ----------
const RULES: [Intent, string[]][] = [
  ['pipeline', ['airflow', 'dag', 'task failed', 'pipeline', 'retry', 'log']],
  ['data_quality', ['null', 'duplicate', 'freshness', 'row count', 'data quality', 'dq ', 'referential']],
  ['dbt', ['dbt', 'model', 'materialization', 'ref(', 'source(', 'manifest']],
  ['sql', ['sql', 'query', 'how many', 'top ', 'total', 'revenue', 'count', 'average', 'sum of', 'list ']],
  ['rag', ['what is', 'explain', 'document', 'runbook', 'how does', 'why']],
];

export function classify(message: string): Intent {
  const text = ` ${message.toLowerCase()} `;
  return RULES.find(([, kws]) => kws.some((k) => text.includes(k)))?.[0] ?? 'general';
}

const BLOCKED = /\b(insert|update|delete|merge|create|alter|drop|truncate|copy|call|grant|revoke)\b/i;

export function validateSql(sql: string, maxRows = 500): SqlValidation {
  const errors: string[] = [];
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (!trimmed) errors.push('SQL is empty.');
  if (trimmed.includes(';')) errors.push('Exactly one statement is allowed.');
  if (!/^\s*(select|with)\b/i.test(trimmed)) errors.push('Only read-only SELECT queries are allowed.');
  const bad = trimmed.match(BLOCKED);
  if (bad) errors.push(`Blocked operation detected: ${bad[1].toUpperCase()}.`);
  const ctes = new Set([...trimmed.matchAll(/\b(\w+)\s+as\s*\(/gi)].map((m) => m[1].toUpperCase()));
  const tables = [...new Set([...trimmed.matchAll(/\b(?:from|join)\s+([\w.]+)/gi)].map((m) => m[1].toUpperCase()))]
    .filter((t) => !ctes.has(t));
  for (const t of tables) {
    if (!t.includes('.')) errors.push(`Table '${t}' must be schema-qualified.`);
    else if (!SCHEMA[t]) errors.push(`Unknown table '${t}' (not found in schema metadata).`);
  }
  if (errors.length) return { is_valid: false, sql, errors, tables };
  const limit = trimmed.match(/\blimit\s+(\d+)\s*$/i);
  const out = limit ? (Number(limit[1]) > maxRows ? trimmed.replace(/\blimit\s+\d+\s*$/i, `LIMIT ${maxRows}`) : trimmed) : `${trimmed}\nLIMIT ${maxRows}`;
  return { is_valid: true, sql: out, errors: [], tables };
}

function sqlAgent(message: string): CopilotResponse {
  const m = message.toLowerCase();
  let sql: string;
  let answer: string;
  if (m.includes('country')) {
    sql = `SELECT c.COUNTRY, COUNT(*) AS ORDERS, SUM(o.AMOUNT) AS REVENUE
FROM ANALYTICS.FCT_ORDERS o
JOIN ANALYTICS.DIM_CUSTOMERS c ON o.CUSTOMER_ID = c.CUSTOMER_ID
GROUP BY c.COUNTRY
ORDER BY REVENUE DESC`;
    answer = 'Joins orders to customers and totals order count and revenue per country, highest revenue first.';
  } else if (m.includes('payment')) {
    sql = `SELECT PAYMENT_METHOD, COUNT(*) AS PAYMENTS, SUM(AMOUNT) AS TOTAL
FROM STAGING.STG_PAYMENTS
GROUP BY PAYMENT_METHOD
ORDER BY TOTAL DESC`;
    answer = 'Totals payments by payment method.';
  } else {
    sql = `SELECT DATE_TRUNC('month', ORDER_DATE) AS MONTH, COUNT(*) AS ORDERS, SUM(AMOUNT) AS REVENUE
FROM ANALYTICS.FCT_ORDERS
GROUP BY 1
ORDER BY 1 DESC`;
    answer = 'Counts orders and revenue per month from the orders fact table.';
  }
  const v = validateSql(sql);
  return {
    intent: 'sql', agent: 'sql', status: 'proposed', sql: v.sql,
    answer: `${answer}\n\n(Demo mode: SQL comes from a template. With an OpenAI key the real backend generates it from the schema.)`,
    assumptions: 'Uses only tables in the sample schema; amounts are in USD.',
    validation: { is_valid: v.is_valid, errors: v.errors, tables: v.tables },
  };
}

function ragAgent(message: string): CopilotResponse {
  const stop = new Set(['the', 'a', 'an', 'is', 'of', 'to', 'and', 'in', 'what', 'how', 'does', 'do', 'for', 'on', 'it', 'this', 'should', 'about']);
  const tok = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((w) => !stop.has(w) && w.length > 2));
  const q = tok(message);
  const hits = DOCS.map((d) => {
    const dt = tok(`${d.section} ${d.text}`);
    return { d, score: q.size ? [...q].filter((w) => dt.has(w)).length / q.size : 0 };
  }).filter((h) => h.score >= 0.25).sort((a, b) => b.score - a.score).slice(0, 3);
  if (!hits.length) {
    return { intent: 'rag', agent: 'rag', status: 'succeeded', sources: [], answer: "I couldn't find this in the approved knowledge base, so I won't guess." };
  }
  return {
    intent: 'rag', agent: 'rag', status: 'succeeded', answer: hits[0].d.text,
    sources: hits.map((h) => ({ source: h.d.source, section: h.d.section, score: Math.round(h.score * 100) / 100 })),
  };
}

function dbtAgent(message: string): CopilotResponse {
  const words = new Set(message.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
  const name = Object.keys(MODELS).find((m) => words.has(m));
  if (!name) {
    return { intent: 'dbt', agent: 'dbt', status: 'failed', answer: `Which model? Available in the manifest: ${Object.keys(MODELS).join(', ')}` };
  }
  const mdl = MODELS[name];
  return {
    intent: 'dbt', agent: 'dbt', status: 'succeeded', sources: [{ source: 'manifest.json', section: name }],
    answer: `${name} (${mdl.mat}): ${mdl.desc}\nUpstream: ${mdl.up.join(', ') || '—'} · Downstream: ${mdl.down.join(', ') || '—'}\nTests: ${mdl.tests.join(', ') || 'none'}`,
  };
}

function dqAgent(message: string): CopilotResponse {
  const text = message.toUpperCase();
  const table = Object.keys(SCHEMA).find((t) => text.includes(t) || text.includes(t.split('.')[1]));
  if (!table) {
    return { intent: 'data_quality', agent: 'data_quality', status: 'failed', answer: `Which table should I check? Known tables: ${Object.keys(SCHEMA).join(', ')}` };
  }
  const cols = SCHEMA[table];
  const key = cols.find((c) => c.endsWith('_ID'))!;
  const checks = [
    { check: 'null counts', sql: `SELECT COUNT(*) AS TOTAL_ROWS,\n  ${cols.map((c) => `COUNT_IF(${c} IS NULL) AS ${c}_NULLS`).join(',\n  ')}\nFROM ${table}` },
    { check: `duplicate ${key}`, sql: `SELECT ${key}, COUNT(*) AS N\nFROM ${table}\nGROUP BY ${key}\nHAVING COUNT(*) > 1\nORDER BY N DESC` },
  ].map((c) => { const v = validateSql(c.sql); return { ...c, sql: v.sql, valid: v.is_valid, errors: v.errors }; });
  return {
    intent: 'data_quality', agent: 'data_quality', status: 'proposed', checks, sql: checks[0].sql,
    answer: `Proposed ${checks.length} read-only checks for ${table}. Findings are hypotheses until you run them.`,
  };
}

function pipelineAgent(pasted: string | null): CopilotResponse {
  // Demo convenience: fall back to the sample log so the example prompt works in one click.
  const log = pasted || SAMPLE_LOG;
  const sigs: [RegExp, string][] = [
    [/object .* does not exist or not authorized/i, 'Missing object or insufficient privileges in Snowflake'],
    [/timeout|timed out/i, 'Task or query timeout'],
    [/connection (refused|reset)|could not connect/i, 'Network / connection failure to an upstream system'],
    [/compilation error/i, 'dbt / SQL compilation error'],
    [/out of memory|oom|killed/i, 'Worker ran out of memory'],
  ];
  const cause = sigs.find(([re]) => re.test(log))?.[1] ?? null;
  const incident = {
    dag_id: log.match(/dag_id=([\w\-.]+)/)?.[1] ?? null,
    task_id: log.match(/task_id=([\w\-.]+)/)?.[1] ?? null,
    evidence: log.split('\n').filter((l) => /\b(error|exception|failed|traceback)\b/i.test(l)).map((l) => l.trim()).slice(0, 8),
    likely_cause: cause,
    cause_status: cause ? 'confirmed-by-signature' : 'unknown',
  };
  return {
    intent: 'pipeline', agent: 'pipeline', status: 'succeeded', incident, requires_approval: ['retry task', 'clear task'],
    answer: `${pasted ? '' : '(No log pasted — using the sample orders_daily log.)\n\n'}DAG \`${incident.dag_id}\` task \`${incident.task_id}\` failed. Likely cause: ${cause ?? 'not identified from known signatures'} (${incident.cause_status}).\n\nRecommended checks: confirm the upstream object exists and the dbt role can SELECT it, re-run the failing query with the read-only role, then request approval before retrying the task.`,
  };
}

export function demoHealth(): Health {
  return { status: 'ok', llm_configured: false, snowflake_configured: true, demo: true };
}

export function demoChat(message: string, intent: Intent | null, log: string | null): CopilotResponse {
  const i = intent ?? classify(message);
  switch (i) {
    case 'sql': return sqlAgent(message);
    case 'rag': return ragAgent(message);
    case 'dbt': return dbtAgent(message);
    case 'data_quality': return dqAgent(message);
    case 'pipeline': return pipelineAgent(log);
    default:
      return { intent: 'general', agent: 'general', status: 'succeeded', answer: "I can help with: SQL generation, documentation questions, dbt models, data quality checks, and Airflow incident diagnosis. Try: 'Explain the fct_orders model'." };
  }
}

/** Generates deterministic sample rows for the columns a query selects. */
export function demoRun(sql: string): QueryResult {
  const v = validateSql(sql);
  if (!v.is_valid) throw new Error(v.errors.join('; '));
  const select = v.sql.match(/select\s+([\s\S]+?)\s+from\s/i)?.[1] ?? '*';
  const table = v.tables[0];
  const columns = select.trim() === '*'
    ? SCHEMA[table]
    : select.split(/,(?![^(]*\))/).map((c) => (c.match(/\bas\s+(\w+)\s*$/i)?.[1] ?? c.trim().split('.').pop()!).toUpperCase());
  const countries = ['India', 'UAE', 'USA', 'UK', 'Germany'];
  const methods = ['credit_card', 'upi', 'bank_transfer', 'gift_card'];
  const rows = Array.from({ length: 5 }, (_, r) => Object.fromEntries(columns.map((c, k) => {
    if (c.includes('COUNTRY')) return [c, countries[r % countries.length]];
    if (c.includes('METHOD')) return [c, methods[r % methods.length]];
    if (c.includes('MONTH') || c.includes('DATE')) return [c, `2026-${String(11 - r).padStart(2, '0')}-01`];
    if (c.includes('NULLS') || c === 'N') return [c, c === 'N' ? 2 : (r + k) % 3 === 0 ? 0 : r];
    if (c.includes('REVENUE') || c.includes('AMOUNT') || c === 'TOTAL') return [c, Math.round((98_000 - r * 11_500) * 100) / 100];
    if (c.endsWith('_ID')) return [c, 10_040 + r * 7];
    return [c, 1_250 - r * 140];
  })));
  return { status: 'succeeded', columns, rows, sql: v.sql };
}
