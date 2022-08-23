// Copyright 2016 wkh237@github. All rights reserved.
// Use of this source code is governed by a MIT-style license that can be
// found in the LICENSE file.

import { NativeModules, Platform } from "react-native";

const RNFetchBlob: RNFetchBlobNative = NativeModules.RNFetchBlob;

/**
 * Displays an options menu using UIDocumentInteractionController.presentOptionsMenu
 * @param  {string} path Path of the file to be open.
 * @param  {string} scheme URI scheme that needs to support, optional
 * @return {Promise}
 */
function presentOptionsMenu(path: string, scheme: string) {
  if (Platform.OS === "ios")
    return RNFetchBlob.presentOptionsMenu("file://" + path, scheme);
  else return Promise.reject("RNFetchBlob.openDocument only supports IOS.");
}

/**
 * Displays a menu for opening the document using UIDocumentInteractionController.presentOpenInMenu
 * @param  {string} path Path of the file to be open.
 * @param  {string} scheme URI scheme that needs to support, optional
 * @return {Promise}
 */
function presentOpenInMenu(path: string, scheme: string) {
  if (Platform.OS === "ios")
    return RNFetchBlob.presentOpenInMenu("file://" + path, scheme);
  else return Promise.reject("RNFetchBlob.openDocument only supports IOS.");
}

/**
 * Displays a full-screen preview of the target document using UIDocumentInteractionController.presentPreview
 * @param  {string} path Path of the file to be open.
 * @param  {string} scheme URI scheme that needs to support, optional
 * @return {Promise}
 */
function presentPreview(path: string, scheme: string) {
  if (Platform.OS === "ios")
    return RNFetchBlob.presentPreview("file://" + path, scheme);
  else return Promise.reject("RNFetchBlob.previewDocument only supports IOS.");
}

/**
 * Set excludeFromBackupKey to a URL to prevent the resource to be backuped to
 * iCloud.
 * @param  {string} url URL of the resource, only file URL is supported
 * @return {Promise}
 */
function excludeFromBackupKey(path: string) {
  return RNFetchBlob.excludeFromBackupKey("file://" + path);
}

export default {
  presentPreview,
  openDocument: presentPreview, // legacy alias
  presentOptionsMenu,
  previewDocument: presentOptionsMenu, // legacy alias
  presentOpenInMenu,
  excludeFromBackupKey
};
