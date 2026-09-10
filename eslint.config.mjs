import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { PlainTextParser } from 'eslint-plugin-obsidianmd/dist/lib/plainTextParser.js';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
  globalIgnores(['node_modules/**', 'dist/**', '.lab/**', 'test-results/**', 'coverage/**', 'main.js']),
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: { allowDefaultProject: ['manifest.json'] },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json'],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    // Isolated website code has no Obsidian DOM helpers or stylesheet access.
    files: ['src/page-runtime.ts'],
    rules: { 'obsidianmd/prefer-create-el': 'off', 'obsidianmd/no-static-styles-assignment': 'off' },
  },
  {
    files: ['manifest.json'],
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: false } },
    rules: { 'obsidianmd/validate-manifest': 'error' },
  },
  {
    files: ['LICENSE'],
    languageOptions: { parser: PlainTextParser, parserOptions: { projectService: false } },
    rules: { 'obsidianmd/validate-license': 'warn' },
  },
);
