"""
Unison Orchestration — Wiktionary Linguistic Data Ingestion Pipeline
=====================================================================
Queries the Wiktionary REST API for Proto-Indo-European (PIE) cognate trees,
etymological roots, phonetic shift tables, and syntactic paradigms.
Ingests into unison_linguistics_core as structured linguistic chunks.

Wiktionary API (no auth required):
  https://en.wiktionary.org/api/rest_v1/
  Rate limit: ~200 requests/minute (polite: asyncio.sleep(0.3))

Data categories fetched:
  1. PIE root reconstructions (*bher-, *sed-, *gʷen-, etc.)
  2. Phonological inventory tables per language family
  3. Morphological paradigm tables (declension/conjugation)
  4. Grimm's Law and Verner's Law phonetic shifts
  5. Common cognate sets across Indo-European branches

Usage:
  python3 pipeline_wiktionary.py                      # standard 500-entry pull
  python3 pipeline_wiktionary.py --max-entries 2000   # deeper pull
  python3 pipeline_wiktionary.py --dry-run

Environment variables: OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Generator

import requests
from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

sys.path.insert(0, os.path.dirname(__file__))
from _pipeline_common import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    UPSERT_BATCH_SIZE,
    TextChunk,
    embed_chunks,
    ensure_collection,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.wiktionary")

COLLECTION_NAME  = "unison_linguistics_core"
X402_PRICE       = 0.005
TIER             = "standard"
DOMAIN           = "linguistics"
WIKI_API         = "https://en.wiktionary.org/w/api.php"
RATE_DELAY       = 0.35   # ~2.8 requests/second

# PIE root entries to fetch from Wiktionary
PIE_ROOTS = [
    "Reconstruction:Proto-Indo-European/bʰer-",
    "Reconstruction:Proto-Indo-European/sed-",
    "Reconstruction:Proto-Indo-European/gʷen-",
    "Reconstruction:Proto-Indo-European/dʰéǵʰōm",
    "Reconstruction:Proto-Indo-European/pṓds",
    "Reconstruction:Proto-Indo-European/h₂eǵ-",
    "Reconstruction:Proto-Indo-European/wḗdr̥",
    "Reconstruction:Proto-Indo-European/péd-",
    "Reconstruction:Proto-Indo-European/ǵn̥h₁-",
    "Reconstruction:Proto-Indo-European/bʰeydʰ-",
]

# Linguistic category pages to crawl for paradigm tables
LINGUISTIC_CATEGORIES = [
    "Proto-Indo-European_roots",
    "Latin_verb_conjugation",
    "Ancient_Greek_declension",
    "Sanskrit_grammar",
    "Old_English_nouns",
    "Gothic_language",
]

# Grimm's Law phonetic shift table — hardcoded ground-truth reference
GRIMMS_LAW_TEXT = """Proto-Indo-European to Proto-Germanic Consonant Shifts (Grimm's Law, ~500 BCE)

FIRST CONSONANT SHIFT:
PIE Voiceless Stops → PGmc Fricatives:
  *p  → f    (PIE *pṓds 'foot' → Eng. foot, Lat. pes/pedis, Gk. pous/podos)
  *t  → θ    (PIE *treyes '3' → Eng. three, Lat. tres, Gk. treis)
  *k  → x/h  (PIE *ḱm̥tóm '100' → Eng. hundred, Lat. centum, Gk. hekaton)
  *kʷ → xʷ/hw (PIE *kʷod 'what' → Eng. what, Lat. quod, Gk. ho)

PIE Voiced Stops → PGmc Voiceless Stops:
  *b  → p    (PIE *bʰrebʰ- → Eng. brave? rearranged)
  *d  → t    (PIE *déḱm̥ '10' → Eng. ten, Lat. decem, Gk. deka)
  *g  → k    (PIE *génos 'clan' → Eng. kin, Lat. genus, Gk. genos)
  *gʷ → kʷ   (PIE *gʷen- 'woman' → Eng. queen, Gk. gynē)

PIE Voiced Aspirates → PGmc Voiced Stops/Fricatives:
  *bʰ → b/v  (PIE *bʰer- 'carry' → Eng. bear, Lat. ferre, Gk. pherein)
  *dʰ → d    (PIE *dʰewbʰ- 'deep' → Eng. deep, OHG tiuf)
  *gʰ → g    (PIE *gʰans- 'goose' → Eng. goose, Lat. anser, Gk. khēn)

VERNER'S LAW EXCEPTION (Verner 1875):
  PIE voiceless fricatives became voiced when not immediately preceded by accent:
  *p→f BUT with wrong accent: f→v (OE fæder vs. Got. fadar)
  Examples: Eng. were/was, father/faeder paradigm alternation
"""

SOUND_CHANGE_TABLES = """Proto-Indo-European Vowel System:
  Short: *a, *e, *i, *o, *u
  Long:  *ā, *ē, *ī, *ō, *ū
  Syllabic resonants: *r̥, *l̥, *m̥, *n̥
  Laryngeals: *h₁ (neutral), *h₂ (colors *a), *h₃ (colors *o)

Regular Correspondences (partial):
  PIE *e  → Skt. a, Gk. e, Lat. e, Eng. e/ø
  PIE *o  → Skt. a, Gk. o, Lat. o, Eng. a/o
  PIE *ā  → Skt. ā, Gk. ā/η, Lat. ā, Eng. o
  PIE *ei → Skt. e, Gk. ei/ī, Lat. ī, Eng. ī/ee
  PIE *ou → Skt. o, Gk. ou/ū, Lat. ū, Eng. ū/ow

Ablaut (Apophony) Grades:
  Full (e-grade): *bʰer- → carry (Eng. bear, Gk. pher-)
  Zero grade:     *bʰr̥-  → born (Eng. born, Skt. bibharti)
  o-grade:        *bʰor-  → burden (Eng. burden, OE byren)
  Lengthened e:   *bʰēr-  → bier (Eng. bier, Gk. phōr 'thief')
"""

MORPHOLOGY_TEXT = """Sanskrit Noun Declension (a-stem masculine: deva 'god'):
Case     Singular   Dual      Plural
Nom.     devaḥ      devau     devāḥ
Acc.     devam      devau     devān
Inst.    devena     devābhyām devaiḥ
Dat.     devāya     devābhyām devebhyaḥ
Abl.     devāt      devābhyām devebhyaḥ
Gen.     devasya    devayoḥ   devānām
Loc.     deve       devayoḥ   deveṣu
Voc.     deva       devau     devāḥ

Latin Noun Declension (1st declension: puella 'girl'):
Case     Singular   Plural
Nom.     puella     puellae
Gen.     puellae    puellarum
Dat.     puellae    puellis
Acc.     puellam    puellas
Abl.     puellā     puellis
Voc.     puella     puellae

Ancient Greek Verb Paradigm (λύω 'I loosen', present active indicative):
Person   Singular   Plural
1st      λύω        λύομεν
2nd      λύεις      λύετε
3rd      λύει       λύουσι(ν)

Aorist active indicative (ἔ-λυ-σ-α):
1st sg: ἔλυσα  2nd sg: ἔλυσας  3rd sg: ἔλυσε
1st pl: ἐλύσαμεν  2nd pl: ἐλύσατε  3rd pl: ἔλυσαν
"""


def fetch_wiktionary_page(title: str) -> str:
    """Fetch plain text of a Wiktionary page."""
    time.sleep(RATE_DELAY)
    try:
        resp = requests.get(WIKI_API, params={
            "action": "query",
            "titles": title,
            "prop":   "extracts",
            "explaintext": True,
            "format": "json",
        }, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        pages = data.get("query", {}).get("pages", {})
        for page in pages.values():
            text = page.get("extract", "")
            if text and len(text) > 100:
                return text
    except Exception as exc:
        log.warning("Failed to fetch '%s': %s", title, exc)
    return ""


def fetch_category_members(category: str, limit: int = 50) -> list[str]:
    """Fetch page titles from a Wiktionary category."""
    time.sleep(RATE_DELAY)
    try:
        resp = requests.get(WIKI_API, params={
            "action":  "query",
            "list":    "categorymembers",
            "cmtitle": f"Category:{category}",
            "cmlimit": limit,
            "format":  "json",
        }, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        return [
            m["title"]
            for m in data.get("query", {}).get("categorymembers", [])
        ]
    except Exception as exc:
        log.warning("Failed to fetch category '%s': %s", category, exc)
    return []


def build_chunks_from_texts(
    texts: list[tuple[str, str]],  # (title, text) pairs
) -> tuple[list[TextChunk], list[dict]]:
    """Convert text records to chunks with linguistic SKU metadata."""
    chunks: list[TextChunk] = []
    skus:   list[dict]      = []
    now = datetime.now(timezone.utc).isoformat()

    for title, text in texts:
        if not text.strip():
            continue
        # Split long texts at paragraph boundaries
        paragraphs = [p.strip() for p in text.split("\n\n") if len(p.strip()) > 100]
        # Group paragraphs into chunks of ~1200 chars
        buffer = ""
        for para in paragraphs:
            candidate = (buffer + "\n\n" + para).strip() if buffer else para
            if len(candidate) > 1500 and buffer:
                chunk_id = str(uuid.uuid4())
                chunks.append(TextChunk(
                    chunk_id=chunk_id,
                    source_url=f"https://en.wiktionary.org/wiki/{title.replace(' ', '_')}",
                    sequence=len(chunks),
                    text=buffer.strip(),
                    is_structured=True,
                ))
                skus.append({
                    "asset_id":             f"WIKT-{uuid.uuid4().hex[:8]}",
                    "title":                title,
                    "domain":               DOMAIN,
                    "tier":                 TIER,
                    "x402_price_per_query": X402_PRICE,
                    "semantic_density":     0.88,
                    "source_uri":           f"https://en.wiktionary.org/wiki/{title.replace(' ', '_')}",
                    "ingested_at":          now,
                })
                buffer = para
            else:
                buffer = candidate
        if buffer.strip():
            chunk_id = str(uuid.uuid4())
            chunks.append(TextChunk(
                chunk_id=chunk_id,
                source_url=f"https://en.wiktionary.org/wiki/{title.replace(' ', '_')}",
                sequence=len(chunks),
                text=buffer.strip(),
                is_structured=True,
            ))
            skus.append({
                "asset_id":             f"WIKT-{uuid.uuid4().hex[:8]}",
                "title":                title,
                "domain":               DOMAIN,
                "tier":                 TIER,
                "x402_price_per_query": X402_PRICE,
                "semantic_density":     0.88,
                "source_uri":           f"https://en.wiktionary.org/wiki/{title.replace(' ', '_')}",
                "ingested_at":          now,
            })

    return chunks, skus


def _batched(items: list, size: int) -> Generator[list, None, None]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert_linguistics(
    embedded: list[tuple[TextChunk, list[float]]],
    skus:     list[dict],
    qdrant:   QdrantClient,
) -> None:
    log.info("Upserting %d linguistic vectors → '%s'…", len(embedded), COLLECTION_NAME)
    total_batches = -(-len(embedded) // UPSERT_BATCH_SIZE)
    paired = list(zip(embedded, skus))
    for batch_idx, batch in enumerate(_batched(paired, UPSERT_BATCH_SIZE)):
        points = [
            qdrant_models.PointStruct(
                id=chunk.chunk_id, vector=vector,
                payload={"text": chunk.text, "source_url": chunk.source_url,
                         "sequence": chunk.sequence, "char_count": chunk.char_count,
                         "is_structured": chunk.is_structured, **sku},
            )
            for (chunk, vector), sku in batch
        ]
        qdrant.upsert(collection_name=COLLECTION_NAME, points=points)
        log.info("  Upserted batch %d/%d", batch_idx + 1, total_batches)
    log.info("Upsert complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Unison Wiktionary linguistics ingestion")
    parser.add_argument("--max-entries", type=int, default=500, dest="max_entries",
                        help="Max API entries to fetch (default: 500)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    log.info("=== Unison Wiktionary Linguistics Ingestion Pipeline START ===")
    log.info("Collection : %s", COLLECTION_NAME)
    log.info("Max entries: %d", args.max_entries)

    # Collect texts: hardcoded reference tables + PIE roots + category members
    texts: list[tuple[str, str]] = [
        ("Grimm's Law",          GRIMMS_LAW_TEXT),
        ("PIE Sound Changes",    SOUND_CHANGE_TABLES),
        ("Morphology Paradigms", MORPHOLOGY_TEXT),
    ]

    # PIE root pages
    log.info("Fetching %d PIE root pages…", len(PIE_ROOTS))
    for title in PIE_ROOTS:
        text = fetch_wiktionary_page(title)
        if text:
            texts.append((title, text))
            log.info("  Fetched: %s (%d chars)", title[:60], len(text))

    # Category member pages up to max_entries limit
    remaining = args.max_entries - len(texts)
    if remaining > 0:
        for category in LINGUISTIC_CATEGORIES:
            if remaining <= 0:
                break
            log.info("Fetching category: %s…", category)
            members = fetch_category_members(category, min(50, remaining))
            for title in members:
                if remaining <= 0:
                    break
                text = fetch_wiktionary_page(title)
                if text:
                    texts.append((title, text))
                    remaining -= 1
            log.info("  Category '%s': %d pages fetched.", category, len(members))

    log.info("Total text records collected: %d", len(texts))
    chunks, skus = build_chunks_from_texts(texts)
    log.info("Produced %d chunks.", len(chunks))

    if args.dry_run:
        log.info("DRY RUN — skipping embed/upsert.")
        return

    for k in ("OPENAI_API_KEY", "QDRANT_URL", "QDRANT_API_KEY"):
        if not os.getenv(k):
            raise EnvironmentError(f"Missing env var: {k}")

    openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    qdrant_client = QdrantClient(url=os.getenv("QDRANT_URL"), api_key=os.getenv("QDRANT_API_KEY"))
    ensure_collection(qdrant_client, COLLECTION_NAME, log)
    embedded = embed_chunks(chunks, openai_client, log)
    upsert_linguistics(embedded, skus, qdrant_client)
    log.info("=== Pipeline COMPLETE — %d vectors → '%s' ===", len(embedded), COLLECTION_NAME)


if __name__ == "__main__":
    main()
