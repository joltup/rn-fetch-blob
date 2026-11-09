// @flow
// The Flow types index.js exports for Flow-typed apps. index.d.ts is what
// TypeScript reads; tests/unit/flowTypes.test.js checks that the types the two
// share have the same shape, so a change to one has to be made in both.

import type ReactNativeBlobUtilReadStream from './class/ReactNativeBlobUtilReadStream';

/** The DownloadManager options of `config({android: {downloadManager}})`. */
export type AddAndroidDownloads = {
  useDownloadManager?: boolean,
  title?: string,
  description?: string,
  path?: string,
  mime?: string,
  mediaScannable?: boolean,
  storeInDownloads?: boolean,
  notification?: boolean,
  storeLocal?: boolean,
};

/** Options for `config()`. */
export type ReactNativeBlobUtilConfig = {
  fileCache?: boolean,
  appendExt?: string,
  path?: string,
  key?: string,
  session?: string,
  overwrite?: boolean,
  timeout?: number,
  followRedirect?: boolean,
  transform?: boolean,
  /** @deprecated use `transform` */
  transformFile?: boolean,
  trusty?: boolean,
  customCACerts?: Array<string>,
  pinnedHosts?: Array<string>,
  trustSystemCerts?: boolean,
  auto?: boolean,
  binaryContentTypes?: Array<string>,
  android?: {
    downloadManager?: AddAndroidDownloads,
    wifiOnly?: boolean,
    targetHostIp?: string,
  },
  ios?: {
    backgroundTask?: boolean,
  },
  /** @deprecated use `android.wifiOnly` */
  wifiOnly?: boolean,
  /** @deprecated use `android.targetHostIp` */
  targetHostIp?: string,
  /** @deprecated use `android.downloadManager` */
  addAndroidDownloads?: AddAndroidDownloads,
  /** @deprecated use `ios.backgroundTask` */
  IOSBackgroundTask?: boolean,
};

export type ReactNativeBlobUtilNative = {
  // API for fetch octet-stream data
  fetchBlob : (
    options:fetchConfig,
    taskId:string,
    method:string,
    url:string,
    headers:any,
    body:any,
    callback:(err:any, ...data:any) => void
  ) => void,
  // API for fetch form data
  fetchBlobForm : (
    options:fetchConfig,
    taskId:string,
    method:string,
    url:string,
    headers:any,
    form:Array<any>,
    callback:(err:any, ...data:any) => void
  ) => void,
  // open file stream
  readStream : (
    path:string,
    encode:'utf8' | 'ascii' | 'base64'
  ) => void,
  // get system folders
  getEnvironmentDirs : (dirs:any) => void,
  // unlink file by path
  unlink : (path:string, callback: (err:any) => void) => void,
  removeSession : (paths:Array<string>, callback: (err:any) => void) => void,
  ls : (path:string, callback: (err:any) => void) => void,
};

export type ReactNativeBlobUtilResponseInfo = {
  taskId: string,
  state: string,
  headers: {[name: string]: string},
  status: number,
  /** Every URL a redirect went through. */
  redirects?: Array<string>,
  respType: 'text' | 'blob' | '' | 'json',
  rnfbEncode: 'path' | 'base64' | 'utf8',
  timeout?: boolean,
};

/** @deprecated use ReactNativeBlobUtilReadStream */
export type ReactNativeBlobUtilStream = ReactNativeBlobUtilReadStream;

/** A file in the Android MediaStore. */
export type filedescriptor = {
  name: string,
  parentFolder?: string,
  mime?: string,
  /** @deprecated use `mime` */
  mimeType?: string,
};

export type ReactNativeBlobUtilStat = {
  filename: string,
  path: string,
  size: number,
  type: 'file' | 'directory' | 'asset',
  lastModified: number,
};
