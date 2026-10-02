# Architecture

Link Float presents an existing core leaf in the browser's popover top layer: a Web viewer page, or a vault note or PDF. It does not recreate or reparent the view to open the overlay or keep it as a tab. Core Web viewer retains ownership of website sessions, navigation, popups, permissions, downloads, and certificates.

## Source and lifecycle

`main.ts` recognizes configurable modifier-clicks in notes; `web-pages.ts` receives equivalent trusted link intents from Web viewer guests. Both paths delegate accepted HTTP(S) links to a single active preview. Other URL schemes and URLs containing embedded credentials are rejected. Note links from Reading view anchors and Live Preview tokens are resolved with core link resolution; only existing Markdown notes and PDFs other than the source note are intercepted, and every other link keeps its core behavior. An opening-intent counter prevents late asynchronous requests from replacing newer work.

`preview.ts` owns the temporary leaf, external controls, keyboard scope, confirmation dialog, reading session, and animation. The source note or Web viewer remains painted underneath and is temporarily inert. Closing removes the leaf and restores the source; Keep removes only the overlay shell and activates the same leaf as a normal tab. Notes and PDFs open with the link's subpath as core open state, so headings, blocks, PDF pages, and PDF.js's remembered positions behave as in an ordinary tab. Until the overlay is shown, a note or PDF is laid out at the overlay's size, hidden and out of the tab row, so it neither flashes beside the source nor resizes it. The shown preview becomes the active leaf, so core commands such as search act on it, and the subpath is applied once more before motion starts. A core page preview left over the clicked link is dismissed, as navigation would dismiss it. Notes and PDFs have no close check; an edited note is saved by core when its leaf closes.

Temporary leaves are filtered from workspace snapshots. The layout wrapper is restored on unload when still owned by Link Float; later wrappers remain intact. Forced source removal and plugin unload release the preview immediately.

## Geometry and motion

`frame.ts` follows the central workspace with ResizeObserver, excluding visible sidebars. At wide sizes the page occupies 80% of that area. Narrow sizes reserve room for the controls; if sidebars leave less than 320 px, the preview uses the window width.

`motion.ts` animates the existing page with a 280 ms damped spring. Opening waits briefly for the embedded browser to prepare while the source link stays visible. The Markdown editor measures its lines through CSS transforms and would scroll or misplace clicks after scaling, so a note waits until its view has scrolled, then a static copy moves while the live view keeps its final geometry, hidden until the copy is removed. Closing reverses the same timeline. Interrupted opening, reduced motion, and teardown cancel pending callbacks and animations.

A native close check can navigate to a blank page. A temporary canvas retains the preceding page pixels through that check and closing motion. Native bitmap data is converted in memory; it is never written to disk. Cancel removes the canvas and reveals the original live page. Capture and conversion have deadlines, and late resources are released.

## Close warnings and reading positions

`close-guard.ts` uses native beforeunload behavior to distinguish a site-requested warning from an ordinary close. A blocked close displays Leave / Cancel. An unresponsive check displays a separate confirmation. There are no form-dirty heuristics and no form serialization. In-page navigation, kept tabs, and application shutdown remain Web viewer behavior.

`reading.ts` samples the document URL and scroll position. Restoration is bounded, explicit fragments take priority, and trusted page input cancels delayed restoration. Small page helpers observe input and control scrolling; their listeners are removed afterward.

`positions.ts` stores at most 100 complete URLs with coordinates and timestamps in Obsidian's vault/device local storage for 30 days. Existing storage keys are retained across installation-directory changes. Explicit fragments, malformed data, and expired entries are excluded. Clearing the cache invalidates in-flight restoration and removes legacy data.

## Persistent hiding and native Web viewer links

`web-pages.ts` owns a registry of main-window Web viewer guests for the plugin lifetime. Layout events and DOM attachment changes discover existing, deferred, restored, directly opened, and kept tabs. Controllers survive removal of the preview shell. Guest replacement or destruction releases the controller; saved rules remain in storage.

`page-runtime.ts` is bundled independently and evaluated in an isolated guest world through the adapter in `compatibility.ts`. A document token binds commands and bounded console-event messages to the current controller generation and URL. Link interception is event-driven, with no recurring tab polling. It validates HTTP(S) destinations, exact modifiers and drag distance, and maps the guest link rectangle to host coordinates using viewport dimensions. The existing single-preview policy also handles replacement from a preview.

The picker uses a temporary transparent host layer over the guest, so selecting an element does not activate website handlers. Pointer coordinates map to the isolated document for hit testing and selection. The document returns the target rectangle and viewport size; an Obsidian-owned highlight inside the host layer maps these to percentages and clips to the guest viewport. Styles use plugin CSS and Obsidian helpers. Highlight updates are scoped to the document and picker session, refresh on scrolling, resizing, and DOM changes, and stop when the pointer leaves the page or the picker closes. Save/Cancel and rule management use an Obsidian-owned popover that stays accessible even when sidebars leave little page width. The picker ends on navigation, Close, Keep, or unload.

CSS Selector Generator 3.9.4 provides candidate selectors behind the isolated helper, with explicit candidate/combination limits and generated-token exclusions. Selection verifies both singleton count and selected-node identity. Saved guards check tag, retained ID/classes and, when no stable ID exists, a bounded text fingerprint. Before saving, the helper revalidates the selected node. This reduces accidental matches; it is not a guarantee of semantic identity after arbitrary site redesigns.

Rules use exact origins and top-document selectors. Reconciliation applies owned attributes through user-origin CSS, preserves zero-match rules, and suspends ambiguous or changed matches. A coalesced MutationObserver also removes copied markers from cloned nodes. A set of desired targets preserves overlapping rule ownership. Undo and unload remove active markers, including copies; CSS removal is requested separately by its returned key. Effective restoration does not depend on that removal succeeding. A cancelled native close probe retains confirmed rules until a document actually changes.

`data.ts` validates and migrates legacy settings into one versioned data document. Settings and rule changes share a serialized read/modify/write queue; confirmed in-memory state advances only after a successful write. Failed writes leave confirmed rules intact and permit later retries. Rules have no expiry and do not use the reading-position cache. Unreadable rules are skipped after the original data is copied to a backup file. Data from a newer schema version, or an unparseable `data.json`, loads read-only so it is not overwritten.

## Compatibility

Private Obsidian and Electron access is concentrated in `compatibility.ts`. This includes the Web viewer guest, leaf identity and container, sidebar geometry, editor-link tokens, and page-search integration. Missing capabilities are checked where used, but compatibility with every future Obsidian release is not guaranteed. Only the main desktop vault window is supported.
