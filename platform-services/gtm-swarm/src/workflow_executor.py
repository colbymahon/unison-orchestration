#!/usr/bin/env python3
"""
Phase 2 Pillar 2 — Execute visual workflow DSL nodes in coordinator ticks.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from intent_router import route_agent_intent

log = logging.getLogger("unison.workflow_executor")

DOMAIN_COLLECTION = {
    "medical": "unison_medical_core",
    "engineering": "unison_engineering_core",
    "legal": "unison_legal_core",
    "financial": "unison_financial_core",
    "cyber": "unison_cyber_core",
}


def parse_workflow_dsl(raw: str | None) -> dict[str, Any] | None:
    if not raw or not raw.strip():
        return None
    try:
        doc = json.loads(raw)
        if isinstance(doc, dict) and doc.get("nodes"):
            return doc
    except json.JSONDecodeError:
        log.warning("Invalid workflow_dsl JSON")
    return None


def resolve_workflow_execution(
    task: dict[str, Any],
    workflow_doc: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Walk DSL nodes and produce execution parameters for coordinator search.
    Falls back to flat task fields when no workflow is attached.
    """
    query = str(task.get("query", "")).strip()
    collection = str(task.get("collection", "unison_public_domain")).strip()
    execution_plan: list[str] = []

    doc = workflow_doc
    if doc is None:
        raw = task.get("workflow_dsl")
        if isinstance(raw, str):
            doc = parse_workflow_dsl(raw)

    if not doc:
        return {
            "query": query,
            "collection": collection,
            "execution_plan": ["flat_task"],
            "verification_min_score": 0.0,
            "require_attestation": False,
        }

    nodes = doc.get("nodes", [])
    edges = doc.get("edges", [])
    nodes_by_id = {n["id"]: n for n in nodes if isinstance(n, dict) and "id" in n}

    adj: dict[str, list[str]] = {}
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        src = edge.get("source")
        tgt = edge.get("target")
        if src and tgt:
            adj.setdefault(str(src), []).append(str(tgt))

    trigger = next(
        (n for n in nodes if isinstance(n, dict) and n.get("type") == "Trigger"),
        None,
    )
    if trigger:
        data = trigger.get("data", {})
        if isinstance(data, dict) and data.get("query"):
            query = str(data["query"]).strip()
        execution_plan.append(f"Trigger:{trigger.get('id', '?')}")

    order_ids: list[str] = []
    if trigger:
        visited: set[str] = set()
        queue = [str(trigger["id"])]
        while queue:
            nid = queue.pop(0)
            if nid in visited:
                continue
            visited.add(nid)
            order_ids.append(nid)
            queue.extend(adj.get(nid, []))

    verification_min_score = 0.0
    require_attestation = False

    for nid in order_ids:
        node = nodes_by_id.get(nid)
        if not node:
            continue
        ntype = node.get("type")
        data = node.get("data", {})
        if not isinstance(data, dict):
            data = {}

        if ntype == "IntentRouter":
            domain = str(data.get("domain", "auto"))
            if domain != "auto":
                collection = DOMAIN_COLLECTION.get(domain, collection)
            else:
                route = route_agent_intent(query)
                if route.get("confidence", 0) > 0:
                    collection = str(route.get("collection", collection))
            execution_plan.append(f"IntentRouter:{domain}")

        elif ntype == "ContextSearch":
            col = str(data.get("collection", "")).strip()
            if col:
                collection = col
            execution_plan.append(f"ContextSearch:{collection}")

        elif ntype == "VerificationAgent":
            verification_min_score = float(data.get("min_score", 0.0) or 0.0)
            require_attestation = bool(data.get("require_attestation", False))
            execution_plan.append(
                f"VerificationAgent:min={verification_min_score}"
            )

        elif ntype == "Action":
            action = str(data.get("action", "enqueue_digest"))
            execution_plan.append(f"Action:{action}")

    return {
        "query": query,
        "collection": collection,
        "execution_plan": execution_plan,
        "verification_min_score": verification_min_score,
        "require_attestation": require_attestation,
    }
