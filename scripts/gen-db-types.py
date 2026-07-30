#!/usr/bin/env python3
"""Generate src/infrastructure/supabase/database.types.ts from a live database.

The Supabase CLI's `gen types` requires Docker even when given a direct
connection string, which rules it out in CI and in any environment without a
container runtime. This introspects the same catalogues the CLI does and emits
the same contract, so the checked-in types are provably derived from the schema
rather than maintained by hand and hoped to be correct.

Usage:
    python3 scripts/gen-db-types.py [--check]

    --check  exit non-zero if the checked-in file differs from the schema,
             without writing. This is the drift guard for CI.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from collections import defaultdict

PSQL = os.environ.get("PGBIN", "/usr/lib/postgresql/16/bin") + "/psql"
PGURL = os.environ.get("PGURL", "postgresql://postgres@localhost:54322/postgres")
TARGET = "src/infrastructure/supabase/database.types.ts"

SCALARS = {
    "uuid": "string", "text": "string", "character varying": "string",
    "boolean": "boolean", "smallint": "number", "integer": "number",
    "bigint": "number", "numeric": "number", "real": "number",
    "double precision": "number", "date": "string",
    "timestamp with time zone": "string", "timestamp without time zone": "string",
    "jsonb": "Json", "json": "Json", "tsvector": "unknown",
}


def query(sql: str) -> list[list[str]]:
    out = subprocess.run(
        [PSQL, PGURL, "-t", "-A", "-F", "\x1f", "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout
    return [line.split("\x1f") for line in out.strip().split("\n") if line.strip()]


# Table names are plural; the row type describing a single row is singular.
# A few names are irregular or already read as singular concepts.
ALIAS_OVERRIDES = {
    "organisation_limits": "OrganisationLimits",
    "platform_settings": "PlatformSettings",
    "organisation_usage_snapshot": "UsageSnapshot",
}


def pascal(name: str) -> str:
    return "".join(part.capitalize() for part in name.split("_"))


def singular(name: str) -> str:
    if name in ALIAS_OVERRIDES:
        return ALIAS_OVERRIDES[name]
    if name.endswith("ies"):
        name = name[:-3] + "y"
    elif name.endswith("s") and not name.endswith("ss"):
        name = name[:-1]
    return pascal(name)


def parse_table_result(result: str) -> list[tuple[str, str]] | None:
    """Turn `TABLE(id uuid, title text, ...)` into column name/type pairs."""
    if not result.startswith("TABLE("):
        return None
    inner = result[len("TABLE("):-1]
    columns, depth, current = [], 0, ""
    for ch in inner:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            columns.append(current.strip())
            current = ""
        else:
            current += ch
    if current.strip():
        columns.append(current.strip())

    parsed = []
    for column in columns:
        parts = column.split(None, 1)
        if len(parts) == 2:
            parsed.append((parts[0], parts[1].strip()))
    return parsed


def ts_type(data_type: str, udt: str, enums: dict[str, list[str]]) -> str:
    if data_type == "USER-DEFINED" and udt in enums:
        return pascal(udt) + "Db"
    if data_type == "ARRAY":
        inner = udt.lstrip("_")
        if inner in enums:
            return pascal(inner) + "Db[]"
        return SCALARS.get(inner, "string") + "[]"
    return SCALARS.get(data_type, "unknown")


def build() -> str:
    enum_rows = query("""
        select t.typname, e.enumlabel
          from pg_type t
          join pg_enum e on e.enumtypid = t.oid
          join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'public'
         order by t.typname, e.enumsortorder;
    """)
    enums: dict[str, list[str]] = defaultdict(list)
    for name, label in enum_rows:
        enums[name].append(label)

    col_rows = query("""
        select c.table_name, c.column_name, c.data_type, c.udt_name,
               c.is_nullable, t.table_type
          from information_schema.columns c
          join information_schema.tables t
            on t.table_name = c.table_name and t.table_schema = c.table_schema
         where c.table_schema = 'public'
         order by c.table_name, c.ordinal_position;
    """)

    tables: dict[str, list[tuple[str, str, bool]]] = defaultdict(list)
    views: dict[str, list[tuple[str, str, bool]]] = defaultdict(list)
    for table, column, data_type, udt, nullable, kind in col_rows:
        entry = (column, ts_type(data_type, udt, enums), nullable == "YES")
        (views if kind == "VIEW" else tables)[table].append(entry)

    fk_rows = query("""
        select con.conname, src.relname, att.attname, tgt.relname
          from pg_constraint con
          join pg_class src on src.oid = con.conrelid
          join pg_class tgt on tgt.oid = con.confrelid
          join pg_namespace n on n.oid = src.relnamespace
          join unnest(con.conkey) with ordinality k(attnum, ord) on true
          join pg_attribute att on att.attrelid = src.oid and att.attnum = k.attnum
         where con.contype = 'f' and n.nspname = 'public'
         order by src.relname, con.conname;
    """)
    fks: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for conname, table, column, ref in fk_rows:
        fks[table].append((conname, column, ref))

    fn_rows = query("""
        select p.proname, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f'
         order by p.proname;
    """)

    # Set-returning functions describe a row shape. Emit it as a named type so
    # `.rpc()` results are typed instead of collapsing to `{}`.
    rpc_rows: dict[str, list[tuple[str, str]]] = {}
    for name, _args, result in fn_rows:
        columns = parse_table_result(result)
        if columns:
            resolved = []
            for col, typ in columns:
                is_array = typ.endswith("[]")
                base = typ.replace("[]", "").strip()
                if base in enums:
                    mapped = pascal(base) + "Db"
                else:
                    mapped = SCALARS.get(base, "unknown")
                resolved.append((col, mapped + ("[]" if is_array else "")))
            rpc_rows[name] = resolved

    L: list[str] = []
    add = L.append

    add("/**")
    add(" * Database contract.")
    add(" *")
    add(" * GENERATED FILE — do not edit by hand.")
    add(" * Regenerate with `npm run db:types` while a database is running.")
    add(" * Verify with `npm run db:types:check`, which fails on drift.")
    add(" *")
    add(" * Two properties this file must preserve, both learned by breaking them:")
    add(" *   Row types are type aliases, not interfaces. Interfaces have no implicit")
    add(" *   index signature and therefore fail Supabase's Record<string, unknown>")
    add(" *   constraint, which silently degrades every query to `never`.")
    add(" *")
    add(" *   Foreign keys are declared. PostgREST resolves embedded selects from")
    add(" *   this metadata; an empty Relationships array turns every join into")
    add(" *   `never` and disables the compiler exactly where an isolation bug hides.")
    add(" */")
    add("")
    add("export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];")
    add("")

    for name in sorted(enums):
        labels = " | ".join(f'"{v}"' for v in enums[name])
        add(f"export type {pascal(name)}Db = {labels};")
    add("")

    for table in sorted(tables):
        add(f"export type {singular(table)}Row = {{")
        for column, tstype, nullable in tables[table]:
            add(f"  {column}: {tstype}{' | null' if nullable else ''};")
        add("};")
        add("")

    for view in sorted(views):
        add(f"export type {singular(view)}Row = {{")
        for column, tstype, nullable in views[view]:
            add(f"  {column}: {tstype}{' | null' if nullable else ''};")
        add("};")
        add("")

    for name in sorted(rpc_rows):
        add(f"export type {singular(name)}Row = {{")
        for column, tstype in rpc_rows[name]:
            add(f"  {column}: {tstype};")
        add("};")
        add("")

    add("type Relationship = {")
    add("  foreignKeyName: string;")
    add("  columns: string[];")
    add("  isOneToOne?: boolean;")
    add("  referencedRelation: string;")
    add("  referencedColumns: string[];")
    add("};")
    add("")
    add("type Table<")
    add("  Row extends Record<string, unknown>,")
    add("  Insert = Partial<Row>,")
    add("  Update = Partial<Row>,")
    add("  Relationships extends Relationship[] = [],")
    add("> = {")
    add("  Row: Row;")
    add("  Insert: Insert;")
    add("  Update: Update;")
    add("  Relationships: Relationships;")
    add("};")
    add("")
    add("type View<Row extends Record<string, unknown>> = { Row: Row; Relationships: [] };")
    add("")
    add("type Fk<Name extends string, Col extends string, Ref extends string> = {")
    add("  foreignKeyName: Name;")
    add("  columns: [Col];")
    add("  isOneToOne: false;")
    add("  referencedRelation: Ref;")
    add("  referencedColumns: [\"id\"];")
    add("};")
    add("")

    add("export type Database = {")
    add("  public: {")
    add("    Tables: {")
    for table in sorted(tables):
        row = f"{singular(table)}Row"
        rels = fks.get(table, [])
        if not rels:
            add(f"      {table}: Table<{row}>;")
        else:
            add(f"      {table}: Table<")
            add(f"        {row},")
            add(f"        Partial<{row}>,")
            add(f"        Partial<{row}>,")
            add("        [")
            for conname, column, ref in rels:
                add(f'          Fk<"{conname}", "{column}", "{ref}">,')
            add("        ]")
            add("      >;")
    add("    };")

    add("    Views: {")
    for view in sorted(views):
        add(f"      {view}: View<{singular(view)}Row>;")
    add("    };")

    add("    Functions: {")
    for name, args, result in fn_rows:
        add(f"      {name}: {{")
        if args.strip():
            add("        Args: {")
            for arg in args.split(","):
                arg = arg.strip()
                if not arg:
                    continue
                parts = arg.split(" DEFAULT ")[0].strip().split()
                arg_name = parts[0]
                arg_type = " ".join(parts[1:])
                optional = " DEFAULT " in arg
                base = arg_type.replace("[]", "")
                mapped = SCALARS.get(base, pascal(base) + "Db" if base in enums else "string")
                if arg_type.endswith("[]"):
                    mapped += "[]"
                add(f"          {arg_name}{'?' if optional else ''}: {mapped} | null;"
                    if optional else f"          {arg_name}: {mapped};")
            add("        };")
        else:
            add("        Args: Record<string, never>;")
        if name in rpc_rows:
            add(f"        Returns: {singular(name)}Row[];")
        else:
            add("        Returns: unknown;")
        add("      };")
    add("    };")

    add("    Enums: {")
    for name in sorted(enums):
        add(f"      {name}: {pascal(name)}Db;")
    add("    };")
    add("    CompositeTypes: Record<string, never>;")
    add("  };")
    add("};")
    add("")

    return "\n".join(L)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    generated = build()

    if args.check:
        if not os.path.exists(TARGET):
            print(f"✗ {TARGET} does not exist")
            return 1
        current = open(TARGET).read()
        if current.strip() != generated.strip():
            print(f"✗ {TARGET} has drifted from the database schema.")
            print("  Run `npm run db:types` and commit the result.")
            return 1
        print(f"✓ {TARGET} matches the database schema")
        return 0

    with open(TARGET, "w") as handle:
        handle.write(generated)
    print(f"✓ wrote {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
