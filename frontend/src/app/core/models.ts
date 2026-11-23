export type Intent = 'sql' | 'rag' | 'dbt' | 'data_quality' | 'pipeline' | 'general';
export type OpStatus = 'proposed' | 'approved' | 'running' | 'succeeded' | 'failed';

export interface Source { source: string; section: string; score?: number; }

export interface DqCheck { check: string; sql: string; valid: boolean; errors: string[]; }

export interface Incident {
  dag_id: string | null; task_id: string | null; evidence: string[];
  likely_cause: string | null; cause_status: string;
}

export interface CopilotResponse {
  intent: Intent;
  agent: string;
  answer: string;
  status: OpStatus;
  sql?: string | null;
  assumptions?: string;
  validation?: { is_valid: boolean; errors: string[]; tables: string[] };
  sources?: Source[];
  checks?: DqCheck[];
  incident?: Incident;
  requires_approval?: string[];
}

export interface ChatTurn { role: 'user' | 'assistant'; text: string; response?: CopilotResponse; }

export interface Health { status: string; llm_configured: boolean; snowflake_configured: boolean; }

export interface SqlValidation { is_valid: boolean; sql: string; errors: string[]; tables: string[]; }

export interface QueryResult { status: string; columns: string[]; rows: Record<string, unknown>[]; sql: string; }
