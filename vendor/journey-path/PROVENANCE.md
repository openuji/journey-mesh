# Journey Path snapshot

Source: `openuji/renderer`, `packages/journey-path`

Commit: `ed4e5df3bf9362544d2bdf1026580754a4c1c034`

This is the committed source used by the Journey Mesh demo. Local uncommitted
changes were excluded. The upstream snapshot has no LICENSE file; no additional
license is asserted here. Existing source notices are retained.

Integration changes: workspace-compatible package scripts and explicit dependency
versions replace the upstream workspace catalog. The comparison uses the public
React renderer API. A local parser fix resolves touchpoints on indexed root
composites through their contained journey as well as their owner. This restores
header metadata for the comparison's existing UJG documents.
