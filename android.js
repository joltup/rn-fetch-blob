// Copyright 2016 wkh237@github. All rights reserved.
// Use of this source code is governed by a MIT-style license that can be
// found in the LICENSE file.

import {
  NativeModules,
  DeviceEventEmitter,
  Platform,
  NativeAppEventEmitter,
} from 'react-native'

const RNFetchBlob:RNFetchBlobNative = NativeModules.RNFetchBlob

function uriForFile(path: string) {
  if (Platform.OS === 'android')
    return RNFetchBlob.uriForFile(path);
  else
    return Promise.reject('RNFetchBlob.android.uriForFile only supports Android.')
}

/**
 * Send an intent to open the file.
 * @param  {string} path Path of the file to be open.
 * @param  {string} mime MIME type string
 * @return {Promise}
 */
function actionViewIntent(path:string, mime:string = 'text/plain') {
  if(Platform.OS === 'android')
    return RNFetchBlob.actionViewIntent(path, mime)
  else
    return Promise.reject('RNFetchBlob.android.actionViewIntent only supports Android.')
}

function getContentIntent(mime:string) {
  if(Platform.OS === 'android')
    return RNFetchBlob.getContentIntent(mime)
  else
    return Promise.reject('RNFetchBlob.android.getContentIntent only supports Android.')
}

function addCompleteDownload(config) {
  if(Platform.OS === 'android')
    return RNFetchBlob.addCompleteDownload(config)
  else
    return Promise.reject('RNFetchBlob.android.addCompleteDownload only supports Android.')
}

function getSDCardDir() {
  if(Platform.OS === 'android')
    return RNFetchBlob.getSDCardDir()
  else
    return Promise.reject('RNFetchBlob.android.getSDCardDir only supports Android.')
}

function getSDCardApplicationDir() {
  if(Platform.OS === 'android')
    return RNFetchBlob.getSDCardApplicationDir()
  else
    return Promise.reject('RNFetchBlob.android.getSDCardApplicationDir only supports Android.')
}


export default {
  uriForFile,
  actionViewIntent,
  getContentIntent,
  addCompleteDownload,
  getSDCardDir,
  getSDCardApplicationDir,
}
