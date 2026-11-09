// @flow
import {FetchBlobResponse} from './class/ReactNativeBlobUtilBlobResponse';
import CanceledFetchError from './class/ReactNativeBlobUtilCanceledFetchError';
import fs from './fs';
import toByteCount from './utils/byteCount';
import {normalizeConfig} from './utils/config';
import {addCode} from './utils/errors';
import {getEventEmitter, requireNativeModule} from './utils/nativeModule';
import {escapeForm, invalidAppendExt, invalidFormField, invalidHeader, nativeOptions, prepareBody} from './utils/request';
import getUUID from './utils/uuid';
import type {ReactNativeBlobUtilConfig} from './types';

/**
 * Calling this method will inject configurations into followed `fetch` method.
 * @param  {ReactNativeBlobUtilConfig} options
 *         Fetch API configurations, contains the following options :
 *         @property {boolean} fileCache
 *                   When fileCache is `true`, response data will be saved in
 *                   storage with a random generated file name, rather than
 *                   a BASE64 encoded string.
 *         @property {string} appendExt
 *                   Set this property to change file extension of random-
 *                   generated file name.
 *         @property {string} path
 *                   If this property has a valid string format, resonse data
 *                   will be saved to specific file path. Default string format
 *                   is : `ReactNativeBlobUtil-file://path-to-file`
 *         @property {string} key
 *                   If this property is set, it will be converted to md5, to
 *                   check if a file with this name exists.
 *                   If it exists, the absolute path is returned (no network
 *                   activity takes place )
 *                   If it doesn't exist, the file is downloaded as usual
 *         @property {number} timeout
 *                   Request timeout in millionseconds, by default it's 60000ms.
 *         @property {boolean} followRedirect
 *                   Follow redirects automatically, default true
 *         @property {boolean} trusty
 *                   Trust all certificates
 *         @property {boolean} wifiOnly
 *                   Only do requests through WiFi. Android only.
 *         @property {boolean} overwrite
 *                   Overwrite an existing file at `path`, default true.
 *         @property {Array<string>} customCACerts
 *                   PEM certificates to trust in addition to, or instead of, the
 *                   system's (see the README).
 *         @property {Array<string>} pinnedHosts
 *                   Hosts the custom CA certificates apply to.
 *         @property {boolean} trustSystemCerts
 *                   Keep trusting the system certificates when customCACerts is set.
 *         @property {boolean} transformFile
 *                   Run the registered file transformer on the downloaded file.
 *         @property {boolean} auto
 *                   Write a binary response to a cache file and keep text and
 *                   JSON in memory; binary is anything but text/* and JSON, or
 *                   a type listed in binaryContentTypes (Android and iOS).
 *         @property {Array<string>} binaryContentTypes
 *                   Content-Type fragments that count as binary.
 *
 * @return {function} This method returns a `fetch` method instance.
 */
export function config(options: ReactNativeBlobUtilConfig) {
    return {fetch: (...args: any) => fetchWithOptions(options || {}, ...args)};
}

/**
 * Create a HTTP request with the default configuration. Use `config(options).fetch`
 * to configure it.
 * @param  {string} method HTTP method, should be `GET`, `POST`, `PUT`, `DELETE`
 * @param  {string} url Request target url string.
 * @param  {object} headers HTTP request headers.
 * @param  {string} body
 *         Request body, can be either a BASE64 encoded data string,
 *         or a file path with prefix `ReactNativeBlobUtil-file://` (can be changed)
 * @return {Promise}
 *         This promise instance also contains a Customized method `progress`for
 *         register progress event handler.
 */
export function fetch(...args: any): Promise {
    return fetchWithOptions({}, ...args);
}

function fetchWithOptions(options: ReactNativeBlobUtilConfig, method: string, url: string, headers: ?Object, body: any): Promise {
    options = normalizeConfig(options);

    // create task ID for receiving progress event
    const taskId = getUUID();
    let respInfo = {'uninit': true};

    // # 241 normalize null or undefined headers, in case nil or null string
    // pass to native context
    headers = headers && Object.keys(headers).reduce((result, key) => {
        result[key] = headers[key] || '';
        return result;
    }, {});

    // Refused here, before any listener exists, so all platforms agree.
    const prepared = prepareBody(method, headers, body);
    const invalid = invalidAppendExt(options) || prepared.error || invalidHeader(headers)
        || (Array.isArray(body) ? invalidFormField(body) : null);
    headers = prepared.headers;
    body = Array.isArray(prepared.body) ? escapeForm(prepared.body) : prepared.body;
    // The kind of a single body travels in the options; native no longer infers it.
    options = nativeOptions(prepared.bodyType ? {...options, bodyType: prepared.bodyType} : options);

    // Every listener this task registers, so that settling or cancelling removes
    // all of them: a task must leave nothing behind for the life of the app.
    const subscriptions = [];
    let settled = false;

    function settle() {
        settled = true;
        while (subscriptions.length > 0) {
            subscriptions.pop().remove();
        }
    }

    let promiseReject;

    // from remote HTTP(S)
    const promise = new Promise((resolve, reject) => {
        promiseReject = reject;

        if (invalid) {
            settled = true;
            reject(addCode('EINVAL', new Error(invalid)));
            return;
        }

        const nativeMethodName = Array.isArray(body) ? 'fetchBlobForm' : 'fetchBlob';
        const emitter = getEventEmitter();

        // Listens for an event of this task only; iOS sends events as JSON strings.
        function listen(eventName, handler) {
            subscriptions.push(emitter.addListener(eventName, (e) => {
                if (typeof e === 'string') e = JSON.parse(e);
                if (e.taskId === taskId) handler(e);
            }));
        }

        listen('ReactNativeBlobUtilProgress', (e) => {
            if (promise.onProgress) promise.onProgress(toByteCount(e.written), toByteCount(e.total), e.chunk);
        });
        listen('ReactNativeBlobUtilProgress-upload', (e) => {
            if (promise.onUploadProgress) promise.onUploadProgress(toByteCount(e.written), toByteCount(e.total));
        });
        listen('ReactNativeBlobUtilState', (e) => {
            respInfo = e;
            if (promise.onStateChange) promise.onStateChange(e);
        });
        listen('ReactNativeBlobUtilServerPush', (e) => {
            if (promise.onPartData) promise.onPartData(e.chunk);
        });

        const req = requireNativeModule()[nativeMethodName];

        /**
         * Send request via native module, the response callback accepts four arguments
         * @callback
         * @param err {?{code: string, message: string}} null when the request succeeded.
         * @param rawType { 'utf8' | 'base64' | 'path'} RNFB request will be stored
         *                  as UTF8 string, BASE64 string, or a file path reference
         *                  in JS context, and this parameter indicates which one
         *                  dose the response data presents.
         * @param data {string} Response data or its reference.
         * @param responseInfo {Object.<>}
         */
        req(options, taskId, method, url, headers || {}, body, (err, rawType, data, responseInfo) => {

            // task done, remove event listeners
            settle();

            if (!responseInfo) responseInfo = {}; // should not be null / undefined

            if (err) {
                // {code, message} from native; a plain string is tolerated.
                const message = typeof err === 'string' ? err : String(err.message);
                const code = typeof err === 'object' && err.code || 'EUNSPECIFIED';
                const error = addCode(code, new Error(message));
                error.respInfo = 'uninit' in respInfo ? responseInfo : respInfo;
                reject(error);
            }
            else {
                // response data is saved to storage, create a session for it
                if (options.path || options.fileCache || options.addAndroidDownloads
                    || options.key || options.auto && respInfo.respType === 'blob') {
                    if (options.session)
                        fs.session(options.session).add(data);
                }
                if ('uninit' in respInfo && respInfo.uninit) // event didn't fire yet so we override it here
                    respInfo = responseInfo;

                respInfo.rnfbEncode = rawType;
                resolve(new FetchBlobResponse(taskId, respInfo, data));
            }

        });

    });

    // Extend the promise with `progress`, `uploadProgress`, `stateChange`, `part`
    // and `cancel`. They stay callable after the task has settled and do
    // nothing then, so a handler registered late, or a cancel of a finished task,
    // is not an error.
    // `progress` and `uploadProgress` take an optional first argument #140: when
    // there is only one argument, the default `interval` and `count` are used.
    function progressReporter(handlerName, nativeMethodName) {
        return (...args) => {
            if (settled) return promise;
            let interval = 250;
            let count = -1;
            let fn = args[0];
            if (args.length === 2) {
                // Only a missing value falls back to the default; 0 is a valid
                // interval ("every chunk") and used to become 250.
                const settings = args[0] || {};
                interval = settings.interval === undefined || settings.interval === null ? interval : settings.interval;
                count = settings.count === undefined || settings.count === null ? count : settings.count;
                fn = args[1];
            }
            promise[handlerName] = fn;
            requireNativeModule()[nativeMethodName](taskId, interval, count);
            return promise;
        };
    }

    promise.progress = progressReporter('onProgress', 'enableProgressReport');
    promise.uploadProgress = progressReporter('onUploadProgress', 'enableUploadProgressReport');
    promise.part = (fn) => {
        promise.onPartData = fn;
        return promise;
    };
    promise.stateChange = (fn) => {
        promise.onStateChange = fn;
        return promise;
    };
    // Resolves once native has cancelled the task. The task itself rejects
    // with CanceledFetchError right away.
    promise.cancel = (fn: ?Function): Promise<void> => {
        if (settled) return Promise.resolve();
        settle();
        const cancelled = requireNativeModule().cancelRequest(taskId).then(() => undefined);
        if (typeof fn === 'function') {
            cancelled.then(() => fn(), (err) => fn(err));
        }
        promiseReject(new CanceledFetchError('canceled'));
        return cancelled;
    };
    promise.taskId = taskId;

    return promise;

}
