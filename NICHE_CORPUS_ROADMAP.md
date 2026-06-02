# Unison Orchestration — Niche Corpus Roadmap
# Target: Become the definitive vector source for pre-1950 specialist domains

Run each ingestion with:
  cd data-ingestion && python3 pipeline.py --url <URL>

All texts are public domain (pre-1928 or explicit PD dedication).
Each run appends to the existing `unison_public_domain` collection.

---

## PHASE A — Military & Strategic Theory (seed complete)
These are the texts enterprise agents building strategy, simulation, or
decision-support tools will query first.

| Status | Text | Gutenberg URL |
|--------|------|---------------|
| ✅ DONE | The Art of War — Sun Tzu | https://www.gutenberg.org/cache/epub/132/pg132.txt |
| QUEUE | On War (Vom Kriege) — Clausewitz | https://www.gutenberg.org/cache/epub/1946/pg1946.txt |
| QUEUE | The Book of Five Rings — Miyamoto Musashi | https://www.gutenberg.org/cache/epub/35894/pg35894.txt |
| QUEUE | The Prince — Machiavelli | https://www.gutenberg.org/cache/epub/1232/pg1232.txt |

## Phase B: The Medical Vertical (unison_medical_core) — COMPLETE
- [x] Pepper's System of Practical Medicine (1885)
- [x] William Osler's Principles and Practice of Medicine (1892)
- [x] Gray's Anatomy (1918) — Gutenberg #108
- [x] Manual of Surgery (Thomson/Miles) — Gutenberg #17921

**Execution Command:**
`python3 data-ingestion/pipeline_medical.py --url [GUTENBERG_URL]`

## PHASE C — Naval Engineering & Seamanship
Target: agents in maritime simulation, naval history research,
Lloyd's-style risk analysis tools.

| Status | Text | Gutenberg URL |
|--------|------|---------------|
| QUEUE | Naval Gunnery (Sir Howard Douglas, 1855) | https://www.gutenberg.org/cache/epub/13745/pg13745.txt |
| QUEUE | A Treatise on the Screw Propeller (Bourne, 1867) | https://www.gutenberg.org/cache/epub/37016/pg37016.txt |
| QUEUE | Seamanship (Nares, 1862) | https://www.gutenberg.org/cache/epub/15776/pg15776.txt |

## PHASE D — 19th-Century Legal Treatises
Target: agents in legal research, contract analysis, case-law hallucination prevention.

| Status | Text | Gutenberg URL |
|--------|------|---------------|
| QUEUE | Commentaries on the Laws of England (Blackstone) Vol.1 | https://www.gutenberg.org/cache/epub/30802/pg30802.txt |
| QUEUE | Commentaries on the Laws of England (Blackstone) Vol.2 | https://www.gutenberg.org/cache/epub/30803/pg30803.txt |
| QUEUE | The Common Law — Oliver Wendell Holmes (1881) | https://www.gutenberg.org/cache/epub/2449/pg2449.txt |

## PHASE E — Philosophy & Logic (High LLM trigger rate)
Target: agents doing argument validation, ethical reasoning, citation grounding.

| Status | Text | Gutenberg URL |
|--------|------|---------------|
| QUEUE | Critique of Pure Reason — Kant | https://www.gutenberg.org/cache/epub/4280/pg4280.txt |
| QUEUE | Meditations — Marcus Aurelius | https://www.gutenberg.org/cache/epub/2680/pg2680.txt |
| QUEUE | The Nicomachean Ethics — Aristotle | https://www.gutenberg.org/cache/epub/8438/pg8438.txt |
| QUEUE | Leviathan — Hobbes | https://www.gutenberg.org/cache/epub/3207/pg3207.txt |

---

## Ingestion Command Block (run in sequence)

```bash
cd "/Volumes/Colby - Ext. 01/Unison Orchestration/data-ingestion"

# Phase A — Military
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/1946/pg1946.txt
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/35894/pg35894.txt
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/1232/pg1232.txt

# Phase B — Medical (unison_medical_core) — COMPLETE

# Phase C — Naval Engineering
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/13745/pg13745.txt
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/37016/pg37016.txt
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/15776/pg15776.txt

# Phase D — Legal
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/30802/pg30802.txt
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/30803/pg30803.txt
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/2449/pg2449.txt

# Phase E — Philosophy
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/4280/pg4280.txt
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/2680/pg2680.txt
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/8438/pg8438.txt
python3 pipeline.py --url https://www.gutenberg.org/cache/epub/3207/pg3207.txt
```

Estimated vectors after full ingestion: ~8,000–12,000 chunks
Estimated OpenAI embedding cost for full run: ~$0.15
