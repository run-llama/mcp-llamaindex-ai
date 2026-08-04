import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'jest.*.js',
      'next.*.ts',
    ],
  },
  {
    files: [
      'lib/**/*.ts',
      'app/**/*.ts',
      '__tests__/*.ts',
      'middleware.ts',
      'instrumentation.ts',
    ],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  tseslint.configs.recommended,
  {
    // The SDK falls back to reading LLAMA_CLOUD_BASE_URL itself, and then to the
    // NA API, so a client constructed without an explicit baseURL silently
    // bypasses the region guard and ships EU documents to North America.
    //
    // Three rules, none of them airtight on its own: the env reads stay in one
    // place; a construction spelled `new LlamaCloud` must pass a baseURL; and
    // the SDK cannot be imported outside the modules that already construct
    // clients, so a new call site is a lint error rather than a silent bypass.
    // A renamed import inside those modules, `baseURL: undefined`, or a key
    // computed at runtime all still slip through — this raises the cost of an
    // accidental reversion, it is not a boundary. The structural fix is a single
    // factory that owns construction; see the follow-up note in the PR.
    files: [
      'lib/**/*.ts',
      'lib/**/*.tsx',
      'app/**/*.ts',
      'app/**/*.tsx',
      'instrumentation.ts',
      'middleware.ts',
    ],
    ignores: ['lib/region.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          // patterns, not paths: the repo already imports subpaths of this
          // package, so an exact-specifier rule would miss the spelling a
          // developer most plausibly reaches for.
          patterns: [
            {
              group: ['@llamaindex/llama-cloud', '@llamaindex/llama-cloud/*'],
              message:
                'Construct LlamaCloud only where the region guard is applied (lib/business/*, app/api/upload). A new call site must pass baseURL: llamaCloudBaseUrl().',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[object.object.name="process"][object.property.name="env"][property.name=/^LLAMA_CLOUD_(BASE_URL|REGION)$/]',
          message:
            'Read this through lib/region.ts (llamaCloudBaseUrl / getRegion) so the region guard cannot be bypassed.',
        },
        {
          selector:
            'MemberExpression[object.object.name="process"][object.property.name="env"][property.value=/^LLAMA_CLOUD_(BASE_URL|REGION)$/]',
          message:
            'Read this through lib/region.ts (llamaCloudBaseUrl / getRegion) so the region guard cannot be bypassed.',
        },
        {
          selector:
            'VariableDeclarator[init.object.name="process"][init.property.name="env"] > ObjectPattern > Property[key.name=/^LLAMA_CLOUD_(BASE_URL|REGION)$/]',
          message:
            'Read this through lib/region.ts (llamaCloudBaseUrl / getRegion) so the region guard cannot be bypassed.',
        },
        {
          // The bypass the env rules cannot see: omitting baseURL entirely makes
          // the SDK read the raw variable itself and then fall back to the NA
          // API, so an EU deployment would ship documents to North America.
          selector:
            'NewExpression[callee.name="LlamaCloud"]:not(:has(ObjectExpression > Property[key.name="baseURL"]))',
          message:
            'Construct LlamaCloud with `baseURL: llamaCloudBaseUrl()`. Without it the SDK falls back to the NA API and the region guard is bypassed.',
        },
      ],
    },
  },
  {
    // The modules that already construct clients, all of which pass baseURL.
    files: ['lib/business/*.ts', 'app/api/upload/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
]);
