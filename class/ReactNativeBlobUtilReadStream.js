// @flow
// Copyright 2016 wkh237@github. All rights reserved.
// Use of this source code is governed by a MIT-style license that can be
// found in the LICENSE file.

import {toUnsignedBytes} from '../utils/bytes';
import {addCode} from '../utils/errors';
import {getEventEmitter, requireNativeModule} from '../utils/nativeModule';
import UUID from '../utils/uuid';

// A multiple of 3 so that base64 chunks concatenate without padding in the middle.
const DEFAULT_BUFFER_SIZE = 12288;
const DEFAULT_TICK = 10;

export default class ReactNativeBlobUtilReadStream {

    path: string;
    encoding: 'utf8' | 'ascii' | 'base64';
    bufferSize: ?number;
    closed: boolean;
    tick: number = DEFAULT_TICK;

    constructor(path: string, encoding: string, bufferSize?: ?number, tick: number) {
        if (!path)
            throw Error('ReactNativeBlobUtil could not open file stream with empty `path`');
        this.encoding = encoding || 'utf8';
        this.bufferSize = bufferSize;
        this.path = path;
        this.closed = false;
        this.tick = tick > 0 ? tick : DEFAULT_TICK;
        this._onData = null;
        this._onEnd = null;
        this._onError = null;
        this.streamId = 'RNFBRS' + UUID();
    }

    /**
     * Start reading. Resolves when the stream ends and rejects with the error
     * when it fails, whether or not onError is set; with onError the rejection
     * counts as handled. The event listener lives only while the stream is
     * open: it used to be added in the constructor, so a stream that was never
     * opened left it behind, and an error without onError was dropped.
     * @return {Promise<void>}
     */
    open(): Promise<void> {
        if (this.closed) {
            return Promise.reject(addCode('EBADF', new Error('Stream closed')));
        }
        let finished;
        finished = new Promise((resolve, reject) => {
            const subscription = getEventEmitter().addListener('ReactNativeBlobUtilFilesystem', (e) => {
                if (typeof e === 'string') e = JSON.parse(e);
                if (e.streamId !== this.streamId) return; // wrong stream
                const {event, code, detail} = e;
                if (event === 'data') {
                    // ascii chunks are bytes 0..255; Android and iOS send them signed
                    if (this._onData) this._onData(this.encoding === 'ascii' ? toUnsignedBytes(detail) : detail);
                    return;
                }
                subscription.remove();
                this.closed = true;
                if (event === 'end') {
                    if (this._onEnd) this._onEnd(detail);
                    resolve();
                    return;
                }
                const err = addCode(code || 'EUNSPECIFIED', new Error(detail));
                if (this._onError) {
                    this._onError(err);
                    finished.catch(() => {});
                }
                reject(err);
            });
            requireNativeModule().readStream(this.path, this.encoding, this.bufferSize > 0 ? this.bufferSize : DEFAULT_BUFFER_SIZE, this.tick, this.streamId);
        });
        return finished;
    }

    onData(fn: () => void) {
        this._onData = fn;
    }

    onError(fn) {
        this._onError = fn;
    }

    onEnd(fn) {
        this._onEnd = fn;
    }

}
