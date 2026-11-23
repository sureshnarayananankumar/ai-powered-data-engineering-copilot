import pytest

from app.security.sql_guard import validate_sql

ALLOWED = {"ANALYTICS", "STAGING"}
KNOWN = {"ANALYTICS.FCT_ORDERS", "ANALYTICS.DIM_CUSTOMERS", "STAGING.STG_PAYMENTS"}


def test_simple_select_is_valid_and_gets_limit():
    r = validate_sql("select order_id from analytics.fct_orders", ALLOWED, KNOWN, max_rows=100)
    assert r.is_valid, r.errors
    assert "LIMIT 100" in r.sql.upper()


def test_existing_large_limit_is_capped():
    r = validate_sql("select * from analytics.fct_orders limit 100000", ALLOWED, KNOWN, max_rows=500)
    assert r.is_valid
    assert "LIMIT 500" in r.sql.upper()


def test_cte_and_join_are_valid():
    sql = """with o as (select * from analytics.fct_orders)
             select c.country, sum(o.amount) from o join analytics.dim_customers c
             on o.customer_id = c.customer_id group by 1"""
    r = validate_sql(sql, ALLOWED, KNOWN)
    assert r.is_valid, r.errors


@pytest.mark.parametrize("sql", [
    "delete from analytics.fct_orders",
    "drop table analytics.fct_orders",
    "update analytics.fct_orders set amount = 0",
    "insert into analytics.fct_orders values (1)",
    "truncate table analytics.fct_orders",
    "create table analytics.x as select 1",
    "merge into analytics.fct_orders t using staging.stg_payments s on t.order_id = s.order_id "
    "when matched then update set amount = s.amount",
])
def test_destructive_sql_is_blocked(sql):
    assert not validate_sql(sql, ALLOWED, KNOWN).is_valid


def test_multiple_statements_blocked():
    r = validate_sql("select 1 from analytics.fct_orders; drop table analytics.fct_orders", ALLOWED, KNOWN)
    assert not r.is_valid


def test_unknown_table_rejected():
    r = validate_sql("select * from analytics.secret_salaries", ALLOWED, KNOWN)
    assert not r.is_valid
    assert any("Unknown table" in e for e in r.errors)


def test_schema_not_on_allowlist_rejected():
    r = validate_sql("select * from hr.salaries", ALLOWED, None)
    assert not r.is_valid


def test_empty_sql_rejected():
    assert not validate_sql("   ").is_valid
