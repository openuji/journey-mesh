# Acceptance comparison findings — 17 November 2026

Local Chromium run on macOS arm64, 1440 × 1000 viewport. The report's saved
deployment records contain image identities and enabled Notifications versions.

| Default profile | Nextcloud 34.0.2 | PR #66147 |
| --- | --- | --- |
| Inputs to acceptance and verified file mount | 3 | 1 |
| Navigation inputs before acceptance | 2 | 0 |
| Acceptance control visible on arrival | No | Yes |
| Complete modeled journey | Passed | Failed after acceptance |

The discovery improvement is observable. Automatic file reveal was not verified:
the pinned PR accepts and mounts the federated file but leaves its invitation
visible. Reloading Bob's page reveals the accepted file in the files list.
Incomplete continuation measurements remain unknown in the report. The PR model
has two states: the inline invitation where Bob accepts, then the file-list row.
It does not require a sidebar or a separate invitation-disappearance check.

The baseline keyboard activation profile stops at the pending-offer assertion:
activating the Pending shares link does not reach the expected state. A separate
browser reproduction remained at All files after Enter. The PR keyboard profile
reaches verified acceptance in one input and then encounters the same continuation
failure as the default profile. These are application-run outcomes; workspace
unit, integration, type, and build checks are separate.

Axe findings cover different observed state sets, including partial journeys.
The page displays coverage and findings without presenting the totals as an
accessibility-improvement delta.

## Investigation of the 404

Reproduced independently of Journey Mesh with uniquely named PDF files and fresh
Bob browser sessions, using `host.docker.internal` on both servers. Each diagnostic
file and share was removed afterward. Web configuration preserves this hostname;
IP discovery is opt-in for Android through `stack:up:android`.

The failing response is Nextcloud's DAV XML, containing
`Sabre\\DAV\\Exception\\NotFound` and “File with name /… could not be located”.
The DAV handler is reached; this is not an unmapped Docker `/dav` route. Acceptance
and the mountpoint lookup both return 200. A repeated direct file lookup in the
same browser session can still return 404. After reloading All files, the file row
appears and the same direct lookup returns 207. An independent Basic-auth DAV
lookup also succeeds. The served filesystem setup, federated-share manager, and
DAV directory PHP files match the pinned image.

The PR's `PendingSharesService.acceptShare` performs acceptance, reads the actual
mountpoint, and then calls `fetchNode` for DAV metadata. Its caller removes the
invitation and updates the files list only after that last call succeeds. A 404
therefore produces “Could not accept file” even after successful acceptance.

This isolates a post-accept metadata lookup/refresh failure in the tested
Nextcloud build. Mount initialization or cache handling is a plausible cause;
the exact server-side cause is not established. Temporarily forcing full
filesystem setup did not eliminate the immediate failure, and that diagnostic
setting was removed. No missing local DAV configuration has been identified.
Because the baseline is 34.0.2 rather than this PR's master base, these results do
not establish that the PR introduced the server-side failure. The integration
failure is appropriate to report against the tested PR, with that qualification.

The measured journey does not reload automatically: doing so would hide the
extra user action and make the automatic-reveal metric misleading.

## Draft for the upstream ticket

**Federated inline acceptance mounts the file but reports “Could not accept file”**

Tested server commit `fa7f792213a5f2782b0a77f7c8d70ddec82a7370` with Notifications
`9.0.0-dev.1` at `cb34906ce6d84d8ebb2038649d55718690e3975f`.

1. Run Alice and Bob on separate Nextcloud instances and share `report.pdf` with
   Bob's federated address.
2. Open All files as Bob. The inline file invitation and Accept file button appear.
3. Activate Accept file.

Observed requests:

- `POST …/remote_shares/pending/{id}` → 200.
- `GET …/remote_shares/{id}` → 200, with `mountpoint: /report.pdf`.
- Browser `PROPFIND /remote.php/dav/files/bob/report.pdf` → 404.

The UI displays “Could not accept file”; the invitation remains and the file is
not added to the current list. Independent OCS and WebDAV checks verify acceptance
and the mounted file. Reloading All files reveals the file; the same direct DAV
lookup then succeeds. This was reproduced independently of the journey runner
and occurred under both default and keyboard activation profiles.

Expected: accepting reveals the file in the current list without a manual reload.
The PR also promises to highlight the file and open its details; the journey
comparison currently verifies only the file-list outcome.

This looks like an integration failure in the tested Nextcloud development build,
rather than a missing local DAV route. Its presence on the PR's master base has
not been tested, so attribution to the PR's changes remains open.

Attach the published comparison URL and workflow-run URL from the GitHub Actions
publish summary. No upstream ticket or comment has been posted by this work.
