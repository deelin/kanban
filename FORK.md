# Dennis's Kanban fork

Source: https://github.com/deelin/kanban

This fork keeps the `kanban` command and adds image drop and clipboard-image
paste to existing agent terminals. The initial release is
`0.1.70-deelin.1`, based on upstream commit
`abd4912` (Kanban 0.1.70). Upstream history and its Apache-2.0 license are retained.

## Install on another Mac or Linux machine

Use Node.js 22 or newer; this release was built and tested with Node 22.22.3.
Install the normal Codex/Claude CLI separately and sign in on the new machine.

Download the prebuilt package from the fork's GitHub release:

```sh
gh release download v0.1.70-deelin.1 --repo deelin/kanban \
  --pattern 'kanban-0.1.70-deelin.1.tgz' --pattern 'SHA256SUMS'
shasum -a 256 -c SHA256SUMS
npm install --global ./kanban-0.1.70-deelin.1.tgz
kanban --version
kanban
```

The package includes the built web UI and runtime. Native dependencies are
installed for the destination machine by npm. No npm registry publication or
post-install patch script is needed. This image bridge currently targets POSIX
runtimes (macOS/Linux); it uses a private directory under `/tmp` and requires
`node` on the Kanban runtime's PATH.

### Build from source instead

```sh
gh repo clone deelin/kanban
cd kanban
git checkout v0.1.70-deelin.1
npm ci
npm --prefix web-ui ci
npm run build
npm pack --ignore-scripts
npm install --global ./kanban-0.1.70-deelin.1.tgz
```

For development, `npm run dev:full` runs the local source. Keep `origin` pointed
to `deelin/kanban` and `upstream` pointed to `cline/kanban`.

## What's changed

- Screenshot drag-and-drop and image paste work in existing terminal sessions.
- File handles are captured during event dispatch, before the browser protects
  the drag store. Transient reads are retried for macOS screenshot promises.
- PNG/JPEG/GIF/WebP are recognized from their bytes, including files with missing
  MIME metadata. The per-image limit is 20 MB.
- Images are written through Kanban's workspace-scoped command API, then their
  paths are bracket-pasted. Codex turns these paths into image attachments.
  No Enter key is sent, so the user can finish their prompt before submitting.
- Uploads remain bound to their original terminal session; replacement or
  disconnection prevents an attachment from landing in the wrong session.
- Pending/unattached files are cleaned up on failure. Successful attachments
  stay in `/tmp/kanban-drop-*` so the session can continue reading them.
- Ordinary text paste is preserved; terminal disposal removes the event handlers.
- Personal release versions disable both automatic and manual npm updates to
  prevent the public package from overwriting the fork. Update using a new fork
  release or rebuild from source.
- The personal build does not run the upstream Sentry sourcemap-upload script.
  This change does not otherwise alter upstream runtime telemetry behavior.

If a browser supplies no file to JavaScript, save the screenshot first and drag
the saved file. The handler shows an error instead of silently doing nothing.

## Migrating an existing patched installation

The original image fix was developed as a local patch against Kanban 0.1.68.
This fork ports that fix into source on the newer upstream base. Other historical
local changes (polling throttles, task pause/restart behavior, custom hook fixes,
board recovery helpers, and automatic-pruning changes) have **not** been ported
or audited here. This release is not a full replica of that patched installation.

Before replacing an existing runtime, preserve its package and Kanban state,
finish or pause its active agent sessions, and compare any other custom patches.
Installing this fork changes the `kanban` command for future processes; it does
not hot-swap an already-running daemon. A launchd service with a hard-coded
Node/package path must point to the installation managed by that same Node.

## Optional Codex status line

[`examples/codex-statusline.toml`](examples/codex-statusline.toml) contains the
colorful status-line preset developed alongside the image fix. Merge the `[tui]`
keys into your Codex config; do not overwrite the entire config. New Codex
sessions pick it up. Usage-limit and estimated-cost fields appear only when
Codex has those values for the active account. API-key authentication does not
provide the ChatGPT `/usage` meters.

## Validation

The image suites cover synchronous handle capture, delayed readability,
clipboard/FileList fallbacks, missing MIME, oversize/type rejection, chunked
upload integrity, private file permissions, cleanup, normal text paste,
session replacement, and listener disposal. Fork-update tests ensure no upstream
registry lookup or install command is run for personal versions.

```sh
npm --prefix web-ui test -- src/terminal/terminal-image-transfer.test.ts \
  src/terminal/terminal-image-upload.test.ts src/terminal/terminal-image-input.test.ts
npx vitest run test/runtime/update/auto-update.test.ts \
  test/runtime/update/personal-fork-update.test.ts
npm run web:typecheck
npm run build
```

Browser promises are simulated in regression tests. The original local bridge
was also used to deliver screenshot attachments into a real Codex session on
macOS. Account credentials, local workspace state, screenshots, and machine-
specific configuration are not part of this repository or release.
