// @flow
// Copyright 2016 wkh237@github. All rights reserved.
// Use of this source code is governed by a MIT-style license that can be
// found in the LICENSE file.

import base64 from 'base-64';
import android from './android';
import CanceledFetchError from './class/ReactNativeBlobUtilCanceledFetchError';
import {config, fetch} from './fetch';
import fs from './fs';
import ios from './ios';
import media from './media';
import MediaCollection from './mediacollection';
import open from './open';
import URIUtil from './utils/uri';

const {session} = fs;
const wrap = URIUtil.wrap;

// Named exports, the same objects as the default export's members:
// import {fetch, fs} from 'react-native-blob-util'.
export {base64, config, fetch, fs, media, open, session, wrap};

export type {ReactNativeBlobUtilConfig, ReactNativeBlobUtilResponseInfo, ReactNativeBlobUtilStream} from './types';
export {default as URIUtil} from './utils/uri';
export {default as CanceledFetchError} from './class/ReactNativeBlobUtilCanceledFetchError';
export {FetchBlobResponse} from './class/ReactNativeBlobUtilBlobResponse';
export { getUUID } from './utils/uuid';
export default {
    fetch,
    config,
    session,
    fs,
    open,
    media,
    wrap,
    base64,
    CanceledFetchError,
    // The namespaces from before 1.0; every member warns once and forwards.
    android,
    ios,
    MediaCollection,
};
