# Working on this repo

Notes for AI coding agents. Humans are welcome to read them too, but
`CONTRIBUTING.md` is the entry point for contributors.

## Attribution

**Never add AI attribution to commits.** No `Co-Authored-By:` naming an AI, no
`Generated with ...` footers, no session links, no tool name in the message
body. Commits are authored by the maintainer. The same applies to PR
descriptions and to comments posted on issues and pull requests.

If a trailer slips in, it has to be stripped by rewriting history and
force-pushing, which is disruptive on a published branch — so get it right the
first time.

A contributor's own commit is theirs. If a PR arrives carrying an
`AI-Co-Authored-By` trailer the contributor wrote themselves, leave it alone;
that is their authorship record, not ours.

## Tests

Two rules, both non-negotiable:

1. **Run the tests after every change.** `npm test` must pass before you
   hand work back or commit it. Report the result honestly — if something
   fails, say so and show the output rather than describing the change as done.
2. **Every bug fix and every new feature ships with a test.** A fix without a
   regression test is not finished. The test should fail against the old
   behaviour and pass against the new one — say so explicitly, and prove it by
   reverting the fix and watching the test fail.

```sh
npm test               # JS unit tests (node --test), requires Node >= 22
npm run test:android   # Kotlin/JVM unit tests through the example app's Gradle
npm run test:ios       # XCTest target in the example app (macOS, after pod install)
npm run e2e:all        # appium e2e; android / ios / windows variants exist
```

JS unit tests live in `tests/unit/*.test.js` and use Node's built-in runner — no
jest, no new dependencies. The package source is Flow-annotated ESM that imports
`react-native`, which plain Node cannot run, so `npm test` registers the loader
hooks in `tests/unit/harness/`: they strip the Flow syntax with the Babel that
`@react-native/babel-preset` already brings, and resolve `react-native` to
`tests/unit/harness/react-native.js`, a fake whose platform, native module and
events a test sets (`rn.setPlatform`, `rn.setNativeModule`, `rn.emit`). Tests of
package code import the package files directly; `tests/unit/harness.test.js`
shows the moves. Pure helpers under `utils/` still need no fake at all
(`utils/byteCount.js` and `tests/unit/byteCount.test.js`).

Native unit tests live in `android/src/test/java` and in the example app's
`ReactNativeBlobUtilE2ETests` target. The JS, JVM and iOS tests read the same
payload fixtures in `tests/fixtures/native-payloads`, so a payload shape is defined
once for all of them.

Where a runtime test genuinely is not reachable — anything needing a booted
app, a device, or the native layer — say so plainly instead of claiming
coverage you do not have, and describe what you verified statically instead.

CI (`.github/workflows/ci.yml`) runs lint, `npm test`, the Android and iOS unit tests,
the example app builds (iOS with static libraries, static frameworks and dynamic
frameworks), a throwaway app on the newest React Native template, and an Expo prebuild
with the config plugin. The e2e suites stay manual in `e2e-mobile.yml`.

## Linting and style

```sh
npm run lint      # eslint over the package's own JS; must stay free of errors
```

Run it before committing, alongside `npm test`. It currently reports **0
errors and 23 warnings** and exits 0, so a non-zero exit or any error line is
something you introduced.

The warnings are a real backlog, not noise to ignore wholesale — mostly
`import/no-default-export` (16, the default-export modules, a design choice
rather than a slip) and `no-console` (3); the rest is the bit arithmetic in
`utils/uuid.js` and one `quotes`. Do not clear
them with a blanket `eslint --fix`: that rewrites nearly every file at once and
buries whatever you were actually changing. Fix them in the files you are
already touching, or in a deliberate pass of their own. If you do need `--fix`, scope it to one rule:

```sh
npx eslint <paths> --no-eslintrc --parser @babel/eslint-parser --parser-options=sourceType:module --rule '{"semi":["error","always"]}' --fix
```

`.eslintignore` deliberately excludes `codegenSpecs/` (Flow spec syntax the
parser cannot read — RN's codegen validates it instead), the example and e2e
apps, and build output.

Style comes from `@react-native/eslint-config` plus the overrides in
`.eslintrc.json`. Beyond what the linter checks, match the file you are
editing: 4-space indent, single quotes.

## Line endings

`.gitattributes` stores text as LF and checks it out natively, so new work
stays consistent. Existing files were **not** renormalised — that would have
rewritten most of the tree in one commit and conflicted with open PRs — so the
tree still holds a mix, and files convert as they are touched.

Two consequences. Git will warn `LF will be replaced by CRLF` on many commits;
that is the conversion working, not a problem. And a file you barely edited
may show as fully rewritten if your editor also flipped its endings — after
editing, check that `git diff --stat` reports roughly the number of lines you
meant to touch, and redo the edit in place if it does not.

## Commit messages

Conventional commits with a scope, matching the existing history:

```
fix(android): use float division for download progress ratio
fix(types): allow HEAD in the Methods union
test(progress): cover byte-count normalisation across native payload shapes
chore(release): 0.24.11
```

Explain *why* in the body, not just what — the mechanism of the bug, and why
this fix rather than an obvious alternative. Reference the issue or PR it came
from. These messages are the only changelog this project has.

## Native module access

JS reaches native through `utils/nativeModule.js`, never by importing
`codegenSpecs/NativeBlobUtils` directly. `TurboModuleRegistry.get()` is
nullable and the spec evaluates it once, so importing that binding caches a
possibly-null module for the lifetime of the process.

Nothing may touch native at module scope. A `new NativeEventEmitter(...)` or a
`getConstants()` call at import time crashes a New Architecture cold start
before the app can boot.

## Contracts between JS and native

Three rules that hold across the codebase since 1.0; a change that breaks one
reopens a bug that was fixed on purpose.

- **JS decides what a request body is.** `utils/request.js` classifies every body
  as `text`, `base64` or `file` and sends it as `options.bodyType` (multipart:
  a `kind` per field). Native obeys it and must not infer anything from the
  Content-Type or a prefix; the platforms used to guess differently.
- **A `content://` URI is never turned into a file path on Android.**
  `normalizePath` returns null for it; open it through
  `ReactNativeBlobUtilContent` (ContentResolver) or reject `ENOTSUP`. Resolving
  one to a path let a URI shared by another app read or delete this app's private
  files.
- **A call resolves `undefined` unless it returns something the caller does not
  already have**, and every rejection carries a code from the `ErrorCode` union in
  `index.d.ts`. A deprecated alias keeps resolving what it resolved before.

## Three platforms

`android/`, `ios/` and `windows/` all implement the same API, and they do not
always agree. A bug at the JS boundary is often a cross-platform inconsistency
rather than a single-platform defect: progress byte counts arrived as strings
from Android and iOS but as int64 (and `null`) from Windows, so the declared
`number` type was wrong everywhere, differently.

Before fixing native code on the platform you can test, check what the other
two do. Windows is the one that gets forgotten.

## Native code

`android/` is Kotlin. `ios/` is Swift behind a thin Objective-C++ adapter,
`ios/ReactNativeBlobUtil/ReactNativeBlobUtil.mm`. `windows/` is C++/WinRT. Codegen
only generates a Java spec and an Objective-C++ protocol, which is why the Kotlin
module subclasses a Java class and why the iOS adapter exists: it is the only iOS
file that imports React, and each of its methods forwards to
`ReactNativeBlobUtilModuleCore` in Swift.

Some files stay in their old language on purpose:

- `android/.../ReactNativeBlobUtilFileTransformer.java` and
  `ios/ReactNativeBlobUtilFileTransformer.h`, because apps implement them. A Kotlin
  interface would force one nullability on implementers.
- `ios/ReactNativeBlobUtilExceptionCatch.{h,m}` reproduces the NSException a utf8
  read stream raises when a chunk splits a multi-byte character, which Swift cannot
  raise. It also catches exceptions from app-provided file transformers before
  they reach Swift; that boundary must stay even after the stream bug is fixed.

Public Kotlin classes keep their Java shape, with `@JvmStatic` and `@JvmField` on
companion members, because apps call them from Java. The tests in
`android/src/test/java/com/ReactNativeBlobUtil/apicheck/` compile the README's setup
from Java and Kotlin and fail if that shape breaks. Swift classes keep their
Objective-C names and selectors through explicit `@objc(...)`.

Parameters that arrive from JS are nullable, and a null fails where it always did.
The `parity` e2e scenario records every native call's result in
`tests/e2e/appium/parity/<platform>.json`, and a run that differs from the recording
fails. Re-record (`E2E_PARITY_RECORD=1`, optionally limited with
`E2E_PARITY_CASES`) only for an intended change, and say so in the commit.

## Codegen

`codegenSpecs/` is parsed by React Native's codegen; the eager
`TurboModuleRegistry.get<Spec>('ReactNativeBlobUtil')` export must stay exactly
as it is, because that call is how codegen discovers the module.
`tests/unit/codegenSchema.test.js`, part of `npm test`, compares the schema codegen
derives from the spec with `tests/unit/fixtures/codegen-schema.json`, so an
accidental signature change fails. After an intended change, regenerate the
snapshot in the same commit:

```sh
node tests/unit/codegenSchema.test.js --update
```

## Building the Windows module

The module builds from its own solution, but only with two overrides - the
standalone solution does not pull the reference set the example app does:

```sh
MSBuild windows/ReactNativeBlobUtil.sln /t:Restore;Build \
  /p:Configuration=Debug /p:Platform=x64 \
  /p:ReactNativeWindowsDir=<repo>/node_modules/react-native-windows/ \
  /p:RunCodegenWindows=false \
  /p:WindowsAppSDKVerifyTransitiveDependencies=false
```

`RunCodegenWindows=false` skips a CLI invocation that needs the app context;
the generated headers are committed under `codegenSpecs/`. Without the Windows
App SDK override the build stops on unresolved transitive references that only
the app solution supplies. Needs the .NET SDK (for restore) and Windows SDK
10.0.22621, which the project pins.

Deploying the example app for e2e additionally needs Developer Mode and
WinAppDriver - see tests/e2e/README.md.

## Dependencies

Do not add one without a strong reason. The unit tests deliberately use Node's
built-in runner to avoid a test framework, and an unused `glob` dependency was
removed in #480. If a change seems to need a package, say why and let the
maintainer decide.

## Types

`index.d.ts` is the package's one typed surface (the Flow copy, which drifted,
was dropped in 1.0). Every runtime method is declared there and every
declaration exists at runtime. `tests/unit/types.test.js` compiles it under
`--strict` together with `tests/unit/fixtures/types-usage.ts`, a sample that
calls every declared API the way an app would: when you add or change an API,
change the declaration and the sample in the same commit.

## Releases

The maintainer publishes from his own machine; there is no publishing workflow.
The old `npm publish` GitHub Action was removed because its npm token was not
kept current and a run of it failed. To prepare a release:

1. `npm version <x.y.z> --no-git-tag-version` — updates `package.json` and
   `package-lock.json` together.
2. Commit and push `master`.
3. `npm publish`. A prerelease needs a dist-tag or npm refuses it:
   `npm publish --tag next` for `1.0.0-rc.1`.
4. Tag as `1.0.0` — no `v` prefix — and create a GitHub release with an
   empty title and a plain list of what changed.

A release from a support line (`support/0.24`, `support/0.25`) is published from
that branch with `npm publish --tag support-0.24` (or `-0.25`): without a tag it
becomes `latest` and a plain install downgrades everyone. A dist-tag cannot look
like a semver range, so `v0.24` is refused. Publish from the main checkout with
the branch checked out, not from a second worktree.

What ships is the `files` whitelist in `package.json`, not an ignore list, and
`prepublishOnly` runs `tests/unit/package.test.js`, which fails if any packed
file is not one of the package's own. When you add a shipped file, add it to
both. A version number, once published, can never be reused even after an
unpublish or deprecation: 1.0.0 went out from the wrong checkout, carrying local
notes and `.claude/`, and is deprecated.

Fixes sitting unreleased on `master` are worse than no fix: users install from
npm, hit the bug, and file duplicates. A single unreleased Android fix produced
five separate reports of the same crash. Release promptly, and keep an issue
open until the release that fixes it is actually published.
