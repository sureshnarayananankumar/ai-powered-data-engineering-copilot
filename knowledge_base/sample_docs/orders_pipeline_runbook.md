# Orders pipeline runbook

The `orders_daily` Airflow DAG runs at 02:00 UTC and builds `fct_orders` with dbt.
This is synthetic sample documentation for the Copilot demo.

## Freshness expectations

`ANALYTICS.FCT_ORDERS` should contain orders up to the previous day by 03:00 UTC.
If freshness is breached, check the `load_fct_orders` task first.

## Missing object errors

"Object does not exist or not authorized" usually means an upstream source was renamed
or the dbt role lost SELECT privileges. Confirm with the read-only role before retrying.
Retrying or clearing tasks requires approval from the on-call data engineer.

## Incremental model behaviour

`fct_orders` is incremental on `ORDER_DATE`. A full refresh is only allowed in a
maintenance window with approval from the data platform lead.
