# Changelog

## [0.1.0] - 2026-09-10

Initial release.

- Open web links in a temporary overlay with configurable modifier-click in Reading view and Live Preview.
- Expand from the clicked link and close with the reverse animation, with reduced-motion support and sizing that follows the sidebars.
- Keep the same live page as an Obsidian tab, including its form state, history, and scroll position.
- Search within the page, navigate back and forward, reload, copy its address, and pin against outside clicks.
- Show Leave / Cancel when a website requests a close warning, and optionally restore reading positions when reopening links.
- Reuse the vault's existing Web viewer sessions.

Requires Obsidian 1.13.7 or later on desktop with the Web viewer core plugin enabled. Tested on macOS. Google sign-in currently returns a 401 error in the tested Web viewer environment.
