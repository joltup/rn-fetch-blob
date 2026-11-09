// @flow
// Opening files in other apps and picking files: one namespace, whatever the
// platform does underneath. A call a platform cannot make rejects with ENOTSUP.

import {Platform} from 'react-native';
import {addCode} from './utils/errors';
import {requireNativeModule} from './utils/nativeModule';
import {notSupported} from './utils/platform';

type OpenOptions = {mime?: string, scheme?: string, title?: string};

function checkPath(path: string): ?Error {
    return typeof path === 'string' ? null : addCode('EINVAL', new TypeError('Missing argument "path" '));
}

// iOS takes a file URL. A path that already is one was prefixed a second time.
function fileUrl(path: string): string {
    return path.startsWith('file://') ? path : 'file://' + path;
}

/**
 * Open a file in another app: Android shows the default app for its MIME type
 * (an ACTION_VIEW intent), iOS shows a full-screen preview
 * (UIDocumentInteractionController.presentPreview).
 * @param  {string} path Path of the file, without a scheme.
 * @param  {{mime?: string, scheme?: string}} options `mime` is used on Android, `scheme` on iOS.
 * @return {Promise<void>}
 */
function file(path: string, options: OpenOptions = {}): Promise<void> {
    const invalid = checkPath(path);
    if (invalid) return Promise.reject(invalid);
    switch (Platform.OS) {
        case 'android':
            return requireNativeModule().actionViewIntent(path, options.mime || '', null).then(() => undefined);
        case 'ios':
            return requireNativeModule().presentPreview(fileUrl(path), options.scheme).then(() => undefined);
        default:
            return Promise.reject(notSupported('android or iOS', 'ReactNativeBlobUtil.open.file'));
    }
}

/**
 * Let the user choose the app that opens the file: an app chooser on Android,
 * the "open in" menu on iOS.
 * @param  {string} path Path of the file, without a scheme.
 * @param  {{mime?: string, scheme?: string, title?: string}} options `title` is the chooser title on Android.
 * @return {Promise<void>}
 */
function chooser(path: string, options: OpenOptions = {}): Promise<void> {
    const invalid = checkPath(path);
    if (invalid) return Promise.reject(invalid);
    switch (Platform.OS) {
        case 'android':
            return requireNativeModule().actionViewIntent(path, options.mime || '', options.title || 'Open with').then(() => undefined);
        case 'ios':
            return requireNativeModule().presentOpenInMenu(fileUrl(path), options.scheme).then(() => undefined);
        default:
            return Promise.reject(notSupported('android or iOS', 'ReactNativeBlobUtil.open.chooser'));
    }
}

/**
 * The iOS options menu for a file (UIDocumentInteractionController.presentOptionsMenu).
 * @return {Promise<void>}
 */
function optionsMenu(path: string, options: OpenOptions = {}): Promise<void> {
    const invalid = checkPath(path);
    if (invalid) return Promise.reject(invalid);
    if (Platform.OS !== 'ios') {
        return Promise.reject(notSupported('ios', 'ReactNativeBlobUtil.open.optionsMenu'));
    }
    return requireNativeModule().presentOptionsMenu(fileUrl(path), options.scheme).then(() => undefined);
}

/**
 * Show the system file picker (Android) and resolve the chosen file's content
 * URI, or null when the user cancels.
 * @param  {string | {mime?: string}} mimeOrOptions MIME type filter, default any.
 * @return {Promise<?string>}
 */
function pick(mimeOrOptions: string | {mime?: string} = '*/*'): Promise<?string> {
    if (Platform.OS !== 'android') {
        return Promise.reject(notSupported('android', 'ReactNativeBlobUtil.open.pick'));
    }
    const mime = mimeOrOptions !== null && typeof mimeOrOptions === 'object' ? mimeOrOptions.mime : mimeOrOptions;
    return requireNativeModule().getContentIntent(mime || '*/*');
}

export default {file, chooser, optionsMenu, pick};
