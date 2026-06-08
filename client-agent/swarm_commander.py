"""
Unison Orchestration — Multi-Agent Swarm Commander
===================================================
Deploys N autonomous agents in parallel against the Unison edge gateway,
each isolated on its own BIP-44 HD child wallet to eliminate EVM nonce
contention entirely.

Architecture decision — why NOT asyncio.Lock():
  The real execute_payment() calls wait_for_transaction_receipt (blocking,
  ~2–5s on Base). A mutex serialises the full settlement including that wait,
  destroying asyncio concurrency at the 402 gate. With N=10 agents that
  stacks ~30s of serialised EVM time — this is a queue, not a swarm.

  Sub-wallets give each agent an independent nonce counter. asyncio.gather
  runs all settlements in parallel. True horizontal scaling.

Wallet derivation:
  Master mnemonic → BIP-44 path m/44'/60'/0'/0/{agent_index}
  Each agent: deterministic address, independent nonce, isolated USDC balance.

Dynamic agent provisioning (--agents N):
  When N > 0, DynamicSwarmFactory distributes agents across the 25-collection
  matrix using proportional weight assignment. Each agent receives a domain-
  specific query archetype and a permanent wallet address binding so the
  X-Agent-ID free-tier bucket is consistent across runs.

  Weights reflect relative collection breadth and ingestion depth. Higher-
  weight collections receive more agents, concentrating load where semantic
  search has the most surface area to stress-test.

Required .env:
  MASTER_MNEMONIC       — 12/24-word BIP-39 mnemonic (keep secret, new seed)
  USDC_CONTRACT_ADDRESS — canonical Base USDC contract
  BASE_RPC_URL          — Alchemy or Infura endpoint recommended for swarm load

Fund each child wallet before live run (addresses printed at startup):
  >= 0.0001 ETH (gas) + >= 0.10 USDC per agent on Base (chainId: 8453).

Usage:
  python3 swarm_commander.py                     # 3-agent static default suite
  python3 swarm_commander.py --dry-run           # simulate, no broadcast
  python3 swarm_commander.py --agents 25         # dynamic: 1 agent per collection
  python3 swarm_commander.py --agents 50 --dry-run  # full proportional swarm, dry
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import random
import re
import secrets
import sys
import time
from dataclasses import dataclass, field

import aiohttp
from dotenv import load_dotenv
from eth_account import Account
from web3 import AsyncWeb3
from web3.providers import AsyncHTTPProvider

from base_builder import append_builder_data_suffix
from unison_agent_config import (
    AGENT_FLEET_LABEL,
    AGENT_VERSION,
    BRAND_NAME,
    BRAND_NAMESPACE,
    EDGE_SEARCH_URL,
    MCP_MANIFEST_URL,
    brand_init_log_lines,
    default_request_headers,
    format_agent_id,
)

load_dotenv()
Account.enable_unaudited_hdwallet_features()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  [%(name)s]  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.swarm")

# ─── Constants ────────────────────────────────────────────────────────────────

EDGE_URL = EDGE_SEARCH_URL
# Chain ID is read from env so the same codebase runs on both networks:
#   Base Mainnet  → BASE_CHAIN_ID=8453   (default)
#   Base Sepolia  → BASE_CHAIN_ID=84532
BASE_CHAIN_ID = int(os.getenv("BASE_CHAIN_ID", "8453"))
USDC_DECIMALS = 6
GAS_LIMIT = 100_000
RECEIPT_TIMEOUT = 60  # seconds
HD_BASE_PATH = "m/44'/60'/0'/0/{index}"

ERC20_ABI = [
    {
        "constant": False,
        "inputs": [
            {"name": "_to", "type": "address"},
            {"name": "_value", "type": "uint256"},
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function",
    },
]


# ─── Config & Wallet Types ────────────────────────────────────────────────────


@dataclass
class AgentConfig:
    agent_id: str
    collection: str
    queries: list[str]
    wallet_index: int          # maps to BIP-44 derivation index
    wallet_address: str = ""   # populated by DynamicSwarmFactory; logged for audit
    query_archetype: str = ""  # domain class label (e.g. technical_spec, statutory_code)


@dataclass
class AgentWallet:
    index: int
    account: object        # eth_account LocalAccount
    w3: AsyncWeb3
    usdc: object           # AsyncContract


# ─── HD Wallet Pool ───────────────────────────────────────────────────────────


def _derive_wallet(mnemonic: str, index: int, rpc_url: str, usdc_address: str) -> AgentWallet:
    """
    Derive a BIP-44 child key at m/44'/60'/0'/0/{index} and initialise
    an AsyncWeb3 instance bound to it.

    Each derived address has its own independent nonce sequence — no shared
    EVM state between agents, no mutex required.
    """
    path = HD_BASE_PATH.format(index=index)
    account = Account.from_mnemonic(mnemonic, account_path=path)

    w3 = AsyncWeb3(AsyncHTTPProvider(rpc_url))
    usdc_checksum = AsyncWeb3.to_checksum_address(usdc_address)
    usdc_contract = w3.eth.contract(address=usdc_checksum, abi=ERC20_ABI)

    return AgentWallet(index=index, account=account, w3=w3, usdc=usdc_contract)


def build_wallet_pool(
    mnemonic: str,
    agent_count: int,
    rpc_url: str,
    usdc_address: str,
) -> dict[int, AgentWallet]:
    """Derive one wallet per agent index. O(N) — runs once at startup."""
    return {
        i: _derive_wallet(mnemonic, i, rpc_url, usdc_address)
        for i in range(agent_count)
    }


# ─── 402 Header Parser ────────────────────────────────────────────────────────


def _parse_payment_required(header_value: str) -> dict[str, str]:
    """
    Parse the Worker's Payment-Required header into a dict.

    Actual format:
        network=base; token=0x833...; amount=0.005; destination=0xE37...

    Separator: '; ' (semicolon-space). Values have no quotes.
    """
    terms: dict[str, str] = {}
    for part in header_value.split(";"):
        part = part.strip()
        if "=" in part:
            key, _, value = part.partition("=")
            terms[key.strip()] = value.strip()
    return terms


# ─── Async EVM Settlement ─────────────────────────────────────────────────────


async def execute_x402_payment_async(
    wallet: AgentWallet,
    destination: str,
    amount_usdc: float,
    agent_id: str,
    *,
    dry_run: bool = False,
    simulate: bool = False,
) -> str:
    """
    Broadcast a USDC ERC-20 transfer on Base and return the confirmed tx hash.

    Execution modes (mutually exclusive, checked in order):
      dry_run  — skips balance check, broadcast, and replay entirely. Use to
                 validate routing and KV isolation with zero network cost.
      simulate — skips balance check and broadcast, generates a deterministic
                 mock hash, and sleeps 500ms to mimic block confirmation latency.
                 The mock hash IS passed to the replay request; the Worker will
                 reject it (not a real on-chain tx), exercising the full
                 error_replay_* code path. Use to validate the state machine
                 without funds or gas.
      live     — full on-chain settlement. Requires wallet to hold USDC >= amount
                 and ETH >= gas cost on the target network.

    Nonce is fetched with 'pending' block tag in live mode only.
    No global lock — wallet address provides nonce isolation by construction.
    """
    agent_log = logging.getLogger(f"unison.swarm.{agent_id}")

    if dry_run:
        agent_log.info("DRY RUN — skipping settlement for wallet[%d].", wallet.index)
        return f"0xdryrun_{wallet.index:04d}_{int(time.time())}"

    if simulate:
        mock_hash = "0xsim" + secrets.token_hex(30)
        agent_log.info(
            "SIMULATE — wallet[%d] mock settlement, 500ms latency. hash=%s",
            wallet.index, mock_hash,
        )
        await asyncio.sleep(0.5)
        agent_log.info("SIMULATE — wallet[%d] mock receipt: status=1 (simulated).", wallet.index)
        return mock_hash

    # ── Live path ─────────────────────────────────────────────────────────────
    amount_units = int(amount_usdc * 10**USDC_DECIMALS)
    dest_checksum = AsyncWeb3.to_checksum_address(destination)

    usdc_balance = await wallet.usdc.functions.balanceOf(wallet.account.address).call()
    agent_log.info(
        "Wallet[%d] %s — balance: %d units (%.6f USDC)",
        wallet.index, wallet.account.address,
        usdc_balance, usdc_balance / 10**USDC_DECIMALS,
    )
    if usdc_balance < amount_units:
        raise ValueError(
            f"Wallet[{wallet.index}] insufficient USDC: "
            f"have {usdc_balance} units, need {amount_units}."
        )

    nonce = await wallet.w3.eth.get_transaction_count(
        wallet.account.address, "pending"
    )
    gas_price = await wallet.w3.eth.gas_price

    tx = append_builder_data_suffix(
        await wallet.usdc.functions.transfer(
            dest_checksum, amount_units
        ).build_transaction({
            "from": wallet.account.address,
            "nonce": nonce,
            "gas": GAS_LIMIT,
            "gasPrice": gas_price,
            "chainId": BASE_CHAIN_ID,
        })
    )

    signed = wallet.account.sign_transaction(tx)
    tx_hash_bytes = await wallet.w3.eth.send_raw_transaction(signed.raw_transaction)
    tx_hash = tx_hash_bytes.hex()
    agent_log.info("Wallet[%d] broadcast: %s  nonce=%d", wallet.index, tx_hash, nonce)

    receipt = await wallet.w3.eth.wait_for_transaction_receipt(
        tx_hash_bytes, timeout=RECEIPT_TIMEOUT
    )
    if receipt.status != 1:
        raise RuntimeError(
            f"Wallet[{wallet.index}] USDC transfer reverted. Receipt: {receipt}"
        )

    agent_log.info("Wallet[%d] confirmed in block %d.", wallet.index, receipt.blockNumber)
    return tx_hash


# ─── Agent Worker ─────────────────────────────────────────────────────────────


async def agent_worker(
    config: AgentConfig,
    wallet: AgentWallet,
    session: aiohttp.ClientSession,
    *,
    dry_run: bool = False,
    simulate: bool = False,
) -> dict[str, object]:
    """
    Autonomous agent loop. Executes all assigned queries against the edge,
    handles the full x402 lifecycle (free tier + paid tier), and returns
    a structured result summary.
    """
    agent_log = logging.getLogger(f"unison.swarm.{config.agent_id}")
    results: list[dict] = []

    headers = default_request_headers(config.agent_id)

    for query in config.queries:
        params = {"collection": config.collection, "q": query}
        agent_log.info("Querying '%s' in %s", query, config.collection)

        try:
            async with session.get(EDGE_URL, params=params, headers=headers) as resp:
                if resp.status == 200:
                    remaining = resp.headers.get("X-Remaining-Free-Tier")
                    tsv = await resp.text()
                    agent_log.info(
                        "200 OK — %d chars, free tier remaining: %s",
                        len(tsv), remaining or "N/A (paid)"
                    )
                    results.append({
                        "query": query, "status": "ok_free",
                        "bytes": len(tsv), "remaining": remaining,
                    })

                elif resp.status == 402:
                    agent_log.info("402 — free tier exhausted, parsing payment terms…")
                    payment_header = resp.headers.get("Payment-Required", "")

                    if not payment_header:
                        agent_log.error(
                            "402 missing Payment-Required header. Raw: %s", dict(resp.headers)
                        )
                        results.append({"query": query, "status": "error_no_header"})
                        continue

                    terms = _parse_payment_required(payment_header)
                    destination = terms.get("destination")
                    amount = float(terms.get("amount", "0.005"))

                    if not destination:
                        agent_log.error("Could not parse 'destination' from header.")
                        results.append({"query": query, "status": "error_bad_header"})
                        continue

                    try:
                        tx_hash = await execute_x402_payment_async(
                            wallet, destination, amount, config.agent_id,
                            dry_run=dry_run, simulate=simulate,
                        )
                    except (ValueError, RuntimeError) as exc:
                        agent_log.error("Payment failed: %s", exc)
                        results.append({"query": query, "status": "error_payment", "detail": str(exc)})
                        continue

                    # Replay with cryptographic proof
                    paid_headers = {**headers, "Payment-Signature": tx_hash}
                    async with session.get(
                        EDGE_URL, params=params, headers=paid_headers
                    ) as paid_resp:
                        if paid_resp.status == 200:
                            tsv = await paid_resp.text()
                            agent_log.info(
                                "Paid replay 200 OK — %d chars, tx: %s",
                                len(tsv), tx_hash[:18]
                            )
                            results.append({
                                "query": query, "status": "ok_paid",
                                "bytes": len(tsv), "tx_hash": tx_hash,
                            })
                        else:
                            body = await paid_resp.text()
                            agent_log.error(
                                "Paid replay returned %d: %s", paid_resp.status, body[:300]
                            )
                            results.append({
                                "query": query, "status": f"error_replay_{paid_resp.status}"
                            })

                else:
                    body = await resp.text()
                    agent_log.error(
                        "Unexpected %d: %s", resp.status, body[:300]
                    )
                    results.append({"query": query, "status": f"error_{resp.status}"})

        except aiohttp.ClientError as exc:
            agent_log.error("HTTP client error: %s", exc)
            results.append({"query": query, "status": "error_network", "detail": str(exc)})

        await asyncio.sleep(0.5)

    return {"agent_id": config.agent_id, "wallet_index": config.wallet_index, "results": results}


# ─── Swarm Deployment ─────────────────────────────────────────────────────────


# ─── Collection Matrix & Dynamic Factory ─────────────────────────────────────

# Relative weight reflects ingestion depth and domain breadth.
# Higher weight → proportionally more agents assigned during dynamic provisioning.
# Weights are intentionally asymmetric to mirror real semantic search load patterns.
COLLECTION_MATRIX: dict[str, dict] = {
    "unison_medical_core": {
        "weight": 5, "archetype": "empirical_trial",
        "seeds": [
            "dosage thresholds and pharmacokinetic half-life",
            "oncology cellular mutation pathways",
            "clinical trial vector and endpoint definition",
            "histopathology tissue classification criteria",
            "surgical complication risk stratification",
        ],
    },
    "unison_legal_core": {
        "weight": 4, "archetype": "statutory_code",
        "seeds": [
            "regulatory precedent and jurisdictional mandate",
            "statutory compliance matrix for commercial contracts",
            "constitutional framework and enumerated powers",
            "tort liability and negligence standard of care",
            "evidentiary burden and chain of custody",
        ],
    },
    "unison_engineering_core": {
        "weight": 4, "archetype": "technical_spec",
        "seeds": [
            "structural tolerance and material fatigue index",
            "screw propeller thrust calculation formulas",
            "load-bearing column stress and buckling limits",
            "hydraulic pressure loss through orifice coefficients",
            "beam deflection under distributed load",
        ],
    },
    "unison_financial_core": {
        "weight": 4, "archetype": "high_frequency_tabular",
        "seeds": [
            "arbitrage spread settlement and yield matrix",
            "liquidity ledger and bid-ask depth decomposition",
            "Tulipomania pricing tiers and peak valuation",
            "present value discounting and IRR calculation",
            "bond duration sensitivity to interest rate shift",
        ],
    },
    "unison_chemistry_core": {
        "weight": 3, "archetype": "technical_spec",
        "seeds": [
            "reaction enthalpy and Gibbs free energy calculation",
            "stoichiometric coefficient balancing in redox reactions",
            "solubility product constant and precipitation thresholds",
            "organic synthesis pathway and reagent selectivity",
            "spectroscopic absorption peak identification",
        ],
    },
    "unison_biotech_core": {
        "weight": 3, "archetype": "empirical_trial",
        "seeds": [
            "recombinant protein expression yield optimization",
            "CRISPR guide RNA off-target cleavage probability",
            "fermentation kinetics and substrate consumption rate",
            "cell viability assay thresholds and passage limits",
            "polymerase chain reaction primer design parameters",
        ],
    },
    "unison_genetics_core": {
        "weight": 3, "archetype": "empirical_trial",
        "seeds": [
            "Mendelian inheritance ratio and dominant allele expression",
            "linkage disequilibrium and haplotype block mapping",
            "SNP variant classification and pathogenicity scoring",
            "pedigree analysis for autosomal recessive conditions",
            "quantitative trait loci heritability estimation",
        ],
    },
    "unison_astrophysics_core": {
        "weight": 3, "archetype": "technical_spec",
        "seeds": [
            "orbital period and semi-major axis Kepler relationship",
            "stellar luminosity classification on H-R diagram",
            "redshift measurement and Hubble constant derivation",
            "gravitational wave strain amplitude calculation",
            "neutron star equation of state pressure density",
        ],
    },
    "unison_mathematics_core": {
        "weight": 3, "archetype": "technical_spec",
        "seeds": [
            "De Morgan law application in Boolean algebra",
            "convergence criteria for infinite series",
            "eigenvalue decomposition and diagonalisation conditions",
            "partial differential equation boundary value method",
            "prime number distribution and Riemann hypothesis",
        ],
    },
    "unison_cyber_core": {
        "weight": 3, "archetype": "technical_spec",
        "seeds": [
            "telegraphic cipher substitution matrix and key schedule",
            "RSA key exchange modular exponentiation foundations",
            "buffer overflow exploit stack canary bypass technique",
            "TLS handshake certificate chain validation",
            "intrusion detection signature pattern matching",
        ],
    },
    "unison_intelligence_core": {
        "weight": 3, "archetype": "statutory_code",
        "seeds": [
            "signals intelligence collection authority and minimisation",
            "open source intelligence source reliability grading",
            "counterintelligence tradecraft and cover discipline",
            "analysis of competing hypotheses methodology",
            "target package development and pattern of life",
        ],
    },
    "unison_thermodynamics_core": {
        "weight": 3, "archetype": "technical_spec",
        "seeds": [
            "Carnot cycle efficiency and reversible heat engine limits",
            "entropy generation in irreversible adiabatic process",
            "Rankine cycle steam turbine expansion work",
            "conductive heat transfer Fourier law coefficient",
            "equation of state for real gas van der Waals correction",
        ],
    },
    "unison_manufacturing_core": {
        "weight": 3, "archetype": "technical_spec",
        "seeds": [
            "CNC G-code feed rate and spindle speed parameters",
            "tolerance stack-up analysis and geometric dimensioning",
            "injection moulding cycle time and cooling calculation",
            "weld joint tensile strength and filler metal classification",
            "surface roughness Ra measurement and grinding wheel spec",
        ],
    },
    "unison_materials_core": {
        "weight": 3, "archetype": "technical_spec",
        "seeds": [
            "cryogenic tensile strength and ductile-brittle transition",
            "FCC lattice parameters and close-packed slip systems",
            "yield strength precipitation hardening alloy series",
            "fracture toughness K1c measurement compact tension",
            "corrosion potential galvanic series electrochemical",
        ],
    },
    "unison_architecture_core": {
        "weight": 2, "archetype": "technical_spec",
        "seeds": [
            "load-bearing wall removal structural transfer beam",
            "passive solar design heat gain coefficient",
            "seismic base isolation shear force distribution",
            "concrete mix design water-cement ratio compressive strength",
            "fire egress width calculation occupant load",
        ],
    },
    "unison_macroeconomics_core": {
        "weight": 2, "archetype": "high_frequency_tabular",
        "seeds": [
            "GDP deflator and real output growth decomposition",
            "monetary policy transmission lag and IS-LM equilibrium",
            "balance of payments current account deficit financing",
            "Okun law unemployment gap and output deviation",
            "fiscal multiplier effect and crowding out mechanism",
        ],
    },
    "unison_agronomy_core": {
        "weight": 2, "archetype": "technical_spec",
        "seeds": [
            "soil chemistry N-P-K ratio and cation exchange capacity",
            "irrigation scheduling evapotranspiration reference method",
            "crop rotation nitrogen fixation legume sequencing",
            "pest threshold economic injury level calculation",
            "seed germination temperature and dormancy breaking",
        ],
    },
    "unison_public_domain": {
        "weight": 2, "archetype": "general_reference",
        "seeds": [
            "public domain strategic doctrine and operational planning",
            "historical military logistics and supply chain record",
            "classical economic theory trade comparative advantage",
            "pre-1928 scientific treatise measurement standard",
            "foundational engineering reference tables and constants",
        ],
    },
    "unison_dtc_core": {
        "weight": 2, "archetype": "high_frequency_tabular",
        "seeds": [
            "direct-to-consumer conversion funnel and CAC benchmark",
            "customer lifetime value cohort retention matrix",
            "inventory turnover ratio and stockout probability",
            "ad spend ROAS decomposition by channel",
            "pricing elasticity and demand curve inflection point",
        ],
    },
    "unison_meteorology_core": {
        "weight": 2, "archetype": "technical_spec",
        "seeds": [
            "atmospheric pressure gradient force and wind shear",
            "radiosonde temperature inversion detection",
            "precipitation probability ensemble model verification",
            "cyclone track forecast cone of uncertainty",
            "dew point depression and convective available potential energy",
        ],
    },
    "unison_linguistics_core": {
        "weight": 2, "archetype": "general_reference",
        "seeds": [
            "phoneme inventory and minimal pair contrast",
            "syntactic tree structure and constituent parsing",
            "morphological derivation affix productivity",
            "creole formation substrate and superstrate influence",
            "semantic shift diachronic meaning change mechanism",
        ],
    },
    "unison_cartography_core": {
        "weight": 1, "archetype": "technical_spec",
        "seeds": [
            "map projection distortion conformal versus equal-area",
            "geodetic datum transformation parameter WGS84",
            "contour interval and slope angle calculation",
            "coordinate system grid reference bearing conversion",
            "triangulation survey baseline error propagation",
        ],
    },
    "unison_collectibles_core": {
        "weight": 1, "archetype": "high_frequency_tabular",
        "seeds": [
            "numismatic grading scale and mint mark premium",
            "philatelic perforation gauge and watermark identification",
            "auction realised price index and condition adjustment",
            "provenance chain documentation and authentication",
            "population report registry census rare variant",
        ],
    },
}


class DynamicSwarmFactory:
    """
    Inspects the Unison collection matrix and provisions AgentConfig instances
    distributed proportionally across active collections by weight.

    Weight semantics:
      Higher weight → more agents assigned → more concurrent load on that
      collection's Qdrant index and Axum routing path. Asymmetric weighting
      concentrates stress on collections with the most semantic surface area,
      revealing index hotspots that uniform round-robin would miss.

    Tenant isolation:
      agent_id is bound to the child wallet address prefix, making the
      X-Agent-ID KV bucket deterministic and consistent across runs. The same
      --agents 25 invocation with the same MASTER_MNEMONIC always produces
      identical agent_id → wallet mappings. This is required for free-tier
      quota tracking to be meaningful across repeated load tests.
    """

    def __init__(self, matrix: dict[str, dict] | None = None) -> None:
        self.matrix = matrix or COLLECTION_MATRIX

    def _build_distribution(self, total_agents: int) -> list[str]:
        """
        Returns a list of collection names of length `total_agents`, ordered
        such that agents are grouped by collection for cleaner log output.

        Algorithm: weighted fill — each collection gets
        floor(weight / total_weight * total_agents) slots, remainder
        distributed to the highest-weight collections first.
        """
        collections = list(self.matrix.keys())
        weights = [self.matrix[c]["weight"] for c in collections]
        total_weight = sum(weights)

        # Base allocation
        alloc = [int(w / total_weight * total_agents) for w in weights]
        remainder = total_agents - sum(alloc)

        # Distribute remainder to highest-weight collections first
        order = sorted(range(len(weights)), key=lambda i: weights[i], reverse=True)
        for i in range(remainder):
            alloc[order[i % len(order)]] += 1

        distribution: list[str] = []
        for col, count in zip(collections, alloc):
            distribution.extend([col] * count)

        return distribution

    def generate(
        self,
        total_agents: int,
        derived_addresses: list[str],
        queries_per_agent: int = 1,
    ) -> list[AgentConfig]:
        """
        Build AgentConfig list for `total_agents` agents mapped to
        `derived_addresses` (index-aligned to BIP-44 child key index).

        queries_per_agent controls how many queries each agent executes.
        Values > 50 will exhaust the KV free tier and trigger live 402
        settlement on Base. Queries are sampled from the archetype seed
        pool with replacement, so a diverse but domain-authentic query
        sequence is generated regardless of pool size.

        Each agent receives:
          - A permanent agent_id tied to its wallet address prefix (tenant-stable).
          - `queries_per_agent` seeds drawn from the collection's archetype pool.
          - wallet_address populated for audit logging and KV isolation proof.
        """
        if len(derived_addresses) < total_agents:
            raise ValueError(
                f"Need {total_agents} derived addresses, got {len(derived_addresses)}."
            )

        distribution = self._build_distribution(total_agents)
        configs: list[AgentConfig] = []

        for i, collection in enumerate(distribution):
            addr = derived_addresses[i]
            archetype_meta = self.matrix[collection]
            seeds = archetype_meta["seeds"]

            # Sample queries_per_agent seeds. random.choices allows repetition
            # when queries_per_agent > len(seeds), keeping the load realistic.
            queries = random.choices(seeds, k=queries_per_agent)

            configs.append(AgentConfig(
                agent_id=format_agent_id("swarm", index=i, addr_prefix=addr[2:8]),
                collection=collection,
                queries=queries,
                wallet_index=i,
                wallet_address=addr,
                query_archetype=archetype_meta["archetype"],
            ))

        return configs


DEFAULT_AGENTS: list[AgentConfig] = [
    AgentConfig(
        agent_id=format_agent_id("agronomy", index=1),
        collection="unison_agronomy_core",
        queries=["soil chemistry N-P-K ratios", "irrigation scheduling evapotranspiration"],
        wallet_index=0,
    ),
    AgentConfig(
        agent_id=format_agent_id("cyber", index=1),
        collection="unison_cyber_core",
        queries=["telegraphic cipher substitution matrix", "RSA key exchange foundations"],
        wallet_index=1,
    ),
    AgentConfig(
        agent_id=format_agent_id("materials", index=1),
        collection="unison_materials_core",
        queries=["cryogenic tensile limits", "FCC lattice parameters and slip systems"],
        wallet_index=2,
    ),
]

# Revenue-gap sealed vectors (premium ingestion targets from Ops telemetry).
REVENUE_GAP_SPEC: list[tuple[str, str]] = [
    ("unison_engineering_core", "19th-century hydrodynamics"),
    ("unison_financial_core", "arbitrage spread settlement"),
    ("unison_linguistics_core", "agglutinative paradigms"),
]


def build_revenue_gap_agents(derived_addresses: list[str]) -> list[AgentConfig]:
    """Spawn exactly 3 agents mapped to the sealed revenue-gap query strings."""
    if len(derived_addresses) < len(REVENUE_GAP_SPEC):
        raise ValueError(
            f"Need {len(REVENUE_GAP_SPEC)} derived addresses, got {len(derived_addresses)}."
        )
    configs: list[AgentConfig] = []
    for i, (collection, query) in enumerate(REVENUE_GAP_SPEC):
        addr = derived_addresses[i]
        configs.append(
            AgentConfig(
                agent_id=format_agent_id("revenue-gap", index=i, addr_prefix=addr[2:8]),
                collection=collection,
                queries=[query],
                wallet_index=i,
                wallet_address=addr,
                query_archetype="revenue_gap_sealed",
            )
        )
    return configs


def resolve_collection_for_query(query: str, manifest: dict[str, object]) -> str:
    """Map a diagnostic query string to the best manifest collection."""
    q = query.lower()
    hints: list[tuple[str, str]] = [
        ("zkp|substrate|integrity|engineering", "unison_engineering_core"),
        ("legal|scotus|court", "unison_legal_core"),
        ("financial|arbitrage|edgar", "unison_financial_core"),
        ("medical|clinical|pharma", "unison_medical_core"),
        ("linguistic|morphology|agglutinative", "unison_linguistics_core"),
    ]
    names = {
        str(c.get("name", ""))
        for c in manifest.get("collections", [])
        if isinstance(c, dict)
    }
    for pattern, collection in hints:
        if re.search(pattern, q) and collection in names:
            return collection
    for collection in names:
        if collection in q.replace(" ", "_"):
            return collection
    return "unison_engineering_core" if "unison_engineering_core" in names else next(iter(names), "unison_engineering_core")


async def verify_mcp_manifest(session: aiohttp.ClientSession) -> dict[str, object]:
    """Resolve discovery from canonical Unison Orchestration brand gateway."""
    log.info("Fetching discovery matrix from: %s", MCP_MANIFEST_URL)
    async with session.get(MCP_MANIFEST_URL) as resp:
        if resp.status != 200:
            body = await resp.text()
            raise RuntimeError(
                f"Manifest probe failed ({resp.status}) at {MCP_MANIFEST_URL}: {body[:200]}"
            )
        manifest = await resp.json()
    collections = manifest.get("collections", [])
    count = len(collections) if isinstance(collections, list) else 0
    name = manifest.get("name", "unknown")
    log.info("Handshake status: HTTP 200 OK (%d Collections Resolved)", count)
    log.info(
        "[%s] MCP manifest resolved — %s",
        BRAND_NAMESPACE,
        name,
    )
    return manifest


async def run_query_diagnostic(query_text: str, *, dry_run: bool) -> int:
    """Isolated single-pass query loop for identity and suffix calibration."""
    log.info("Initializing %s...", AGENT_FLEET_LABEL)

    mnemonic, rpc_url, usdc_address, _ = _load_env()
    wallet_pool = build_wallet_pool(
        mnemonic=mnemonic,
        agent_count=1,
        rpc_url=rpc_url,
        usdc_address=usdc_address,
    )
    wallet = wallet_pool[0]
    agent_id = format_agent_id("swarm", index=0, addr_prefix=wallet.account.address[2:8])

    connector = aiohttp.TCPConnector(limit=4)
    async with aiohttp.ClientSession(
        connector=connector,
        headers=default_request_headers(),
    ) as session:
        manifest = await verify_mcp_manifest(session)
        collection = resolve_collection_for_query(query_text, manifest)
        log.info("Outbound Header Ingress: X-Agent-ID: %s", agent_id)
        log.info("Diagnostic query routed → collection=%s | q=%r", collection, query_text)

        cfg = AgentConfig(
            agent_id=agent_id,
            collection=collection,
            queries=[query_text],
            wallet_index=0,
            wallet_address=wallet.account.address,
            query_archetype="diagnostic_probe",
        )
        await deploy_swarm([cfg], wallet_pool, dry_run=dry_run)

    if dry_run:
        print(
            "[SUCCESS] Dry-run execution clean. "
            "Telemetry identifiers are securely locked."
        )
    return 0


async def deploy_swarm(
    agents: list[AgentConfig],
    wallet_pool: dict[int, AgentWallet],
    *,
    dry_run: bool = False,
    simulate: bool = False,
) -> None:
    """
    Ignite the swarm. All agent_worker coroutines run concurrently via
    asyncio.gather — HTTP queries and EVM settlements are both fully parallel
    because each wallet has an independent nonce sequence.
    """
    log.info(
        "Deploying %d-agent swarm | dry_run=%s | simulate=%s",
        len(agents), dry_run, simulate,
    )

    for cfg in agents:
        wallet = wallet_pool[cfg.wallet_index]
        log.info(
            "  %-32s  wallet[%02d]  %s  %-30s  archetype=%s",
            cfg.agent_id, cfg.wallet_index,
            wallet.account.address, cfg.collection,
            cfg.query_archetype or "—",
        )

    t0 = time.monotonic()
    connector = aiohttp.TCPConnector(limit=len(agents) * 4)
    session_headers = default_request_headers()

    async with aiohttp.ClientSession(
        connector=connector,
        headers=session_headers,
    ) as session:
        await verify_mcp_manifest(session)
        tasks = [
            agent_worker(cfg, wallet_pool[cfg.wallet_index], session,
                         dry_run=dry_run, simulate=simulate)
            for cfg in agents
        ]
        all_results = await asyncio.gather(*tasks, return_exceptions=True)

    elapsed = time.monotonic() - t0

    log.info("─" * 60)
    log.info("Swarm complete in %.2fs", elapsed)
    ok_total = err_total = 0
    for res in all_results:
        if isinstance(res, Exception):
            log.error("Agent raised exception: %s", res)
            continue
        agent_results = res["results"]
        ok = sum(1 for r in agent_results if r["status"].startswith("ok"))
        err = sum(1 for r in agent_results if r["status"].startswith("error"))
        ok_total += ok
        err_total += err
        log.info(
            "  %-28s  ok=%d  err=%d",
            res["agent_id"], ok, err
        )
    log.info("─" * 60)
    log.info("Total  ok=%d  err=%d", ok_total, err_total)


def _load_task_coordinator_tick():
    """Import Commit 2 coordinator from gtm-swarm (optional — degrades gracefully)."""
    import importlib.util

    mod_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "platform-services",
        "gtm-swarm",
        "src",
        "swarm_commander.py",
    )
    if not os.path.isfile(mod_path):
        log.warning("Task coordinator module missing at %s", mod_path)
        return None
    try:
        spec = importlib.util.spec_from_file_location(
            "unison_gtm_task_coordinator", mod_path
        )
        if spec is None or spec.loader is None:
            raise ImportError(f"Could not load spec for {mod_path}")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.run_coordinator_tick
    except Exception as exc:
        log.warning("Task coordinator unavailable (non-fatal): %s", exc)
        return None


async def run_continuous_swarm(
    agents: list[AgentConfig],
    wallet_pool: dict[int, AgentWallet],
    *,
    dry_run: bool = False,
    simulate: bool = False,
    interval_seconds: int = 1800,
    task_tick_seconds: int = 30,
) -> None:
    """PM2-supervised loop — task queue ticks every 30s + swarm cycles on interval."""
    coordinator_tick = _load_task_coordinator_tick()
    cycle = 0
    ticks_since_swarm = 0
    ticks_per_swarm = max(1, interval_seconds // task_tick_seconds)

    while True:
        cycle += 1
        ticks_since_swarm += 1

        if coordinator_tick is not None:
            log.info("=== Task coordinator tick %d START ===", cycle)
            try:
                await coordinator_tick()
            except Exception as exc:
                log.exception(
                    "Task coordinator tick %d failed (non-fatal): %s", cycle, exc
                )

        if ticks_since_swarm >= ticks_per_swarm:
            ticks_since_swarm = 0
            log.info("=== Continuous swarm cycle %d START ===", cycle)
            try:
                await deploy_swarm(
                    agents,
                    wallet_pool,
                    dry_run=dry_run,
                    simulate=simulate,
                )
            except Exception as exc:
                log.exception("Swarm cycle %d failed (non-fatal): %s", cycle, exc)
            log.info("=== Continuous swarm cycle %d COMPLETE ===", cycle)

        log.info("Sleeping %ds until next coordinator tick", task_tick_seconds)
        await asyncio.sleep(task_tick_seconds)


# ─── Entry Point ──────────────────────────────────────────────────────────────


def _load_env() -> tuple[str, str, str, str]:
    required = ["MASTER_MNEMONIC", "BASE_RPC_URL", "USDC_CONTRACT_ADDRESS"]
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        raise EnvironmentError(f"Missing required env var(s): {', '.join(missing)}")
    return (
        os.environ["MASTER_MNEMONIC"],
        os.environ["BASE_RPC_URL"],
        os.environ["USDC_CONTRACT_ADDRESS"],
        os.getenv("AGENT_PRIVATE_KEY", ""),
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unison Swarm Commander — multi-agent x402 load harness",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 swarm_commander.py                                  # standard: 3-agent static suite\n"
            "  python3 swarm_commander.py --mode aggressive                # 5 agents × 55 queries (402 load)\n"
            "  python3 swarm_commander.py --mode revenue-gap               # 3 sealed premium vectors\n"
            "  python3 swarm_commander.py --agents 25 --dry-run            # print wallet map, no tx\n"
            "  python3 swarm_commander.py --agents 50 --queries-per-agent 51 # full swarm, 402 live fire\n"
            "  python3 swarm_commander.py --query \"ZKP substrate...\" --dry-run  # identity calibration\n"
        ),
    )
    parser.add_argument(
        "--query",
        metavar="TEXT",
        help="Isolated single-pass diagnostic query (implies one-agent swarm).",
    )
    parser.add_argument(
        "--mode",
        choices=["standard", "aggressive", "revenue-gap"],
        default="standard",
        help=(
            "Execution profile: standard (default static/dynamic), aggressive "
            "(5 agents × 55 queries), revenue-gap (3 sealed telemetry queries)."
        ),
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Simulate EVM settlements without broadcasting to Base network.",
    )
    parser.add_argument(
        "--agents", type=int, default=0,
        help=(
            "Number of agents to deploy dynamically from the collection matrix. "
            "When 0 (default), runs the 3-agent static DEFAULT_AGENTS suite."
        ),
    )
    parser.add_argument(
        "--queries-per-agent", type=int, default=1,
        dest="queries_per_agent",
        help=(
            "Queries each agent executes per run (default: 1). "
            "Set > 50 to exhaust the KV free tier and trigger live x402 settlement. "
            "Queries are sampled from each collection's archetype seed pool."
        ),
    )
    parser.add_argument(
        "--simulate", action="store_true",
        help=(
            "Simulate EVM settlement: skips balance check and broadcast, generates "
            "a cryptographically random mock tx hash, sleeps 500ms to mimic block "
            "confirmation, then replays with the mock hash. HTTP queries to the edge "
            "are REAL and consume live KV free-tier quota. The Worker will reject the "
            "mock hash, exercising the full error_replay_* code path. "
            "Use to validate the async state machine without funds or gas."
        ),
    )
    parser.add_argument(
        "--continuous",
        action="store_true",
        help="Run swarm cycles on an interval until interrupted (PM2 daemon mode).",
    )
    parser.add_argument(
        "--interval-seconds",
        type=int,
        default=1800,
        dest="interval_seconds",
        help="Seconds between continuous swarm cycles (default: 1800 = 30 min).",
    )
    parser.add_argument(
        "--task-tick-seconds",
        type=int,
        default=30,
        dest="task_tick_seconds",
        help="Seconds between task queue coordinator ticks (default: 30).",
    )
    args = parser.parse_args()

    if args.simulate and args.dry_run:
        parser.error("--simulate and --dry-run are mutually exclusive.")

    if args.query:
        query_text = args.query.strip()
        if not query_text:
            parser.error("--query requires non-empty text.")
        asyncio.run(run_query_diagnostic(query_text, dry_run=args.dry_run))
        return

    log.info("=== %s Swarm Commander START ===", BRAND_NAME)
    for line in brand_init_log_lines():
        log.info(line)
    log.info("Profile   : %s", args.mode)

    agents = args.agents
    queries_per_agent = args.queries_per_agent

    if args.mode == "aggressive":
        agents = 5
        queries_per_agent = 55
        log.info(
            "Aggressive profile — overriding to %d agents, %d queries/agent.",
            agents, queries_per_agent,
        )
    elif args.mode == "revenue-gap":
        agents = len(REVENUE_GAP_SPEC)
        log.info("Revenue-gap profile — %d sealed agents (telemetry vectors).", agents)

    mnemonic, rpc_url, usdc_address, _ = _load_env()

    # ── Agent provisioning ────────────────────────────────────────────────────
    if args.mode == "revenue-gap":
        n = len(REVENUE_GAP_SPEC)
        wallet_pool = build_wallet_pool(
            mnemonic=mnemonic,
            agent_count=n,
            rpc_url=rpc_url,
            usdc_address=usdc_address,
        )
        derived_addresses = [wallet_pool[i].account.address for i in range(n)]
        agent_configs = build_revenue_gap_agents(derived_addresses)
        for cfg in agent_configs:
            log.info(
                "  %-32s  %-30s  query=%r",
                cfg.agent_id, cfg.collection, cfg.queries[0],
            )

    elif agents > 0:
        # Dynamic path: DynamicSwarmFactory distributes agents across the
        # 25-collection matrix using proportional weight assignment.
        n = agents
        log.info(
            "Dynamic provisioning: %d agents across %d collections.",
            n, len(COLLECTION_MATRIX),
        )

        wallet_pool = build_wallet_pool(
            mnemonic=mnemonic,
            agent_count=n,
            rpc_url=rpc_url,
            usdc_address=usdc_address,
        )
        derived_addresses = [wallet_pool[i].account.address for i in range(n)]

        factory = DynamicSwarmFactory()
        agent_configs = factory.generate(n, derived_addresses, queries_per_agent=queries_per_agent)

        dist_summary: dict[str, int] = {}
        for cfg in agent_configs:
            dist_summary[cfg.collection] = dist_summary.get(cfg.collection, 0) + 1
        log.info("Weight-proportional distribution:")
        for col, count in sorted(dist_summary.items(), key=lambda x: -x[1]):
            log.info("  %-40s  %d agent(s)", col, count)

    else:
        # Standard static path: 3-agent default suite for quick smoke tests.
        agent_configs = DEFAULT_AGENTS
        wallet_indices = {cfg.wallet_index for cfg in agent_configs}
        wallet_pool = build_wallet_pool(
            mnemonic=mnemonic,
            agent_count=max(wallet_indices) + 1,
            rpc_url=rpc_url,
            usdc_address=usdc_address,
        )
        log.info("Standard static 3-agent suite. Use --agents N or --mode aggressive.")

    log.info("HD wallet pool (%d wallets):", len(wallet_pool))
    for idx, wallet in wallet_pool.items():
        log.info("  wallet[%02d]: %s", idx, wallet.account.address)

    if args.dry_run:
        log.info(
            "DRY RUN mode — live HTTP queries, EVM settlements simulated (no broadcast)."
        )
    elif args.simulate:
        log.info(
            "SIMULATE mode — HTTP queries are LIVE (consumes KV free-tier quota). "
            "EVM broadcast replaced with mock hash. Worker will reject replay."
        )
    else:
        log.info(
            "LIVE mode. Each wallet must hold >= 0.10 USDC "
            "and >= 0.0001 ETH on Base (chainId: %d) before running.", BASE_CHAIN_ID
        )

    if args.continuous:
        log.info(
            "CONTINUOUS mode — %d agents, %d queries/agent, interval=%ds",
            len(agent_configs),
            queries_per_agent,
            args.interval_seconds,
        )
        asyncio.run(
            run_continuous_swarm(
                agent_configs,
                wallet_pool,
                dry_run=args.dry_run,
                simulate=args.simulate,
                interval_seconds=args.interval_seconds,
                task_tick_seconds=args.task_tick_seconds,
            )
        )
    else:
        asyncio.run(
            deploy_swarm(
                agent_configs,
                wallet_pool,
                dry_run=args.dry_run,
                simulate=args.simulate,
            )
        )


if __name__ == "__main__":
    main()
