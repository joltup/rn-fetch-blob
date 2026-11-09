// @flow
// The device's shared media library: Android's MediaStore, the Downloads
// app and the media scanner. Every call rejects with ENOTSUP elsewhere.

import {toUnsignedBytes} from './utils/bytes';
import {warnOnce} from './utils/deprecate';
import {addCode} from './utils/errors';
import {requireNativeModule} from './utils/nativeModule';
import {platformOnly} from './utils/platform';
import type {filedescriptor} from './types';

const androidOnly = (name, fn) => platformOnly('android', `ReactNativeBlobUtil.media.${name}`, fn);

/**
 * The descriptor as native reads it: parentFolder defaults to "", and `mime`,
 * the key the rest of the API uses, stands in for native's `mimeType`.
 */
function withParentFolder(fd: filedescriptor): filedescriptor {
    if (!fd || typeof fd !== 'object') {
        return fd;
    }
    const out = {...fd};
    if (!('parentFolder' in out)) {
        out.parentFolder = '';
    }
    if (out.mimeType === undefined && out.mime !== undefined) {
        out.mimeType = out.mime;
    }
    delete out.mime;
    return out;
}

/**
 * Create an empty entry in a collection.
 * @param  {filedescriptor} fd {name, mimeType, parentFolder?}
 * @param  {'Audio' | 'Image' | 'Video' | 'Download'} collection
 * @return {Promise<string>} The entry's content URI.
 */
const createFile = androidOnly('createFile', (fd: filedescriptor, collection: string) => {
    return requireNativeModule().createMediaFile(withParentFolder(fd), collection);
});

/**
 * Copy a file from the app's storage into an existing entry.
 * @param  {string} uri The entry's content URI.
 * @param  {string} path The file to copy.
 * @param  {{transform?: boolean}} options Run the registered file transformer first.
 * @return {Promise<void>}
 */
const write = androidOnly('write', (uri: string, path: string, options: ?{transform?: boolean} = null) => {
    return requireNativeModule().writeToMediaFile(uri, path, Boolean(options && options.transform)).then(() => undefined);
});

/**
 * Create an entry and copy a file into it in one step.
 * @return {Promise<string>} The entry's content URI.
 */
const copyToMediaStore = androidOnly('copyToMediaStore', (fd: filedescriptor, collection: string, path: string) => {
    return requireNativeModule().copyToMediaStore(withParentFolder(fd), collection, path);
});

/**
 * Copy an entry into the app's own storage, overwriting the destination.
 * @return {Promise<void>}
 */
const copyToInternal = androidOnly('copyToInternal', (uri: string, dest: string) => {
    return requireNativeModule().copyToInternal(uri, dest).then(() => undefined);
});

/**
 * Read an entry: text for utf8, a base64 string, or bytes 0..255 for ascii.
 */
const read = androidOnly('read', (uri: string, encodingOrOptions: any = 'utf8') => {
    const encoding = encodingOrOptions !== null && typeof encodingOrOptions === 'object'
        ? encodingOrOptions.encoding
        : encodingOrOptions;
    const lowered = encoding === undefined || encoding === null ? 'utf8' : String(encoding).toLowerCase();
    // Checked here as fs.readFile does; native read an unknown encoding as utf8.
    if (!['utf8', 'ascii', 'base64'].includes(lowered)) {
        return Promise.reject(addCode('EINVAL', new TypeError(`Unsupported encoding "${encoding}", expected one of utf8, ascii, base64`)));
    }
    const result = requireNativeModule().getBlob(uri, lowered);
    return lowered === 'ascii' ? result.then(toUnsignedBytes) : result;
});

/**
 * The download options as native reads them: `notification`, the key the
 * DownloadManager config uses for the same thing, stands in for native's
 * `showNotification`. The old key still works and warns once.
 */
function withShowNotification(options: Object): Object {
    if (!options || typeof options !== 'object') {
        return options;
    }
    const out = {...options};
    if ('showNotification' in out) {
        warnOnce('media.addDownload.showNotification',
            'ReactNativeBlobUtil.media.addDownload option "showNotification" is deprecated and will be removed; use "notification"');
    }
    if (out.notification !== undefined) {
        out.showNotification = out.notification;
    }
    delete out.notification;
    return out;
}

/**
 * Register a finished download with the Downloads app.
 * @param  {{title, description, mime, path, notification}} options
 * @return {Promise<void>}
 */
const addDownload = androidOnly('addDownload', (options: Object) => {
    return requireNativeModule().addCompleteDownload(withShowNotification(options)).then(() => undefined);
});

/**
 * Ask the media scanner to index files so they show in the gallery and other apps.
 * @param  {Array<{path: string, mime?: string}>} files
 * @return {Promise<void>}
 */
const scan = androidOnly('scan', (files: Array<Object>) => {
    if (files === undefined) {
        return Promise.reject(addCode('EINVAL', new TypeError('Missing argument')));
    }
    return requireNativeModule().scanFile(files).then(() => undefined);
});

export default {
    createFile,
    write,
    copyToMediaStore,
    copyToInternal,
    read,
    addDownload,
    scan,
};
