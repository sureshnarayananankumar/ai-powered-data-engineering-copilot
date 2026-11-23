# Data quality standards

Synthetic sample standards used by the Copilot demo.

## Primary keys

Every fact and dimension table must have a unique, non-null primary key.
`ORDER_ID` is the key of `FCT_ORDERS`; `CUSTOMER_ID` is the key of `DIM_CUSTOMERS`.

## Null thresholds

Foreign keys such as `CUSTOMER_ID` in `FCT_ORDERS` must have zero nulls.
Descriptive columns may have up to 1% nulls.
