# Architecture

Link Float presents an existing core Web viewer leaf in the browser's popover top layer. It does not recreate or reparent the embedded browser to open the overlay or keep it as a tab. Core Web viewer retains ownership of website sessions, navigation, popups, permissions, downloads, and certificates.

## Source and lifecycle

`main.ts` recognizes configurable modifier-clicks and delegates accepted HTTP(S) links to a single active preview. Other URL schemes and URLs containing embedded credentials are rejected. An opening-intent counter prevents late asynchronous requests from replacing newer work.

`preview.ts` owns the temporary leaf, external controls, keyboard scope, confirmation dialog, reading session, and animation. The source note remains painted underneath and is temporarily inert. Closing removes the leaf and restores the source; Keep removes only the overlay shell and activates the same browser leaf as a normal tab.

Temporary leaves are filtered from workspace snapshots. The layout wrapper is restored on unload when still owned by Link Float; later wrappers remain intact. Forced source removal and plugin unload release the preview immediately.

## Geometry and motion

`frame.ts` follows the central workspace with ResizeObserver, excluding visible sidebars. At wide sizes the page occupies 80% of that area. Narrow sizes reserve room for the controls; if sidebars leave less than 320 px, the preview uses the window width.

`motion.ts` animates the existing page with a 280 ms damped spring. Opening waits briefly for the embedded browser to prepare while the source link stays visible. Closing reverses the same timeline. Interrupted opening, reduced motion, and teardown cancel pending callbacks and animations.

A native close check can navigate to a blank page. A temporary canvas retains the preceding page pixels through that check and closing motion. Native bitmap data is converted in memory; it is never written to disk. Cancel removes the canvas and reveals the original live page. Capture and conversion have deadlines, and late resources are released.

## Close warnings and reading positions

`close-guard.ts` uses native beforeunload behavior to distinguish a site-requested warning from an ordinary close. A blocked close displays Leave / Cancel. An unresponsive check displays a separate confirmation. There are no form-dirty heuristics and no form serialization. In-page navigation, kept tabs, and application shutdown remain Web viewer behavior.

`reading.ts` samples the document URL and scroll position. Restoration is bounded, explicit fragments take priority, and trusted page input cancels delayed restoration. Small page helpers observe input and control scrolling; their listeners are removed afterward.

`positions.ts` stores at most 100 complete URLs with coordinates and timestamps in Obsidian's vault/device local storage for 30 days. Existing storage keys are retained across installation-directory changes. Explicit fragments, malformed data, and expired entries are excluded. Clearing the cache invalidates in-flight restoration and removes legacy data.

## Compatibility

Private Obsidian and Electron access is concentrated in `compatibility.ts`. This includes the Web viewer guest, leaf identity and container, sidebar geometry, editor-link tokens, and page-search integration. Missing capabilities are checked where used, but compatibility with every future Obsidian release is not guaranteed. Only the main desktop vault window is supported.
