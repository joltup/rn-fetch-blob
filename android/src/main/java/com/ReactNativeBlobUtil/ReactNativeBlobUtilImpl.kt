package com.ReactNativeBlobUtil

import android.app.Activity
import android.app.Activity.RESULT_OK
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.SparseArray
import androidx.annotation.RequiresApi
import androidx.core.content.FileProvider
import com.ReactNativeBlobUtil.ReactNativeBlobUtilConst.GET_CONTENT_INTENT
import com.ReactNativeBlobUtil.Utils.FileDescription
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.network.CookieJarContainer
import com.facebook.react.modules.network.ForwardingCookieHandler
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.JavaNetCookieJar
import okhttp3.OkHttpClient
import java.io.File
import java.io.FileNotFoundException
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal class ReactNativeBlobUtilImpl(reactContext: ReactApplicationContext) {

    private val mClient: OkHttpClient = OkHttpClientProvider.getOkHttpClient()

    init {
        val mCookieHandler = ForwardingCookieHandler()
        val mCookieJarContainer = mClient.cookieJar as CookieJarContainer
        mCookieJarContainer.setCookieJar(JavaNetCookieJar(mCookieHandler))

        RCTContext = reactContext
        reactContext.addActivityEventListener(object : ActivityEventListener {
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                if (requestCode != GET_CONTENT_INTENT) return
                val pending = promiseTable.get(GET_CONTENT_INTENT) ?: return
                promiseTable.remove(GET_CONTENT_INTENT)
                val uri = if (resultCode == RESULT_OK) data?.data else null
                // The user dismissed the picker, or it returned nothing: resolve null
                // instead of leaving the promise pending forever.
                pending.resolve(uri?.toString())
            }

            override fun onNewIntent(intent: Intent) {

            }
        })
    }

    /**
     * Rejects ENOTSUP when one of the paths is a content:// URI, for calls that only
     * work on file paths (a directory, a move, a new file). True when it rejected.
     */
    private fun refuseContent(promise: Promise, vararg paths: String?): Boolean {
        val uri = paths.firstOrNull { ReactNativeBlobUtilContent.isContent(it) } ?: return false
        promise.reject("ENOTSUP", "'$uri' is a content:// URI; this call only takes file paths")
        return true
    }

    fun createFile(path: String?, content: String?, encode: String?, promise: Promise) {
        if (refuseContent(promise, path)) return
        threadPool.execute { ReactNativeBlobUtilFS.createFile(path, content, encode, promise) }
    }

    fun createFileASCII(path: String?, dataArray: ReadableArray?, promise: Promise) {
        if (refuseContent(promise, path)) return
        threadPool.execute { ReactNativeBlobUtilFS.createFileASCII(path, dataArray, promise) }
    }

    fun actionViewIntent(path: String?, mime: String?, chooserTitle: String?, promise: Promise) {
        try {
            val uriForFile: Uri = if (!ReactNativeBlobUtilUtils.isContentUri(path)) {
                FileProvider.getUriForFile(
                    RCTContext,
                    RCTContext.packageName + ".provider", File(path),
                )
            } else {
                // isContentUri only matches a non-null path.
                Uri.parse(path!!)
            }
            var intent = Intent(Intent.ACTION_VIEW)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                // Create the intent with data and type
                intent.setDataAndType(uriForFile, mime)

                // Set flag to give temporary permission to external app to use FileProvider
                intent.setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                // All the activity to be opened outside of an activity
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            } else {
                intent.setDataAndType(Uri.parse("file://$path"), mime).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            if (chooserTitle != null) {
                intent = Intent.createChooser(intent, chooserTitle)
                // The chooser is a new intent without the flag set above, and starting
                // one from the application context without it throws, so every call
                // with a title rejected - open.chooser always passes one (#486).
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            try {
                RCTContext.startActivity(intent)
                promise.resolve(true)
            } catch (ex: ActivityNotFoundException) {
                promise.reject("ENOAPP", "No app installed for $mime")
            }

            ActionViewVisible = true

            // The promise settled above; the listener only clears the flag when
            // the app comes back. Resolving again here was a no-op that the
            // bridge logged as a double resolve.
            val listener = object : LifecycleEventListener {

                override fun onHostResume() {
                    ActionViewVisible = false
                    RCTContext.removeLifecycleEventListener(this)
                }

                override fun onHostPause() {

                }

                override fun onHostDestroy() {

                }
            }
            RCTContext.addLifecycleEventListener(listener)
        } catch (ex: Exception) {
            promise.reject("EUNSPECIFIED", ex.localizedMessage)
        }
    }

    fun writeArrayChunk(streamId: String?, dataArray: ReadableArray?, promise: Promise) {
        ReactNativeBlobUtilStream.writeArrayChunk(streamId, dataArray, promise)
    }

    fun unlink(path: String?, promise: Promise) {
        if (ReactNativeBlobUtilContent.isContent(path)) {
            threadPool.execute {
                try {
                    // Nothing to delete resolves, as for a missing file.
                    ReactNativeBlobUtilContent.delete(path!!)
                    promise.resolve(null)
                } catch (e: SecurityException) {
                    promise.reject("EACCES", "Not allowed to delete '$path'")
                } catch (e: FileNotFoundException) {
                    promise.resolve(null)
                } catch (e: Exception) {
                    promise.reject("EUNSPECIFIED", e.localizedMessage)
                }
            }
            return
        }
        ReactNativeBlobUtilFS.unlink(path, promise)
    }

    fun mkdir(path: String?, promise: Promise) {
        if (refuseContent(promise, path)) return
        ReactNativeBlobUtilFS.mkdir(path, promise)
    }

    fun exists(path: String?, promise: Promise) {
        val (exists, isDirectory) = if (ReactNativeBlobUtilContent.isContent(path)) {
            ReactNativeBlobUtilContent.exists(path!!) to false
        } else {
            ReactNativeBlobUtilFS.exists(path)
        }
        val result = Arguments.createMap()
        result.putBoolean("exists", exists)
        result.putBoolean("isDirectory", isDirectory)
        promise.resolve(result)
    }

    fun cp(path: String?, dest: String?, promise: Promise) {
        threadPool.execute { ReactNativeBlobUtilFS.cp(path, dest, promise) }
    }

    fun mv(path: String?, dest: String?, promise: Promise) {
        if (refuseContent(promise, path, dest)) return
        ReactNativeBlobUtilFS.mv(path, dest, promise)
    }

    fun ls(path: String?, promise: Promise) {
        if (refuseContent(promise, path)) return
        ReactNativeBlobUtilFS.ls(path, promise)
    }

    fun writeStream(path: String?, encode: String?, append: Boolean, promise: Promise) {
        ReactNativeBlobUtilStream(RCTContext).writeStream(path, encode, append, promise)
    }

    fun writeChunk(streamId: String?, data: String?, promise: Promise) {
        ReactNativeBlobUtilStream.writeChunk(streamId, data, promise)
    }

    fun closeStream(streamId: String?, promise: Promise) {
        ReactNativeBlobUtilStream.closeStream(streamId, promise)
    }

    fun removeSession(paths: ReadableArray?, promise: Promise) {
        ReactNativeBlobUtilFS.removeSession(paths, promise)
    }

    fun readFile(path: String?, encoding: String?, transformFile: Boolean, promise: Promise) {
        threadPool.execute { ReactNativeBlobUtilFS.readFile(path, encoding, transformFile, promise) }
    }

    fun writeFileArray(path: String?, data: ReadableArray?, append: Boolean, promise: Promise) {
        if (refuseContent(promise, path)) return
        threadPool.execute { ReactNativeBlobUtilFS.writeFile(path, data, append, promise) }
    }

    fun writeFile(path: String?, encoding: String?, data: String?, transformFile: Boolean, append: Boolean, promise: Promise) {
        if (refuseContent(promise, path)) return
        threadPool.execute { ReactNativeBlobUtilFS.writeFile(path, encoding, data, transformFile, append, promise) }
    }

    fun lstat(path: String?, promise: Promise) {
        if (refuseContent(promise, path)) return
        ReactNativeBlobUtilFS.lstat(path, promise)
    }

    fun stat(path: String?, promise: Promise) {
        if (ReactNativeBlobUtilContent.isContent(path)) {
            threadPool.execute {
                try {
                    val stat = ReactNativeBlobUtilContent.stat(path!!)
                    if (stat == null) promise.reject("ENOENT", "No such content '$path'") else promise.resolve(stat)
                } catch (e: SecurityException) {
                    promise.reject("EACCES", "Not allowed to read '$path'")
                } catch (e: Exception) {
                    promise.reject("EUNSPECIFIED", e.localizedMessage)
                }
            }
            return
        }
        ReactNativeBlobUtilFS.stat(path, promise)
    }

    fun scanFile(pairs: ReadableArray?, promise: Promise) {
        val ctx = RCTContext
        threadPool.execute {
            val size = pairs?.size() ?: 0
            val p = arrayOfNulls<String>(size)
            val m = arrayOfNulls<String>(size)
            for (i in 0 until size) {
                val pair = pairs!!.getMap(i)
                if (pair != null && pair.hasKey("path")) {
                    p[i] = pair.getString("path")
                    m[i] = if (pair.hasKey("mime")) pair.getString("mime") else null
                }
            }
            ReactNativeBlobUtilFS(ctx).scanFile(p, m, promise)
        }
    }

    fun hash(path: String?, algorithm: String?, promise: Promise) {
        threadPool.execute { ReactNativeBlobUtilFS.hash(path, algorithm, promise) }
    }

    /**
     * @param path       Stream file path
     * @param encoding   Stream encoding, should be one of `base64`, `ascii`, and `utf8`
     * @param bufferSize Stream buffer size, default to 4096 or 4095(base64).
     */
    fun readStream(path: String?, encoding: String?, bufferSize: Int, tick: Int, streamId: String?) {
        val ctx = RCTContext
        fsThreadPool.execute {
            val fs = ReactNativeBlobUtilStream(ctx)
            fs.readStream(path, encoding, bufferSize, tick, streamId, RCTContext)
        }
    }

    fun cancelRequest(taskId: String?, promise: Promise) {
        try {
            ReactNativeBlobUtilReq.cancelTask(taskId)
            promise.resolve(null)
        } catch (ex: Exception) {
            promise.reject("EUNSPECIFIED", ex.localizedMessage)
        }
    }

    fun slice(src: String?, dest: String?, start: Long, end: Long, promise: Promise) {
        if (refuseContent(promise, dest)) return
        ReactNativeBlobUtilFS.slice(src, dest, start, end, "", promise)
    }

    fun enableProgressReport(taskId: String?, interval: Int, count: Int) {
        val config = ReactNativeBlobUtilProgressConfig(true, interval, count, ReactNativeBlobUtilProgressConfig.ReportType.Download)
        ReactNativeBlobUtilReq.progressReport[taskId] = config
    }

    fun df(promise: Promise) {
        fsThreadPool.execute { ReactNativeBlobUtilFS.df(promise, RCTContext) }
    }


    fun enableUploadProgressReport(taskId: String?, interval: Int, count: Int) {
        val config = ReactNativeBlobUtilProgressConfig(true, interval, count, ReactNativeBlobUtilProgressConfig.ReportType.Upload)
        ReactNativeBlobUtilReq.uploadProgressReport[taskId] = config
    }

    fun fetchBlob(options: ReadableMap?, taskId: String?, method: String?, url: String?, headers: ReadableMap?, body: String?, callback: Callback) {
        ReactNativeBlobUtilReq(options, taskId, method, url, headers, body, null, mClient, callback).run()
    }

    fun fetchBlobForm(options: ReadableMap?, taskId: String?, method: String?, url: String?, headers: ReadableMap?, body: ReadableArray?, callback: Callback) {
        ReactNativeBlobUtilReq(options, taskId, method, url, headers, null, body, mClient, callback).run()
    }

    fun getContentIntent(mime: String?, promise: Promise) {
        if (promiseTable.get(GET_CONTENT_INTENT) != null) {
            promise.reject("EBUSY", "A file picker is already open")
            return
        }
        val i = Intent(Intent.ACTION_GET_CONTENT)
        if (mime != null)
            i.setType(mime)
        else
            i.setType("*/*")
        promiseTable.put(GET_CONTENT_INTENT, promise)
        try {
            RCTContext.startActivityForResult(i, GET_CONTENT_INTENT, null)
        } catch (ex: Exception) {
            promiseTable.remove(GET_CONTENT_INTENT)
            promise.reject("EUNSPECIFIED", ex.localizedMessage)
        }
    }

    fun addCompleteDownload(config: ReadableMap?, promise: Promise) {
        val dm = RCTContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        if (config == null || !config.hasKey("path")) {
            promise.reject("EINVAL", "ReactNativeBlobUtil.addCompleteDownload config or path missing.")
            return
        }
        val path = ReactNativeBlobUtilUtils.normalizePath(config.getString("path"))
        if (path == null) {
            promise.reject("EINVAL", "ReactNativeBlobUtil.addCompleteDownload can not resolve URI:" + config.getString("path"))
            return
        }
        try {
            val stat = ReactNativeBlobUtilFS.statFile(path)
            @Suppress("DEPRECATION")
            dm.addCompletedDownload(
                if (config.hasKey("title")) config.getString("title") else "",
                if (config.hasKey("description")) config.getString("description") else "",
                true,
                if (config.hasKey("mime")) config.getString("mime") else null,
                path,
                // Long.valueOf(String) in Java: a missing stat or size throws and rejects below.
                stat!!.getString("size")!!.toLong(),
                config.hasKey("showNotification") && config.getBoolean("showNotification"),
            )
            promise.resolve(null)
        } catch (ex: Exception) {
            promise.reject("EUNSPECIFIED", ex.localizedMessage)
        }

    }

    fun getSDCardDir(promise: Promise) {
        ReactNativeBlobUtilFS.getSDCardDir(RCTContext, promise)
    }

    fun getSDCardApplicationDir(promise: Promise) {
        ReactNativeBlobUtilFS.getSDCardApplicationDir(RCTContext, promise)
    }

    fun createMediaFile(filedata: ReadableMap?, mt: String?, promise: Promise) {
        if (!(filedata!!.hasKey("name") && filedata.hasKey("parentFolder") && filedata.hasKey("mimeType"))) {
            promise.reject("EINVAL", "invalid filedata: $filedata")
            return
        }
        if (mt == null) {
            // It went on after the reject and threw in valueOf(null).
            promise.reject("EINVAL", "invalid mediatype")
            return
        }

        val file = FileDescription(filedata.getString("name"), filedata.getString("mimeType"), filedata.getString("parentFolder"))
        val res = ReactNativeBlobUtilMediaCollection.createNewMediaFile(file, ReactNativeBlobUtilMediaCollection.MediaType.valueOf(mt), RCTContext)
        if (res != null) promise.resolve(res.toString())
        else promise.reject("EUNSPECIFIED", "File could not be created")
    }

    fun writeToMediaFile(fileUri: String?, path: String?, transformFile: Boolean, promise: Promise) {
        val res = ReactNativeBlobUtilMediaCollection.writeToMediaFile(Uri.parse(fileUri!!), path, transformFile, promise, RCTContext)
        if (res) promise.resolve("Success")
    }

    @RequiresApi(api = Build.VERSION_CODES.Q)
    fun copyToInternal(contentUri: String?, destpath: String?, promise: Promise) {
        ReactNativeBlobUtilMediaCollection.copyToInternal(Uri.parse(contentUri!!), destpath, promise)
    }

    @RequiresApi(api = Build.VERSION_CODES.Q)
    fun getBlob(contentUri: String?, encoding: String?, promise: Promise) {
        ReactNativeBlobUtilMediaCollection.getBlob(Uri.parse(contentUri!!), encoding, promise)
    }

    fun copyToMediaStore(filedata: ReadableMap?, mt: String?, path: String?, promise: Promise) {
        if (!(filedata!!.hasKey("name") && filedata.hasKey("parentFolder") && filedata.hasKey("mimeType"))) {
            promise.reject("EINVAL", "invalid filedata: $filedata")
            return
        }
        if (mt == null) {
            promise.reject("EINVAL", "invalid mediatype")
            return
        }
        if (path == null) {
            promise.reject("EINVAL", "invalid path")
            return
        }

        val file = FileDescription(filedata.getString("name"), filedata.getString("mimeType"), filedata.getString("parentFolder"))
        val fileuri = ReactNativeBlobUtilMediaCollection.createNewMediaFile(file, ReactNativeBlobUtilMediaCollection.MediaType.valueOf(mt), RCTContext)

        if (fileuri == null) {
            promise.reject("EUNSPECIFIED", "File could not be created")
            return
        }

        val res = ReactNativeBlobUtilMediaCollection.writeToMediaFile(fileuri, path, false, promise, RCTContext)
        if (res) promise.resolve(fileuri.toString())
    }

    companion object {

        const val NAME = "ReactNativeBlobUtil"

        /** Set by the first module instance; everything else reads the app context from here. */
        lateinit var RCTContext: ReactApplicationContext

        private val taskQueue = LinkedBlockingQueue<Runnable>()
        private val threadPool = ThreadPoolExecutor(5, 10, 5000, TimeUnit.MILLISECONDS, taskQueue)

        // Shares taskQueue with threadPool, as it did in Java.
        private val fsThreadPool = ThreadPoolExecutor(2, 10, 5000, TimeUnit.MILLISECONDS, taskQueue)
        private var ActionViewVisible = false
        private val promiseTable = SparseArray<Promise>()
    }
}
