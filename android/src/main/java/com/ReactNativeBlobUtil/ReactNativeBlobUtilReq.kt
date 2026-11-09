package com.ReactNativeBlobUtil

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.Cursor
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import com.ReactNativeBlobUtil.Response.ReactNativeBlobUtilDefaultResp
import com.ReactNativeBlobUtil.Response.ReactNativeBlobUtilFileResp
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.Call
import okhttp3.ConnectionPool
import okhttp3.Headers
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.MalformedURLException
import java.net.Proxy
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class ReactNativeBlobUtilReq(
    options: ReadableMap?,
    private val taskId: String?,
    method: String?,
    private val url: String?,
    private val headers: ReadableMap?,
    private val rawRequestBody: String?,
    private val rawRequestBodyArray: ReadableArray?,
    private val client: OkHttpClient,
    private val callback: Callback,
) : BroadcastReceiver(), Runnable {

    internal enum class RequestType {
        Form,
        SingleFile,
        AsIs,
        WithoutBody,
        Others,
    }

    internal enum class ResponseType {
        KeepInMemory,
        FileStorage,
    }

    internal enum class ResponseFormat {
        Auto,
        UTF8,
        BASE64,
    }

    // A null method throws here, as method.toUpperCase(...) did in the Java constructor.
    private val method: String = method!!.uppercase(Locale.ROOT)
    private val options = ReactNativeBlobUtilConfig(options)
    private var destPath: String? = null
    private var customPath: String? = null

    // Never assigned, as in Java: DownloadManager.addCompletedDownload always receives 0.
    private val contentLength: Long = 0
    private var downloadManagerId: Long = 0
    private var requestBody: ReactNativeBlobUtilBody? = null
    private var requestType: RequestType
    private val responseType: ResponseType
    private var responseFormat = ResponseFormat.Auto
    private var respInfo: WritableMap? = null
    // The file-writing body this request creates. An application interceptor outside this
    // request's own can wrap it again, so the response's top-level body is not necessarily it.
    private var fileResponse: ReactNativeBlobUtilFileResp? = null
    private val redirects = ArrayList<String>()
    private var callbackfired = false

    init {
        // If transformFile is specified, we first want to get the response back in memory so we can
        // encrypt it wholesale and at that point, write it into the file storage.
        responseType = if ((this.options.fileCache!! || this.options.path != null) && !shouldTransformFile())
            ResponseType.FileStorage
        else
            ResponseType.KeepInMemory

        requestType = if (rawRequestBody != null)
            RequestType.SingleFile
        else if (rawRequestBodyArray != null)
            RequestType.Form
        else
            RequestType.WithoutBody
    }

    private fun shouldTransformFile(): Boolean =
        options.transformFile!! &&
            // Can only process if it's written to a file
            (options.fileCache!! || options.path != null)

    private fun invokeCallback(vararg args: Any?) {
        if (callbackfired) return
        callback.invoke(*args)
        callbackfired = true
    }

    /**
     * Reports a failed request as {code, message} in the callback's error slot.
     * The codes follow POSIX/Node names so an app can switch on them.
     */
    private fun fail(code: String, message: String?) {
        val error = Arguments.createMap()
        error.putString("code", code)
        error.putString("message", message ?: "")
        invokeCallback(error, null, null)
    }

    /** The code for an exception OkHttp hands to onFailure. */
    private fun codeFor(e: IOException): String = when (e) {
        is SocketTimeoutException -> "ETIMEDOUT"
        // A request body whose source vanished while it was being sent.
        is java.io.FileNotFoundException -> "ENOENT"
        is UnknownHostException -> "ENOTFOUND"
        is java.net.ConnectException -> "ECONNREFUSED"
        is javax.net.ssl.SSLException -> "ESSL"
        is java.net.SocketException -> "ECONNRESET"
        else -> "EUNSPECIFIED"
    }

    private val scheduledExecutorService: ScheduledExecutorService = Executors.newScheduledThreadPool(1)
    private var future: Future<*>? = null

    @Suppress("DEPRECATION")
    private val mHandler = Handler(Handler.Callback { msg ->
        if (msg.what == QUERY) {
            val data = msg.data
            val id = data.getLong("downloadManagerId")
            if (id == downloadManagerId) {

                val appCtx = ReactNativeBlobUtilImpl.RCTContext.applicationContext

                val downloadManager = appCtx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

                val query = DownloadManager.Query()
                query.setFilterById(downloadManagerId)

                val cursor: Cursor? = downloadManager.query(query)

                if (cursor != null && cursor.moveToFirst()) {

                    val written = cursor.getInt(cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)).toLong()

                    val total = cursor.getLong(cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                    cursor.close()

                    val reportConfig = getReportProgress(taskId)
                    val progress = if (total > 0) written.toFloat() / total else 0f

                    if (reportConfig != null && reportConfig.shouldReport(progress /* progress */)) {
                        val args = Arguments.createMap()
                        // String.valueOf in Java: a null task id goes out as "null".
                        args.putString("taskId", taskId.toString())
                        args.putDouble("written", written.toDouble())
                        args.putDouble("total", total.toDouble())
                        args.putString("chunk", "")
                        ReactNativeBlobUtilImpl.RCTContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                            .emit(ReactNativeBlobUtilConst.EVENT_PROGRESS, args)

                    }

                    if (total == written) {
                        future!!.cancel(true)
                    }
                }
            }
        }
        true
    })

    override fun run() {
        val appCtx = ReactNativeBlobUtilImpl.RCTContext.applicationContext
        // appendExt ends up in a path; a separator in it escaped the cache.
        if (!ReactNativeBlobUtilUtils.isSafeExtension(options.appendExt)) {
            fail("EINVAL", "appendExt must be a file extension, without path separators")
            releaseTaskResource()
            return
        }
        // use download manager instead of default HTTP implementation
        val downloads = options.addAndroidDownloads
        if (downloads != null && downloads.hasKey("useDownloadManager")) {

            if (downloads.getBoolean("useDownloadManager")) {
                val uri = Uri.parse(url!!)
                val req = DownloadManager.Request(uri)
                if (downloads.hasKey("notification") && downloads.getBoolean("notification")) {
                    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                } else {
                    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_HIDDEN)
                }
                if (downloads.hasKey("title")) {
                    req.setTitle(downloads.getString("title"))
                }
                if (downloads.hasKey("description")) {
                    req.setDescription(downloads.getString("description"))
                }
                if (downloads.hasKey("path")) {
                    val path = downloads.getString("path")
                    val f = File(path)
                    val dir = f.parentFile

                    if (!f.exists()) {
                        if (dir != null && !dir.exists()) {
                            if (!dir.mkdirs() && !dir.exists()) {
                                fail("ENOTDIR", "Failed to create parent directory of '$path'")
                                return
                            }
                        }
                    }
                    req.setDestinationUri(Uri.parse("file://$path"))

                    customPath = path
                }


                if (downloads.hasKey("storeLocal") && downloads.getBoolean("storeLocal")) {
                    val downloadDir = ReactNativeBlobUtilFS.getSystemfolders(ReactNativeBlobUtilImpl.RCTContext)["DownloadDir"] as String?
                    val path = downloadDir + UUID.randomUUID().toString()

                    val f = File(path)
                    val dir = f.parentFile
                    if (!f.exists()) {
                        if (dir != null && !dir.exists()) {
                            if (!dir.mkdirs() && !dir.exists()) {
                                fail("ENOTDIR", "Failed to create parent directory of '$path'")
                                return
                            }
                        }
                    }
                    req.setDestinationUri(Uri.parse("file://$path"))
                    customPath = path
                }

                if (downloads.hasKey("mime")) {
                    req.setMimeType(downloads.getString("mime"))
                }

                if (downloads.hasKey("mediaScannable") && downloads.getBoolean("mediaScannable")) {
                    @Suppress("DEPRECATION")
                    req.allowScanningByMediaScanner()
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && downloads.hasKey("storeInDownloads") && downloads.getBoolean("storeInDownloads")) {
                    val title = downloads.getString("title")
                    var t = if (title == null || title.isEmpty()) UUID.randomUUID().toString() else title
                    val appendExt = options.appendExt
                    if (appendExt != null && !appendExt.isEmpty())
                        t += ".$appendExt"

                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, t)
                }

                // set headers
                val headerKeys = headers!!.keySetIterator()
                while (headerKeys.hasNextKey()) {
                    val key = headerKeys.nextKey()
                    req.addRequestHeader(key, headers.getString(key))
                }

                // Attempt to add cookie, if it exists
                try {
                    val urlObj = URL(url)
                    val baseUrl = urlObj.protocol + "://" + urlObj.host
                    val cookie = CookieManager.getInstance().getCookie(baseUrl)
                    req.addRequestHeader("Cookie", cookie)
                } catch (e: MalformedURLException) {
                    e.printStackTrace()
                }

                val dm = appCtx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                downloadManagerId = dm.enqueue(req)
                androidDownloadManagerTaskTable[taskId] = downloadManagerId
                if (Build.VERSION.SDK_INT >= 34) {
                    appCtx.registerReceiver(this, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_EXPORTED)
                } else {
                    appCtx.registerReceiver(this, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
                }
                future = scheduledExecutorService.scheduleAtFixedRate(Runnable {
                    val msg = mHandler.obtainMessage()
                    val data = Bundle()
                    data.putLong("downloadManagerId", downloadManagerId)
                    msg.data = data
                    msg.what = QUERY
                    mHandler.sendMessage(msg)
                }, 0, 100, TimeUnit.MILLISECONDS)
                return
            }

        }

        // find cached result if `key` property exists
        var cacheKey = taskId
        val appendExt = options.appendExt
        val ext = if (appendExt == null || appendExt.isEmpty()) "" else ".$appendExt"

        if (options.key != null) {
            cacheKey = ReactNativeBlobUtilUtils.getMD5(options.key)
            if (cacheKey == null) {
                cacheKey = taskId
            }

            val file = File(ReactNativeBlobUtilFS.getTmpPath(cacheKey) + ext)

            if (file.exists()) {
                invokeCallback(null, ReactNativeBlobUtilConst.RNFB_RESPONSE_PATH, file.absolutePath)
                return
            }
        }

        if (options.path != null)
            destPath = options.path
        else if (options.fileCache!!)
            destPath = ReactNativeBlobUtilFS.getTmpPath(cacheKey) + ext


        try {
            // use trusty SSL socket
            val clientBuilder = if (options.trusty!!) {
                ReactNativeBlobUtilUtils.getUnsafeOkHttpClient(client)
            } else if (!options.customCACerts.isNullOrEmpty()) {
                ReactNativeBlobUtilUtils.getCustomCACertOkHttpClient(
                    client,
                    ReactNativeBlobUtilImpl.RCTContext,
                    options.customCACerts!!,
                    options.trustSystemCerts!!,
                    // Scoped per handshake, so a redirect to a pinned host is checked too.
                    options.pinnedHosts,
                )
            } else {
                client.newBuilder()
            }

            // wifi only, need ACCESS_NETWORK_STATE permission
            // and API level >= 21
            val targetHostIp = options.targetHostIp
            val targetHostIpAvailable = targetHostIp != null && !targetHostIp.isEmpty()

            if (options.wifiOnly!!) {
                var found = false

                // convert targetHostIp from String into InetAddress
                var targetHostAddr: InetAddress? = null
                if (targetHostIpAvailable) {
                    targetHostAddr = try {
                        InetAddress.getByName(targetHostIp)
                    } catch (e: UnknownHostException) {
                        null // skip
                    }
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    val connectivityManager = ReactNativeBlobUtilImpl.RCTContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                    @Suppress("DEPRECATION")
                    val networks = connectivityManager.allNetworks

                    for (network in networks) {

                        if (!isValidWifiNetwork(connectivityManager, network)) {
                            continue
                        }

                        // if targetHostIpAvailable does not match, fallback to any wifi
                        if (targetHostIpAvailable) {
                            if (networkMatchesTargetIp(connectivityManager, network, targetHostIp, targetHostAddr)) {
                                clientBuilder.proxy(Proxy.NO_PROXY)
                                clientBuilder.socketFactory(network.socketFactory)
                                found = true
                                break
                            }
                        }

                        // wifiOnly. selects the first interface with wifi transport
                        // if targetHostIp is available and it matches, this selection will be overriden
                        if (!found) {
                            clientBuilder.proxy(Proxy.NO_PROXY)
                            clientBuilder.socketFactory(network.socketFactory)
                            found = true

                            if (!targetHostIpAvailable) {
                                break
                            }
                        }
                    }

                    if (!found) {
                        fail("ENETUNREACH", "No available WiFi connections.")
                        releaseTaskResource()
                        return
                    }


                } else {
                    ReactNativeBlobUtilUtils.emitWarningEvent("ReactNativeBlobUtil: wifiOnly or targetHostIp was set, but SDK < 21. wifiOnly was ignored.")
                }
            }

            val builder = Request.Builder()
            try {
                builder.url(URL(url))
            } catch (e: MalformedURLException) {
                // Not logged: the URL can carry tokens, and logcat is not the place.
                // Request.Builder rejects it below and the request fails EINVAL.
            }

            val mheaders = HashMap<String, String?>()
            // set headers
            if (headers != null) {
                val headerKeys = headers.keySetIterator()
                while (headerKeys.hasNextKey()) {
                    val key = headerKeys.nextKey()
                    val value = headers.getString(key)
                    if (key.equals("RNFB-Response", ignoreCase = true)) {
                        if (value!!.equals("base64", ignoreCase = true))
                            responseFormat = ResponseFormat.BASE64
                        else if (value.equals("utf8", ignoreCase = true))
                            responseFormat = ResponseFormat.UTF8
                    } else {
                        // A null value fails here and the request is rejected, as in Java; only
                        // the message differs, since OkHttp's own null check no longer runs first.
                        builder.header(key.lowercase(Locale.ROOT), value!!)
                        mheaders[key.lowercase(Locale.ROOT)] = value
                    }
                }
            }

            // Any method but GET and HEAD sends a body it is given (DELETE and OPTIONS
            // used to drop theirs); POST, PUT and PATCH send an empty one without.
            val sendsBody = !method.equals("get", ignoreCase = true) && !method.equals("head", ignoreCase = true) &&
                (rawRequestBody != null || rawRequestBodyArray != null ||
                    method.equals("post", ignoreCase = true) || method.equals("put", ignoreCase = true) || method.equals("patch", ignoreCase = true))
            val bodyType = options.bodyType
            if (sendsBody && rawRequestBodyArray == null && rawRequestBody != null && bodyType != null) {
                // JS decided what the body is; nothing is inferred from Content-Type or a prefix.
                requestType = if (bodyType == "text") RequestType.AsIs else RequestType.SingleFile
            } else if (sendsBody) {
                var cType = getHeaderIgnoreCases(mheaders, "Content-Type").lowercase(Locale.ROOT)

                if (rawRequestBodyArray != null) {
                    requestType = RequestType.Form
                } else if (cType.isEmpty()) {
                    // The Java version set Content-Type: application/octet-stream here only
                    // when cType was not empty, which in this branch it always is.
                    requestType = RequestType.SingleFile
                }
                if (rawRequestBody != null) {
                    if (rawRequestBody.startsWith(ReactNativeBlobUtilConst.FILE_PREFIX) ||
                        rawRequestBody.startsWith(ReactNativeBlobUtilConst.CONTENT_PREFIX)
                    ) {
                        requestType = RequestType.SingleFile
                    } else if (cType.lowercase(Locale.ROOT).contains(";base64") || cType.lowercase(Locale.ROOT).startsWith("application/octet")) {
                        cType = cType.replace(";base64", "").replace(";BASE64", "")
                        if (mheaders.containsKey("content-type"))
                            mheaders["content-type"] = cType
                        if (mheaders.containsKey("Content-Type"))
                            mheaders["Content-Type"] = cType
                        requestType = RequestType.SingleFile
                    } else {
                        requestType = RequestType.AsIs
                    }
                }
            } else {
                requestType = RequestType.WithoutBody
            }

            // A file body that is not there fails the request. It used to be created
            // empty and uploaded, so the server got a zero-byte file.
            if (requestType == RequestType.SingleFile && rawRequestBody != null && rawRequestBody.startsWith(ReactNativeBlobUtilConst.FILE_PREFIX)) {
                val filePath = rawRequestBody.substring(ReactNativeBlobUtilConst.FILE_PREFIX.length)
                val normalized = ReactNativeBlobUtilUtils.normalizePath(filePath)
                if (!ReactNativeBlobUtilContent.isContent(filePath) && !ReactNativeBlobUtilUtils.isAsset(normalized) &&
                    (normalized == null || !File(normalized).isFile)
                ) {
                    fail("ENOENT", "No such file '$filePath'")
                    releaseTaskResource()
                    return
                }
            }

            val isChunkedRequest = getHeaderIgnoreCases(mheaders, "Transfer-Encoding").equals("chunked", ignoreCase = true)

            // set request body
            when (requestType) {
                RequestType.SingleFile, RequestType.AsIs -> {
                    val body = ReactNativeBlobUtilBody(taskId)
                        .chunkedEncoding(isChunkedRequest)
                        .setRequestType(requestType)
                        .setBody(rawRequestBody)
                        .setMIME(getHeaderIgnoreCases(mheaders, "content-type").toMediaTypeOrNull())
                    requestBody = body
                    builder.method(method, body)
                }
                RequestType.Form -> {
                    val boundary = "ReactNativeBlobUtil-$taskId"
                    val body = ReactNativeBlobUtilBody(taskId)
                        .chunkedEncoding(isChunkedRequest)
                        .setRequestType(requestType)
                        .setBody(rawRequestBodyArray)
                        .setMIME("multipart/form-data; boundary=$boundary".toMediaTypeOrNull())
                    requestBody = body
                    builder.method(method, body)
                }

                RequestType.WithoutBody -> {
                    if (method.equals("post", ignoreCase = true) || method.equals("put", ignoreCase = true) || method.equals("patch", ignoreCase = true)) {
                        builder.method(method, ByteArray(0).toRequestBody(null))
                    } else {
                        builder.method(method, null)
                    }
                }

                RequestType.Others -> {}
            }

            // #156 fix cookie issue
            val req = builder.build()
            clientBuilder.addNetworkInterceptor(Interceptor { chain ->
                redirects.add(chain.request().url.toString())
                withoutRetryAfter(chain.proceed(chain.request()))
            })
            // Add request interceptor for upload progress event
            clientBuilder.addInterceptor(Interceptor { chain -> wrapResponseBody(chain, req) })


            applyTimeouts(clientBuilder, options.timeout, responseType == ResponseType.FileStorage)

            clientBuilder.connectionPool(pool)
            clientBuilder.followRedirects(options.followRedirect!!)
            clientBuilder.followSslRedirects(options.followRedirect!!)
            clientBuilder.retryOnConnectionFailure(mayResend(method))

            val httpClient = enableTls12OnPreLollipop(clientBuilder).build()

            val call = httpClient.newCall(req)
            taskTable[taskId] = call
            call.enqueue(object : okhttp3.Callback {

                override fun onFailure(call: Call, e: IOException) {
                    cancelTask(taskId)
                    if (respInfo == null) {
                        respInfo = Arguments.createMap()
                    }

                    // check if this error caused by socket timeout
                    if (e.javaClass == SocketTimeoutException::class.java) {
                        respInfo!!.putBoolean("timeout", true)
                        fail("ETIMEDOUT", "The request timed out.")
                    } else {
                        fail(codeFor(e), e.localizedMessage)
                    }
                    releaseTaskResource()
                }

                @Throws(IOException::class)
                override fun onResponse(call: Call, response: Response) {
                    val notifyConfig = options.addAndroidDownloads
                    // Download manager settings
                    if (notifyConfig != null) {
                        var title: String? = ""
                        var desc: String? = ""
                        var mime: String? = "text/plain"
                        var scannable = false
                        var notification = false
                        if (notifyConfig.hasKey("title"))
                            title = notifyConfig.getString("title")
                        if (notifyConfig.hasKey("description"))
                            desc = notifyConfig.getString("description")
                        if (notifyConfig.hasKey("mime"))
                            mime = notifyConfig.getString("mime")
                        if (notifyConfig.hasKey("mediaScannable"))
                            scannable = notifyConfig.getBoolean("mediaScannable")
                        if (notifyConfig.hasKey("notification"))
                            notification = notifyConfig.getBoolean("notification")
                        val dm = ReactNativeBlobUtilImpl.RCTContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                        @Suppress("DEPRECATION")
                        dm.addCompletedDownload(title, desc, scannable, mime, destPath, contentLength, notification)
                    }

                    done(response)
                }
            })


        } catch (error: Exception) {
            releaseTaskResource()
            // OkHttp's Request.Builder rejects a malformed URL or method with
            // IllegalArgumentException; everything else is unexpected.
            fail(if (error is IllegalArgumentException) "EINVAL" else "EUNSPECIFIED", "ReactNativeBlobUtil request error: " + error.message + error.cause)
        }
    }

    /**
     * The application interceptor: swaps the response body for one that reports progress
     * and, for file storage, writes to disk.
     */
    @Throws(IOException::class)
    private fun wrapResponseBody(chain: Interceptor.Chain, req: Request): Response =
        proceedOnce(chain, req) { response ->
            val extended: ResponseBody = when (responseType) {
                ResponseType.KeepInMemory -> ReactNativeBlobUtilDefaultResp(
                    ReactNativeBlobUtilImpl.RCTContext,
                    taskId,
                    response.body!!,
                    options.increment!!,
                )
                ResponseType.FileStorage -> ReactNativeBlobUtilFileResp(
                    ReactNativeBlobUtilImpl.RCTContext,
                    taskId,
                    response.body!!,
                    destPath,
                    options.overwrite!!,
                ).also { fileResponse = it }
            }
            response.newBuilder().body(extended).build()
        }

    /**
     * Remove cached information of the HTTP task
     */
    private fun releaseTaskResource() {
        if (taskTable.containsKey(taskId))
            taskTable.remove(taskId)
        if (androidDownloadManagerTaskTable.containsKey(taskId))
            androidDownloadManagerTaskTable.remove(taskId)
        if (uploadProgressReport.containsKey(taskId))
            uploadProgressReport.remove(taskId)
        if (progressReport.containsKey(taskId))
            progressReport.remove(taskId)
        requestBody?.clearRequestBody()
    }

    /**
     * Send response data back to javascript context.
     *
     * @param resp OkHttp response object
     */
    private fun done(resp: Response) {
        val isBlobResp = isBlobResponse(resp)
        val respmap = getResponseInfo(resp, isBlobResp)
        emitStateEvent(respmap.copy())

        emitStateEvent(getResponseInfo(resp, isBlobResp))
        when (responseType) {
            ResponseType.KeepInMemory -> {
                try {
                    // For XMLHttpRequest, automatic response data storing strategy, when response
                    // data is considered as binary data, write it to file system
                    if (isBlobResp && options.auto!!) {
                        val dest = ReactNativeBlobUtilFS.getTmpPath(taskId)
                        val ins = resp.body!!.byteStream()
                        val os = FileOutputStream(File(dest))
                        var read: Int
                        val buffer = ByteArray(10240)
                        while (ins.read(buffer).also { read = it } != -1) {
                            os.write(buffer, 0, read)
                        }
                        ins.close()
                        os.flush()
                        os.close()
                        invokeCallback(null, ReactNativeBlobUtilConst.RNFB_RESPONSE_PATH, dest, respmap.copy())
                    }
                    // response data directly pass to JS context as string.
                    else {
                        val b = resp.body!!.bytes()
                        // If process file option is turned on, we first keep response in memory and then stream that content
                        // after processing
                        if (shouldTransformFile()) {
                            val transformer = ReactNativeBlobUtilFileTransformer.sharedFileTransformer
                                ?: throw IllegalStateException("Write file with transform was specified but the shared file transformer is not set")
                            destPath = destPath!!.replace("?append=true", "")
                            val file = File(destPath)
                            if (!file.exists()) {
                                file.createNewFile()
                            }
                            try {
                                FileOutputStream(file).use { fos -> fos.write(transformer.onWriteFile(b)) }
                            } catch (e: Exception) {
                                invokeCallback("Error from file transformer:" + e.localizedMessage, respmap.copy())
                                return
                            }
                            invokeCallback(null, ReactNativeBlobUtilConst.RNFB_RESPONSE_PATH, destPath, respmap.copy())
                            return
                        }
                        if (responseFormat == ResponseFormat.BASE64) {
                            invokeCallback(null, ReactNativeBlobUtilConst.RNFB_RESPONSE_BASE64, Base64.encodeToString(b, Base64.NO_WRAP), respmap.copy())
                            return
                        }
                        try {
                            // Attempt to decode the incoming response data to determine whether it contains a valid UTF8 string
                            val charSet = Charset.forName("UTF-8")
                            val decoder = charSet.newDecoder()
                            decoder.decode(ByteBuffer.wrap(b))
                            // If the data contains invalid characters the following lines will be skipped.
                            val utf8 = String(b, charSet)
                            invokeCallback(null, ReactNativeBlobUtilConst.RNFB_RESPONSE_UTF8, utf8)
                        }
                        // This usually means the data contains invalid unicode characters but still valid data,
                        // it's binary data, so send it as a normal string
                        catch (ignored: CharacterCodingException) {
                            if (responseFormat == ResponseFormat.UTF8) {
                                // The platform charset, as new String(b) used in Java.
                                val utf8 = String(b, Charset.defaultCharset())
                                invokeCallback(null, ReactNativeBlobUtilConst.RNFB_RESPONSE_UTF8, utf8, respmap.copy())
                            } else {
                                invokeCallback(null, ReactNativeBlobUtilConst.RNFB_RESPONSE_BASE64, Base64.encodeToString(b, Base64.NO_WRAP), respmap.copy())
                            }
                        }
                    }
                } catch (e: IOException) {
                    invokeCallback("ReactNativeBlobUtil failed to encode response data to BASE64 string.", respmap.copy())
                }
            }
            ResponseType.FileStorage -> {
                val responseBody = resp.body

                // Drain via byteStream() — avoids OkHttp's bytes() check that rejects
                // content-length > Integer.MAX_VALUE (2 GB). ProgressReportingSource.read()
                // writes each chunk to disk as a side-effect. Closing the stream flushes
                // and closes the FileOutputStream that holds the destination file.
                try {
                    val drainStream = responseBody!!.byteStream()
                    try {
                        val drainBuf = ByteArray(65536)
                        @Suppress("ControlFlowWithEmptyBody")
                        while (drainStream.read(drainBuf) != -1) {
                        }
                    } finally {
                        try {
                            drainStream.close()
                        } catch (ignored2: Exception) {
                        }
                    }
                } catch (ignored: Exception) {
                    //                    ignored.printStackTrace();
                }

                val fileResp = try {
                    fileResponse ?: (responseBody as ReactNativeBlobUtilFileResp?)
                } catch (ex: ClassCastException) {
                    // unexpected response type
                    if (responseBody != null) {
                        var responseBodyString: String? = null
                        try {
                            val isBufferDataExists = responseBody.source().buffer.size > 0
                            val isContentExists = responseBody.contentLength() > 0
                            if (isBufferDataExists && isContentExists) {
                                responseBodyString = responseBody.string()
                            }
                        } catch (exception: IOException) {
                            exception.printStackTrace()
                        }
                        invokeCallback("Unexpected FileStorage response file: $responseBodyString", respmap.copy())
                    } else {
                        invokeCallback("Unexpected FileStorage response with no file.", respmap.copy())
                    }
                    return
                }

                if (fileResp != null && !fileResp.isDownloadComplete()) {
                    invokeCallback("Download interrupted.", respmap.copy())
                } else {
                    destPath = destPath!!.replace("?append=true", "")
                    invokeCallback(null, ReactNativeBlobUtilConst.RNFB_RESPONSE_PATH, destPath, respmap.copy())
                }
            }
        }
        //        if(!resp.isSuccessful())
        resp.body!!.close()
        releaseTaskResource()
    }

    /**
     * Create response information object, contains status code, headers, etc.
     *
     * @param resp       Response object
     * @param isBlobResp If the response is binary data
     * @return Get RCT bridge object contains response information.
     */
    private fun getResponseInfo(resp: Response, isBlobResp: Boolean): WritableMap {
        val info = Arguments.createMap()
        info.putInt("status", resp.code)
        info.putString("state", "2")
        info.putString("taskId", taskId)
        // A request that times out fails with ETIMEDOUT and never gets here.
        info.putBoolean("timeout", false)
        val headerMap = Arguments.createMap()
        for ((name, value) in headerFields(resp.headers)) {
            headerMap.putString(name, value)
        }
        val redirectList = Arguments.createArray()
        for (r in redirects) {
            redirectList.pushString(r)
        }
        info.putArray("redirects", redirectList)
        info.putMap("headers", headerMap)
        val h = resp.headers
        // The same rules as iOS: text/* is "text", application/json is "json",
        // anything else with a Content-Type is "blob", and no Content-Type is
        // "text". The old check compared the whole header against "text/", so
        // every text response came out as "".
        val contentType = getHeaderIgnoreCases(h, "content-type").lowercase(Locale.ROOT)
        val respType = when {
            isBlobResp -> "blob"
            contentType.isEmpty() -> "text"
            contentType.contains("text/") -> "text"
            contentType.contains("application/json") -> "json"
            else -> "blob"
        }
        info.putString("respType", respType)
        return info
    }

    /**
     * Check if response data is binary data.
     *
     * @param resp OkHttp response.
     * @return If the response data contains binary bytes
     */
    private fun isBlobResponse(resp: Response): Boolean =
        isBinaryContentType(getHeaderIgnoreCases(resp.headers, "Content-Type"), options.binaryContentTypes)

    private fun getHeaderIgnoreCases(headers: Headers, field: String): String {
        val value = headers[field]
        if (value != null) return value
        return headers[field.lowercase(Locale.ROOT)] ?: ""
    }

    private fun getHeaderIgnoreCases(headers: HashMap<String, String?>, field: String): String {
        val value = headers[field]
        if (value != null) return value
        val lowerCasedValue = headers[field.lowercase(Locale.ROOT)]
        return lowerCasedValue ?: ""
    }

    private fun emitStateEvent(args: WritableMap) {
        ReactNativeBlobUtilImpl.RCTContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(ReactNativeBlobUtilConst.EVENT_HTTP_STATE, args)
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (DownloadManager.ACTION_DOWNLOAD_COMPLETE == action) {
            val appCtx = ReactNativeBlobUtilImpl.RCTContext.applicationContext
            // An intent without the id is not ours; it used to crash on extras!!.
            val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            if (id == downloadManagerId) {
                releaseTaskResource() // remove task ID from task map
                // One receiver per download; it was never unregistered and every finished
                // download left one behind for the life of the app.
                try {
                    appCtx.unregisterReceiver(this)
                } catch (e: IllegalArgumentException) {
                    // not registered any more
                }

                val query = DownloadManager.Query()
                query.setFilterById(downloadManagerId)
                val dm = appCtx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                dm.query(query)
                val c: Cursor? = dm.query(query)
                if (c == null) {
                    invokeCallback("Download manager failed to download from  $url. Query was unsuccessful ", null, null)
                    return
                }

                var filePath: String? = null
                try {
                    // the file exists in media content database
                    if (c.moveToFirst()) {
                        val statusCode = c.getInt(c.getColumnIndex(DownloadManager.COLUMN_STATUS))
                        if (statusCode == DownloadManager.STATUS_FAILED) {
                            invokeCallback("Download manager failed to download from  $url. Status Code = $statusCode", null, null)
                            return
                        }
                        val contentUri = c.getString(c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI))
                        if (contentUri != null) {
                            val uri = Uri.parse(contentUri)
                            @Suppress("DEPRECATION")
                            val cursor = appCtx.contentResolver.query(uri, arrayOf(MediaStore.Files.FileColumns.DATA), null, null, null)
                            // use default destination of DownloadManager
                            if (cursor != null) {
                                cursor.moveToFirst()
                                filePath = cursor.getString(0)
                                cursor.close()
                            }
                        }
                    }
                } finally {
                    c.close()
                }

                // When the file is not found in media content database, check if custom path exists
                val downloads = options.addAndroidDownloads!!
                if (downloads.hasKey("path") || downloads.hasKey("storeLocal")) {
                    try {
                        val customDest = customPath
                        val exists = File(customDest).exists()
                        if (!exists)
                            throw Exception("Download manager download failed, the file does not downloaded to destination.")
                        else
                            invokeCallback(null, ReactNativeBlobUtilConst.RNFB_RESPONSE_PATH, customDest)

                    } catch (ex: Exception) {
                        ex.printStackTrace()
                        invokeCallback(ex.localizedMessage, null)
                    }
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && downloads.hasKey("storeInDownloads") && downloads.getBoolean("storeInDownloads")) {
                    val downloadeduri = dm.getUriForDownloadedFile(downloadManagerId)
                    if (downloadeduri == null)
                        invokeCallback("Download manager could not resolve downloaded file uri.", ReactNativeBlobUtilConst.RNFB_RESPONSE_PATH, null)
                    else
                        invokeCallback(null, ReactNativeBlobUtilConst.RNFB_RESPONSE_PATH, downloadeduri.toString())
                } else {
                    if (filePath == null)
                        invokeCallback("Download manager could not resolve downloaded file path.", ReactNativeBlobUtilConst.RNFB_RESPONSE_PATH, null)
                    else
                        invokeCallback(null, ReactNativeBlobUtilConst.RNFB_RESPONSE_PATH, filePath)
                }

            }
        }
    }

    /**
     * Check if a network is a valid connected WiFi network
     */
    @Suppress("DEPRECATION")
    private fun isValidWifiNetwork(cm: ConnectivityManager, network: Network): Boolean {
        val netInfo = cm.getNetworkInfo(network)
        val caps = cm.getNetworkCapabilities(network)

        if (caps == null || netInfo == null) {
            return false
        }

        if (!netInfo.isConnected) {
            return false
        }

        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    /**
     * Check if a network matches the target host IP address
     */
    private fun networkMatchesTargetIp(cm: ConnectivityManager, network: Network, targetHostIp: String?, targetHostAddr: InetAddress?): Boolean {
        val lp = cm.getLinkProperties(network) ?: return false

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // For Android 11 and above, use DHCP server address
            val dhcpServer = lp.dhcpServerAddress
            if (dhcpServer != null && dhcpServer.hostAddress == targetHostIp) {
                return true
            }
        }

        // For older versions or Android 11+ if DHCP does not match, check routing table
        if (targetHostAddr != null) {
            for (route in lp.routes) {
                if (route.isDefaultRoute) {
                    continue
                }
                if (route.matches(targetHostAddr)) {
                    return true
                }
            }
        }

        return false
    }

    companion object {

        private const val QUERY = 1314

        @JvmField
        val taskTable = HashMap<String?, Call>()

        @JvmField
        val androidDownloadManagerTaskTable = HashMap<String?, Long>()

        internal val progressReport = HashMap<String?, ReactNativeBlobUtilProgressConfig>()

        internal val uploadProgressReport = HashMap<String?, ReactNativeBlobUtilProgressConfig>()

        internal val pool = newConnectionPool()

        @JvmStatic
        fun cancelTask(taskId: String?) {
            val call = taskTable[taskId]
            if (call != null) {
                call.cancel()
                taskTable.remove(taskId)
            }

            if (androidDownloadManagerTaskTable.containsKey(taskId)) {
                val downloadManagerIdForTaskId = androidDownloadManagerTaskTable[taskId]!!
                val appCtx = ReactNativeBlobUtilImpl.RCTContext.applicationContext
                val dm = appCtx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                dm.remove(downloadManagerIdForTaskId)
            }
        }

        /**
         * Invoke this method to enable download progress reporting.
         *
         * @param taskId Task ID of the HTTP task.
         * @return Task ID of the target task
         */
        @JvmStatic
        fun getReportProgress(taskId: String?): ReactNativeBlobUtilProgressConfig? {
            if (!progressReport.containsKey(taskId)) return null
            return progressReport[taskId]
        }

        /**
         * Invoke this method to enable download progress reporting.
         *
         * @param taskId Task ID of the HTTP task.
         * @return Task ID of the target task
         */
        @JvmStatic
        fun getReportUploadProgress(taskId: String?): ReactNativeBlobUtilProgressConfig? {
            if (!uploadProgressReport.containsKey(taskId)) return null
            return uploadProgressReport[taskId]
        }

        /**
         * Whether a response counts as binary: respType reports it as "blob" and `auto`
         * writes it to a file. A Content-Type listed in binaryContentTypes is binary, and
         * so is any other than a text type (text/...) and application/json; no Content-Type is text. The
         * same rule as iOS. The old check compared the whole header with "text/" and
         * "application/json" using equals, so only a listed type ever counted as binary
         * and `auto` did nothing without binaryContentTypes.
         */
        @JvmStatic
        internal fun isBinaryContentType(contentType: String, binaryContentTypes: ReadableArray?): Boolean {
            val ctype = contentType.lowercase(Locale.ROOT)
            if (binaryContentTypes != null) {
                for (i in 0 until binaryContentTypes.size()) {
                    val listed = binaryContentTypes.getString(i)
                    if (listed != null && ctype.contains(listed.lowercase(Locale.ROOT))) {
                        return true
                    }
                }
            }
            return ctype.isNotEmpty() && !ctype.contains("text/") && !ctype.contains("application/json")
        }

        /**
         * The pool every request shares. It keeps an idle connection for 4s instead of
         * OkHttp's default 5 minutes. OkHttp checks that a pooled connection is still
         * open before a request other than GET only once it has been idle for 10s, and
         * [mayResend] no longer lets it send such a request again on a new connection.
         * A server that closes idle connections after 5s, as Node's http server and
         * uvicorn do by default, would otherwise get a POST sent 5 to 10s after the
         * previous request on a connection it had already closed, and the call would
         * fail with "unexpected end of stream" although the server never saw it (#504).
         */
        @JvmStatic
        internal fun newConnectionPool(): ConnectionPool = ConnectionPool(5, 4, TimeUnit.SECONDS)

        /**
         * Applies the `timeout` option, in milliseconds; a negative one leaves the
         * base client's timeouts. It bounds connecting and each write, so an upload
         * whose body the server stops reading fails with ETIMEDOUT. The write timeout
         * used to be left alone, and React Native's base client has none, so such an
         * upload hung for good (#384). It bounds each read too, except for a download
         * to a file: the 60-second default fired on slow connections before a large
         * file finished, so a file download has no read timeout and cancel() ends one
         * that stalls.
         */
        @JvmStatic
        internal fun applyTimeouts(builder: OkHttpClient.Builder, timeout: Long, toFile: Boolean): OkHttpClient.Builder {
            if (timeout >= 0) {
                builder.connectTimeout(timeout, TimeUnit.MILLISECONDS)
                builder.writeTimeout(timeout, TimeUnit.MILLISECONDS)
            }
            if (toFile) {
                builder.readTimeout(0, TimeUnit.MILLISECONDS)
            } else if (timeout >= 0) {
                builder.readTimeout(timeout, TimeUnit.MILLISECONDS)
            }
            return builder
        }

        /**
         * The response headers as JS gets them: one entry per name, with a repeated
         * field's values joined by ", ", as iOS's allHeaderFields and fetch's
         * Headers.get do. Each repetition used to replace the one before, so of two
         * Set-Cookie headers only the last reached JS (#377).
         */
        @JvmStatic
        internal fun headerFields(headers: Headers): Map<String, String> =
            headers.names().associateWith { headers.values(it).joinToString(", ") }

        /**
         * Whether OkHttp may send a request again after a connection failure, when the
         * server may already have received it. Only GET and HEAD: OkHttp resends after a
         * reset or "unexpected end of stream" on a pooled connection even once the body
         * was sent, and a POST the server acted on would be acted on twice (#504). Other
         * methods also lose OkHttp's recovery from failures before the request went out
         * (next route, refused HTTP/2 stream, stale pooled socket); those now fail, and
         * the server never saw the request.
         */
        @JvmStatic
        internal fun mayResend(method: String): Boolean =
            method.equals("GET", ignoreCase = true) || method.equals("HEAD", ignoreCase = true)

        /**
         * Proceeds with [request] once and passes the response to [wrap]. A failure is
         * rethrown for OkHttp to report through onFailure. The interceptor used to catch
         * it, a read timeout included, and proceed again, so the request went out a
         * second time after the JS side had already seen it fail (#504). Anything other
         * than an IOException is wrapped in one: OkHttp rethrows other exceptions on its
         * dispatcher thread after onFailure, which crashes the app.
         */
        @JvmStatic
        @Throws(IOException::class)
        internal fun proceedOnce(chain: Interceptor.Chain, request: Request, wrap: (Response) -> Response): Response {
            var response: Response? = null
            try {
                response = chain.proceed(request)
                return wrap(response)
            } catch (e: IOException) {
                response?.close()
                throw e
            } catch (e: Exception) {
                response?.close()
                throw IOException(e)
            }
        }

        /**
         * OkHttp sends a request again after a 503 with Retry-After: 0, whatever
         * retryOnConnectionFailure says, and does not without the header. For a method
         * [mayResend] refuses, the network interceptor drops the header (#504), so it
         * does not reach JS either.
         */
        @JvmStatic
        internal fun withoutRetryAfter(response: Response): Response =
            if (response.code == 503 && !mayResend(response.request.method)) {
                response.newBuilder().removeHeader("Retry-After").build()
            } else {
                response
            }

        /**
         * Enabled TLS 1.2 on Android 4.1 to 4.4 (API 16 to 19). The library's minSdk is 24,
         * so the version check in the Java version could never pass; the builder is
         * returned unchanged. Kept because it is public.
         */
        @JvmStatic
        fun enableTls12OnPreLollipop(client: OkHttpClient.Builder): OkHttpClient.Builder = client
    }
}
