// Copyright 2016 wkh237@github. All rights reserved.
// Use of this source code is governed by a MIT-style license that can be
// found in the LICENSE file.

import {NativeModules} from 'react-native';
import fs from '../fs.js'
import getUUID from '../utils/uuid'
import Log from '../utils/log.js'
import EventTarget from './EventTarget'

const RNFetchBlob = NativeModules.RNFetchBlob
const log = new Log('Blob')
const blobCacheDir = fs.dirs.DocumentDir + '/RNFetchBlob-blobs/'

log.disable()
// log.level(3)

/**
 * A RNFetchBlob style Blob polyfill class, this is a Blob which compatible to
 * Response object attain fron RNFetchBlob.fetch.
 */
export default class Blob extends EventTarget {

  cacheName:string;
  type:string;
  size:number;
  isRNFetchBlobPolyfill:boolean = true;
  multipartBoundary:string = null;

  _ref:string = null;
  _blobCreated:boolean = false;
  _onCreated:Array<any> = [];
  _closed:boolean = false;

  /**
   * Static method that remove all files in Blob cache folder.
   * @nonstandard
   * @return {Promise}
   */
  static clearCache() {
    return fs.unlink(blobCacheDir).then(() => fs.mkdir(blobCacheDir))
  }

  static build(data:any, cType:any):Promise<Blob> {
    return new Promise((resolve, reject) => {
      new Blob(data, cType).onCreated(resolve)
    })
  }

  get blobPath() {
    return this._ref
  }

  static setLog(level:number) {
    if(level === -1)
      log.disable()
    else
      log.level(level)
  }

  /**
   * RNFetchBlob Blob polyfill, create a Blob directly from file path, BASE64
   * encoded data, and string. The conversion is done implicitly according to
   * given `mime`. However, the blob creation is asynchronously, to register
   * event `onCreated` is need to ensure the Blob is creadted.
   * @param  {any} data Content of Blob object
   * @param  {any} mime Content type settings of Blob object, `text/plain`
   *                    by default
   * @param  {boolean} defer When this argument set to `true`, blob constructor
   *                         will not invoke blob created event automatically.
   */
  constructor(data:any, cType:any, defer:boolean) {
    super()
    cType = cType || {}
    this.cacheName = getBlobName()
    this.isRNFetchBlobPolyfill = true
    this.isDerived = defer
    this.type = cType.type || 'text/plain'
    log.verbose('Blob constructor called', 'mime', this.type, 'type', typeof data, 'length', data?  data.length:0)
    this._ref = blobCacheDir + this.cacheName
    let p = null
    if(!data)
      data = ''
    if(data.isRNFetchBlobPolyfill) {
      log.verbose('create Blob cache file from Blob object')
      let size = 0
      this._ref = String(data.getRNFetchBlobRef())
      let orgPath = this._ref

      p = fs.exists(orgPath)
            .then((exist) =>  {
              if(exist)
                return fs.writeFile(orgPath, data, 'uri')
                         .then((size) => Promise.resolve(size))
                         .catch((err) => {
                           throw `RNFetchBlob Blob file creation error, ${err}`
                         })
              else
                throw `could not create Blob from path ${orgPath}, file not exists`
            })
    }
    // process FormData
    else if(data instanceof FormData) {
      log.verbose('create Blob cache file from FormData', data)
      let boundary = `RNFetchBlob-${this.cacheName}-${Date.now()}`
      this.multipartBoundary = boundary
      let parts = data.getParts()
      let formArray = []
      if(!parts) {
        p = fs.writeFile(this._ref, '', 'utf8')
      }
      else {
        for(let i in parts) {
          formArray.push('\r\n--'+boundary+'\r\n')
          let part = parts[i]
          for(let j in part.headers) {
            formArray.push(j + ': ' +part.headers[j] + '\r\n')
          }
          formArray.push('\r\n')
          if(part.isRNFetchBlobPolyfill)
            formArray.push(part)
          else
            formArray.push(part.string)
        }
        log.verbose('FormData array', formArray)
        formArray.push('\r\n--'+boundary+'--\r\n')
        p = createMixedBlobData(this._ref, formArray)
      }
    }
    // if the data is a string starts with `RNFetchBlob-file://`, append the
    // Blob data from file path
    else if(typeof data === 'string' && data.startsWith('RNFetchBlob-file://')) {
      log.verbose('create Blob cache file from file path', data)
      // set this flag so that we know this blob is a wrapper of an existing file
      this._isReference = true
      this._ref = String(data).replace('RNFetchBlob-file://', '')
      let orgPath = this._ref
      if(defer)
        return
      else {
        p = fs.stat(orgPath)
              .then((stat) =>  {
                return Promise.resolve(stat.size)
              })
      }
    }
    // content from variable need create file
    else if(typeof data === 'string') {
      let encoding = 'utf8'
      let mime = String(this.type)
      // when content type contains application/octet* or *;base64, RNFetchBlob
      // fs will treat it as BASE64 encoded string binary data
      if(/(application\/octet|\;base64)/i.test(mime))
        encoding = 'base64'
      else
        data = data.toString()
      // create cache file
      this.type = String(this.type).replace(/;base64/ig, '')
      log.verbose('create Blob cache file from string', 'encode', encoding)
      p = fs.writeFile(this._ref, data, encoding)
            .then((size) => {
              return Promise.resolve(size)
            })

    }
    // TODO : ArrayBuffer support
    // else if (data instanceof ArrayBuffer ) {
    //
    // }
    // when input is an array of mixed data types, create a file cache
    else if(Array.isArray(data)) {
      log.verbose('create Blob cache file from mixed array', data)
      p = createMixedBlobData(this._ref, data)
    }
    else {
      data = data.toString()
      p = fs.writeFile(this._ref, data, 'utf8')
            .then((size) => Promise.resolve(size))
    }
    p && p.then((size) => {
      this.size = size
      this._invokeOnCreateEvent()
    })
    .catch((err) => {
      log.error('RNFetchBlob could not create Blob : '+ this._ref, err)
    })

  }

  /**
   * Since Blob content will asynchronously write to a file during creation,
   * use this method to register an event handler for Blob initialized event.
   * @nonstandard
   * @param  {(b:Blob) => void} An event handler invoked when Blob created
   * @return {Blob} The Blob object instance itself
   */
  onCreated(fn:() => void):Blob {
    log.verbose('#register blob onCreated', this._blobCreated)
    if(!this._blobCreated)
      this._onCreated.push(fn)
    else {
      fn(this)
    }
    return this
  }

  markAsDerived() {
    this._isDerived = true
  }

  get isDerived() {
    return this._isDerived || false
  }

  /**
   * Get file reference of the Blob object.
   * @nonstandard
   * @return {string} Blob file reference which can be consumed by RNFetchBlob fs
   */
  getRNFetchBlobRef() {
    return this._ref
  }

  /**
   * Create a Blob object which is sliced from current object
   * @param  {number} start    Start byte number
   * @param  {number} end      End byte number
   * @param  {string} contentType Optional, content type of new Blob object
   * @return {Blob}
   */
  slice(start:?number, end:?number, contentType:?string=''):Blob {
    if(this._closed)
      throw 'Blob has been released.'
    log.verbose('slice called', start, end, contentType)


    let resPath = blobCacheDir + getBlobName()
    let pass = false
    log.debug('fs.slice new blob will at', resPath)
    let result = new Blob(RNFetchBlob.wrap(resPath), { type : contentType }, true)
    fs.exists(blobCacheDir)
    .then((exist) => {
      if(exist)
        return Promise.resolve()
      return fs.mkdir(blobCacheDir)
    })
    .then(() => fs.slice(this._ref, resPath, start, end))
    .then((dest) => {
      log.debug('fs.slice done', dest)
      result._invokeOnCreateEvent()
      pass = true
    })
    .catch((err) => {
      console.warn('Blob.slice failed:', err)
      pass = true
    })
    log.debug('slice returning new Blob')

    return result
  }

  /**
   * Read data of the Blob object, this is not standard method.
   * @nonstandard
   * @param  {string} encoding Read data with encoding
   * @return {Promise}
   */
  readBlob(encoding:string):Promise<any> {
    if(this._closed)
      throw 'Blob has been released.'
    return fs.readFile(this._ref, encoding || 'utf8')
  }

  /**
   * Release the resource of the Blob object.
   * @nonstandard
   * @return {Promise}
   */
  close() {
    if(this._closed)
      return Promise.reject('Blob has been released.')
    this._closed = true
    return fs.unlink(this._ref).catch((err) => {
      console.warn(err)
    })
  }

  safeClose() {
    if(this._closed)
      return Promise.reject('Blob has been released.')
    this._closed = true
    if(!this._isReference) {
      return fs.unlink(this._ref).catch((err) => {
        console.warn(err)
      })   
    }
    else {
      return Promise.resolve()
    }
  }

  _invokeOnCreateEvent() {
    log.verbose('invoke create event', this._onCreated)
    this._blobCreated = true
    let fns = this._onCreated
    for(let i in fns) {
      if(typeof fns[i] === 'function') {
        fns[i](this)
      }
    }
    delete this._onCreated
  }

}

/**
 * Get a temp filename for Blob object
 * @return {string} Temporary filename
 */
function getBlobName() {
  return 'blob-' + getUUID()
}

/**
 * Create a file according to given array. The element in array can be a number,
 * Blob, String, Array.
 * @param  {string} ref File path reference
 * @param  {Array} dataArray An array contains different types of data.
 * @return {Promise}
 */
function createMixedBlobData(ref, dataArray) {
  // create an empty file for store blob data
  let p = fs.writeFile(ref, '')
  let args = []
  let size = 0
  for(let i in dataArray) {
    let part = dataArray[i]
    if(!part)
      continue
    if(part.isRNFetchBlobPolyfill) {
      args.push([ref, part._ref, 'uri'])
    }
    else if(typeof part === 'string')
      args.push([ref, part, 'utf8'])
    // TODO : ArrayBuffer
    // else if (part instanceof ArrayBuffer) {
    //
    // }
    else if (Array.isArray(part))
      args.push([ref, part, 'ascii'])
  }
  // start write blob data
  for(let i in args) {
    p = p.then(function(written){
      let arg = this
      if(written)
        size += written
      log.verbose('mixed blob write', args[i], written)
      return fs.appendFile(...arg)
    }.bind(args[i]))
  }
  return p.then(() => Promise.resolve(size))
}
