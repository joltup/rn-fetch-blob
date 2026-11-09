/**
 * Request bodies: JS decides what a body is (text, base64 or a file) and tells
 * native, which no longer guesses from the Content-Type or a prefix. A plain
 * string keeps the documented rule; the explicit forms are never guessed.
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

const {fetch} = await import('../../fetch.js');

async function sent(method, headers, body) {
    calls.length = 0;
    await fetch(method, 'https://example.com', headers, body);
    return calls[0];
}

async function rejection(promise) {
    try {
        await promise;
    } catch (err) {
        return err;
    }
    assert.fail('expected a rejection');
}

test('a plain string keeps the documented rule', async () => {
    let call = await sent('POST', {'Content-Type': 'text/plain'}, 'hello');
    assert.deepEqual([call.options.bodyType, call.body], ['text', 'hello']);

    call = await sent('POST', {'Content-Type': 'application/octet-stream'}, 'AAEC');
    assert.deepEqual([call.options.bodyType, call.body], ['base64', 'AAEC']);

    call = await sent('POST', {'Content-Type': 'image/png;BASE64'}, 'AAEC');
    assert.deepEqual([call.options.bodyType, call.body, call.headers['Content-Type']], ['base64', 'AAEC', 'image/png']);

    call = await sent('POST', {}, 'ReactNativeBlobUtil-file:///docs/a.txt');
    assert.deepEqual([call.options.bodyType, call.body], ['file', 'ReactNativeBlobUtil-file:///docs/a.txt']);

    call = await sent('POST', {}, 'ReactNativeBlobUtil-content://content://media/1');
    assert.equal(call.options.bodyType, 'file');
});

// Without a Content-Type, iOS used to send a string as octet-stream and
// base64-decode it, while Android sent it as text.
test('a string without a Content-Type is text on every platform', async () => {
    const call = await sent('POST', {}, 'plain body');
    assert.deepEqual([call.options.bodyType, call.body], ['text', 'plain body']);
});

test('the explicit forms are never guessed', async () => {
    let call = await sent('POST', {'Content-Type': 'application/octet-stream'}, {text: 'ReactNativeBlobUtil-file:///etc/hosts'});
    assert.deepEqual([call.options.bodyType, call.body], ['text', 'ReactNativeBlobUtil-file:///etc/hosts']);

    call = await sent('POST', {'Content-Type': 'text/plain'}, {base64: 'AAEC'});
    assert.deepEqual([call.options.bodyType, call.body], ['base64', 'AAEC']);

    call = await sent('PUT', {}, {file: '/docs/a.txt'});
    assert.deepEqual([call.options.bodyType, call.body], ['file', 'ReactNativeBlobUtil-file:///docs/a.txt']);

    call = await sent('PUT', {}, {file: 'content://media/1'});
    assert.deepEqual([call.options.bodyType, call.body], ['file', 'ReactNativeBlobUtil-content://content://media/1']);
});

test('bytes are sent as base64', async () => {
    let call = await sent('POST', {}, new Uint8Array([0, 1, 2, 255]));
    assert.deepEqual([call.options.bodyType, call.body], ['base64', 'AAEC/w==']);

    call = await sent('POST', {}, new Uint8Array([9, 0, 1, 2, 255]).subarray(1));
    assert.equal(call.body, 'AAEC/w==');

    call = await sent('POST', {}, new Uint8Array([0, 1, 2, 255]).buffer);
    assert.equal(call.body, 'AAEC/w==');
});

test('a body on GET or HEAD rejects EINVAL, an unknown body type too', async () => {
    for (const method of ['GET', 'get', 'HEAD']) {
        calls.length = 0;
        assert.equal((await rejection(fetch(method, 'https://example.com', {}, 'x'))).code, 'EINVAL');
        assert.equal(calls.length, 0);
    }
    assert.equal((await rejection(fetch('POST', 'https://example.com', {}, {nope: 1}))).code, 'EINVAL');
    assert.equal((await rejection(fetch('POST', 'https://example.com', {}, 42))).code, 'EINVAL');
    // No body, or an empty one, is fine on GET.
    assert.equal((await sent('GET', {}, undefined)).options.bodyType, undefined);
    assert.equal((await sent('GET', {}, '')).options.bodyType, undefined);
});

test('multipart fields carry their kind', async () => {
    const call = await sent('POST', {'Content-Type': 'multipart/form-data'}, [
        {name: 'text', data: 'plain'},
        {name: 'prefixedText', data: 'ReactNativeBlobUtil-file:///docs/a.txt'},
        {name: 'b64', filename: 'b.bin', data: 'AAEC'},
        {name: 'file', filename: 'a.txt', data: 'ReactNativeBlobUtil-file:///docs/a.txt'},
        {name: 'content', filename: 'c.txt', data: 'ReactNativeBlobUtil-content://content://media/1'},
        {name: 'explicitText', filename: 'x.txt', data: {text: 'AAEC'}},
        {name: 'explicitBase64', data: {base64: 'AAEC'}},
        {name: 'explicitFile', data: {file: '/docs/dir/report.pdf'}},
    ]);
    assert.deepEqual(call.form.map((f) => [f.name, f.kind, f.data, f.filename]), [
        ['text', 'text', 'plain', undefined],
        ['prefixedText', 'text', 'ReactNativeBlobUtil-file:///docs/a.txt', undefined],
        ['b64', 'base64', 'AAEC', 'b.bin'],
        ['file', 'file', 'ReactNativeBlobUtil-file:///docs/a.txt', 'a.txt'],
        ['content', 'file', 'ReactNativeBlobUtil-content://content://media/1', 'c.txt'],
        ['explicitText', 'text', 'AAEC', 'x.txt'],
        ['explicitBase64', 'base64', 'AAEC', undefined],
        // A file part gets the file's name when none is given, as browsers do.
        ['explicitFile', 'file', 'ReactNativeBlobUtil-file:///docs/dir/report.pdf', 'report.pdf'],
    ]);
});

// Without a Content-Type, iOS's URLSession adds application/x-www-form-urlencoded
// on its own, Android sent none, and Windows added text/plain. JS now supplies
// one, as fetch does for a string body, so all three send the same header.
test('a body without a Content-Type gets one: text/plain for text, octet-stream otherwise', async () => {
    let call = await sent('POST', {}, 'plain');
    assert.equal(call.headers['Content-Type'], 'text/plain;charset=UTF-8');
    call = await sent('POST', {'X-Other': '1'}, {base64: 'AAEC'});
    assert.equal(call.headers['Content-Type'], 'application/octet-stream');
    call = await sent('POST', undefined, {file: '/docs/a.txt'});
    assert.equal(call.headers['Content-Type'], 'application/octet-stream');
    // A Content-Type the caller gave, in any case, is kept.
    call = await sent('POST', {'content-type': 'application/json'}, '{}');
    assert.deepEqual(call.headers, {'content-type': 'application/json'});
    // No body, no header.
    call = await sent('GET', {}, undefined);
    assert.deepEqual(call.headers, {});
});

// Pickers and camera libraries hand out file:// URLs, and wrap() put one behind
// the file prefix as it was. Native read the rest as a path: iOS's multipart
// builder looked for a file named "file:///..." and failed the request, Windows
// sent an empty part, and Android kept %20 in the name (#411, #256).
test('a file given as a file:// URL is sent as its decoded path', async () => {
    const url = 'file:///docs/my%20scan%20%232.pdf';
    const path = '/docs/my scan #2.pdf';

    const form = await sent('POST', {}, [
        {name: 'wrapped', filename: 'scan.pdf', data: `ReactNativeBlobUtil-file://${url}`},
        {name: 'explicit', data: {file: url}},
        {name: 'host', filename: 'h.pdf', data: 'ReactNativeBlobUtil-file://file://localhost/docs/h.pdf'},
    ]);
    assert.deepEqual(form.form.map((f) => [f.name, f.kind, f.data, f.filename]), [
        ['wrapped', 'file', `ReactNativeBlobUtil-file://${path}`, 'scan.pdf'],
        ['explicit', 'file', `ReactNativeBlobUtil-file://${path}`, 'my scan #2.pdf'],
        ['host', 'file', 'ReactNativeBlobUtil-file:///docs/h.pdf', 'h.pdf'],
    ]);

    for (const body of [`ReactNativeBlobUtil-file://${url}`, {file: url}]) {
        const single = await sent('POST', {}, body);
        assert.equal(single.body, `ReactNativeBlobUtil-file://${path}`);
        assert.equal(single.options.bodyType, 'file');
    }

    // A plain path is left alone, a % in it included, and so is a malformed escape.
    const plain = await sent('POST', {}, {file: '/docs/100%.txt'});
    assert.equal(plain.body, 'ReactNativeBlobUtil-file:///docs/100%.txt');
    const malformed = await sent('POST', {}, {file: 'file:///docs/100%.txt'});
    assert.equal(malformed.body, 'ReactNativeBlobUtil-file:///docs/100%.txt');
});
