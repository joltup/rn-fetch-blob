// @flow
// Copyright 2016 wkh237@github. All rights reserved.
// Use of this source code is governed by a MIT-style license that can be
// found in the LICENSE file.

import {addCode} from '../utils/errors';
import {requireNativeModule} from '../utils/nativeModule';

export default class ReactNativeBlobUtilWriteStream {

  id : string;
  encoding : string;
  append : boolean;

  constructor(streamId:string, encoding:string, append:boolean) {
    this.id = streamId;
    this.encoding = encoding;
    this.append = append;
  }

  /**
   * Write a chunk: a string, or byte values 0..255 for an ascii stream.
   * @return {Promise<ReactNativeBlobUtilWriteStream>} Resolves the stream, for chaining.
   */
  write(data: string | Array<number>): Promise<ReactNativeBlobUtilWriteStream> {
    if (this.encoding === 'ascii') {
      if (!Array.isArray(data)) {
        return Promise.reject(addCode('EINVAL', new TypeError('ascii input data must be an Array')));
      }
      return requireNativeModule().writeArrayChunk(this.id, data).then(() => this);
    }
    return requireNativeModule().writeChunk(this.id, data).then(() => this);
  }

  close(): Promise<void> {
    return requireNativeModule().closeStream(this.id).then(() => undefined);
  }

}
