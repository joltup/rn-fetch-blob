/**
 * What fetch refuses or rewrites before a request reaches native, so that all
 * three platforms behave the same: header injection, multipart header injection,
 * and pinnedHosts compared case-insensitively.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import rn from './harness/react-native.js';

const calls = [];

rn.setNativeModule({
    getConstants: () => ({DocumentDir: '/docs'}),
    fetchBlob(options, taskId, method, url, headers, body, callback) {
        calls.push({options, headers, body});
        callback(null, 'utf8', 'ok', {status: 200});
    },
    fetchBlobForm(options, taskId, method, url, headers, form, callback) {
        calls.push({options, headers, form});
        callback(null, 'utf8', 'ok', {status: 200});
    },
});

const {fetch, config} = await import('../../fetch.js');

async function rejection(promise) {
    try {
        await promise;
    } catch (err) {
        return err;
    }
    assert.fail('expected a rejection');
}

// Windows adds headers without validation, so a CR/LF in a value started a new
// header on the wire there.
test('a header name or value with CR, LF or NUL rejects EINVAL without reaching native', async () => {
    for (const headers of [
        {'X-Test': 'a\r\nX-Injected: 1'},
        {'X-Test': 'a\nb'},
        {'X-Test\r\nX-Injected': '1'},
        {'X-Test': 'a\u0000b'},
    ]) {
        calls.length = 0;
        const err = await rejection(fetch('GET', 'https://example.com', headers));
        assert.equal(err.code, 'EINVAL');
        assert.equal(calls.length, 0);
    }
    assert.equal(rn.listenerCount('ReactNativeBlobUtilState'), 0);
});

// Native reads every header value as a string, so a value of another type -
// an object a caller passed by mistake, a number, an array - could not cross
// the bridge and only crashed there: on Android with a ReadableNativeMap cast
// error, on iOS with no visible error at all. Refused before reaching native.
test('a header value that is not a string rejects EINVAL without reaching native', async () => {
    for (const headers of [
        {'X-Test': {value: 'a'}},
        {'X-Test': ['a', 'b']},
        {'X-Test': 42},
        {'X-Test': true},
    ]) {
        calls.length = 0;
        const err = await rejection(fetch('GET', 'https://example.com', headers));
        assert.equal(err.code, 'EINVAL', String(headers['X-Test']));
        assert.match(err.message, /X-Test/);
        assert.equal(calls.length, 0);
    }
    assert.equal(rn.listenerCount('ReactNativeBlobUtilState'), 0);
});

// Android and iOS paste name and filename into the part's Content-Disposition
// between quotes, so a quote or a line break in a shared file's name rewrote the
// part header. Escaped as browsers do (WHATWG multipart/form-data).
test('multipart names and filenames are escaped the way browsers do', async () => {
    calls.length = 0;
    await fetch('POST', 'https://example.com', {}, [
        {name: 'a"b', data: 'x'},
        {name: 'file', filename: 'evil"\r\nContent-Type: text/html.png', type: 'image/png', data: 'AAAA'},
    ]);
    assert.deepEqual(calls[0].form.map((f) => [f.name, f.filename]), [
        ['a%22b', undefined],
        ['file', 'evil%22%0D%0AContent-Type: text/html.png'],
    ]);
});

test('a multipart type with CR or LF rejects EINVAL', async () => {
    calls.length = 0;
    const err = await rejection(fetch('POST', 'https://example.com', {}, [
        {name: 'f', filename: 'f.txt', type: 'text/plain\r\nX-Injected: 1', data: 'AAAA'},
    ]));
    assert.equal(err.code, 'EINVAL');
    assert.equal(calls.length, 0);
});

// Android's OkHttp and iOS hand native the host in lower case, so a pinned host
// written with capitals never matched and the request fell back to system trust.
test('pinnedHosts are compared lower-case, without changing the caller\'s options', async () => {
    calls.length = 0;
    const options = {customCACerts: ['ca'], pinnedHosts: ['API.Example.com']};
    await config(options).fetch('GET', 'https://api.example.com');
    assert.deepEqual(calls[0].options.pinnedHosts, ['api.example.com']);
    assert.deepEqual(options.pinnedHosts, ['API.Example.com']);
});

// GHSA-5xf6-f6v8-jc8c: appendExt is appended to a file name the library
// generates in its cache. With a separator in it, "/../../shared_prefs/x.xml"
// took the download out of the cache onto any file the app can write.
test('an appendExt with a path separator rejects EINVAL without reaching native', async () => {
    for (const appendExt of ['/../../shared_prefs/auth.xml', 'x\\..\\..\\y', 'C:evil', 'png\n', 42]) {
        calls.length = 0;
        const err = await rejection(config({fileCache: true, appendExt}).fetch('GET', 'https://example.com'));
        assert.equal(err.code, 'EINVAL', String(appendExt));
        assert.equal(calls.length, 0);
    }
    // Extensions, with or without dots, still work.
    for (const appendExt of ['png', 'tar.gz', '.jpg', '']) {
        calls.length = 0;
        await config({fileCache: true, appendExt}).fetch('GET', 'https://example.com');
        assert.equal(calls.length, 1, appendExt);
    }
});
