// @flow
// Copyright 2016 wkh237@github. All rights reserved.
// Use of this source code is governed by a MIT-style license that can be
// found in the LICENSE file.

// import type {ReactNativeBlobUtilConfig, ReactNativeBlobUtilNative, ReactNativeBlobUtilStream} from './types'

import {Platform} from 'react-native';
import ReactNativeBlobUtilReadStream from './class/ReactNativeBlobUtilReadStream';
import ReactNativeBlobUtilSession from './class/ReactNativeBlobUtilSession';
import ReactNativeBlobUtilWriteStream from './class/ReactNativeBlobUtilWriteStream';
import media from './media';
import {toUnsignedBytes} from './utils/bytes';
import {deprecatedAlias} from './utils/deprecate';
import {addCode} from './utils/errors';
import {requireNativeModule} from './utils/nativeModule';
import {platformOnly} from './utils/platform';
import type {ReactNativeBlobUtilStat} from './types';

/**
 * Native constants are read on first access rather than at import. On the New
 * Architecture the module may not be registered when this file is evaluated,
 * and reaching native here would throw while the package is being imported.
 */
let constants = null;

function getConstants() {
    if (constants == null) {
        constants = requireNativeModule().getConstants();
    }

    return constants;
}

const dirs = {};

for (const name of [
    'DocumentDir',
    'CacheDir',
    'PictureDir',
    'MusicDir',
    'MovieDir',
    'DownloadDir',
    'DCIMDir',
    'SDCardDir', // Deprecated
    'SDCardApplicationDir', // Deprecated
    'MainBundleDir',
    'LibraryDir',
    'ApplicationSupportDir',
    'RingtoneDir',

    'LegacyPictureDir',
    'LegacyMusicDir',
    'LegacyMovieDir',
    'LegacyDownloadDir',
    'LegacyDCIMDir',
    'LegacyRingtoneDir',
    'LegacySDCardDir', // Deprecated
]) {
    Object.defineProperty(dirs, name, {
        enumerable: true,
        get: () => getConstants()[name],
    });
}

/** Native reports size and lastModified as strings on some platforms. */
function normalizeStat(entry: Object): ReactNativeBlobUtilStat {
    return {...entry, size: Number(entry.size), lastModified: Number(entry.lastModified)};
}

/**
 * Android reports internal and external storage as four strings; iOS and
 * Windows report {free, total} numbers. Every platform resolves numeric
 * `free` and `total`; Android keeps its four fields as numbers as well.
 */
function normalizeDf(space: Object): Object {
    const numbers = {};
    for (const key of Object.keys(space)) {
        numbers[key] = Number(space[key]);
    }
    if ('internal_free' in numbers && !('free' in numbers)) {
        return {free: numbers.internal_free, total: numbers.internal_total, ...numbers};
    }
    return numbers;
}

/** ascii reads resolve bytes 0..255; Android and iOS return them signed. */
function withUnsignedBytes(encoding: string, promise: Promise<any>): Promise<any> {
    return encoding === 'ascii' ? promise.then(toUnsignedBytes) : promise;
}

const READ_ENCODINGS = ['utf8', 'ascii', 'base64'];
const WRITE_ENCODINGS = ['utf8', 'ascii', 'base64', 'uri'];

/**
 * The encoding native will receive: lower-cased, with null and undefined
 * meaning utf8. An encoding native does not know yields an EINVAL error
 * instead, so the caller rejects here rather than hand it on - iOS readFile
 * never completed for an unknown encoding, and Android silently read utf8.
 */
function normalizeEncoding(encoding: ?string, allowed: Array<string>): string | Error {
    if (encoding === null || encoding === undefined) {
        return 'utf8';
    }
    const lowered = String(encoding).toLowerCase();
    if (allowed.includes(lowered)) {
        return lowered;
    }
    return addCode('EINVAL', new TypeError(`Unsupported encoding "${encoding}", expected one of ${allowed.join(', ')}`));
}

/**
 * The encoding and options of a call that takes either the positional form
 * (encoding, options) or one options object ({encoding, ...rest}).
 */
function encodingAndOptions(encodingOrOptions: any, options: ?Object): [any, Object] {
    if (encodingOrOptions !== null && typeof encodingOrOptions === 'object' && !Array.isArray(encodingOrOptions)) {
        return [encodingOrOptions.encoding, encodingOrOptions];
    }
    return [encodingOrOptions, options || {}];
}

/**
 * Get a file cache session
 * @param  {string} name Stream ID
 * @return {ReactNativeBlobUtilSession}
 */
function session(name: string): ReactNativeBlobUtilSession {
    let s = ReactNativeBlobUtilSession.getSession(name);
    if (s)
        return new ReactNativeBlobUtilSession(name);
    else {
        ReactNativeBlobUtilSession.setSession(name, []);
        return new ReactNativeBlobUtilSession(name, []);
    }
}

function asset(path: string): string {
    if (Platform.OS === 'ios') {
        // path from camera roll
        if (/^assets-library:\/\//.test(path))
            return path;
    }
    return 'bundle-assets://' + path;
}

function createFile(path: string, data: string, encodingOrOptions: any = 'utf8'): Promise<void> {
    if (typeof path !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    let [encoding] = encodingAndOptions(encodingOrOptions, null);
    encoding = normalizeEncoding(encoding, WRITE_ENCODINGS);
    if (encoding instanceof Error) {
        return Promise.reject(encoding);
    }
    // Resolves undefined on every platform: the path is the caller's own. Android
    // resolved it, iOS [null], Windows undefined.
    if (encoding === 'ascii') {
        return Array.isArray(data) ?
            requireNativeModule().createFileASCII(path, data).then(() => undefined) :
            Promise.reject(addCode('EINVAL', new TypeError('`data` of ASCII file must be an array with 0..255 numbers')));
    }
    else {
        return requireNativeModule().createFile(path, data, encoding).then(() => undefined);
    }
}

/**
 * Create write stream to a file.
 * @param  {string} path Target path of file stream.
 * @param  {string | {encoding?: string, append?: boolean}} encodingOrOptions Encoding of input data, or the options.
 * @param  {boolean} [append]  A flag represent if data append to existing ones.
 * @return {Promise<ReactNativeBlobUtilWriteStream>} A promise resolves a `WriteStream` object.
 */
function writeStream(
    path: string,
    encodingOrOptions?: any = 'utf8',
    append?: boolean = false,
): Promise<ReactNativeBlobUtilWriteStream> {
    if (typeof path !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    let [encoding, options] = encodingAndOptions(encodingOrOptions, {append});
    append = Boolean(options.append);
    encoding = normalizeEncoding(encoding, READ_ENCODINGS);
    if (encoding instanceof Error) {
        return Promise.reject(encoding);
    }
    return requireNativeModule().writeStream(path, encoding, append)
        .then((streamId: string) => new ReactNativeBlobUtilWriteStream(streamId, encoding, append));
}

/**
 * Create file stream from file at `path`.
 * @param  {string} path   The file path.
 * @param  {string | {encoding?: string, bufferSize?: number, tick?: number}} encodingOrOptions
 *         Data encoding (`base64`, `utf8`, `ascii`), or the options.
 * @param  {number} [bufferSize=12288] Size of stream buffer, in bytes. Use a multiple of 3 for base64.
 * @param  {number} [tick=10] Interval in milliseconds between reading chunks of data
 * @return {ReactNativeBlobUtilStream} ReactNativeBlobUtilStream stream instance.
 */
function readStream(
    path: string,
    encodingOrOptions: any = 'utf8',
    bufferSize?: number,
    tick?: number = 10
): Promise<ReactNativeBlobUtilReadStream> {
    // An empty path made the stream's constructor throw instead of rejecting.
    if (typeof path !== 'string' || path === '') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    let [encoding, options] = encodingAndOptions(encodingOrOptions, {bufferSize, tick});
    bufferSize = options.bufferSize;
    tick = options.tick === undefined || options.tick === null ? 10 : options.tick;
    encoding = normalizeEncoding(encoding, READ_ENCODINGS);
    if (encoding instanceof Error) {
        return Promise.reject(encoding);
    }
    return Promise.resolve(new ReactNativeBlobUtilReadStream(path, encoding, bufferSize, tick));
}

/**
 * Create a directory.
 * @param  {string} path Path of directory to be created
 * @return {Promise}
 */
function mkdir(path: string): Promise<void> {
    if (typeof path !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    return requireNativeModule().mkdir(path).then(() => undefined);
}

/**
 * Read a file.
 * @param  {string} path Path of the file.
 * @param  {'base64' | 'utf8' | 'ascii' | {encoding?: string, transform?: boolean}} encodingOrOptions
 *         Encoding of the result, or the options.
 * @param  {{transform?: boolean}} options Run the registered file transformer on the data.
 * @return {Promise<Array<number> | string>}
 */
function readFile(path: string, encodingOrOptions: any = 'utf8', options: ?{transform?: boolean} = null): Promise<any> {
    if (typeof path !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    let [encoding, opts] = encodingAndOptions(encodingOrOptions, options);
    encoding = normalizeEncoding(encoding, READ_ENCODINGS);
    if (encoding instanceof Error) {
        return Promise.reject(encoding);
    }
    return withUnsignedBytes(encoding, requireNativeModule().readFile(path, encoding, Boolean(opts.transform)));
}

/**
 * Write data to a file, replacing it.
 * @param  {string} path  Path of the file.
 * @param  {string | number[]} data Data to write to the file.
 * @param  {string | {encoding?: string, transform?: boolean}} encodingOrOptions Encoding of data, or the options.
 * @param  {{transform?: boolean}} options Run the registered file transformer on the data first (not for ascii).
 * @return {Promise<number>} The number of bytes written.
 */
function writeFile(path: string, data: string | Array<number>, encodingOrOptions: any = 'utf8', options: ?{transform?: boolean} = null): Promise<number> {
    if (typeof path !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    let [encoding, opts] = encodingAndOptions(encodingOrOptions, options);
    encoding = normalizeEncoding(encoding, WRITE_ENCODINGS);
    if (encoding instanceof Error) {
        return Promise.reject(encoding);
    }
    const transform = Boolean(opts.transform);
    if (encoding === 'ascii') {
        if (transform) {
            return Promise.reject(addCode('EINVAL', new TypeError('ascii is not supported for converted files')));
        }
        if (!Array.isArray(data)) {
            return Promise.reject(addCode('EINVAL', new TypeError('"data" must be an Array when encoding is "ascii"')));
        }
        else
            return requireNativeModule().writeFileArray(path, data, false);
    }
    else {
        if (typeof data !== 'string') {
            return Promise.reject(addCode('EINVAL', new TypeError(`"data" must be a String when encoding is "utf8" or "base64", but it is "${typeof data}"`)));
        }
        else
            return requireNativeModule().writeFile(path, encoding, data, transform, false);
    }
}

function appendFile(path: string, data: string | Array<number>, encodingOrOptions?: any = 'utf8'): Promise<number> {
    if (typeof path !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    let [encoding] = encodingAndOptions(encodingOrOptions, null);
    encoding = normalizeEncoding(encoding, WRITE_ENCODINGS);
    if (encoding instanceof Error) {
        return Promise.reject(encoding);
    }
    if (encoding === 'ascii') {
        if (!Array.isArray(data)) {
            return Promise.reject(addCode('EINVAL', new TypeError('`data` of ASCII file must be an array with 0..255 numbers')));
        }
        else
            return requireNativeModule().writeFileArray(path, data, true);
    }
    else {
        if (typeof data !== 'string') {
            return Promise.reject(addCode('EINVAL', new TypeError(`"data" must be a String when encoding is "utf8" or "base64", but it is "${typeof data}"`)));
        }
        else
            return requireNativeModule().writeFile(path, encoding, data, false, true);
    }
}

/**
 * Exclude a file or directory from iCloud and iTunes backups (iOS).
 * @param  {string} path Path of the file or directory.
 * @return {Promise<void>}
 */
const excludeFromBackup = platformOnly('ios', 'ReactNativeBlobUtil.fs.excludeFromBackup', (path: string) => {
    if (typeof path !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    return requireNativeModule().excludeFromBackupKey('file://' + path).then(() => undefined);
});

/**
 * The directory shared by the apps of an app group (iOS).
 * @param  {string} groupName
 * @return {Promise<string>}
 */
const appGroupDir = platformOnly('ios', 'ReactNativeBlobUtil.fs.appGroupDir', (groupName: string) => {
    return requireNativeModule().pathForAppGroup(groupName);
});

/**
 * The directory shared by the apps of an app group, synchronously (iOS); '' elsewhere.
 * @param  {string} groupName
 * @return {string}
 */
function appGroupDirSync(groupName: string): string {
    return Platform.OS === 'ios' ? requireNativeModule().syncPathAppGroup(groupName) : '';
}

/**
 * Show statistic data of a path.
 * @param  {string} path Target path
 * @return {Promise<ReactNativeBlobUtilStat>}
 */
function stat(path: string): Promise<ReactNativeBlobUtilStat> {
    if (typeof path !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    return requireNativeModule().stat(path).then((entry) => entry ? normalizeStat(entry) : entry);
}

/**
 * Calculate a cryptographic hash sum over the contents of a file.
 *
 * `sha224` is unavailable on Windows - neither WinRT's hash providers nor CNG
 * offer SHA-224 - so the promise rejects there. Android and iOS support all of
 * md5, sha1, sha224, sha256, sha384 and sha512.
 *
 * @param  {string} path Path of the file.
 * @param  {string} algorithm md5, sha1, sha224, sha256, sha384 or sha512.
 * @return {Promise<string>} The hash, hex encoded.
 */
function hash(path: string, algorithm: string): Promise<string> {
    if (typeof path !== 'string' || typeof algorithm !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" and/or "algorithm"')));
    }
    return requireNativeModule().hash(path, algorithm);
}

// cp and mv resolve undefined: the destination is the caller's own. They
// resolved a constant true (iOS, Windows) or undefined (Android).
function cp(path: string, dest: string): Promise<void> {
    if (typeof path !== 'string' || typeof dest !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" and/or "destination"')));
    }
    return requireNativeModule().cp(path, dest).then(() => undefined);
}

function mv(path: string, dest: string): Promise<void> {
    if (typeof path !== 'string' || typeof dest !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" and/or "destination"')));
    }
    return requireNativeModule().mv(path, dest).then(() => undefined);
}

/**
 * The entries of a directory: their names, or with {stats: true} a stat of
 * each (what lstat returned; lstat means something else in Node).
 */
function ls(path: string, options: ?{stats?: boolean} = null): Promise<any> {
    if (typeof path !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    if (options && options.stats) {
        return requireNativeModule().lstat(path)
            .then((entries) => Array.isArray(entries) ? entries.map(normalizeStat) : entries);
    }
    return requireNativeModule().ls(path);
}

/** The external storage root (Android). */
const sdCardDir = platformOnly('android', 'ReactNativeBlobUtil.fs.sdCardDir', () => requireNativeModule().getSDCardDir());

/** The app's directory on external storage (Android). */
const sdCardApplicationDir = platformOnly('android', 'ReactNativeBlobUtil.fs.sdCardApplicationDir',
    () => requireNativeModule().getSDCardApplicationDir());

/**
 * Remove file at path.
 * @param  {string}   path:string Path of target file.
 * @return {Promise}
 */
function unlink(path: string): Promise<void> {
    if (typeof path !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    return requireNativeModule().unlink(path).then(() => undefined);
}

/**
 * Check if file exists and if it is a folder.
 * @param  {string} path Path to check
 * @return {Promise<boolean>}
 */
function exists(path: string): Promise<boolean> {
    if (typeof path !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    return requireNativeModule().exists(path).then((result) => Boolean(result && result.exists));
}

function slice(src: string, dest: string, start: number, end: number): Promise<void> {
    if (typeof src !== 'string' || typeof dest !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "src" and/or "destination"')));
    }

    let p = Promise.resolve();
    let size = 0;

    function normalize(num, length) {
        if (num < 0)
            return Math.max(0, length + num);
        if (!num && num !== 0)
            return length;
        return num;
    }

    if (start < 0 || end < 0 || !start || !end) {
        p = p.then(() => stat(src))
            .then((info) => {
                size = Math.floor(info.size);
                start = normalize(start || 0, size);
                end = normalize(end, size);
            });
    }
    // undefined: the destination is the caller's own.
    return p.then(() => requireNativeModule().slice(src, dest, start, end)).then(() => undefined);
}

function isDir(path: string): Promise<boolean> {
    if (typeof path !== 'string') {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument "path" ')));
    }
    return requireNativeModule().exists(path).then((result) => Boolean(result && result.isDirectory));
}

function df(): Promise<{ free: number, total: number }> {
    return requireNativeModule().df().then((space) => space ? normalizeDf(space) : space);
}

export default {
    ReactNativeBlobUtilSession,
    unlink,
    mkdir,
    session,
    ls,
    readStream,
    mv,
    cp,
    writeStream,
    writeFile,
    appendFile,
    readFile,
    excludeFromBackup,
    appGroupDir,
    appGroupDirSync,
    hash,
    exists,
    createFile,
    isDir,
    stat,
    dirs,
    sdCardDir,
    sdCardApplicationDir,
    slice,
    asset,
    df,
    // Names from before 1.0; each warns once.
    readFileWithTransform: deprecatedAlias('fs.readFileWithTransform', 'fs.readFile(path, encoding, {transform: true})',
        (path: string, encoding: string = 'utf8') => readFile(path, encoding, {transform: true})),
    writeFileWithTransform: deprecatedAlias('fs.writeFileWithTransform', 'fs.writeFile(path, data, encoding, {transform: true})',
        (path: string, data: any, encoding: ?string = 'utf8') => writeFile(path, data, encoding, {transform: true})),
    scanFile: deprecatedAlias('fs.scanFile', 'media.scan', media.scan),
    lstat: deprecatedAlias('fs.lstat', 'fs.ls(path, {stats: true})', (path: string) => ls(path, {stats: true})),
    pathForAppGroup: deprecatedAlias('fs.pathForAppGroup', 'fs.appGroupDir', appGroupDir),
    syncPathAppGroup: deprecatedAlias('fs.syncPathAppGroup', 'fs.appGroupDirSync', appGroupDirSync),
};
