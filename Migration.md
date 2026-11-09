# Migrating to 1.0

1.0 rewrites the native layers and cleans up the JavaScript API. Android moves from
Java to Kotlin, and iOS from Objective-C++ to Swift; Windows stays C++. Before the old
Android and iOS code was removed, the new code was checked call by call against
recordings of how 0.25 behaved on the same device. On top of that, the JavaScript
surface loses what never worked, and the platforms are brought to one behaviour where
they disagreed. Every change to what your code sees is listed under
[JavaScript API](#javascript-api).

Most apps only need to meet the new requirements below and check the removed APIs.

## Requirements

| | 0.25 | 1.0 |
|---|---|---|
| React Native architecture | Old or New | **New Architecture only** |
| React Native | 0.76 and up | 0.84 and up (tested on 0.84 and the newest release); `peerDependencies` now says so, so `npm install` on an older app fails instead of the build |
| Android `minSdk` | the app's (library fallback 16) | 24 |
| Android build | Java 8 bytecode | Java 17 bytecode, Kotlin compiled with the app's Kotlin setup |
| iOS deployment target | 11.0 | 15.1 |
| Xcode | | 16.1 or newer |
| iOS integration | CocoaPods or the bundled Xcode project | CocoaPods, or SwiftPM autolinking on React Native 0.87 and newer (1.1.0; on 0.88 from 1.1.1) |

If your app still runs on the Old Architecture, stay on 0.25 until it moves to the New
Architecture.

## JavaScript API

### One namespace per capability

The API is grouped by what a call does, not by which platform implements it. A call a
platform cannot make rejects with `ENOTSUP`. The old names keep working for one release
and print one deprecation warning each.

| Before | 1.0 |
|---|---|
| `android.actionViewIntent(path, mime)` / `ios.presentPreview(path)` | `open.file(path, {mime, scheme})` |
| `android.actionViewIntent(path, mime, title)` / `ios.presentOpenInMenu(path)` | `open.chooser(path, {mime, scheme, title})` |
| `ios.presentOptionsMenu(path)` | `open.optionsMenu(path, {scheme})` |
| `android.getContentIntent(mime)` | `open.pick(mime)` (resolves `null` when cancelled) |
| `MediaCollection.createMediaFile` | `media.createFile(fd, collection)` |
| `MediaCollection.writeToMediaFile` / `...WithTransform` | `media.write(uri, path, {transform})` (resolves `undefined`; the old names keep resolving `"Success"`) |
| `MediaCollection.copyToMediaStore`, `copyToInternal` | `media.copyToMediaStore`, `media.copyToInternal` |
| `MediaCollection.getBlob(uri, encoding)` | `media.read(uri, encoding)` |
| `android.addCompleteDownload(options)` | `media.addDownload(options)` |
| `android.scanFile(files)`, `fs.scanFile` | `media.scan(files)` |
| `android.getSDCardDir()`, `getSDCardApplicationDir()` | `fs.sdCardDir()`, `fs.sdCardApplicationDir()` |
| `fs.lstat(path)` | `fs.ls(path, {stats: true})` (`lstat` means "stat without following a link" in Node) |
| `ios.excludeFromBackupKey(path)` | `fs.excludeFromBackup(path)` |
| `ios.pathForAppGroup`, `syncPathAppGroup`, `fs.pathForAppGroup`, `fs.syncPathAppGroup` | `fs.appGroupDir(name)`, `fs.appGroupDirSync(name)` |
| `fs.readFileWithTransform(path, encoding)` | `fs.readFile(path, encoding, {transform: true})` |
| `fs.writeFileWithTransform(path, data, encoding)` | `fs.writeFile(path, data, encoding, {transform: true})` |

### Removed

- **The Web API polyfills** (`ReactNativeBlobUtil.polyfill`: Blob, File, XMLHttpRequest,
  FileReader, Fetch, ProgressEvent, Event). They were experimental since 0.8 and no
  longer worked: FileReader's read methods were stubs, and XMLHttpRequest never
  completed `json` or `arraybuffer` responses. Use React Native's own `Blob`,
  `XMLHttpRequest` and `fetch`; for file bodies and file downloads, use
  `ReactNativeBlobUtil.fetch` with `wrap(path)` and `config({path})`.
- **`ReactNativeBlobUtil.JSONStream`** and the bundled oboe.js. It replaced the global
  XMLHttpRequest when used. Stream the response to a file with `config({path})` and
  parse it, or use a streaming JSON parser of your choice on `fs.readStream`.
- **`response.blob()`** on the result of `fetch`. It returned the polyfill Blob.
  Use `response.base64()`, `response.path()` (with `config({fileCache: true})` or
  `config({path})`) or the new `response.array()`.
- **`fetch` of a `ReactNativeBlobUtil-file://` URL.** It read the file through the
  stream API without `cancel`, `taskId` or progress. Use `fs.readFile` or
  `fs.readStream`.

### Resolved values

The same call resolved different values per platform. 1.0 resolves one value everywhere, by
one rule: a call resolves `undefined` unless it returns something the caller does not
already have (a byte count, a stat, a new content URI).

| Call | 0.25 | 1.0 |
|---|---|---|
| `fs.createFile` | the path (Android), `[null]` (iOS), `undefined` (Windows) | `undefined` |
| `fs.cp`, `fs.mv` | `undefined` (Android), `true` (iOS, Windows) | `undefined` |
| `fs.mkdir` | `true` or `undefined` by platform | `undefined` |
| `fs.slice` | the destination path | `undefined` |
| `media.copyToInternal` | `""` (Android) | `undefined`; the deprecated `MediaCollection.copyToInternal` keeps `""` |
| `fs.df` | four strings `internal_free`, `internal_total`, `external_free`, `external_total` (Android); `{free, total}` numbers (iOS, Windows) | `{free, total}` as numbers on every platform; Android keeps its four fields, as numbers |
| `fs.lstat` entries | `size` a string; `lastModified` a string (Android) or number (iOS) | `size` and `lastModified` numbers, like `fs.stat` |
| `fs.readFile(path, 'ascii')`, ascii `readStream` chunks, `response.array()` | bytes -128..127 (Android, iOS) or 0..255 (Windows) | bytes 0..255 |
| `ios.presentOptionsMenu`, `ios.presentOpenInMenu`, `ios.presentPreview`, `ios.excludeFromBackupKey` | `[null]` (iOS), `[]` (Windows) | `undefined` |

If you compared ascii bytes against negative values, or read `df().internal_free` as a
string, adjust those comparisons.

### Platform-specific calls

- A call that only exists on one platform now rejects on the others with an `Error`
  whose `code` is `ENOTSUP`. Before, `android.*` and `ios.present*` rejected with a
  bare string, `fs.pathForAppGroup` and `ios.excludeFromBackupKey` never settled on
  Android, and MediaCollection resolved `""` or `[]` on Windows as if it had worked.
- `fs.scanFile` is now `media.scan`; `fs.pathForAppGroup` and `fs.syncPathAppGroup` are
  now `fs.appGroupDir` and `fs.appGroupDirSync`. The old names still work and print
  one deprecation warning.
- `ios.openDocument` and `ios.previewDocument` were crossed: `openDocument` showed the
  preview and `previewDocument` the options menu. They now do what their names say
  (the options menu and the preview), and are deprecated in favour of
  `open.optionsMenu` and `open.file`.
- `MediaCollection.createMediaFile`, `writeToMediaFile` and
  `writeToMediaFileWithTransform` are the spellings that match native; the old
  `...Mediafile` names still work and warn once.
- A cancelled `fetch` rejects with `CanceledFetchError`, which now has `code:
  'ECANCELED'` and is also a named export: `import {CanceledFetchError} from
  'react-native-blob-util'`.

### Types

- Named exports: `import {fetch, config, fs, open, media, wrap, session, base64} from
  'react-native-blob-util'`. They are the same objects as the default export's members.
- `CodedError.code` is the exported `ErrorCode` union, and `FetchError` adds `respInfo`
  for a failed `fetch`. `readFile`, `writeFile`, `appendFile` and `media.read` accept
  an encoding typed as `Encoding` (known only at runtime) and resolve `string | number[]`.
- `android.actionViewIntent` is typed to resolve `void`, as it does at runtime.
- `index.js.flow` is gone; `index.d.ts` is the only declaration file and now matches
  the JavaScript. Names that changed: `RNFetchBlobDf` is `ReactNativeBlobUtilDf`
  (the old name stays as a deprecated alias), `ReactNativeBlobUtilStream` is
  `ReactNativeBlobUtilReadStream` (alias kept), `ReactNativeBlobUtilFile` and `Net`
  are removed (nothing implemented them), and `config()` returns `{fetch}` rather than
  the whole API. `StatefulPromise` gains `stateChange`, `part` and `taskId`;
  `readFile`, `createFile` and `writeFile` are typed per encoding.

### Error codes

Every rejection now carries a `code`. Before, the native methods that reported through a
callback (`exists`, `writeStream`, the write stream's `write` and `close`, `unlink`,
`session.dispose`, `stat`, `lstat`, `cp`, `mv`, `df`, `scanFile`, `cancelRequest`)
either stamped `EUNSPECIFIED` on every failure or gave no code at all, and a `fetch`
error had neither a code nor the response info. Now:

- `stat`, `lstat`, `cp` and `mv` reject with `ENOENT` when the source, or the
  destination's directory, is missing. `writeStream` rejects with `EISDIR` for a
  directory, `ENOENT` when the file cannot be created and `ENOTDIR` when its parent
  cannot. Writing to or closing a stream that was already closed rejects with `EBADF`
  (on Android this used to crash the app). Anything else keeps `EUNSPECIFIED`.
- A failed `fetch` rejects with an `Error` whose `respInfo` holds the response info
  received so far and whose `code` names the failure the same way on every platform:

  | Code | Meaning |
  |---|---|
  | `ETIMEDOUT` | the request timed out (`respInfo.timeout` is also true) |
  | `ENOTFOUND` | the host name could not be resolved |
  | `ECONNREFUSED` | the host refused the connection |
  | `ECONNRESET` | the connection was lost |
  | `ENETUNREACH` | no usable network (Android `wifiOnly` without WiFi; iOS offline) |
  | `ESSL` | the TLS handshake or certificate check failed, including `customCACerts` and `pinnedHosts` rejections |
  | `ECANCELED` | the task was cancelled |
  | `EINVAL` | the URL or method is invalid |
  | `ENOTDIR` | the download directory could not be created |
  | `EUNSPECIFIED` | anything else; the message says what |
- `EACCES` (new): a `content://` provider refused access to the URI (Android).
- `task.cancel(callback)`: the callback is called once native has cancelled, with an
  error argument if that failed. It used to receive `(null, taskId)`.
- Messages are unchanged where they existed, so string matching on messages keeps
  working; switch to `err.code` when you can.

### Behaviour brought in line across platforms

Where the platforms disagreed, 1.0 picks one behaviour:

| Operation | Before | 1.0 |
|---|---|---|
| `fs.unlink` on a missing path | rejected on Android, resolved on iOS | resolves everywhere |
| `session.dispose` with a missing file | resolved on Android, rejected on iOS | resolves everywhere |
| `fs.cp` / `fs.mv` onto an existing file | Android overwrote, iOS and Windows rejected (cp) | overwrite everywhere |
| `fs.writeFile` onto a directory | ENOENT (Android), EISDIR (iOS) | EISDIR |
| `fs.writeStream` onto a directory | EUNSPECIFIED (Android), EISDIR (iOS) | EISDIR |
| `fs.writeFile` with invalid base64 | resolved 0 (Android), EINVAL (iOS) | EINVAL |
| `fs.readFile` on a directory | EISDIR (Android), resolved "" (iOS) | EISDIR |
| `fs.readFile` utf8 of invalid bytes | U+FFFD (Android), null (iOS) | U+FFFD |
| utf8 `readStream` with a character split across chunks | ok (Android), error (iOS) | ok |
| `fs.createFile(path, src, 'uri')` with a missing source | ENOENT (Android), empty file (iOS) | ENOENT |
| `fs.createFile(path, data, 'base64')` with data that is not base64 (a `data:` URL, say) | EINVAL (Android, Windows), an empty file (iOS) | EINVAL (1.1.1) |
| `fs.lstat` / `fs.ls` on a folder that cannot be read (Android) | `lstat` ended the app; `ls` rejected with a NullPointerException's message | rejects `EACCES` (1.1.1) |
| `fs.hash` / `fs.slice` on a missing file | EUNSPECIFIED (Android), ENOENT (iOS) | ENOENT |
| `fs.mkdir` on an existing directory | EEXIST (Android, iOS), resolved (Windows) | EEXIST |
| `fs.ls` on a missing path | ENOENT (Android, iOS), ENOTDIR (Windows) | ENOENT |
| `lstat` `lastModified` on Windows | seconds | milliseconds, like the other platforms |
| `android.getContentIntent` when the user cancels | never settled | resolves `null`; a second call while the picker is open rejects `EBUSY` |
| `android.actionViewIntent` | resolved `true`, then `null` again on resume | settles once; resolves `undefined`, like `open.file` it forwards to |
| A response header sent more than once (`Set-Cookie`, say) on Android | only the last value reached `res.headers` and `res.info().headers` | every value, joined with `, ` as on iOS (1.1.1) |
| `open.chooser` (and `android.actionViewIntent` with a `chooserTitle`) on Android | rejected `EUNSPECIFIED` every time: the chooser was started without `FLAG_ACTIVITY_NEW_TASK` | opens the chooser (1.1.1) |
| `timeout` on Android | bounded connecting and reading only, so an upload whose body the server stopped reading never ended | also bounds each write, as on iOS (1.1.1) |
| `respInfo.respType` on Android | `""` for every text response (a broken header check) | `text`, `json` or `blob` by Content-Type, as on iOS |
| `config({auto: true})` on Android | wrote only a type listed in `binaryContentTypes` to a file (the same broken check) | writes every response that is not `text/*` or `application/json` to a file, as on iOS (1.1.0) |
| `android: {downloadManager}` without `useDownloadManager` and without a `title` or `description` (Android) | ended the app: DownloadManager refused the empty title, on OkHttp's thread | lists the file in the Downloads app under its name; if that fails, a warning, and the request still resolves (1.1.1) |
| An upload on Android whose source cannot be read (a revoked `content://` URI, a missing asset, a read error mid-way) | sent an empty or cut-off body, and either resolved or failed with "unexpected end of stream" | rejects with the source's own error (`EUNSPECIFIED`) |
| `appendExt` containing `/`, `\`, `:` or a control character (GHSA-5xf6-f6v8-jc8c) | appended to the generated cache file name as it was, so `"/../../shared_prefs/x.xml"` wrote the download over any file the app can write | rejects `EINVAL` on every platform; an extension such as `png`, `tar.gz` or `.jpg` is unaffected |
| A header name or value containing CR, LF or NUL | sent as it was: rejected by OkHttp on Android, and on Windows it started a new header on the wire | rejects `EINVAL` before the request starts, on every platform |
| A header value that is not a string (an object, an array, a number, a boolean) | crashed the app on Android ("cannot be cast ... to String"), was dropped on iOS and sent as text on Windows (an object as `""`); `0` and `false` were sent as `""` | rejects `EINVAL` before the request starts, on every platform; `null` and `undefined` are still sent as `""` (1.1.1). Pass `String(value)` for a number |
| A multipart form that is empty, or whose last field has no `name` or `data` | crashed the app on iOS (an out-of-bounds read, in release builds too) | sends the fields it has, as on Android; an empty form sends the closing delimiter alone (1.1.1) |
| A file body or multipart file given as a `file://` URL (`wrap('file:///…')`, `{file: 'file:///…'}`) | iOS multipart failed ("failed to create request body"), Windows sent an empty part, Android kept `%20` in the name | the URL's decoded path, on every platform (1.1.1) |
| `headers` that are not an object (a body passed in their place) | one header per character; a long string threw from `fetch` itself on Hermes | rejects `EINVAL` before the request starts (1.1.1) |
| A multipart `name` or `filename` containing `"`, CR or LF | pasted into the part header unescaped (Android, iOS), so it could rewrite the part's headers | escaped as browsers do: `%22`, `%0D`, `%0A`; a `type` with CR or LF rejects `EINVAL` |
| `pinnedHosts` written with capitals | never matched (hosts are compared as the HTTP stack reports them, in lower case), so the request used system trust | matched case-insensitively |
| `res.text()` / `res.json()` of a `fileCache`/`path` or base64 response | decoded one character per byte, so `é` came back as `Ã©`; `res.base64()` of a text body threw on characters beyond Latin-1 | UTF-8 on every platform, a leading byte order mark dropped (as fetch does), an embedded NUL kept on iOS too |
| `Content-Length` of a single-file upload over 2 GB on Android | capped at 2 GB, so the request declared the wrong length | the file's size |
| `fs.slice` on Windows | wrote the slice into the source file, from an empty buffer | writes the range to the destination |
| `fs.ls` on Windows | listed the parent directory | lists the directory itself |
| `session.dispose` on Windows | failed on every file | removes the files; missing ones are skipped |
| `fs.dirs` on Windows | 7 directories set | every key set (Android-only ones are `""`) |
| Events on iOS | a JSON string each listener had to parse | the object itself, as on Android |
| `ios.excludeFromBackupKey` of a path with `#` or a space | marked a different file, or resolved without marking one | marks the file it was given; EINVAL when no URL can be built |

One difference cannot be aligned from this side. A string a native module
resolves reaches JS through `jsi::String::createFromUtf8(runtime, [value UTF8String])`
(`RCTTurboModule.mm`), which reads a C string, so on iOS it stops at the first NUL
byte: `fs.readFile(path, 'utf8')` of content holding a NUL returns everything up to
it, where Android returns the whole thing. The native layer produces the full string -
what is cut off is cut off above it. `base64` and `ascii` are unaffected, and are how
to read a file that is not text.

Network-level differences stay documented rather than aligned: a URL without a host
(`http://`) is `EINVAL` on Android, which rejects it before connecting, and
`ECONNREFUSED` on iOS, which tries to connect; and only iOS puts `rnfbEncode` on the first
`stateChange`.

### The response

The result of `fetch` gains what a fetch `Response` offers first:

- `res.status`, `res.ok` (status 200..299), `res.headers` (names in lower case) and
  `res.url` (the URL after redirects), next to `res.info()`, which is unchanged. An
  HTTP error status still resolves; with `config({path})` the error body is what was
  written to the file, so check `res.ok` before using it.
- `res.arrayBuffer()`.
- `res.readFile()` and `res.readStream()` reject with `EINVAL`, and `res.session()`
  throws, when the body is not a file. They used to log a warning and return `null`.

### Request bodies

0.25 let each platform guess what a string body was, from its Content-Type and a
prefix, and they guessed differently: without a Content-Type, iOS sent the string as
`application/octet-stream` and base64-decoded it while Android sent it as text, and
Windows never decoded base64 and did not recognise `wrap(path)` at all. 1.0 decides
in JavaScript and every platform sends what it is told.

- A plain string keeps the rule 0.x documented: a `wrap(path)` string is a file; a
  Content-Type ending in `;base64` (removed before sending) or starting with
  `application/octet` makes it base64; anything else is text. **Without a
  Content-Type a string is text on every platform** (iOS decoded it as base64).
- A body sent without a Content-Type gets one, as fetch does for a string: text goes
  out as `text/plain;charset=UTF-8`, base64, bytes and files as `application/octet-stream`.
  The platforms disagreed: Android sent none, Windows `text/plain; charset=UTF-8`, and
  iOS's URLSession adds `application/x-www-form-urlencoded` by itself.
- New explicit forms, never guessed from anything: `{text: string}`,
  `{base64: string}`, `{file: path}` (a path, or a `content://` URI on Android), and
  bytes (`ArrayBuffer` or a typed array). Use `{text}` for a string that comes from a
  user or a server: a plain string that happens to start with the file prefix is
  uploaded as that file's contents.
- A multipart field's `data` may use the same forms. A plain string is text without a
  `filename` and base64 (or a wrapped file) with one, as before; a file part without
  a `filename` is named after the file, as browsers do.
- A body on `GET` or `HEAD` rejects `EINVAL` (it was dropped silently). `DELETE`
  and `OPTIONS` send the body they are given (Android dropped it).
- A file body whose file does not exist rejects `ENOENT`. Android used to create an
  empty file at that path and upload it.

### Always a Promise

`response.text()`, `response.json()` and `response.base64()` returned a value when the
body was held in memory and a Promise when it was a file, so code worked or broke depending
on `config()`. They always return a Promise now; `await` them. `response.flush()` always
returns a Promise (resolved at once when there is no file). `task.cancel()` returns a
Promise that resolves once native has cancelled; the optional callback still works.

### Options and defaults

- The config keys `Progress`, `UploadProgress` and `indicator` are gone. Nothing read
  the first two (use `task.progress({interval, count}, fn)`), and the iOS network
  activity indicator has not existed since iOS 13.
- `task.expire(fn)` is gone. No platform ever emitted the event it listened for.
- `key` is now declared in the config types; it was always honoured. So are `auto` and
  `binaryContentTypes` (1.1.0), honoured on Android and iOS, and the `RNFB-Response`
  request header, which forces the form a body held in memory takes.
- `media.addDownload` takes `notification` (1.1.0), the key the DownloadManager config
  uses for the same thing; `showNotification` still works and warns once.
- `URIUtil.isFileURI` and `URIUtil.unwrapFileURI` recognise the
  `ReactNativeBlobUtil-content://` prefix `wrap()` gives a content URI (1.1.0); they
  only knew the file prefix.
- `fs.readStream` reads 12288 bytes per chunk by default (a multiple of 3, so base64
  chunks concatenate) instead of 10240, and `tick` defaults to 10 ms in both the
  wrapper and the stream.
- Every call that took positional flags also takes one options object; the positional
  forms keep working:
  `fs.readFile(path, {encoding, transform})`, `fs.writeFile(path, data, {encoding, transform})`,
  `fs.appendFile(path, data, {encoding})`, `fs.createFile(path, data, {encoding})`,
  `fs.readStream(path, {encoding, bufferSize, tick})`, `fs.writeStream(path, {encoding, append})`,
  `open.pick({mime})`, `media.read(uri, {encoding})`.
- `mime` is the key for a MIME type everywhere. Media descriptors take `{name, mime,
  parentFolder}`; `mimeType` still works.
- `config` groups the platform-only options and renames the transformer flag:

  | Before | 1.0 |
  |---|---|
  | `transformFile` | `transform` (as in `readFile`/`writeFile`) |
  | `addAndroidDownloads` | `android: {downloadManager}` |
  | `wifiOnly`, `targetHostIp` | `android: {wifiOnly, targetHostIp}` |
  | `IOSBackgroundTask` | `ios: {backgroundTask}` |

  The old keys keep working and warn once each.
- `media.read` rejects an unknown encoding with `EINVAL`, as `fs.readFile` does; it was
  read as utf8.
- A read stream's `open()` returns a Promise that resolves when the stream ends and
  rejects with the error when it fails. An error without `onError` used to be dropped;
  now it rejects that Promise (with `onError` set, the rejection is marked handled).
  The native listener is added by `open()`, so a stream that is never opened no longer
  leaves it behind, and opening a finished stream rejects `EBADF` instead of throwing.
  `fs.readStream('')` rejects `EINVAL` instead of throwing.
- `task.progress({interval: 0}, fn)` reports every chunk; `0` used to become `250`.
- `open.*` on iOS accepts a path that is already a `file://` URL; it was prefixed twice.

## Android

Apps that follow the README don't need to change anything.

### content:// URIs are opened through their provider (security fix)

0.25 turned a `content://` URI into a file path before using it: the provider's
`_data` column, the path inside a Downloads `raw:` id, or an external-storage document
id joined onto a directory. That path was then opened with your app's own rights, so a
URI another app shared with yours could name any file your app can read or delete,
including its private files. `fs.readFile`, `readStream`, `stat` and `unlink` on a
forged Downloads URI read and deleted a file in your app's data directory.

1.0 hands every `content://` URI to `ContentResolver`, and the provider decides:

- `readFile`, `readStream`, `hash`, `cp` (source and destination), `writeStream`,
  `media.write`, `media.copyToMediaStore` and uploads of `wrap(uri)` read or write
  through the provider. A URI the provider refuses rejects with `EACCES`.
- `stat` asks the provider: `filename`, `size` and `lastModified` as it reports them,
  `type: 'file'`, and `path` is the URI itself. **It no longer returns a file path for a
  content URI**; pass the URI to the other calls instead.
- `exists` asks the provider (`isDirectory` is false); `unlink` deletes through it, and
  resolves when there was nothing to delete.
- `ls`, `lstat`, `mv`, `mkdir`, `createFile`, `writeFile` and the destination of
  `slice` only take file paths and reject a content URI with `ENOTSUP`. Copy it to a
  file with `fs.cp(uri, path)` first.
- `com.ReactNativeBlobUtil.Utils.PathResolver` is gone.

### A failed request is not sent again (Android, 1.1.1)

A request that failed after the server may already have received it could go out a
second time without the app knowing, so a POST that changes state (a payment, an
order) was acted on twice (#504). Three paths did it, and all three are closed:

- After any failure, a read timeout from `timeout` included, the library proceeded
  with the request again. It now fails once: a timeout rejects `ETIMEDOUT` as before,
  without a second attempt behind it.
- OkHttp's `retryOnConnectionFailure` was on for every request. It stays on only for
  `GET` and `HEAD`. Other methods lose OkHttp's silent recovery from a failure before
  the request went out (another route, a refused HTTP/2 stream, a pooled connection
  the server had closed); those reject now, and the server never saw the request.
- OkHttp resends after a `503` with `Retry-After: 0`. For methods other than `GET` and
  `HEAD` that header is dropped from the response, so it no longer reaches JS either.

Idle connections stay in the library's pool for 4 seconds instead of 5 minutes, so a
POST no longer goes out on a connection a server that closes idle ones after 5 seconds
(Node's default) has already closed. `respInfo.timeout` on a response is always
`false`; it was only ever `true` after a resend that succeeded.

### TLS and other hardening (Android)

- `trusty: true` keeps hostname verification. It used to install an accept-all
  hostname verifier next to your `sharedTrustManager`, so a trust manager that
  validated a private CA still accepted that CA's certificate for any host name. If your
  test server's certificate does not name the host you connect to, fix the certificate
  (or use `customCACerts`, the supported way to trust a private CA).
- `customCACerts` with `pinnedHosts` is decided per TLS handshake, so a redirect is
  covered: a request that started at an unpinned host and was redirected to a pinned
  one reached the pinned host with the system's trust. `customCACertsApplyTo` is gone
  from `ReactNativeBlobUtilUtils`; `getCustomCACertOkHttpClient` takes the pinned hosts.
- A DownloadManager download no longer leaves its broadcast receiver registered for the
  life of the app, and an unrelated `DOWNLOAD_COMPLETE` broadcast without an id no
  longer crashes it.
- Before Android 10, `media.createFile` / `copyToMediaStore` reject a `name` or
  `parentFolder` containing a `..` segment; the file used to be created wherever the
  joined path pointed.
- Request URLs are no longer written to logcat when a request fails to build.
- `media.*` and the SD-card calls reject with ordinary codes. They used the call's name
  (`ReactNativeBlobUtil.createMediaFile`) or, for `copyToInternal`, the whole message as the
  code: an invalid descriptor or media type is `EINVAL`, a missing source `ENOENT`, a
  provider refusal `EACCES`, anything else `EUNSPECIFIED`. `copyToInternal` also settles
  once; after a failure it used to reject and then resolve `""`.

- `ReactNativeBlobUtilUtils.sharedTrustManager` is still a static field. Java and
  Kotlin code that sets it compiles unchanged.
- `ReactNativeBlobUtilFileTransformer` stays a Java class, so existing
  `FileTransformer` implementations in Java or Kotlin keep compiling, whatever
  nullability a Kotlin implementation declared.
- `ReactNativeBlobUtilPackage` keeps its name and no-argument constructor, for apps
  that register it by hand.
- The library no longer applies `kotlin-android` when the app already provides Kotlin
  (AGP 9 with `android.builtInKotlin=true`).
- The library no longer depends on `commons-lang3`. If your app used it without
  declaring it, add it to your own dependencies.
- `ReactNativeBlobUtilReq.enableTls12OnPreLollipop` returns the builder unchanged.
  It only ever did something on Android 4.1 to 4.4, which `minSdk` 24 excludes.

Classes that were package-private in Java (`ReactNativeBlobUtilFS`,
`ReactNativeBlobUtilImpl`, `ReactNativeBlobUtilConfig`, `ReactNativeBlobUtilBody`) are
now `internal` Kotlin classes. Code outside the library couldn't use them before either.

## iOS

Apps that follow the README don't need to change anything.

- `ReactNativeBlobUtilFileTransformer.h` stays Objective-C. The `FileTransformer`
  protocol and `+setFileTransformer:` are unchanged and work from an Objective-C or a
  Swift `AppDelegate`.
- The pod now contains Swift (`swift_version` 5.0) and defines a module. CocoaPods
  handles this under static libraries, static frameworks and dynamic frameworks alike.
- The only public headers are `ReactNativeBlobUtilFileTransformer.h` and
  `ReactNativeBlobUtilExceptionCatch.h`. The other headers, including
  `ReactNativeBlobUtilConst.h`, are gone: those classes are Swift now. App code that
  imported them has to stop, and apps had no documented reason to.
- The document menus (`open.file`, `open.chooser`, `open.optionsMenu` and the iOS aliases)
  present from the view controller on top, found through the key window's scene
  (1.1.1). With the UIScene life cycle, which React Native 0.88's template uses and
  apps need once they build with the iOS 27 SDK, the first menu crashed the app; over a
  modal screen a menu did nothing.
- `ios/ReactNativeBlobUtil.xcodeproj` is deleted. It no longer matched the sources, so
  linking the library through that project stopped working long ago. Use CocoaPods.

### TLS, cached files and codes (iOS)

- `trusty: true` no longer accepts any certificate for any host. The chain is still not
  validated, but the host name and the validity dates are: a certificate that names another
  host, or has expired, is refused and the request fails with `ESSL`.
- `pinnedHosts` entries match the host case-insensitively; one written with capitals used to
  match nothing and silently fall back to system trust.
- `fileCache` and `key` responses are written to `Library/Application Support/ReactNativeBlobUtil_tmp`
  instead of `Documents/ReactNativeBlobUtil_tmp`, so they are no longer in the iCloud backup or
  visible in the Files app. **A path to a cached file stored before the upgrade no longer
  exists**; download the file again (or move it out of `Documents` yourself).
- `fs.hash` rejects `EUNSPECIFIED` where it rejected `EUNKNOWN` and `EREAD`; the messages are
  unchanged.

## Windows

- `fetch` reports the response: `res.info()` (and so `res.status`, `res.ok`,
  `res.headers`, `res.url`) is filled as on Android and iOS, and the `stateChange`
  event fires. Windows reported nothing, so `status` was undefined.
- Redirects are followed (`followRedirect` defaults to `true`, as elsewhere); Windows
  returned the 3xx response. Each hop gets its own trust decision, so `customCACerts`
  and `pinnedHosts` apply per host, and `Authorization` is dropped on a move to another
  host, as OkHttp does.
- `timeout` is applied, in milliseconds, and a timeout rejects `ETIMEDOUT` with
  `respInfo.timeout` true. It was read as seconds and never used.
- `overwrite: false` appends to an existing file, as on Android and iOS; it was ignored.
- `fetch` accepts every HTTP method. It rejected `PATCH`, `HEAD` and `OPTIONS` with
  `EINVAL` ("Method not supported").
- Request bodies follow the rules under [Request bodies](#request-bodies). Before 1.0
  Windows only read a file for a bare `file://` prefix (so `wrap(path)` was sent as
  text), never decoded base64, and read a file for a multipart field even without a
  `filename`. A text body without a Content-Type is sent without one, like Android; it
  used to get `text/plain; charset=UTF-8`, and so did every multipart text part, which
  now defaults to `text/plain` (`application/octet-stream` with a `filename`).
