# Changelog

## [0.3.0] - 2026-10-02

- Hold the modifier and click a link to another note or a PDF in your vault to open it in the overlay, from Reading view and Live Preview. Close it with Escape or keep it as a tab.
- Heading and block links scroll to their target, PDF page links open that page, and plain PDF links return to the position Obsidian remembers, as with an ordinary link click.
- Notes open in your default view mode and can be edited. Links to missing notes, within the same note, or to other file types keep Obsidian's usual behavior.

## [0.2.2] - 2026-10-01

- Load the plugin even when its saved data cannot be fully read. Saved hiding rules that cannot be read are skipped, and the previous data is copied to a backup file in the plugin folder first.
- Keep settings and hiding rules read-only when they were saved by a newer Link Float version or the data file is damaged, so synced devices do not overwrite them.

## [0.2.1] - 2026-09-10

- Render the element picker highlight in Obsidian’s interface while preserving selection, saved hiding rules, and page interaction.
- Keep the highlight aligned during scrolling and zoom changes, and clear it when selection ends.

## [0.2.0] - 2026-09-10

- Hide selected website elements in previews and ordinary Web viewer tabs. Saved rules apply across page reloads and later visits.
- Preview a selection before saving, cancel it, or use Hidden elements → Show again to restore an element across matching open tabs.
- Open previews from links in ordinary Web viewer tabs with the configured modifier while preserving the source page’s form state, history, and scroll position.

Requires Obsidian 1.13.7 or later on desktop with Web viewer enabled. The picker selects elements in the main page. Embedded frames and web components can be hidden as a whole, but their internal elements cannot be selected.

## [0.1.1] - 2026-09-10

- Publish a new version for automated Community directory review.
- No changes to plugin behavior.

## [0.1.0] - 2026-09-10

Initial release.

- Open web links in a temporary overlay with configurable modifier-click in Reading view and Live Preview.
- Expand from the clicked link and close with the reverse animation, with reduced-motion support and sizing that follows the sidebars.
- Keep the same live page as an Obsidian tab, including its form state, history, and scroll position.
- Search within the page, navigate back and forward, reload, copy its address, and pin against outside clicks.
- Show Leave / Cancel when a website requests a close warning, and optionally restore reading positions when reopening links.
- Reuse the vault's existing Web viewer sessions.

Requires Obsidian 1.13.7 or later on desktop with the Web viewer core plugin enabled. Tested on macOS. Google sign-in currently returns a 401 error in the tested Web viewer environment.
