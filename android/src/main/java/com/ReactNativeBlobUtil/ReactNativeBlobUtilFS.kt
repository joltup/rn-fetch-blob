package com.ReactNativeBlobUtil

import android.media.MediaScannerConnection
import android.net.Uri
import android.os.AsyncTask
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.charset.Charset
import java.security.MessageDigest
import java.util.Locale

internal class ReactNativeBlobUtilFS(private val mCtx: ReactApplicationContext) {

    // Resolved eagerly, as the Java constructor did.
    @Suppress("unused")
    private val emitter: DeviceEventManagerModule.RCTDeviceEventEmitter =
        mCtx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)

    /**
     * Media scanner scan file
     *
     * @param path     Path to file
     * @param mimes    Array of MIME type strings
     * @param promise  Resolves when the scan completes
     */
    fun scanFile(path: Array<String?>, mimes: Array<String?>, promise: Promise) {
        try {
            MediaScannerConnection.scanFile(mCtx, path, mimes) { _, _ -> promise.resolve(null) }
        } catch (err: Exception) {
            promise.reject("EUNSPECIFIED", err.localizedMessage)
        }
    }

    companion object {

        /**
         * Write string with encoding to file (used for mediastore)
         *
         * @param path     Destination file path.
         * @param encoding Encoding of the string.
         * @param data     Array passed from JS context.
         */
        fun writeFile(path: String?, encoding: String?, data: String?, append: Boolean): Boolean {
            try {
                val f = File(ReactNativeBlobUtilUtils.normalizePath(path))
                val dir = f.parentFile
                if (!f.exists()) {
                    if (dir != null && !dir.exists()) {
                        if (!dir.mkdirs() && !dir.exists()) {
                            return false
                        }
                    }
                    if (!f.createNewFile()) {
                        return false
                    }
                }

                // write data from a file
                if (encoding!!.equals(ReactNativeBlobUtilConst.DATA_ENCODE_URI, ignoreCase = true)) {
                    val normalizedData = ReactNativeBlobUtilUtils.normalizePath(data)
                    val src = File(normalizedData)
                    if (!src.exists()) {
                        return false
                    }
                    val buffer = ByteArray(10240)
                    var read: Int
                    var fin: FileInputStream? = null
                    var fout: FileOutputStream? = null
                    try {
                        fin = FileInputStream(src)
                        fout = FileOutputStream(f, append)
                        while (fin.read(buffer).also { read = it } > 0) {
                            fout.write(buffer, 0, read)
                        }
                    } finally {
                        fin?.close()
                        fout?.close()
                    }
                } else {
                    val bytes = ReactNativeBlobUtilUtils.stringToBytes(data!!, encoding)
                    val fout = FileOutputStream(f, append)
                    try {
                        fout.write(bytes)
                    } finally {
                        fout.close()
                    }
                }
                return true
            } catch (e: FileNotFoundException) {
                // According to https://docs.oracle.com/javase/7/docs/api/java/io/FileOutputStream.html
                return false
            } catch (e: Exception) {
                return false
            }
        }

        /**
         * Write string with encoding to file
         *
         * @param path     Destination file path.
         * @param encoding Encoding of the string.
         * @param data     Array passed from JS context.
         * @param promise  RCT Promise
         */
        fun writeFile(path: String?, encoding: String?, data: String?, transformFile: Boolean, append: Boolean, promise: Promise) {
            try {
                var written = 0
                val f = File(path)
                val dir = f.parentFile
                if (f.isDirectory) {
                    promise.reject("EISDIR", "Expecting a file but '$path' is a directory")
                    return
                }
                if (!f.exists()) {
                    if (dir != null && !dir.exists()) {
                        if (!dir.mkdirs() && !dir.exists()) {
                            promise.reject("EUNSPECIFIED", "Failed to create parent directory of '$path'")
                            return
                        }
                    }
                    if (!f.createNewFile()) {
                        promise.reject("ENOENT", "File '$path' does not exist and could not be created")
                        return
                    }
                }

                // write data from a file
                if (encoding!!.equals(ReactNativeBlobUtilConst.DATA_ENCODE_URI, ignoreCase = true)) {
                    val normalizedData = ReactNativeBlobUtilUtils.normalizePath(data)
                    val src = File(normalizedData)
                    if (!src.exists()) {
                        promise.reject("ENOENT", "No such file '$path' ('$normalizedData')")
                        return
                    }
                    val buffer = ByteArray(10240)
                    var read: Int
                    written = 0
                    var fin: FileInputStream? = null
                    var fout: FileOutputStream? = null
                    try {
                        fin = FileInputStream(src)
                        fout = FileOutputStream(f, append)
                        while (fin.read(buffer).also { read = it } > 0) {
                            fout.write(buffer, 0, read)
                            written += read
                        }
                    } finally {
                        fin?.close()
                        fout?.close()
                    }
                } else {
                    var bytes = ReactNativeBlobUtilUtils.stringToBytes(data!!, encoding)
                    if (transformFile) {
                        val transformer = ReactNativeBlobUtilFileTransformer.sharedFileTransformer
                            ?: throw IllegalStateException("Write file with transform was specified but the shared file transformer is not set")
                        bytes = transformer.onWriteFile(bytes)
                    }
                    val fout = FileOutputStream(f, append)
                    try {
                        fout.write(bytes)
                        written = bytes.size
                    } finally {
                        fout.close()
                    }
                }
                promise.resolve(written)
            } catch (e: FileNotFoundException) {
                // According to https://docs.oracle.com/javase/7/docs/api/java/io/FileOutputStream.html
                promise.reject("ENOENT", "File '$path' does not exist and could not be created")
            } catch (e: IllegalArgumentException) {
                promise.reject("EINVAL", e.message)
            } catch (e: Exception) {
                promise.reject("EUNSPECIFIED", e.localizedMessage)
            }
        }

        /**
         * Write array of bytes into file
         *
         * @param path    Destination file path.
         * @param data    Array passed from JS context.
         * @param promise RCT Promise
         */
        fun writeFile(path: String?, data: ReadableArray?, append: Boolean, promise: Promise) {
            try {
                val f = File(path)
                val dir = f.parentFile

                if (!f.exists()) {
                    if (dir != null && !dir.exists()) {
                        if (!dir.mkdirs() && !dir.exists()) {
                            promise.reject("ENOTDIR", "Failed to create parent directory of '$path'")
                            return
                        }
                    }
                    if (!f.createNewFile()) {
                        promise.reject("ENOENT", "File '$path' does not exist and could not be created")
                        return
                    }
                }

                val os = FileOutputStream(f, append)
                try {
                    val bytes = ByteArray(data!!.size())
                    for (i in 0 until data.size()) {
                        bytes[i] = data.getInt(i).toByte()
                    }
                    os.write(bytes)
                } finally {
                    os.close()
                }
                promise.resolve(data.size())
            } catch (e: FileNotFoundException) {
                // According to https://docs.oracle.com/javase/7/docs/api/java/io/FileOutputStream.html
                promise.reject("ENOENT", "File '$path' does not exist and could not be created")
            } catch (e: Exception) {
                promise.reject("EUNSPECIFIED", e.localizedMessage)
            }
        }

        /**
         * Read file with a buffer that has the same size as the target file.
         *
         * @param path     Path of the file.
         * @param encoding Encoding of read stream.
         * @param promise  JS promise
         */
        fun readFile(rawPath: String?, encoding: String?, transformFile: Boolean, promise: Promise) {
            val resolved = ReactNativeBlobUtilUtils.normalizePath(rawPath)
            val path = resolved ?: rawPath
            try {
                var bytes: ByteArray = if (resolved != null && resolved.startsWith(ReactNativeBlobUtilConst.FILE_PREFIX_BUNDLE_ASSET)) {
                    val assetName = resolved.replace(ReactNativeBlobUtilConst.FILE_PREFIX_BUNDLE_ASSET, "")
                    ReactNativeBlobUtilImpl.RCTContext.assets.open(assetName).use { readBytesWithLimit(it) }
                }
                // issue 287
                else if (resolved == null) {
                    // A null path throws here, inside the try, as Uri.parse(null) did in Java.
                    val input = ReactNativeBlobUtilImpl.RCTContext.contentResolver.openInputStream(Uri.parse(path!!))
                    if (input == null) {
                        promise.reject("ENOENT", "No such file '$path'")
                        return
                    }
                    input.use { readBytesWithLimit(it) }
                } else {
                    FileInputStream(File(resolved)).use { readBytesWithLimit(it) }
                }

                if (transformFile) {
                    val transformer = ReactNativeBlobUtilFileTransformer.sharedFileTransformer
                        ?: throw IllegalStateException("Read file with transform was specified but the shared file transformer is not set")
                    bytes = transformer.onReadFile(bytes)
                }

                when (encoding!!.lowercase(Locale.ROOT)) {
                    "base64" -> promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
                    "ascii" -> {
                        val asciiResult = Arguments.createArray()
                        for (b in bytes) {
                            // Signed, as in Java: bytes above 127 reach JS as negative numbers.
                            asciiResult.pushInt(b.toInt())
                        }
                        promise.resolve(asciiResult)
                    }
                    // The platform charset, as new String(bytes) used in Java; Kotlin's
                    // String(bytes) would always pick UTF-8. On Android both are UTF-8.
                    "utf8" -> promise.resolve(String(bytes, Charset.defaultCharset()))
                    else -> promise.resolve(String(bytes, Charset.defaultCharset()))
                }
            } catch (err: SecurityException) {
                promise.reject("EACCES", "Not allowed to read '$path'")
            } catch (err: FileNotFoundException) {
                // A null message throws here, as msg.contains(...) did in Java.
                val msg: String = err.localizedMessage!!
                if (msg.contains("EISDIR")) {
                    promise.reject("EISDIR", "Expecting a file but '$path' is a directory; $msg")
                } else {
                    promise.reject("ENOENT", "No such file '$path'; $msg")
                }
            } catch (err: Exception) {
                promise.reject("EUNSPECIFIED", err.localizedMessage)
            }

        }

        @Throws(IOException::class)
        private fun readBytesWithLimit(input: InputStream): ByteArray {
            val buffer = ByteArray(10240)
            val output = ByteArrayOutputStream()
            var read: Int

            while (input.read(buffer).also { read = it } != -1) {
                output.write(buffer, 0, read)
            }

            return output.toByteArray()
        }

        /**
         * Static method that returns system folders to JS context
         *
         * @param ctx React Native application context
         */
        fun getSystemfolders(ctx: ReactApplicationContext): Map<String, Any> {
            val res = HashMap<String, Any>()

            res["DocumentDir"] = getFilesDirPath(ctx)
            res["CacheDir"] = getCacheDirPath(ctx)
            res["DCIMDir"] = getExternalFilesDirPath(ctx, Environment.DIRECTORY_DCIM)
            res["PictureDir"] = getExternalFilesDirPath(ctx, Environment.DIRECTORY_PICTURES)
            res["MusicDir"] = getExternalFilesDirPath(ctx, Environment.DIRECTORY_MUSIC)
            res["DownloadDir"] = getExternalFilesDirPath(ctx, Environment.DIRECTORY_DOWNLOADS)
            res["MovieDir"] = getExternalFilesDirPath(ctx, Environment.DIRECTORY_MOVIES)
            res["RingtoneDir"] = getExternalFilesDirPath(ctx, Environment.DIRECTORY_RINGTONES)

            val state = Environment.getExternalStorageState()
            if (state == Environment.MEDIA_MOUNTED) {
                res["SDCardDir"] = getExternalFilesDirPath(ctx, null)

                val externalDirectory = ctx.getExternalFilesDir(null)

                if (externalDirectory != null && externalDirectory.parentFile != null) {
                    res["SDCardApplicationDir"] = externalDirectory.parentFile!!.absolutePath
                } else {
                    res["SDCardApplicationDir"] = ""
                }
            } else {
                res["SDCardDir"] = ""
                res["SDCardApplicationDir"] = ""
            }

            res["MainBundleDir"] = ctx.applicationInfo.dataDir

            // TODO Change me with the correct path
            res["LibraryDir"] = ""
            res["ApplicationSupportDir"] = ""

            return res
        }

        /**
         * Static method that returns legacy system folders to JS context (usage of deprecated functions since these retunr different folders)
         *
         * @param ctx React Native application context
         */
        @Suppress("DEPRECATION")
        fun getLegacySystemfolders(@Suppress("UNUSED_PARAMETER") ctx: ReactApplicationContext): Map<String, Any> {
            val res = HashMap<String, Any>()

            res["LegacyDCIMDir"] = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM).absolutePath
            res["LegacyPictureDir"] = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES).absolutePath
            res["LegacyMusicDir"] = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC).absolutePath
            res["LegacyDownloadDir"] = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).absolutePath
            res["LegacyMovieDir"] = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES).absolutePath
            res["LegacyRingtoneDir"] = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_RINGTONES).absolutePath

            val state = Environment.getExternalStorageState()
            if (state == Environment.MEDIA_MOUNTED) {
                res["LegacySDCardDir"] = Environment.getExternalStorageDirectory().absolutePath
            } else {
                res["LegacySDCardDir"] = ""
            }

            return res
        }

        fun getExternalFilesDirPath(ctx: ReactApplicationContext, type: String?): String {
            val dir = ctx.getExternalFilesDir(type)
            if (dir != null) return dir.absolutePath
            return ""
        }

        fun getFilesDirPath(ctx: ReactApplicationContext): String {
            val dir = ctx.filesDir
            if (dir != null) return dir.absolutePath
            return ""
        }

        fun getCacheDirPath(ctx: ReactApplicationContext): String {
            val dir = ctx.cacheDir
            if (dir != null) return dir.absolutePath
            return ""
        }

        fun getSDCardDir(ctx: ReactApplicationContext, promise: Promise) {
            if (Environment.getExternalStorageState() == Environment.MEDIA_MOUNTED) {
                try {
                    val path = ctx.getExternalFilesDir(null)!!.absolutePath
                    promise.resolve(path)
                } catch (e: Exception) {
                    promise.reject("EUNSPECIFIED", e.localizedMessage)
                }
            } else {
                promise.reject("ENOENT", "External storage not mounted")
            }

        }

        fun getSDCardApplicationDir(ctx: ReactApplicationContext, promise: Promise) {
            if (Environment.getExternalStorageState() == Environment.MEDIA_MOUNTED) {
                try {
                    val path = ctx.getExternalFilesDir(null)!!.parentFile!!.absolutePath
                    promise.resolve(path)
                } catch (e: Exception) {
                    promise.reject("EUNSPECIFIED", e.localizedMessage)
                }
            } else {
                promise.reject("ENOENT", "External storage not mounted")
            }
        }

        /**
         * Static method that returns a temp file path
         *
         * @param taskId An unique string for identify
         * @return String
         */
        fun getTmpPath(taskId: String?): String =
            "${ReactNativeBlobUtilImpl.RCTContext.filesDir}/ReactNativeBlobUtilTmp_$taskId"


        /**
         * Unlink file at path
         *
         * @param path     Path of target
         * @param callback JS context callback
         */
        fun unlink(path: String?, promise: Promise) {
            try {
                val normalizedPath = ReactNativeBlobUtilUtils.normalizePath(path)
                val target = File(normalizedPath)
                // Removing what is not there is not a failure: the path is gone
                // either way, as on iOS.
                if (target.exists()) {
                    deleteRecursive(target)
                }
                promise.resolve(null)
            } catch (err: Exception) {
                promise.reject("EUNSPECIFIED", err.localizedMessage)
            }
        }

        @Throws(IOException::class)
        private fun deleteRecursive(fileOrDirectory: File) {
            if (fileOrDirectory.isDirectory) {
                val files = fileOrDirectory.listFiles()
                if (files == null) {
                    throw NullPointerException("Received null trying to list files of directory '$fileOrDirectory'")
                } else {
                    for (child in files) {
                        deleteRecursive(child)
                    }
                }
            }
            val result = fileOrDirectory.delete()
            if (!result) {
                throw IOException("Failed to delete '$fileOrDirectory'")
            }
        }

        /**
         * Make a folder
         *
         * @param path    Source path
         * @param promise JS promise
         */
        fun mkdir(rawPath: String?, promise: Promise) {
            val path = ReactNativeBlobUtilUtils.normalizePath(rawPath)
            // A null path throws here, outside the try, as it did in Java.
            val dest = File(path)
            if (dest.exists()) {
                promise.reject("EEXIST", (if (dest.isDirectory) "Folder" else "File") + " '" + path + "' already exists")
                return
            }
            try {
                val result = dest.mkdirs()
                if (!result) {
                    promise.reject("EUNSPECIFIED", "mkdir failed to create some or all directories in '$path'")
                    return
                }
            } catch (e: Exception) {
                promise.reject("EUNSPECIFIED", e.localizedMessage)
                return
            }
            promise.resolve(true)
        }

        /**
         * Copy file to destination path
         *
         * @param path     Source path
         * @param dest     Target path
         * @param callback JS context callback
         */
        fun cp(path: String?, rawDest: String?, promise: Promise) {
            val destIsContent = ReactNativeBlobUtilContent.isContent(rawDest)
            val dest = ReactNativeBlobUtilUtils.normalizePath(rawDest)
            var input: InputStream? = null
            var out: OutputStream? = null
            var message = ""
            var code = "EUNSPECIFIED"

            try {
                input = inputStreamFromPath(path)
                if (input == null) {
                    promise.reject("ENOENT", "Source file at path`$path` does not exist or can not be opened")
                    return
                }
                if (!destIsContent && !File(dest).exists()) {
                    val parent = File(dest).parentFile
                    if (parent != null && !parent.isDirectory) {
                        promise.reject("ENOENT", "Destination directory of '$dest' does not exist")
                        return
                    }
                    val result = File(dest).createNewFile()
                    if (!result) {
                        promise.reject("EEXIST", "Destination file at '$dest' already exists")
                        return
                    }
                }

                out = if (destIsContent) ReactNativeBlobUtilContent.openOutput(rawDest!!, false) else FileOutputStream(dest)

                val buf = ByteArray(10240)
                var len: Int
                while (input.read(buf).also { len = it } > 0) {
                    out.write(buf, 0, len)
                }
            } catch (err: Exception) {
                // A destination whose directory does not exist, or a source that
                // cannot be opened after all, surfaces as FileNotFoundException.
                if (err is FileNotFoundException) code = "ENOENT"
                if (err is SecurityException) code = "EACCES"
                message += err.localizedMessage
            } finally {
                try {
                    input?.close()
                    out?.close()
                } catch (e: Exception) {
                    message += e.localizedMessage
                }
            }
            // Settle exactly once.
            if (message != "") {
                promise.reject(code, message)
            } else {
                promise.resolve(null)
            }
        }

        /**
         * Move file
         *
         * @param path     Source file path
         * @param dest     Destination file path
         * @param callback JS context callback
         */
        fun mv(rawPath: String?, rawDest: String?, promise: Promise) {
            val path = ReactNativeBlobUtilUtils.normalizePath(rawPath)
            val dest = ReactNativeBlobUtilUtils.normalizePath(rawDest)
            if (path == null) {
                promise.reject("EINVAL", "Missing argument \"path\"")
                return
            }
            val src = File(path)
            if (!src.exists()) {
                promise.reject("ENOENT", "Source file at path `$path` does not exist")
                return
            }

            try {
                // mv should fail if the destination directory does not exist.
                val destFile = File(dest)
                val parentDir = destFile.parentFile
                if (parentDir != null && !parentDir.exists()) {
                    promise.reject("ENOENT", "mv failed because the destination directory doesn't exist")
                    return
                }
                // mv overwrites files, so delete any existing file.
                if (destFile.exists()) {
                    destFile.delete()
                }
                // mv by renaming the file.
                val result = src.renameTo(destFile)
                if (!result) {
                    promise.reject("EUNSPECIFIED", "mv failed for unknown reasons")
                    return
                }
            } catch (e: Exception) {
                promise.reject("EUNSPECIFIED", e.toString())
                return
            }

            promise.resolve(null)
        }

        /**
         * Check if the path exists, also check if it is a folder when exists.
         *
         * @param path     Path to check
         * @param callback JS context callback
         */
        /**
         * Whether the path exists, and whether it is a directory. Pure, so it is
         * unit-testable; the module wraps the pair in the map the spec promises.
         */
        fun exists(rawPath: String?): Pair<Boolean, Boolean> {
            if (isAsset(rawPath)) {
                return try {
                    val filename = rawPath!!.replace(ReactNativeBlobUtilConst.FILE_PREFIX_BUNDLE_ASSET, "")
                    ReactNativeBlobUtilImpl.RCTContext.assets.openFd(filename)
                    true to false
                } catch (e: IOException) {
                    false to false
                }
            }
            val path = ReactNativeBlobUtilUtils.normalizePath(rawPath) ?: return false to false
            return File(path).exists() to File(path).isDirectory
        }

        /**
         * List content of folder
         *
         * @param path    Target folder
         * @param promise JS context promise
         */
        fun ls(rawPath: String?, promise: Promise) {
            try {
                val path = ReactNativeBlobUtilUtils.normalizePath(rawPath)
                val src = File(path)
                if (!src.exists()) {
                    promise.reject("ENOENT", "No such file '$path'")
                    return
                }
                if (!src.isDirectory) {
                    promise.reject("ENOTDIR", "Not a directory '$path'")
                    return
                }
                // list() is null for a directory that cannot be read, too (#425).
                val files = File(path).list()
                if (files == null) {
                    promise.reject("EACCES", "Cannot read directory '$path'")
                    return
                }
                val arg = Arguments.createArray()
                for (i in files) {
                    arg.pushString(i)
                }
                promise.resolve(arg)
            } catch (e: Exception) {
                e.printStackTrace()
                promise.reject("EUNSPECIFIED", e.localizedMessage)
            }
        }

        /**
         * Create a file by slicing given file path
         *
         * @param path   Source file path
         * @param dest   Destination of created file
         * @param start  Start byte offset in source file
         * @param end    End byte offset
         * @param encode NOT IMPLEMENTED
         */
        fun slice(path: String?, rawDest: String?, start: Long, end: Long, @Suppress("UNUSED_PARAMETER") encode: String?, promise: Promise) {
            try {
                val dest = ReactNativeBlobUtilUtils.normalizePath(rawDest)

                if (!path!!.startsWith(ReactNativeBlobUtilConst.FILE_PREFIX_CONTENT)) {
                    val file = File(ReactNativeBlobUtilUtils.normalizePath(path))
                    if (file.isDirectory) {
                        promise.reject("EISDIR", "Expecting a file but '$path' is a directory")
                        return
                    }
                    // FileInputStream would throw FileNotFoundException, which the
                    // catch below reported as EUNSPECIFIED with the open() text.
                    if (!file.exists()) {
                        promise.reject("ENOENT", "No such file '$path'")
                        return
                    }
                }

                val input = inputStreamFromPath(path)
                if (input == null) {
                    promise.reject("ENOENT", "No such file '$path'")
                    return
                }
                val out = FileOutputStream(File(dest))
                val skipped = input.skip(start)
                if (skipped != start) {
                    promise.reject("EUNSPECIFIED", "Skipped $skipped instead of the specified $start bytes")
                    return
                }
                val buffer = ByteArray(10240)
                var remain = (end - start).toInt()
                while (remain > 0) {
                    val read = input.read(buffer, 0, 10240)
                    if (read <= 0) {
                        break
                    }
                    out.write(buffer, 0, minOf(remain, read))
                    remain -= read
                }
                input.close()
                out.flush()
                out.close()
                promise.resolve(dest)
            } catch (e: Exception) {
                e.printStackTrace()
                promise.reject("EUNSPECIFIED", e.localizedMessage)
            }
        }

        @Suppress("DEPRECATION")
        fun lstat(rawPath: String?, promise: Promise) {
            val path = ReactNativeBlobUtilUtils.normalizePath(rawPath)

            object : AsyncTask<String?, Int, Int>() {
                override fun doInBackground(vararg args: String?): Int = try {
                    lstatIn(args[0], promise)
                } catch (e: Exception) {
                    // Thrown here, on AsyncTask's thread, an exception ended the app.
                    promise.reject("EUNSPECIFIED", e.localizedMessage)
                    0
                }
            }.execute(path)
        }

        /** lstat's work, off AsyncTask so a test can reach it. */
        internal fun lstatIn(target: String?, promise: Promise): Int {
            if (target == null) {
                promise.reject("EINVAL", "the path specified for lstat is either `null` or `undefined`.")
                return 0
            }
            val src = File(target)
            if (!src.exists()) {
                promise.reject("ENOENT", "failed to lstat path `$target` because it does not exist or it is not a folder")
                return 0
            }
            val paths = if (src.isDirectory) {
                // list() is null for a directory that cannot be read, too; the old
                // `files!!` threw on AsyncTask's thread and ended the app (#425).
                val files = src.list()
                if (files == null) {
                    promise.reject("EACCES", "failed to lstat path `$target` because the folder cannot be read")
                    return 0
                }
                files.map { src.path + "/" + it }
            } else {
                listOf(src.absolutePath)
            }
            val res = Arguments.createArray()
            for (p in paths) {
                res.pushMap(statFile(p))
            }
            promise.resolve(res)
            return 0
        }

        /**
         * show status of a file or directory
         *
         * @param path     Path
         * @param callback Callback
         */
        fun stat(rawPath: String?, promise: Promise) {
            try {
                val path = ReactNativeBlobUtilUtils.normalizePath(rawPath)
                val result = statFile(path)
                if (result == null) {
                    promise.reject("ENOENT", "failed to stat path `$path` because it does not exist or it is not a folder")
                } else {
                    promise.resolve(result)
                }
            } catch (err: Exception) {
                promise.reject("EUNSPECIFIED", err.localizedMessage)
            }
        }

        /**
         * Basic stat method
         *
         * @param path Path
         * @return Stat  Result of a file or path
         */
        fun statFile(rawPath: String?): WritableMap? {
            try {
                val path = ReactNativeBlobUtilUtils.normalizePath(rawPath)
                val stat = Arguments.createMap()
                if (isAsset(path)) {
                    val name = path!!.replace(ReactNativeBlobUtilConst.FILE_PREFIX_BUNDLE_ASSET, "")
                    val fd = ReactNativeBlobUtilImpl.RCTContext.assets.openFd(name)
                    stat.putString("filename", name)
                    stat.putString("path", path)
                    stat.putString("type", "asset")
                    stat.putString("size", fd.length.toString())
                    stat.putInt("lastModified", 0)
                } else {
                    val target = File(path)
                    if (!target.exists()) {
                        return null
                    }
                    stat.putString("filename", target.name)
                    stat.putString("path", target.path)
                    stat.putString("type", if (target.isDirectory) "directory" else "file")
                    stat.putString("size", target.length().toString())
                    val lastModified = target.lastModified().toString()
                    stat.putString("lastModified", lastModified)

                }
                return stat
            } catch (err: Exception) {
                return null
            }
        }

        fun hash(path: String?, algorithm: String?, promise: Promise) {
            try {
                // Nullable keys, like the Java HashMap: a null algorithm is simply not found.
                val algorithms = HashMap<String?, String>()

                algorithms["md5"] = "MD5"
                algorithms["sha1"] = "SHA-1"
                algorithms["sha224"] = "SHA-224"
                algorithms["sha256"] = "SHA-256"
                algorithms["sha384"] = "SHA-384"
                algorithms["sha512"] = "SHA-512"

                if (!algorithms.containsKey(algorithm)) {
                    promise.reject("EINVAL", "Invalid algorithm '$algorithm', must be one of md5, sha1, sha224, sha256, sha384, sha512")
                    return
                }

                if (!path!!.startsWith(ReactNativeBlobUtilConst.FILE_PREFIX_CONTENT)) {
                    val file = File(ReactNativeBlobUtilUtils.normalizePath(path))
                    if (file.isDirectory) {
                        promise.reject("EISDIR", "Expecting a file but '$path' is a directory")
                        return
                    }
                    // FileInputStream would throw FileNotFoundException, which the
                    // catch below reported as EUNSPECIFIED with the open() text.
                    if (!file.exists()) {
                        promise.reject("ENOENT", "No such file '$path'")
                        return
                    }
                }

                val md = MessageDigest.getInstance(algorithms[algorithm])

                val inputStream = inputStreamFromPath(path)
                if (inputStream == null) {
                    promise.reject("ENOENT", "No such file '$path'")
                    return
                }
                val chunkSize = 4096 * 256 // 1Mb
                val buffer = ByteArray(chunkSize)

                var bytesRead: Int
                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    md.update(buffer, 0, bytesRead)
                }

                val hexString = StringBuilder()
                for (digestByte in md.digest()) {
                    hexString.append(String.format("%02x", digestByte))
                }

                promise.resolve(hexString.toString())
            } catch (e: SecurityException) {
                promise.reject("EACCES", "Not allowed to read '$path'")
            } catch (e: Exception) {
                e.printStackTrace()
                promise.reject("EUNSPECIFIED", e.localizedMessage)
            }
        }

        /**
         * Create new file at path
         *
         * @param path     The destination path of the new file.
         * @param data     Initial data of the new file.
         * @param encoding Encoding of initial data.
         * @param promise  Promise for Javascript
         */
        fun createFile(rawPath: String?, data: String?, encoding: String?, promise: Promise) {
            try {
                val path = ReactNativeBlobUtilUtils.normalizePath(rawPath)
                val dest = File(path)
                val created = dest.createNewFile()
                // A null encoding throws here, after the file was created, as encoding.equals(...) did in Java.
                if (encoding!! == ReactNativeBlobUtilConst.DATA_ENCODE_URI) {
                    val orgPath = data!!.replace(ReactNativeBlobUtilConst.FILE_PREFIX, "")
                    val src = File(orgPath)
                    if (!src.exists()) {
                        promise.reject("ENOENT", "Source file : $data does not exist")
                        return
                    }
                    val fin = FileInputStream(src)
                    val ostream: OutputStream = FileOutputStream(dest)
                    val buffer = ByteArray(10240)
                    var read = fin.read(buffer)
                    while (read > 0) {
                        ostream.write(buffer, 0, read)
                        read = fin.read(buffer)
                    }
                    fin.close()
                    ostream.close()
                } else {
                    if (!created) {
                        promise.reject("EEXIST", "File `$path` already exists")
                        return
                    }
                    // Not closed, as in Java.
                    val ostream: OutputStream = FileOutputStream(dest)
                    ostream.write(ReactNativeBlobUtilUtils.stringToBytes(data!!, encoding))
                }
                promise.resolve(path)
            } catch (err: Exception) {
                promise.reject("EUNSPECIFIED", err.localizedMessage)
            }
        }

        /**
         * Create file for ASCII encoding
         *
         * @param path    Path of new file.
         * @param data    Content of new file
         * @param promise JS Promise
         */
        fun createFileASCII(rawPath: String?, data: ReadableArray?, promise: Promise) {
            try {
                val path = ReactNativeBlobUtilUtils.normalizePath(rawPath)
                val dest = File(path)
                val created = dest.createNewFile()
                if (!created) {
                    promise.reject("EEXIST", "File at path `$path` already exists")
                    return
                }
                // Not closed, as in Java.
                val ostream: OutputStream = FileOutputStream(dest)
                val chunk = ByteArray(data!!.size())
                for (i in 0 until data.size()) {
                    chunk[i] = data.getInt(i).toByte()
                }
                ostream.write(chunk)
                promise.resolve(path)
            } catch (err: Exception) {
                promise.reject("EUNSPECIFIED", err.localizedMessage)
            }
        }

        fun df(promise: Promise, ctx: ReactApplicationContext) {
            val stat = StatFs(ctx.filesDir.path)
            val args = Arguments.createMap()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
                args.putString("internal_free", stat.freeBytes.toString())
                args.putString("internal_total", stat.totalBytes.toString())
                val dir = ctx.getExternalFilesDir(null)
                if (dir != null) {
                    val statEx = StatFs(dir.path)
                    args.putString("external_free", statEx.freeBytes.toString())
                    args.putString("external_total", statEx.totalBytes.toString())
                } else {
                    args.putString("external_free", "-1")
                    args.putString("external_total", "-1")
                }
            }
            promise.resolve(args)
        }

        /**
         * Remove files in session.
         *
         * @param paths    An array of file paths.
         * @param promise  Resolves when every file is gone
         */
        @Suppress("DEPRECATION")
        fun removeSession(paths: ReadableArray?, promise: Promise) {
            val task = object : AsyncTask<ReadableArray?, Int, Int>() {
                override fun doInBackground(vararg paths: ReadableArray?): Int {
                    try {
                        val failuresToDelete = ArrayList<String?>()
                        for (i in 0 until paths[0]!!.size()) {
                            val fileName = paths[0]!!.getString(i)
                            val f = File(fileName)
                            if (f.exists()) {
                                val result = f.delete()
                                if (!result) {
                                    failuresToDelete.add(fileName)
                                }
                            }
                        }
                        if (failuresToDelete.isEmpty()) {
                            promise.resolve(null)
                        } else {
                            val listString = StringBuilder()
                            listString.append("Failed to delete: ")
                            for (s in failuresToDelete) {
                                listString.append(s).append(", ")
                            }
                            promise.reject("EUNSPECIFIED", listString.toString())
                        }
                    } catch (err: Exception) {
                        promise.reject("EUNSPECIFIED", err.localizedMessage)
                    }
                    return paths[0]?.size() ?: 0
                }
            }
            task.execute(paths)
        }

        /**
         * Get input stream of the given path.
         * When the path starts with bundle-assets:// the stream is created by Assets Manager
         * When the path starts with content:// the stream is created by ContentResolver
         * otherwise use FileInputStream.
         *
         * @param path The file to open stream
         * @return InputStream instance
         * @throws IOException If the given file does not exist or is a directory FileInputStream will throw a FileNotFoundException
         */
        @Throws(IOException::class)
        internal fun inputStreamFromPath(path: String?): InputStream? {
            // A null path throws here, as path.startsWith(...) did in Java; every caller is inside a try.
            val p = path!!
            if (p.startsWith(ReactNativeBlobUtilConst.FILE_PREFIX_BUNDLE_ASSET)) {
                return ReactNativeBlobUtilImpl.RCTContext.assets.open(p.replace(ReactNativeBlobUtilConst.FILE_PREFIX_BUNDLE_ASSET, ""))
            }
            if (p.startsWith(ReactNativeBlobUtilConst.FILE_PREFIX_CONTENT)) {
                return ReactNativeBlobUtilImpl.RCTContext.contentResolver.openInputStream(Uri.parse(p))
            }
            return FileInputStream(File(ReactNativeBlobUtilUtils.normalizePath(p)))
        }

        fun isAsset(path: String?): Boolean =
            path != null && path.startsWith(ReactNativeBlobUtilConst.FILE_PREFIX_BUNDLE_ASSET)
    }

}
