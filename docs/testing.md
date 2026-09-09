# Testing

Tested on macOS with Obsidian 1.13.7 and Electron 43.3.0, including a 120 Hz display. Opening and closing, sidebar layout, ordinary interaction, GitHub sign-in, and application restart were checked. Google sign-in returns 401 in the tested Web viewer environment. Windows/Linux UI behavior and mobile are not covered; Linux CI checks source and builds only.

## Automated checks

`npm run package` runs the official Obsidian ESLint configuration, unit tests, TypeScript, and the production build. It requires no installed Obsidian app or local vault.

Unit tests cover URL and modifier handling, workspace snapshot filtering, bounded reading-position storage, expiry, malformed data, and migration behavior.

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
| `npm run lab:test-ui` | External controls, page geometry, themes, narrow windows, and hit testing. |
| `npm run lab:test-lifecycle` | Concurrent requests, late completion, source ownership, search, and context menu. |
| `npm run lab:test-session` | Leave/Cancel, draft preservation, replacement, reading restoration, and interruption. |
| `npm run lab:test-motion` | Forward/reverse geometry, opaque moving pixels, live guest identity, interruption, reduced motion, and capture cleanup. |
| `npm run lab:test-frame` | Both sidebars, resizing, centering, and retained guest identity. |
| `npm run lab:test-recovery` | Reload of the Peek Lab renderer and workspace/reading recovery. Requires an otherwise empty test workspace. |
| `npm run lab:measure-motion` | Three fixture cycles measured from deduplicated Chromium frame reports without screen recording. |

Reports and diagnostic captures are written to ignored `test-results/` and `.lab/` directories. Motion checks temporarily attach the lab debugger and restore their media emulation afterward. Fixtures use ports 4179 and 4180; they do not require real accounts.

The performance diagnostic reports preparation latency separately from frame delivery. A short local sample is not a guarantee of zero dropped frames on arbitrary sites or under other system load. The renderer recovery test is distinct from a full application restart.

For manual checks, use representative links, an editable page, and a long article. Check Cancel versus Leave, Keep preserving the same live page, reopening at the saved position, the chosen modifier, and sidebar resizing. Account-specific flows require separate testing in the destination site; fixture login does not establish compatibility with an external identity provider.
