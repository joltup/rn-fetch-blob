
type RNFetchBlobConfig = {
  fileCache : bool,
  path : string,
  appendExt : string,
  session : string,
  addAndroidDownloads : any,
  indicator : bool,
  followRedirect : bool,
  trusty : bool,
  wifiOnly : bool
};

type RNFetchBlobNative = {
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

type RNFetchBlobResponseInfo = {
  taskId : string,
  state : number,
  headers : any,
  status : number,
  respType : 'text' | 'blob' | '' | 'json',
  rnfbEncode : 'path' | 'base64' | 'ascii' | 'utf8'
}

type RNFetchBlobStream = {
  onData : () => void,
  onError : () => void,
  onEnd : () => void,
  _onData : () => void,
  _onEnd : () => void,
  _onError : () => void,
}
