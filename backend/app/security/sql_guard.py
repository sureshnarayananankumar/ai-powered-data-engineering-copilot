"""SQL guard: parser-based validation that runs BEFORE any query reaches Snowflake.

Prompt instructions are never trusted as a safety control. Every generated or
user-edited statement passes through `validate_sql`.
"""
from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp

# Statement types that change state or are administrative.
BLOCKED_EXPRESSIONS: tuple[type[exp.Expression], ...] = (
    exp.Insert, exp.Update, exp.Delete, exp.Merge, exp.Create, exp.Drop,
    exp.Alter, exp.TruncateTable, exp.Copy, exp.Command, exp.Grant,
)


@dataclass
class ValidationResult:
    is_valid: bool
    sql: str
    errors: list[str] = field(default_factory=list)
    tables: list[str] = field(default_factory=list)


def _table_name(table: exp.Table) -> str:
    parts = [p for p in (table.catalog, table.db, table.name) if p]
    return ".".join(parts).upper()


def validate_sql(
    sql: str,
    allowed_schemas: set[str] | None = None,
    known_tables: set[str] | None = None,
    max_rows: int = 500,
) -> ValidationResult:
    """Validate a single read-only Snowflake SELECT statement.

    - exactly one statement
    - must be SELECT / WITH ... SELECT / UNION
    - no DML/DDL anywhere in the tree
    - schemas must be on the allowlist (if given)
    - tables must be known from metadata (if given)
    - a LIMIT is enforced (added if missing, capped at max_rows)
    """
    errors: list[str] = []
    if not sql or not sql.strip():
        return ValidationResult(False, sql, ["SQL is empty."])

    try:
        statements = [s for s in sqlglot.parse(sql, read="snowflake") if s is not None]
    except sqlglot.errors.ParseError as e:
        return ValidationResult(False, sql, [f"SQL could not be parsed: {e}"])

    if len(statements) != 1:
        return ValidationResult(False, sql, ["Exactly one statement is allowed."])

    tree = statements[0]

    if not isinstance(tree, (exp.Select, exp.Union, exp.Subquery)) and not (
        isinstance(tree, exp.With) or tree.find(exp.Select) is tree
    ):
        errors.append(f"Only read-only SELECT queries are allowed (got {tree.key.upper()}).")

    for node in tree.walk():
        if isinstance(node, BLOCKED_EXPRESSIONS):
            errors.append(f"Blocked operation detected: {node.key.upper()}.")
            break

    cte_names = {c.alias_or_name.upper() for c in tree.find_all(exp.CTE)}
    tables = sorted({_table_name(t) for t in tree.find_all(exp.Table) if t.name.upper() not in cte_names})

    for t in tables:
        parts = t.split(".")
        schema = parts[-2] if len(parts) >= 2 else None
        if allowed_schemas is not None:
            if schema is None:
                errors.append(f"Table '{t}' must be schema-qualified.")
            elif schema not in allowed_schemas:
                errors.append(f"Schema '{schema}' is not on the allowlist.")
        if known_tables is not None and t not in known_tables and parts[-1] not in known_tables:
            errors.append(f"Unknown table '{t}' (not found in schema metadata).")

    if errors:
        return ValidationResult(False, sql, errors, tables)

    # Enforce a row limit.
    if isinstance(tree, exp.Select):
        limit = tree.args.get("limit")
        current = None
        if limit is not None:
            try:
                current = int(limit.expression.name)
            except (AttributeError, ValueError):
                current = None
        if current is None or current > max_rows:
            tree = tree.limit(max_rows)

    safe_sql = tree.sql(dialect="snowflake", pretty=True)
    return ValidationResult(True, safe_sql, [], tables)
