// Copyright 2016 wkh237@github. All rights reserved.
// Use of this source code is governed by a MIT-style license that can be
// found in the LICENSE file.

import {NativeModules} from 'react-native';
import XMLHttpRequestEventTarget from './XMLHttpRequestEventTarget.js'
import Log from '../utils/log.js'
import Blob from './Blob.js'
import ProgressEvent from './ProgressEvent.js'
import URIUtil from '../utils/uri'

const RNFetchBlob = NativeModules.RNFetchBlob
const log = new Log('XMLHttpRequest')

log.disable()
// log.level(3)

const UNSENT = 0
const OPENED = 1
const HEADERS_RECEIVED = 2
const LOADING = 3
const DONE = 4

export default class XMLHttpRequest extends XMLHttpRequestEventTarget{

  _onreadystatechange : () => void;

  upload : XMLHttpRequestEventTarget = new XMLHttpRequestEventTarget();
  static binaryContentTypes : Array<string> = [
    'image/', 'video/', 'audio/'
  ];

  // readonly
  _readyState : number = UNSENT;
  _uriType : 'net' | 'file' = 'net';
  _response : any = '';
  _responseText : any = '';
  _responseHeaders : any = {};
  _responseType : '' | 'arraybuffer' | 'blob'  | 'json' | 'text' = '';
  // TODO : not suppoted ATM
  _responseURL : null = '';
  _responseXML : null = '';
  _status : number = 0;
  _statusText : string = '';
  _timeout : number = 60000;
  _sendFlag : boolean = false;
  _uploadStarted : boolean = false;
  _increment : boolean = false;

  // RNFetchBlob compatible data structure
  _config : RNFetchBlobConfig = {};
  _url : any;
  _method : string;
  _headers: any = {
    'Content-Type' : 'text/plain'
  };
  _cleanUp : () => void = null;
  _body: any;

  // RNFetchBlob promise object, which has `progress`, `uploadProgress`, and
  // `cancel` methods.
  _task: any;

  // constants
  get UNSENT() { return UNSENT }
  get OPENED() { return OPENED }
  get HEADERS_RECEIVED() { return HEADERS_RECEIVED }
  get LOADING() { return LOADING }
  get DONE() { return DONE }

  static get UNSENT() {
    return UNSENT
  }

  static get OPENED() {
    return OPENED
  }

  static get HEADERS_RECEIVED() {
    return HEADERS_RECEIVED
  }

  static get LOADING() {
    return LOADING
  }

  static get DONE() {
    return DONE
  }

  static setLog(level:number) {
    if(level === -1)
      log.disable()
    else
      log.level(level)
  }

  static addBinaryContentType(substr:string) {
    for(let i in XMLHttpRequest.binaryContentTypes) {
      if(new RegExp(substr,'i').test(XMLHttpRequest.binaryContentTypes[i])) {
        return
      }
    }
    XMLHttpRequest.binaryContentTypes.push(substr)

  }

  static removeBinaryContentType(val) {
    for(let i in XMLHttpRequest.binaryContentTypes) {
      if(new RegExp(substr,'i').test(XMLHttpRequest.binaryContentTypes[i])) {
        XMLHttpRequest.binaryContentTypes.splice(i,1)
        return
      }
    }
  }

  constructor() {
    log.verbose('XMLHttpRequest constructor called')
    super()
  }


  /**
   * XMLHttpRequest.open, always async, user and password not supported. When
   * this method invoked, headers should becomes empty again.
   * @param  {string} method Request method
   * @param  {string} url Request URL
   * @param  {true} async Always async
   * @param  {any} user NOT SUPPORTED
   * @param  {any} password NOT SUPPORTED
   */
  open(method:string, url:string, async:true, user:any, password:any) {
    log.verbose('XMLHttpRequest open ', method, url, async, user, password)
    this._method = method
    this._url = url
    this._headers = {}
    this._increment = URIUtil.isJSONStreamURI(this._url)
    this._url = this._url.replace(/^JSONStream\:\/\//, '')
    this._dispatchReadStateChange(XMLHttpRequest.OPENED)
  }

  /**
   * Invoke this function to send HTTP request, and set body.
   * @param  {any} body Body in RNfetchblob flavor
   */
  send(body) {

    this._body = body

    if(this._readyState !== XMLHttpRequest.OPENED)
      throw 'InvalidStateError : XMLHttpRequest is not opened yet.'
    let promise = Promise.resolve()
    this._sendFlag = true
    log.verbose('XMLHttpRequest send ', body)
    let {_method, _url, _headers } = this
    log.verbose('sending request with args', _method, _url, _headers, body)
    log.verbose(typeof body, body instanceof FormData)

    if(body instanceof Blob) {
      log.debug('sending blob body', body._blobCreated)
      promise = new Promise((resolve, reject) => {
          body.onCreated((blob) => {
            // when the blob is derived (not created by RN developer), the blob
            // will be released after XMLHttpRequest sent
            if(blob.isDerived) {
              this._cleanUp = () => {
                blob.close()
              }
            }
            log.debug('body created send request')
            body = RNFetchBlob.wrap(blob.getRNFetchBlobRef())
            resolve()
          })
        })
    }
    else if(typeof body === 'object') {
      body = JSON.stringify(body)
      promise = Promise.resolve()
    }
    else {
      body = body ? body.toString() : body
      promise = Promise.resolve()
    }

    promise.then(() => {
      log.debug('send request invoke', body)
      for(let h in _headers) {
        _headers[h] = _headers[h].toString()
      }

      this._task = RNFetchBlob
                    .config({
                      auto: true,
                      timeout : this._timeout,
                      increment : this._increment,
                      binaryContentTypes : XMLHttpRequest.binaryContentTypes
                    })
                    .fetch(_method, _url, _headers, body)
      this._task
          .stateChange(this._headerReceived)
          .uploadProgress(this._uploadProgressEvent)
          .progress(this._progressEvent)
          .catch(this._onError)
          .then(this._onDone)

    })
  }

  overrideMimeType(mime:string) {
    log.verbose('XMLHttpRequest overrideMimeType', mime)
    this._headers['Content-Type'] = mime
  }

  setRequestHeader(name, value) {
    log.verbose('XMLHttpRequest set header', name, value)
    if(this._readyState !== OPENED || this._sendFlag) {
      throw `InvalidStateError : Calling setRequestHeader in wrong state  ${this._readyState}`
    }
    // UNICODE SHOULD NOT PASS
    if(typeof name !== 'string' || /[^\u0000-\u00ff]/.test(name)) {
      throw 'TypeError : header field name should be a string'
    }
    //
    let invalidPatterns = [
      /[\(\)\>\<\@\,\:\\\/\[\]\?\=\}\{\s\ \u007f\;\t\0\v\r]/,
      /tt/
    ]
    for(let pattern of invalidPatterns) {
      if(pattern.test(name) || typeof name !== 'string') {
        throw `SyntaxError : Invalid header field name ${name}`
      }
    }
    this._headers[name] = value
  }

  abort() {
    log.verbose('XMLHttpRequest abort ')
    if(!this._task)
      return
    this._task.cancel((err) => {
      let e = {
        timeStamp : Date.now(),
      }
      if(this.onabort)
        this.onabort()
      if(err) {
        e.detail = err
        e.type = 'error'
        this.dispatchEvent('error', e)
      }
      else {
        e.type = 'abort'
        this.dispatchEvent('abort', e)
      }
    })
  }

  getResponseHeader(field:string):string | null {
    log.verbose('XMLHttpRequest get header', field, this._responseHeaders)
    if(!this._responseHeaders)
      return null
    return (this._responseHeaders[field] || this._responseHeaders[field.toLowerCase()]) || null

  }

  getAllResponseHeaders():string | null {
    log.verbose('XMLHttpRequest get all headers', this._responseHeaders)
    if(!this._responseHeaders)
      return ''
    let result = ''
    let respHeaders = this.responseHeaders
    for(let i in respHeaders) {
      result += `${i}: ${respHeaders[i]}${String.fromCharCode(0x0D,0x0A)}`
    }
    return result.substr(0, result.length-2)
  }

  _headerReceived = (e) => {
    log.debug('header received ', this._task.taskId, e)
    this.responseURL = this._url
    if(e.state === "2" && e.taskId === this._task.taskId) {
      this._responseHeaders = e.headers
      this._statusText = e.status
      this._status = Math.floor(e.status)
      this._dispatchReadStateChange(XMLHttpRequest.HEADERS_RECEIVED)
    }
  }

  _uploadProgressEvent = (send:number, total:number) => {
    if(!this._uploadStarted) {
      this.upload.dispatchEvent('loadstart')
      this._uploadStarted = true
    }
    if(send >= total)
      this.upload.dispatchEvent('load')
    this.upload.dispatchEvent('progress', new ProgressEvent(true, send, total))
  }

  _progressEvent = (send:number, total:number, chunk:string) => {
    log.verbose(this.readyState)
    if(this._readyState === XMLHttpRequest.HEADERS_RECEIVED)
      this._dispatchReadStateChange(XMLHttpRequest.LOADING)
    let lengthComputable = false
    if(total && total >= 0)
        lengthComputable = true
    let e = new ProgressEvent(lengthComputable, send, total)

    if(this._increment) {
      this._responseText += chunk
    }
    this.dispatchEvent('progress', e)
  }

  _onError = (err) => {
    let statusCode = Math.floor(this.status)
    if(statusCode >= 100 && statusCode !== 408) {
      return
    }
    log.debug('XMLHttpRequest error', err)
    this._statusText = err
    this._status = String(err).match(/\d+/)
    this._status = this._status ? Math.floor(this.status) : 404
    this._dispatchReadStateChange(XMLHttpRequest.DONE)
    if(err && String(err.message).match(/(timed\sout|timedout)/) || this._status == 408) {
      this.dispatchEvent('timeout')
    }
    this.dispatchEvent('loadend')
    this.dispatchEvent('error', {
      type : 'error',
      detail : err
    })
    this.clearEventListeners()
  }

  _onDone = (resp) => {
    log.debug('XMLHttpRequest done', this._url, resp, this)
    this._statusText = this._status
    let responseDataReady = () => {
      log.debug('request done state = 4')
      this.dispatchEvent('load')
      this.dispatchEvent('loadend')
      this._dispatchReadStateChange(XMLHttpRequest.DONE)
      this.clearEventListeners()
    }
    if(resp) {
      let info = resp.respInfo || {}
      log.debug(this._url, info, info.respType)
      switch(this._responseType) {
        case 'blob' :
          resp.blob().then((b) => {
            this._responseText = resp.text()
            this._response = b
            responseDataReady()
          })
        break;
        case 'arraybuffer':
          // TODO : to array buffer
        break
        case 'json':
          this._response = resp.json()
          this._responseText = resp.text()
        break
        default :
          this._responseText = resp.text()
          this._response = this.responseText
          responseDataReady()
        break;
      }
    }

  }

  _dispatchReadStateChange(state) {
    this._readyState = state
    if(typeof this._onreadystatechange === 'function')
      this._onreadystatechange()
  }

  set onreadystatechange(fn:() => void) {
    log.verbose('XMLHttpRequest set onreadystatechange', fn)
    this._onreadystatechange = fn
  }

  get onreadystatechange() {
    return this._onreadystatechange
  }

  get readyState() {
    log.verbose('get readyState', this._readyState)
    return this._readyState
  }

  get status() {
    log.verbose('get status', this._status)
    return this._status
  }

  get statusText() {
    log.verbose('get statusText', this._statusText)
    return this._statusText
  }

  get response() {
    log.verbose('get response', this._response)
    return this._response
  }

  get responseText() {
    log.verbose('get responseText', this._responseText)
    return this._responseText
  }

  get responseURL() {
    log.verbose('get responseURL', this._responseURL)
    return this._responseURL
  }

  get responseHeaders() {
    log.verbose('get responseHeaders', this._responseHeaders)
    return this._responseHeaders
  }

  set timeout(val) {
    this._timeout = val*1000
    log.verbose('set timeout', this._timeout)
  }

  get timeout() {
    log.verbose('get timeout', this._timeout)
    return this._timeout
  }

  set responseType(val) {
    log.verbose('set response type', this._responseType)
    this._responseType = val
  }

  get responseType() {
    log.verbose('get response type', this._responseType)
    return this._responseType
  }

  static get isRNFBPolyfill() {
    return true
  }

}
