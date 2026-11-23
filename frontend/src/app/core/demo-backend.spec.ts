import { classify, demoChat, demoRun, validateSql } from './demo-backend';

describe('demo backend', () => {
  it('routes intents like the Python router', () => {
    expect(classify('Why did the orders_daily DAG fail?')).toBe('pipeline');
    expect(classify('Check duplicates in fct_orders')).toBe('data_quality');
    expect(classify('Explain the dbt model fct_orders')).toBe('dbt');
    expect(classify('How many orders per country?')).toBe('sql');
  });

  it('blocks destructive SQL and unknown tables', () => {
    expect(validateSql('drop table analytics.fct_orders').is_valid).toBeFalse();
    expect(validateSql('select 1 from analytics.fct_orders; delete from analytics.fct_orders').is_valid).toBeFalse();
    expect(validateSql('select * from analytics.secret').is_valid).toBeFalse();
    expect(validateSql('select * from analytics.fct_orders').sql).toContain('LIMIT 500');
  });

  it('answers each agent offline', () => {
    expect(demoChat('Explain the fct_orders model', null, null).answer).toContain('incremental');
    expect(demoChat('Explain what to do about missing object errors', null, null).sources?.[0].section).toBe('Missing object errors');
    expect(demoChat('Why did the orders_daily DAG fail?', null, null).incident?.task_id).toBe('load_fct_orders');
    const dq = demoChat('Check nulls and duplicates in fct_orders', null, null);
    expect(dq.checks?.every((c) => c.valid)).toBeTrue();
    const sql = demoChat('How many orders and revenue per country?', null, null);
    expect(demoRun(sql.sql!).columns).toEqual(['COUNTRY', 'ORDERS', 'REVENUE']);
  });
});
