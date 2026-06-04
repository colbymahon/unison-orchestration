# LangChain Community — UnisonX402Retriever (upstream fork payload)

Mirrors the official `langchain-ai/langchain` monorepo layout for a copy-paste PR into
`langchain_community`. Tracks public specification: [langchain-ai/langchain#37900](https://github.com/langchain-ai/langchain/issues/37900).

## Copy into your fork

```bash
# After: gh repo fork langchain-ai/langchain --clone
cd langchain
cp -R /path/to/unison-orchestration/integrations/langchain-community-contrib/libs/community/langchain_community/* \
  libs/community/langchain_community/
cp -R .../tests/unit_tests/retrievers/test_unison_unit.py \
  libs/community/tests/unit_tests/retrievers/
```

Add to `libs/community/langchain_community/retrievers/__init__.py`:

```python
from langchain_community.retrievers.unison import UnisonX402Retriever

__all__ = [..., "UnisonX402Retriever"]
```

## Local unit tests (this tree)

```bash
cd integrations/langchain-community-contrib
pip install langchain-core requests pydantic pytest
PYTHONPATH=libs/community pytest libs/community/tests/unit_tests/retrievers/test_unison_unit.py -q
```

## Production reference

Canonical implementation: `packages/unison-langchain/` (commit a2b3495+).
