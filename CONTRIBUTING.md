# Contributing to Link Float

Use Node.js 22.13 or later and npm. Run commands from the repository root.

```sh
npm ci
npm run package
```

Dependencies are pinned in `package-lock.json`. The scoped override for `eslint-plugin-obsidianmd` uses the project's current Obsidian API typings instead of the linter package's older exact peer requirement. It does not disable any rules.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check TypeScript without emitting files. |
| `npm run lint` | Run the official Obsidian ESLint configuration with zero warnings allowed. |
| `npm test` | Run focused tests for links, layout filtering, saved positions, and serialized settings/rule storage. |
| `npm run build` | Typecheck and build the production plugin. |
| `npm run check` | Run lint, tests, typecheck, and build. |
| `npm run package` | Run checks and write `dist/link-float` and SHA-256 checksums. |
| `npm run release:notes -- 0.2.2` | Validate release metadata and extract the matching changelog section. |

`src/` contains the plugin, `tests/` contains unit tests, and `scripts/` contains build and local integration tools. The build externalizes Obsidian and CodeMirror and does not include the test harness, fixtures, or developer tools. The guest helper is built separately as an isolated-world script, including the pinned CSS Selector Generator dependency and its license notice. The picker highlight uses Obsidian DOM helpers and plugin CSS in the host interface; the guest helper only reports target geometry. All recommended Obsidian lint rules apply to both scripts. See [architecture](docs/architecture.md) and [testing](docs/testing.md).

## Changes

Use a short-lived branch from `main` and a pull request describing the resulting behavior. Keep changes focused and run checks appropriate to the affected behavior. Use synthetic examples in tests and bug reports. Do not commit vault settings, browser profiles, credentials, local paths, screenshots of private pages, or generated diagnostic reports. These belong in ignored local directories.

## Releases

1. Update `manifest.json`, `package.json`, the lockfile root version, and `versions.json` consistently. Use `x.y.z` versions. Keep the plugin ID `link-float` stable.
2. Add dated, user-facing changes to `CHANGELOG.md`; its version section is the source for release notes.
3. Run `npm run package` and `npm run release:notes -- x.y.z`. Complete the relevant integration checks and review the final public files and images.
4. Push the reviewed source and verify GitHub CI. Use **Review branch** in the Obsidian Community developer dashboard to inspect review findings before a release where available.
5. Push a version tag matching the manifest exactly, without a `v` prefix. The release workflow builds and validates the package, creates provenance attestations, and prepares a draft release with individual `main.js`, `manifest.json`, and `styles.css` assets.
6. Inspect the draft, notes, and asset checksums before publishing. The workflow does not publish the release or submit a Community entry, and it does not overwrite an existing release on rerun.

For the first directory submission, connect the repository through [Obsidian Community](https://community.obsidian.md/), follow the [submission instructions](https://docs.obsidian.md/plugins/releasing/submit-plugin), and resolve blocking review findings. A successful build or GitHub release does not imply directory acceptance.
