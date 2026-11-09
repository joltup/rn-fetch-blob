# Contributing

Bug reports, fixes and features are welcome. For anything larger than a small fix,
open an issue first so the approach is agreed before you spend time on it.

## Layout

| Path | What lives there |
|---|---|
| `index.js`, `fs.js`, `class/`, `utils/` | The JavaScript API |
| `codegenSpecs/` | The TurboModule spec React Native's codegen reads |
| `android/` | Android native module, in Kotlin |
| `ios/` | iOS native module, in Swift, behind a thin Objective-C++ adapter that conforms to the generated spec |
| `windows/` | Windows native module, in C++/WinRT |
| `plugin/` | The Expo config plugin (`withCustomCACerts`) |
| `examples/ReactNativeBlobUtil/` | The example app the native unit tests and e2e tests run in |
| `tests/` | JS unit tests, shared fixtures, e2e scenarios and the test server |

The library supports the New Architecture only.

The repository uses npm: install with `npm install` (CI runs `npm ci`), and
`package-lock.json` is the only lockfile. Please don't commit a `yarn.lock` or
`pnpm-lock.yaml`.

## Before you open a pull request

1. Run the JavaScript checks:

   ```sh
   npm run lint
   npm test          # needs Node 22 or newer
   ```

2. Run the native unit tests for the platform you changed:

   ```sh
   npm run test:android   # JVM tests through the example app's Gradle
   npm run test:ios       # XCTest target in the example app (macOS, after pod install)
   ```

3. For native changes, run the e2e suite on that platform (see
   [tests/e2e/README.md](tests/e2e/README.md)). The `parity` scenario compares the
   result of every native call with a recorded file. If you changed behaviour on
   purpose, re-record it with `E2E_PARITY_RECORD=1` and explain the change in the pull
   request.

4. Add a test with every fix and feature. A fix should come with a test that fails
   without it.

## The platforms disagree

`android/`, `ios/` and `windows/` implement the same API, and they don't always
behave the same. Before fixing native code on one platform, check what the other two do.

## Commit messages

Conventional commits with a scope, for example `fix(android): ...` or
`test(ios): ...`. Explain why in the body; these messages are the changelog.

[AGENTS.md](AGENTS.md) has more detail on building, line endings, codegen and releases.
