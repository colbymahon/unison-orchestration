# Channel B — LangChain distribution (2026 routing)

## Why GitHub Discussions failed

| URL | Error | Cause |
|-----|--------|--------|
| `github.com/langchain-ai/langchain/discussions/new` | Invalid category | Repo only exposes **Announcements** (`announcements`). **Ideas / Integrations do not exist.** Top thread: discussions moved off GitHub. |
| `github.com/langchain-ai/langchain-community/discussions` | **404** | `has_discussions: false` — discussions never enabled on that repo. |

## Policy change (May 2026)

[`langchain-community` is sunset](https://github.com/langchain-ai/langchain-community/issues/674). **No new retriever PRs** are accepted into `langchain_community`.

Official path: [**Publish a standalone integration**](https://docs.langchain.com/oss/python/contributing/publish-langchain)

Unison already ships this:

```bash
pip install unison-langchain
# or from monorepo: packages/unison-langchain/
```

## Correct upstream touchpoints

1. **LangChain Forum** (replaces GitHub Ideas/Integrations)  
   - https://forum.langchain.com  
   - Category: **Talking Shop** or **OSS Product Help**  
   - Body: `integrations/LANGCHAIN_FORUM_POST.md`

2. **PyPI** — publish `unison-langchain` if not already on index.

3. **Docs listing** — PR to LangChain **docs** repo (not `langchain` code):  
   https://docs.langchain.com/oss/python/contributing/publish-langchain

4. **Smithery** (primary M2M ingress) — `crmendeavors/unison-orchestration-hub`

5. **Optional GitHub issue** on `langchain-ai/langchain` (expect redirect to standalone package):  
   Title: `[External Integration] unison-langchain — TSV/x402 MCP retriever`  
   Link PyPI + Smithery + manifest; do **not** expect a monorepo merge.

## Deprecated (do not use)

- PR into `libs/community/langchain_community/retrievers/unison.py`
- GitHub Discussion categories Ideas / Integrations on `langchain-ai/langchain`
- `langchain-community` discussions URL

Fork payload in `integrations/langchain-community-contrib/` remains useful as **reference implementation** for docs and Forum posts, not for upstream merge.
