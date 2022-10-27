// Copyright 2016 wkh237@github. All rights reserved.
// Use of this source code is governed by a MIT-style license that can be
// found in the LICENSE file.

import {
  NativeModules,
  DeviceEventEmitter,
  NativeAppEventEmitter,
  Platform,
  AppState,
} from 'react-native'
import type {
  RNFetchBlobNative,
  RNFetchBlobConfig,
  RNFetchBlobStream,
  RNFetchBlobResponseInfo
} from './types'
import URIUtil from './utils/uri'
//import StatefulPromise from './class/StatefulPromise.js'
import fs from './fs'
import getUUID from './utils/uuid'
import base64 from 'base-64'
import polyfill from './polyfill'
import reduce from 'lodash/reduce'
import android from './android'
import ios from './ios'
import JSONStream from './json-stream'
const {
  RNFetchBlobSession,
  readStream,
  createFile,
  unlink,
  exists,
  mkdir,
  session,
  writeStream,
  readFile,
  ls,
  isDir,
  mv,
  cp
} = fs

const Blob = polyfill.Blob
const emitter = DeviceEventEmitter
const RNFetchBlob = NativeModules.RNFetchBlob

// when app resumes, check if there's any expired network task and trigger
// their .expire event
if(Platform.OS === 'ios') {
  AppState.addEventListener('change', (e) => {
    if(e === 'active')
      RNFetchBlob.emitExpiredEvent(()=>{})
  })
}

// register message channel event handler.
emitter.addListener("RNFetchBlobMessage", (e) => {

  if(e.event === 'warn') {
    console.warn(e.detail)
  }
  else if (e.event === 'error') {
    throw e.detail
  }
  else {
    console.log("RNFetchBlob native message", e.detail)
  }
})

// Show warning if native module not detected
if(!RNFetchBlob || !RNFetchBlob.fetchBlobForm || !RNFetchBlob.fetchBlob) {
  console.warn(
    'rn-fetch-blob could not find valid native module.',
    'please make sure you have linked native modules using `rnpm link`,',
    'and restart RN packager or manually compile IOS/Android project.'
  )
}

function wrap(path:string):string {
  const prefix = path.startsWith('content://') ? 'RNFetchBlob-content://' : 'RNFetchBlob-file://'
  return prefix + path
}

/**
 * Calling this method will inject configurations into followed `fetch` method.
 * @param  {RNFetchBlobConfig} options
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
 *                   is : `RNFetchBlob-file://path-to-file`
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
 *                   Only do requests through WiFi. Android SDK 21 or above only.
 *
 * @return {function} This method returns a `fetch` method instance.
 */
function config (options:RNFetchBlobConfig) {
  return { fetch : fetch.bind(options) }
}

/**
 * Fetch from file system, use the same interface as RNFB.fetch
 * @param  {RNFetchBlobConfig} [options={}] Fetch configurations
 * @param  {string} method     Should be one of `get`, `post`, `put`
 * @param  {string} url        A file URI string
 * @param  {string} headers    Arguments of file system API
 * @param  {any}    body       Data to put or post to file systen.
 * @return {Promise}
 */
function fetchFile(options = {}, method, url, headers = {}, body):Promise {

  if(!URIUtil.isFileURI(url)) {
    throw `could not fetch file from an invalid URI : ${url}`
  }

  url = URIUtil.unwrapFileURI(url)

  let promise = null
  let cursor = 0
  let total = -1
  let cacheData = ''
  let info = null
  let _progress, _uploadProgress, _stateChange

  switch(method.toLowerCase()) {

    case 'post':
    break

    case 'put':
    break

    // read data from file system
    default:
      promise = fs.stat(url)
      .then((stat) => {
        total = stat.size
        return fs.readStream(url,
          headers.encoding || 'utf8',
          Math.floor(headers.bufferSize) || 409600,
          Math.floor(headers.interval) || 100
        )
      })
      .then((stream) => new Promise((resolve, reject) => {
        stream.open()
        info = {
          state : "2",
          headers : { 'source' : 'system-fs' },
          status : 200,
          respType : 'text',
          rnfbEncode : headers.encoding || 'utf8'
        }
        _stateChange(info)
        stream.onData((chunk) => {
          _progress && _progress(cursor, total, chunk)
          if(headers.noCache)
            return
          cacheData += chunk
        })
        stream.onError((err) => { reject(err) })
        stream.onEnd(() => {
          resolve(new FetchBlobResponse(null, info, cacheData))
        })
      }))
    break
  }

  promise.progress = (fn) => {
    _progress = fn
    return promise
  }
  promise.stateChange = (fn) => {
    _stateChange = fn
    return promise
  }
  promise.uploadProgress = (fn) => {
    _uploadProgress = fn
    return promise
  }

  return promise
}

/**
 * Create a HTTP request by settings, the `this` context is a `RNFetchBlobConfig` object.
 * @param  {string} method HTTP method, should be `GET`, `POST`, `PUT`, `DELETE`
 * @param  {string} url Request target url string.
 * @param  {object} headers HTTP request headers.
 * @param  {string} body
 *         Request body, can be either a BASE64 encoded data string,
 *         or a file path with prefix `RNFetchBlob-file://` (can be changed)
 * @return {Promise}
 *         This promise instance also contains a Customized method `progress`for
 *         register progress event handler.
 */
function fetch(...args:any):Promise {

  // create task ID for receiving progress event
  let taskId = getUUID()
  let options = this || {}
  let subscription, subscriptionUpload, stateEvent, partEvent
  let respInfo = {}
  let [method, url, headers, body] = [...args]

  // # 241 normalize null or undefined headers, in case nil or null string
  // pass to native context
  headers = reduce(headers, (result, value, key) => {
    result[key] = value || ''
    return result
  }, {});

  // fetch from file system
  if(URIUtil.isFileURI(url)) {
    return fetchFile(options, method, url, headers, body)
  }

  let promiseResolve;
  let promiseReject;

  // from remote HTTP(S)
  let promise = new Promise((resolve, reject) => {
    promiseResolve = resolve;
    promiseReject = reject;

    let nativeMethodName = Array.isArray(body) ? 'fetchBlobForm' : 'fetchBlob'

    // on progress event listener
    subscription = emitter.addListener('RNFetchBlobProgress', (e) => {
      if(e.taskId === taskId && promise.onProgress) {
        promise.onProgress(e.written, e.total, e.chunk)
      }
    })

    subscriptionUpload = emitter.addListener('RNFetchBlobProgress-upload', (e) => {
      if(e.taskId === taskId && promise.onUploadProgress) {
        promise.onUploadProgress(e.written, e.total)
      }
    })

    stateEvent = emitter.addListener('RNFetchBlobState', (e) => {
      if(e.taskId === taskId)
        respInfo = e
      promise.onStateChange && promise.onStateChange(e)
    })

    subscription = emitter.addListener('RNFetchBlobExpire', (e) => {
      if(e.taskId === taskId && promise.onExpire) {
        promise.onExpire(e)
      }
    })

    partEvent = emitter.addListener('RNFetchBlobServerPush', (e) => {
      if(e.taskId === taskId && promise.onPartData) {
        promise.onPartData(e.chunk)
      }
    })

    // When the request body comes from Blob polyfill, we should use special its ref
    // as the request body
    if( body instanceof Blob && body.isRNFetchBlobPolyfill) {
      body = body.getRNFetchBlobRef()
    }

    let req = RNFetchBlob[nativeMethodName]

    /**
     * Send request via native module, the response callback accepts three arguments
     * @callback
     * @param err {any} Error message or object, when the request success, this
     *                  parameter should be `null`.
     * @param rawType { 'utf8' | 'base64' | 'path'} RNFB request will be stored
     *                  as UTF8 string, BASE64 string, or a file path reference
     *                  in JS context, and this parameter indicates which one
     *                  dose the response data presents.
     * @param data {string} Response data or its reference.
     */
    req(options, taskId, method, url, headers || {}, body, (err, rawType, data) => {

      // task done, remove event listeners
      subscription.remove()
      subscriptionUpload.remove()
      stateEvent.remove()
      partEvent.remove()
      delete promise['progress']
      delete promise['uploadProgress']
      delete promise['stateChange']
      delete promise['part']
      delete promise['cancel']
      // delete promise['expire']
      promise.cancel = () => {}

      if(err)
        reject(new Error(err, respInfo))
      else {
        // response data is saved to storage, create a session for it
        if(options.path || options.fileCache || options.addAndroidDownloads
          || options.key || options.auto && respInfo.respType === 'blob') {
          if(options.session)
            session(options.session).add(data)
        }
        respInfo.rnfbEncode = rawType
        resolve(new FetchBlobResponse(taskId, respInfo, data))
      }

    })

  })

  // extend Promise object, add `progress`, `uploadProgress`, and `cancel`
  // method for register progress event handler and cancel request.
  // Add second parameter for performance purpose #140
  // When there's only one argument pass to this method, use default `interval`
  // and `count`, otherwise use the given on.
  // TODO : code refactor, move `uploadProgress` and `progress` to StatefulPromise
  promise.progress = (...args) => {
    let interval = 250
    let count = -1
    let fn = () => {}
    if(args.length === 2) {
      interval = args[0].interval || interval
      count = args[0].count || count
      fn = args[1]
    }
    else {
      fn = args[0]
    }
    promise.onProgress = fn
    RNFetchBlob.enableProgressReport(taskId, interval, count)
    return promise
  }
  promise.uploadProgress = (...args) => {
    let interval = 250
    let count = -1
    let fn = () => {}
    if(args.length === 2) {
      interval = args[0].interval || interval
      count = args[0].count || count
      fn = args[1]
    }
    else {
      fn = args[0]
    }
    promise.onUploadProgress = fn
    RNFetchBlob.enableUploadProgressReport(taskId, interval, count)
    return promise
  }
  promise.part = (fn) => {
    promise.onPartData = fn
    return promise
  }
  promise.stateChange = (fn) => {
    promise.onStateChange = fn
    return promise
  }
  promise.expire = (fn) => {
    promise.onExpire = fn
    return promise
  }
  promise.cancel = (fn) => {
    fn = fn || function(){}
    subscription.remove()
    subscriptionUpload.remove()
    stateEvent.remove()
    RNFetchBlob.cancelRequest(taskId, fn)
    promiseReject(new Error("canceled"))
  }
  promise.taskId = taskId

  return promise

}

/**
 * RNFetchBlob response object class.
 */
class FetchBlobResponse {

  taskId : string;
  path : () => string | null;
  type : 'base64' | 'path' | 'utf8';
  data : any;
  blob : (contentType:string, sliceSize:number) => Promise<Blob>;
  text : () => string | Promise<any>;
  json : () => any;
  base64 : () => any;
  flush : () => void;
  respInfo : RNFetchBlobResponseInfo;
  session : (name:string) => RNFetchBlobSession | null;
  readFile : (encode: 'base64' | 'utf8' | 'ascii') => ?Promise<any>;
  readStream : (
    encode: 'utf8' | 'ascii' | 'base64',
  ) => RNFetchBlobStream | null;

  constructor(taskId:string, info:RNFetchBlobResponseInfo, data:any) {
    this.data = data
    this.taskId = taskId
    this.type = info.rnfbEncode
    this.respInfo = info

    this.info = ():RNFetchBlobResponseInfo => {
      return this.respInfo
    }

    this.array = ():Promise<Array> => {
      let cType = info.headers['Content-Type'] || info.headers['content-type']
      return new Promise((resolve, reject) => {
        switch(this.type) {
          case 'base64':
            // TODO : base64 to array buffer
          break
          case 'path':
            fs.readFile(this.data, 'ascii').then(resolve)
          break
          default:
            // TODO : text to array buffer
          break
        }
      })
    }

    /**
     * Convert result to javascript RNFetchBlob object.
     * @return {Promise<Blob>} Return a promise resolves Blob object.
     */
    this.blob = ():Promise<Blob> => {
      let Blob = polyfill.Blob
      let cType = info.headers['Content-Type'] || info.headers['content-type']
      return new Promise((resolve, reject) => {
        switch(this.type) {
          case 'base64':
            Blob.build(this.data, { type : cType + ';BASE64' }).then(resolve)
          break
          case 'path':
            polyfill.Blob.build(wrap(this.data), { type : cType }).then(resolve)
          break
          default:
            polyfill.Blob.build(this.data, { type : 'text/plain' }).then(resolve)
          break
        }
      })
    }
    /**
     * Convert result to text.
     * @return {string} Decoded base64 string.
     */
    this.text = ():string | Promise<any> => {
      let res = this.data
      switch(this.type) {
        case 'base64':
          return base64.decode(this.data)
        case 'path':
          return fs.readFile(this.data, 'base64').then((b64) => Promise.resolve(base64.decode(b64)))
        default:
          return this.data
      }
    }
    /**
     * Convert result to JSON object.
     * @return {object} Parsed javascript object.
     */
    this.json = ():any => {
      switch(this.type) {
        case 'base64':
          return JSON.parse(base64.decode(this.data))
        case 'path':
          return fs.readFile(this.data, 'utf8')
                   .then((text) => Promise.resolve(JSON.parse(text)))
        default:
          return JSON.parse(this.data)
      }
    }
    /**
     * Return BASE64 string directly.
     * @return {string} BASE64 string of response body.
     */
    this.base64 = ():string | Promise<any> => {
      switch(this.type) {
        case 'base64':
          return this.data
        case 'path':
          return fs.readFile(this.data, 'base64')
        default:
          return base64.encode(this.data)
      }
    }
    /**
     * Remove cahced file
     * @return {Promise}
     */
    this.flush = () => {
      let path = this.path()
      if(!path || this.type !== 'path')
        return
      return unlink(path)
    }
    /**
     * get path of response temp file
     * @return {string} File path of temp file.
     */
    this.path = () => {
      if(this.type === 'path')
        return this.data
      return null
    }

    this.session = (name:string):RNFetchBlobSession | null => {
      if(this.type === 'path')
        return session(name).add(this.data)
      else {
        console.warn('only file paths can be add into session.')
        return null
      }
    }
    /**
     * Start read stream from cached file
     * @param  {String} encoding Encode type, should be one of `base64`, `ascii`, `utf8`.
     * @return {void}
     */
    this.readStream = (encoding: 'base64' | 'utf8' | 'ascii'):RNFetchBlobStream | null => {
      if(this.type === 'path') {
        return readStream(this.data, encoding)
      }
      else {
        console.warn('RNFetchblob', 'this response data does not contains any available stream')
        return null
      }
    }
    /**
     * Read file content with given encoding, if the response does not contains
     * a file path, show warning message
     * @param  {String} encoding Encode type, should be one of `base64`, `ascrii`, `utf8`.
     * @return {String}
     */
    this.readFile = (encoding: 'base64' | 'utf8' | 'ascii') => {
      if(this.type === 'path') {
        return readFile(this.data, encoding)
      }
      else {
        console.warn('RNFetchblob', 'this response does not contains a readable file')
        return null
      }
    }
  }

}

export default {
  fetch,
  base64,
  android,
  ios,
  config,
  session,
  fs,
  wrap,
  polyfill,
  JSONStream
}
