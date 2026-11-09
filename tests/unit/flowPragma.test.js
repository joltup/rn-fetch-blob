/**
 * Every shipped JavaScript file that uses Flow syntax says so with an @flow
 * pragma. Transformers that do not assume every file may be Flow decide by that
 * pragma: babel-plugin-syntax-hermes-parser with parseLangTypes 'flow' parses a
 * file as Flow only when /@flow/ matches it, and hands any other file to a
 * parser that fails on a type annotation (#503).
 *
 * A file counts as Flow when Babel cannot parse it without the Flow plugin.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const babel = createRequire(import.meta.url)('@babel/core');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/** The .js files the `files` whitelist ships, native directories aside. */
function shippedScripts() {
    const found = [];
    const walk = (rel) => {
        const full = path.join(root, rel);
        if (fs.statSync(full).isDirectory()) {
            for (const entry of fs.readdirSync(full)) {
                walk(path.posix.join(rel, entry));
            }
        } else if (rel.endsWith('.js')) {
            found.push(rel);
        }
    };
    for (const entry of pkg.files) {
        const rel = entry.replace(/\/$/, '');
        if (!/^(android|ios|windows)(\/|$)/.test(rel) && fs.existsSync(path.join(root, rel))) {
            walk(rel);
        }
    }
    return found.sort();
}

function parsesWithoutFlow(source) {
    try {
        babel.parseSync(source, {babelrc: false, configFile: false, sourceType: 'module'});
        return true;
    } catch {
        return false;
    }
}

test('the walk finds the package sources', () => {
    const files = shippedScripts();
    for (const expected of ['index.js', 'fetch.js', 'utils/request.js', 'class/ReactNativeBlobUtilSession.js']) {
        assert.ok(files.includes(expected), `${expected} not found among ${files.length} files`);
    }
});

test('a shipped file with Flow syntax carries an @flow pragma', () => {
    const missing = shippedScripts().filter((rel) => {
        const source = fs.readFileSync(path.join(root, rel), 'utf8');
        return !parsesWithoutFlow(source) && !/@flow/.test(source);
    });
    assert.deepEqual(missing, []);
});

// The pragma has a consequence: @react-native/babel-preset, which apps build
// with, now parses those files with hermes-parser instead of Babel. Syntax only
// Babel accepts would break every app's build, so each file must parse there.
test('every file marked @flow parses with hermes-parser, as an app build does', () => {
    const hermes = createRequire(import.meta.url)('hermes-parser');
    const failed = [];
    for (const rel of shippedScripts()) {
        const source = fs.readFileSync(path.join(root, rel), 'utf8');
        if (/@flow/.test(source)) {
            try {
                hermes.parse(source, {babel: true, flow: 'all', sourceType: 'module'});
            } catch (e) {
                failed.push(`${rel}: ${e.message.split('\n')[0]}`);
            }
        }
    }
    assert.deepEqual(failed, []);
});
