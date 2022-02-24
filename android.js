// Copyright 2016 wkh237@github. All rights reserved.
// Use of this source code is governed by a MIT-style license that can be
// found in the LICENSE file.

import { NativeModules, Platform } from 'react-native'

const RNFetchBlob = NativeModules.RNFetchBlob

/**
 * Send an intent to open the file.
 * @param  {string} path Path of the file to be open.
 * @param  {string} mime MIME type string
 * @param  {string} title for chooser, if not set the chooser won't be displayed (see https://developer.android.com/reference/android/content/Intent.html#createChooser(android.content.Intent,%20java.lang.CharSequence))
 * @return {Promise}
 */
function actionViewIntent(path, mime, chooserTitle) {
  if(Platform.OS === 'android')
    return RNFetchBlob.actionViewIntent(path, mime, chooserTitle)
  else
    return Promise.reject('RNFetchBlob.android.actionViewIntent only supports Android.')
}

function getContentIntent(mime) {
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
  actionViewIntent,
  getContentIntent,
  addCompleteDownload,
  getSDCardDir,
  getSDCardApplicationDir,
}
