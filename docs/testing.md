# Testing

Tested on macOS with Obsidian 1.13.7 and Electron 43.3.0, including a 120 Hz display. Opening and closing, sidebar layout, ordinary interaction, GitHub sign-in, and application restart were checked. Google sign-in returns 401 in the tested Web viewer environment. Windows/Linux UI behavior and mobile are not covered; Linux CI checks source and builds only.

## Automated checks

`npm run package` runs the official Obsidian ESLint configuration, unit tests, TypeScript, and the production build. It requires no installed Obsidian app or local vault.

Unit tests cover URL and modifier handling, which vault files open in a preview, workspace snapshot filtering, bounded reading-position storage, expiry, malformed data, migration behavior, concurrent settings/rule writes, and recovery after failed writes.

## Local integration harness

The integration harness is macOS-specific and uses Obsidian's local CLI socket. It targets only this checkout's `.lab/Peek Lab` vault and checks its exact path before evaluating commands. It creates and closes test leaves, changes test note modes, and brings that window forward. Run harnesses sequentially.

Prepare and open a disposable vault:

```sh
npm run lab:prepare
```

Open `.lab/Peek Lab` in Obsidian, enable the CLI, and enable Web viewer and Link Float. Start the loopback fixtures in separate terminals:

```sh
npm run lab:fixture
```

```sh
npm run lab:fixture-session
```

Run the checks relevant to the change:

| Command | Coverage |
| --- | --- |
| `npm run lab:test` | Trusted modifier-click, source restoration, Keep, guest state, sessions, keyboard input, unload, and rapid cycles. |
| `npm run lab:test-hiding` | Persistent selection, native-tab coverage, cross-tab propagation, Undo, DOM ambiguity/reordering, close cancellation, native Peek, narrow controls, and vault renderer restoration. Starts its own fixture on port 4182. |
| `npm run lab:test-ui` | External controls, page geometry, themes, narrow windows, and hit testing. |
| `npm run lab:test-lifecycle` | Concurrent requests, late completion, source ownership, search, and context menu. |
| `npm run lab:test-session` | Leave/Cancel, draft preservation, replacement, reading restoration, and interruption. |
| `npm run lab:test-motion` | Forward/reverse geometry, opaque moving pixels, live guest identity, interruption, reduced motion, and capture cleanup. |
| `npm run lab:test-notes` | Note and PDF links from Reading view and Live Preview, heading and block positions compared with ordinary tabs, PDF page links and remembered positions, ignored links, replacement, Keep, editing with Escape, and search. Writes its own fixture notes and PDF into the lab vault. |
| `npm run lab:test-frame` | Both sidebars, resizing, centering, and retained guest identity. |
| `npm run lab:test-recovery` | Reload of the Peek Lab renderer and workspace/reading recovery. Requires an otherwise empty test workspace. |
| `npm run lab:measure-motion` | Three fixture cycles measured from deduplicated Chromium frame reports without screen recording. |

Reports and diagnostic captures are written to ignored `test-results/` and `.lab/` directories. Motion checks temporarily attach the lab debugger and restore their media emulation afterward. Fixtures use ports 4179 and 4180; they do not require real accounts.

The performance diagnostic reports preparation latency separately from frame delivery. A short local sample is not a guarantee of zero dropped frames on arbitrary sites or under other system load. The renderer recovery test is distinct from a full application restart.

For manual checks, use representative links, an editable page, and a long article. Check Cancel versus Leave, Keep preserving the same live page, reopening at the saved position, the chosen modifier, and sidebar resizing. Account-specific flows require separate testing in the destination site; fixture login does not establish compatibility with an external identity provider.

## Persistent hiding acceptance

The local hiding harness uses trusted Electron input in Obsidian 1.13.7 / Electron 43.3.0 on macOS. It checks highlight alignment in ordinary tabs and previews, scrolling, DOM resizing, 125 percent web zoom, pointer exit, target removal, rapid picker restart, navigation cleanup, picker isolation from earlier page handlers, reversible node/input/listener state, propagation to independent tabs, Keep identity, settings persistence, plugin unload/reload, cloned and reordered DOM, overlapping rules, exact-origin scope, native-tab Peek, native close cancellation, narrow-window rule controls, and restoration after reloading the disposable vault renderer.

These fixtures do not establish selector durability across arbitrary live-site redesigns, iframe/Shadow DOM traversal, other desktop operating systems, or a full application-process restart of this new implementation. The persisted-file and restored-tab checks are distinct from that last scenario.
