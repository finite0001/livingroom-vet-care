"""Join literal source metadata with independently created reference metadata.

The reference program creates only its declared empty reference schemas and
rolls back. No installed application property chooses an expected value.
"""
from copy import deepcopy
import json

DYNAMIC = {"workflow_tables", "tables", "ordinary_relations", "count_fk_trigger_registrations"}
CONTEXT = (
    ("parent205", "relations", "controlled_stock_execution_contexts"),
    ("private206", "parent", "manifest", "relations", "controlled_stock_execution_contexts"),
    ("original269", "parents", "parent205", "manifest", "relations", "controlled_stock_execution_contexts"),
    ("original269", "parents", "private206", "parent", "manifest", "relations", "controlled_stock_execution_contexts"),
)


def get(value, path):
    for key in path:
        value = value[key]
    return value


def set_value(value, path, item):
    for key in path[:-1]:
        value = value[key]
    value[path[-1]] = item


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def validate(static, complete):
    if set(complete) != set(static) or set(complete["properties"]) != set(static["properties"]) | DYNAMIC:
        raise ValueError("Complete literal-plus-reference source property inventory required")
    projected = deepcopy(complete)
    props = projected["properties"]
    for key in DYNAMIC:
        value = props.pop(key)
        if key == "count_fk_trigger_registrations":
            if type(value) is not list or not value:
                raise ValueError("Complete independently source-created FK registrations required")
        elif type(value) is not dict or not value:
            raise ValueError("Complete independently source-created relation metadata required")
    source_context = get(props, CONTEXT[0])
    for path in CONTEXT:
        if canonical(get(props, path)) != canonical(source_context):
            raise ValueError("Every current context projection must use the same source reference")
        set_value(props, path, deepcopy(get(static["properties"], path)))
    for table, constraint in (("configuration", "v3_enum_publication_mode"), ("publications", "v3_enum_mode")):
        current = props["original269"]["relations"][table]["constraints"]
        original = static["properties"]["original269"]["relations"][table]["constraints"]
        matches = [row for row in original if row["name"] == constraint]
        if len(matches) != 1 or len([row for row in current if row["name"] == constraint]) != 1:
            raise ValueError("Exactly the two declared source-created CHECK overlays required")
        for row in current:
            if row["name"] == constraint:
                row["definition"] = matches[0]["definition"]
    if canonical(projected) != canonical(static):
        raise ValueError("Reference source program changed unrelated literal metadata")
    return complete
