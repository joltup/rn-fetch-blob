/**
 * Package.swift, the Swift Package Manager manifest React Native >= 0.87 uses to
 * autolink this module. CocoaPods globs its sources; the manifest enumerates
 * them, so the two drift in one direction: a new Swift file joins the pod build
 * automatically and is silently missing from the SwiftPM one. These tests tie
 * the manifest to the tree on disk so that drift fails here instead of in a
 * consumer's Xcode build.
 *
 * The React-free rule is the other half. SwiftPM cannot compile Swift and
 * C-family sources in one target, so the module is three: a React-free
 * Objective-C leaf, the Swift core, and the adapter that owns React. The leaf's
 * publicHeadersPath turns its directory into a module umbrella, and a React
 * import anywhere in it breaks that module with "'RCTBridgeModule.h' file not
 * found" - which is how this layout was arrived at. The podspec relies on the
 * same rule for public_header_files.
 *
 * Parsed as text rather than via `swift package dump-package`: these tests run
 * on every platform the module supports, and only macOS has a Swift toolchain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = fs.readFileSync(path.join(root, 'Package.swift'), 'utf8');

/** The `path:` of a named target. */
function targetChunk(name) {
    // Drop everything before the first .target(: it holds the package name, the
    // product, and the .package(path:) dependencies, any of which would match.
    const [, ...targets] = manifest.split('.target(');
    return targets.find((chunk) => chunk.trimStart().startsWith(`\n            name: "${name}",`)
        || new RegExp(`^\\s*name: "${name}",`).test(chunk));
}

function targetPath(name) {
    const target = targetChunk(name);
    assert.ok(target, `Package.swift declares no target named ${name}`);
    const match = target.match(/path:\s*"([^"]+)"/);
    assert.ok(match, `target ${name} declares no path`);
    return match[1];
}

/** The `sources:` list of a named target, or null when it declares none. */
function targetSources(name) {
    const target = targetChunk(name);
    assert.ok(target, `Package.swift declares no target named ${name}`);
    const match = target.match(/sources:\s*\[([^\]]*)\]/);
    if (!match) {
        return null;
    }
    return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function filesIn(dir, extensions) {
    return fs
        .readdirSync(path.join(root, dir), {withFileTypes: true})
        .filter((entry) => entry.isFile() && extensions.includes(path.extname(entry.name)))
        .map((entry) => entry.name)
        .sort();
}

const LEAF = 'ReactNativeBlobUtilObjC';
const CORE = 'ReactNativeBlobUtilCore';
const ADAPTER = 'ReactNativeBlobUtil';

test('the product is the name React Native autolinks this module under', () => {
    // generate-spm-autolinking.js references libs/<SwiftName> and depends on a
    // product of the same name; anything else resolves to nothing.
    assert.match(manifest, /\.library\(\s*\n?\s*name: "ReactNativeBlobUtil"/);
});

test('package.json gives React Native the product name the manifest declares', () => {
    // Without swiftpmConfig.name, React Native 0.88 names the product after the
    // podspec, which is the npm name react-native-blob-util, and resolving the
    // app's packages fails: "product 'react-native-blob-util' ... not found" (#507).
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const product = manifest.match(/\.library\(\s*name: "([^"]+)"/);
    assert.ok(product, 'Package.swift declares no library product');
    assert.equal(pkg.swiftpmConfig?.name, product[1]);
});

test('every source the manifest lists exists on disk', () => {
    for (const name of [LEAF, CORE, ADAPTER]) {
        const dir = targetPath(name);
        for (const source of targetSources(name) ?? []) {
            const full = path.join(root, dir, source);
            assert.ok(fs.existsSync(full), `${name} lists ${dir}/${source}, which does not exist`);
        }
    }
});

test('the Swift target lists every Swift file in its directory', () => {
    // The drift that matters: add a .swift file, forget the manifest, and
    // SwiftPM consumers link a module with a missing symbol.
    const dir = targetPath(CORE);
    const onDisk = filesIn(dir, ['.swift']);
    const listed = [...(targetSources(CORE) ?? [])].sort();
    assert.deepEqual(listed, onDisk,
        `Package.swift's ${CORE} sources and the .swift files in ${dir}/ disagree`);
});

test('no target mixes Swift and C-family sources', () => {
    // SwiftPM rejects it outright, and React Native's autolinker refuses to
    // scaffold a library whose sources look mixed.
    for (const name of [LEAF, ADAPTER]) {
        const dir = targetPath(name);
        assert.deepEqual(filesIn(dir, ['.swift']), [],
            `${dir}/ holds Swift sources, but ${name} is a C-family target`);
    }
    const coreDir = targetPath(CORE);
    const cFamily = (targetSources(CORE) ?? []).filter((s) => /\.(m|mm|c|cc|cpp)$/.test(s));
    assert.deepEqual(cFamily, [], `${coreDir} lists C-family sources in the Swift target`);
});

test('the Objective-C leaf imports no React header', () => {
    // publicHeadersPath makes this directory a module umbrella. A React import
    // in any of it - directly, or via a header it imports - stops the leaf
    // module building, which stops the Swift core importing it. The podspec
    // publishes the same directory as public_header_files for the same reason.
    const dir = targetPath(LEAF);
    for (const name of filesIn(dir, ['.h', '.m', '.mm'])) {
        const body = fs.readFileSync(path.join(root, dir, name), 'utf8');
        const offending = body
            .split('\n')
            .filter((line) =>
                /^\s*#(import|include)\s*[<"](React\/|react\/|ReactCommon\/|RCT|ReactNativeBlobUtilSpec\/)/
                    .test(line));
        assert.deepEqual(offending, [],
            `${dir}/${name} imports React; it belongs in the adapter target instead`);
    }
});

test('the adapter reaches the Swift core through the protocol, not its generated header', () => {
    // A C-family SwiftPM target cannot see a sibling Swift target's -Swift.h:
    // Xcode writes it into DerivedData and a manifest cannot put that on the
    // include path (SwiftPM rejects $(...) build settings in flags). The
    // protocol in the leaf is what replaces it.
    const adapter = fs.readFileSync(
        path.join(root, 'ios/ReactNativeBlobUtil/ReactNativeBlobUtil.mm'), 'utf8');
    const swiftHeaderImports = adapter
        .split('\n')
        .filter((line) => /^\s*#import\s*[<"].*-Swift\.h[>"]/.test(line));
    assert.deepEqual(swiftHeaderImports, [],
        'the adapter imports a generated Swift header, which does not resolve under SwiftPM');
    assert.match(adapter, /ReactNativeBlobUtilModuleCoreBridge\.h/);
});

test('the Swift core declares conformance, so a drifting signature is a compile error', () => {
    // Without the conformance the protocol is a hand-maintained copy of the
    // Swift API and a renamed method becomes a runtime crash in the adapter.
    const core = fs.readFileSync(path.join(root, 'ios/ReactNativeBlobUtilModuleCore.swift'), 'utf8');
    assert.match(core, /ReactNativeBlobUtilModuleCoreBridge/);
});

test('the Swift language mode matches the version the podspec pins', () => {
    // swift-tools-version 6.0 would otherwise put the core in Swift 6 language
    // mode, where its shared mutable statics are errors - so the pod build would
    // pass and the SwiftPM build would not.
    const podspec = fs.readFileSync(path.join(root, 'react-native-blob-util.podspec'), 'utf8');
    const pinned = podspec.match(/swift_version\s*=\s*'(\d+)\.\d+'/);
    assert.ok(pinned, 'the podspec no longer pins swift_version');
    assert.match(manifest, new RegExp(`\\.swiftLanguageMode\\(\\.v${pinned[1]}\\)`));
});
