package com.ReactNativeBlobUtil

import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.Promise
import org.junit.After
import org.junit.Assume
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.lang.reflect.Proxy

/**
 * Written against the Java implementation and kept unchanged through the Kotlin
 * port, like ReactNativeBlobUtilUtilsTest. It covers the calls that stay on java.io.
 * Anything that builds a WritableMap or WritableArray, runs an AsyncTask, or needs
 * the React context or a ContentResolver is left to the e2e parity scenario.
 */
class ReactNativeBlobUtilFSTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @After
    fun clearTransformer() {
        ReactNativeBlobUtilFileTransformer.sharedFileTransformer = null
    }

    /**
     * The path as the library should see it: a plain path on every host.
     * normalizePath treats anything that starts with `word:` as a URI, and a
     * Windows drive letter looks like one, so the drive is dropped. Windows
     * resolves the rest on the current drive.
     */
    private val File.plain: String
        get() = absolutePath.replace('\\', '/').replaceFirst(Regex("^[A-Za-z]:"), "")

    private class Settled(val method: String, val args: List<Any?>) {
        override fun toString() = "$method$args"
    }

    private class RecordingPromise {
        val calls = mutableListOf<Settled>()
        val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, args ->
            calls.add(Settled(method.name, args?.toList().orEmpty()))
            null
        } as Promise

        fun resolved(): Any? {
            assertEquals("settled once: $calls", 1, calls.size)
            assertEquals("$calls", "resolve", calls[0].method)
            return calls[0].args.single()
        }

        fun rejected(): Pair<Any?, Any?> {
            assertEquals("settled once: $calls", 1, calls.size)
            assertEquals("$calls", "reject", calls[0].method)
            assertEquals("$calls", 2, calls[0].args.size)
            return calls[0].args[0] to calls[0].args[1]
        }
    }


    /** Reverses on read; reverses and appends '!' on write, so a skipped transform shows. */
    private val reversing = object : ReactNativeBlobUtilFileTransformer.FileTransformer {
        override fun onWriteFile(data: ByteArray): ByteArray = data.reversedArray() + '!'.code.toByte()
        override fun onReadFile(data: ByteArray): ByteArray = data.reversedArray()
    }

    // writeFile(path, encoding, data, transformFile, append, promise)

    @Test
    fun `writeFile creates missing parent folders and resolves the byte count`() {
        val target = File(tmp.root, "a/b/out.txt")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.writeFile(target.plain, "utf8", "hé", false, false, p.promise)
        assertEquals(3, p.resolved())
        assertEquals("hé", target.readText())
    }

    @Test
    fun `writeFile replaces the content, or appends when asked to`() {
        val target = tmp.newFile("text.txt").apply { writeText("abc") }
        val replace = RecordingPromise()
        ReactNativeBlobUtilFS.writeFile(target.plain, "utf8", "de", false, false, replace.promise)
        assertEquals(2, replace.resolved())
        assertEquals("de", target.readText())

        val append = RecordingPromise()
        ReactNativeBlobUtilFS.writeFile(target.plain, "utf8", "fg", false, true, append.promise)
        assertEquals(2, append.resolved())
        assertEquals("defg", target.readText())
    }

    @Test
    fun `writeFile with the uri encoding copies another file and resolves its size`() {
        // Larger than the 10240-byte copy buffer.
        val bytes = ByteArray(25_000) { (it % 251).toByte() }
        val src = tmp.newFile("src.bin").apply { writeBytes(bytes) }
        val target = File(tmp.root, "copy.bin")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.writeFile(target.plain, ReactNativeBlobUtilConst.DATA_ENCODE_URI, "file://" + src.plain, false, false, p.promise)
        assertEquals(25_000, p.resolved())
        assertArrayEquals(bytes, target.readBytes())
    }

    @Test
    fun `writeFile with the uri encoding rejects a missing source after creating the target`() {
        val target = File(tmp.root, "copy.bin")
        val missing = File(tmp.root, "missing.bin")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.writeFile(target.plain, ReactNativeBlobUtilConst.DATA_ENCODE_URI, missing.plain, false, false, p.promise)
        assertEquals("ENOENT" to "No such file '${target.plain}' ('${missing.plain}')", p.rejected())
        assertTrue(target.exists())
    }

    @Test
    fun `writeFile onto a folder rejects with EISDIR`() {
        val dir = tmp.newFolder("folder")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.writeFile(dir.plain, "utf8", "x", false, false, p.promise)
        assertEquals("EISDIR" to "Expecting a file but '${dir.plain}' is a directory", p.rejected())
    }

    @Test
    fun `writeFile runs the shared transformer and counts the transformed bytes`() {
        ReactNativeBlobUtilFileTransformer.sharedFileTransformer = reversing
        val target = File(tmp.root, "t.txt")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.writeFile(target.plain, "utf8", "abc", true, false, p.promise)
        assertEquals(4, p.resolved())
        assertEquals("cba!", target.readText())
    }

    @Test
    fun `writeFile with transform but no transformer rejects`() {
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.writeFile(File(tmp.root, "t.txt").plain, "utf8", "abc", true, false, p.promise)
        assertEquals("EUNSPECIFIED" to "Write file with transform was specified but the shared file transformer is not set", p.rejected())
    }

    // writeFile(path, numbers, append, promise)

    @Test
    fun `writeFile with a number array keeps the low byte of each number`() {
        val target = File(tmp.root, "bytes/out.bin")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.writeFile(target.plain, JavaOnlyArray.of(0, 127, 128, 255, 256), false, p.promise)
        assertEquals(5, p.resolved())
        assertArrayEquals(byteArrayOf(0, 127, -128, -1, 0), target.readBytes())

        val append = RecordingPromise()
        ReactNativeBlobUtilFS.writeFile(target.plain, JavaOnlyArray.of(1), true, append.promise)
        assertEquals(1, append.resolved())
        assertArrayEquals(byteArrayOf(0, 127, -128, -1, 0, 1), target.readBytes())
    }

    // writeFile(path, encoding, data, append), used for the media store copy

    @Test
    fun `the boolean writeFile writes text, or copies a uri source`() {
        val target = File(tmp.root, "media/out.txt")
        assertTrue(ReactNativeBlobUtilFS.writeFile(target.plain, "utf8", "hi", false))
        assertEquals("hi", target.readText())

        val src = tmp.newFile("src.txt").apply { writeText("copied") }
        assertTrue(ReactNativeBlobUtilFS.writeFile(target.plain, ReactNativeBlobUtilConst.DATA_ENCODE_URI, src.plain, true))
        assertEquals("hicopied", target.readText())
    }

    @Test
    fun `the boolean writeFile reports failure instead of throwing`() {
        assertFalse(ReactNativeBlobUtilFS.writeFile(File(tmp.root, "out.txt").plain, ReactNativeBlobUtilConst.DATA_ENCODE_URI, File(tmp.root, "missing").plain, false))
        assertFalse(ReactNativeBlobUtilFS.writeFile(null, "utf8", "hi", false))
        assertFalse(ReactNativeBlobUtilFS.writeFile(tmp.newFolder("dir").plain, "utf8", "hi", false))
    }

    // readFile

    @Test
    fun `readFile resolves text for utf8, any other encoding, and file scheme paths`() {
        val f = tmp.newFile("r.txt").apply { writeText("hi") }
        val cases = listOf(f.plain to "utf8", f.plain to "UTF8", "file://" + f.plain to "utf8", f.plain to "latin1")
        for ((path, encoding) in cases) {
            val p = RecordingPromise()
            ReactNativeBlobUtilFS.readFile(path, encoding, false, p.promise)
            assertEquals("$path $encoding", "hi", p.resolved())
        }
    }

    @Test
    fun `readFile rejects a missing file with ENOENT`() {
        val missing = File(tmp.root, "missing.txt")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.readFile(missing.plain, "utf8", false, p.promise)
        val (code, message) = p.rejected()
        assertEquals("ENOENT", code)
        assertTrue("$message", (message as String).startsWith("No such file '${missing.plain}'; "))
    }

    @Test
    fun `readFile runs the shared transformer, and rejects when none is set`() {
        val f = tmp.newFile("t.txt").apply { writeText("abc") }
        val noTransformer = RecordingPromise()
        ReactNativeBlobUtilFS.readFile(f.plain, "utf8", true, noTransformer.promise)
        assertEquals("EUNSPECIFIED" to "Read file with transform was specified but the shared file transformer is not set", noTransformer.rejected())

        ReactNativeBlobUtilFileTransformer.sharedFileTransformer = reversing
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.readFile(f.plain, "utf8", true, p.promise)
        assertEquals("cba", p.resolved())
    }

    // mkdir

    @Test
    fun `mkdir creates nested folders and resolves true`() {
        val dir = File(tmp.root, "x/y/z")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.mkdir(dir.plain, p.promise)
        assertEquals(true, p.resolved())
        assertTrue(dir.isDirectory)
    }

    @Test
    fun `mkdir rejects an existing folder or file with EEXIST`() {
        val dir = tmp.newFolder("existing")
        val onDir = RecordingPromise()
        ReactNativeBlobUtilFS.mkdir(dir.plain, onDir.promise)
        assertEquals("EEXIST" to "Folder '${dir.plain}' already exists", onDir.rejected())

        val file = tmp.newFile("existing.txt")
        val onFile = RecordingPromise()
        ReactNativeBlobUtilFS.mkdir(file.plain, onFile.promise)
        assertEquals("EEXIST" to "File '${file.plain}' already exists", onFile.rejected())
    }

    // cp, mv, unlink, exists

    @Test
    fun `cp copies over an existing destination and resolves`() {
        val src = tmp.newFile("src.txt").apply { writeText("new content") }
        val dest = tmp.newFile("dest.txt").apply { writeText("old content that is longer") }
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.cp(src.plain, dest.plain, p.promise)
        assertEquals(null, p.resolved())
        assertEquals("new content", dest.readText())
    }

    @Test
    fun `cp rejects ENOENT when the source is missing`() {
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.cp(File(tmp.root, "missing.txt").plain, File(tmp.root, "dest.txt").plain, p.promise)
        val (code, message) = p.rejected()
        assertEquals("ENOENT", code)
        assertTrue("$message", (message as String).isNotEmpty())
    }

    @Test
    fun `cp rejects ENOENT when the destination directory is missing`() {
        val src = tmp.newFile("src.txt").apply { writeText("x") }
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.cp(src.plain, File(tmp.root, "nowhere/dest.txt").plain, p.promise)
        assertEquals("ENOENT", p.rejected().first)
    }

    @Test
    fun `mv moves the file over an existing destination`() {
        val src = tmp.newFile("a.txt").apply { writeText("a") }
        val dest = tmp.newFile("b.txt").apply { writeText("b") }
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.mv(src.plain, dest.plain, p.promise)
        assertEquals(null, p.resolved())
        assertFalse(src.exists())
        assertEquals("a", dest.readText())
    }

    @Test
    fun `mv rejects ENOENT for a missing source or destination folder`() {
        val missing = File(tmp.root, "missing.txt")
        val noSource = RecordingPromise()
        ReactNativeBlobUtilFS.mv(missing.plain, File(tmp.root, "b.txt").plain, noSource.promise)
        assertEquals("ENOENT" to "Source file at path `${missing.plain}` does not exist", noSource.rejected())

        val src = tmp.newFile("a.txt")
        val noFolder = RecordingPromise()
        ReactNativeBlobUtilFS.mv(src.plain, File(tmp.root, "nowhere/b.txt").plain, noFolder.promise)
        assertEquals("ENOENT" to "mv failed because the destination directory doesn't exist", noFolder.rejected())
        assertTrue(src.exists())
    }

    @Test
    fun `unlink deletes a folder tree`() {
        val dir = tmp.newFolder("tree")
        File(dir, "sub").mkdirs()
        File(dir, "sub/f.txt").writeText("x")
        File(dir, "g.txt").writeText("y")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.unlink(dir.plain, p.promise)
        assertEquals(null, p.resolved())
        assertFalse(dir.exists())
    }

    @Test
    fun `unlink of a missing path resolves, the path is gone either way`() {
        val missing = File(tmp.root, "missing.txt")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.unlink(missing.plain, p.promise)
        assertEquals(null, p.resolved())
    }

    @Test
    fun `writeFile with invalid base64 rejects EINVAL and writes nothing`() {
        val file = File(tmp.root, "bad.bin")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.writeFile(file.plain, "base64", "@@@@", false, false, p.promise)
        assertEquals("EINVAL" to "Invalid base64 data", p.rejected())
        assertEquals(0L, file.length())
    }

    @Test
    fun `exists reports existence and whether the path is a folder`() {
        val file = tmp.newFile("f.txt")
        val dir = tmp.newFolder("d")
        val cases = listOf(
            file.plain to (true to false),
            dir.plain to (true to true),
            File(tmp.root, "missing").plain to (false to false),
            null to (false to false),
        )
        for ((path, expected) in cases) {
            assertEquals("$path", expected, ReactNativeBlobUtilFS.exists(path))
        }
    }

    // hash

    @Test
    fun `hash resolves the lower-case hex digest for every supported algorithm`() {
        // Digests of "abc", computed with Node's crypto. md5 starts with 0x90, a
        // negative byte, so the formatting of the high bit is covered too.
        val expected = mapOf(
            "md5" to "900150983cd24fb0d6963f7d28e17f72",
            "sha1" to "a9993e364706816aba3e25717850c26c9cd0d89d",
            "sha224" to "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7",
            "sha256" to "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            "sha384" to "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
            "sha512" to "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
        )
        val f = tmp.newFile("abc.txt").apply { writeText("abc") }
        for ((algorithm, digest) in expected) {
            val p = RecordingPromise()
            ReactNativeBlobUtilFS.hash(f.plain, algorithm, p.promise)
            assertEquals(algorithm, digest, p.resolved())
        }
    }

    @Test
    fun `hash rejects an unknown algorithm, a folder and a missing file`() {
        val f = tmp.newFile("abc.txt")
        for (algorithm in listOf("sha3", "MD5", null)) {
            val p = RecordingPromise()
            ReactNativeBlobUtilFS.hash(f.plain, algorithm, p.promise)
            assertEquals("EINVAL" to "Invalid algorithm '$algorithm', must be one of md5, sha1, sha224, sha256, sha384, sha512", p.rejected())
        }

        val dir = tmp.newFolder("d")
        val onDir = RecordingPromise()
        ReactNativeBlobUtilFS.hash(dir.plain, "md5", onDir.promise)
        assertEquals("EISDIR" to "Expecting a file but '${dir.plain}' is a directory", onDir.rejected())

        val missing = RecordingPromise()
        ReactNativeBlobUtilFS.hash(File(tmp.root, "missing").plain, "md5", missing.promise)
        assertEquals("ENOENT" to "No such file '${File(tmp.root, "missing").plain}'", missing.rejected())
    }

    // slice

    @Test
    fun `slice copies the byte range and resolves the destination path`() {
        val bytes = ByteArray(25_000) { (it % 251).toByte() }
        val src = tmp.newFile("src.bin").apply { writeBytes(bytes) }
        val dest = File(tmp.root, "slice.bin")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.slice(src.plain, dest.plain, 100, 20_100, "", p.promise)
        assertEquals(dest.plain, p.resolved())
        assertArrayEquals(bytes.copyOfRange(100, 20_100), dest.readBytes())
    }

    @Test
    fun `slice stops at the end of the source`() {
        val src = tmp.newFile("src.txt").apply { writeText("0123456789") }
        val dest = File(tmp.root, "slice.txt")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.slice(src.plain, dest.plain, 7, 100, "", p.promise)
        assertEquals(dest.plain, p.resolved())
        assertEquals("789", dest.readText())
    }

    @Test
    fun `slice rejects a folder`() {
        val dir = tmp.newFolder("d")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.slice(dir.plain, File(tmp.root, "slice.txt").plain, 0, 1, "", p.promise)
        assertEquals("EISDIR" to "Expecting a file but '${dir.plain}' is a directory", p.rejected())
    }

    // createFile, createFileASCII

    @Test
    fun `createFile writes the initial content and resolves the path`() {
        val target = File(tmp.root, "new.txt")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.createFile(target.plain, "hé", "utf8", p.promise)
        assertEquals(target.plain, p.resolved())
        assertEquals("hé", target.readText())
    }

    @Test
    fun `createFile rejects an existing file with EEXIST`() {
        val existing = tmp.newFile("existing.txt")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.createFile(existing.plain, "x", "utf8", p.promise)
        assertEquals("EEXIST" to "File `${existing.plain}` already exists", p.rejected())
    }

    @Test
    fun `createFile with the uri encoding copies the source, even over an existing file`() {
        val src = tmp.newFile("src.txt").apply { writeText("from source") }
        val existing = tmp.newFile("existing.txt").apply { writeText("old") }
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.createFile(existing.plain, ReactNativeBlobUtilConst.FILE_PREFIX + src.plain, ReactNativeBlobUtilConst.DATA_ENCODE_URI, p.promise)
        assertEquals(existing.plain, p.resolved())
        assertEquals("from source", existing.readText())
    }

    @Test
    fun `createFile with the uri encoding rejects a missing source`() {
        val missing = ReactNativeBlobUtilConst.FILE_PREFIX + File(tmp.root, "missing").plain
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.createFile(File(tmp.root, "new.txt").plain, missing, ReactNativeBlobUtilConst.DATA_ENCODE_URI, p.promise)
        assertEquals("ENOENT" to "Source file : $missing does not exist", p.rejected())
    }

    @Test
    fun `createFile without an encoding fails before checking whether the file existed`() {
        val existing = tmp.newFile("existing.txt")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.createFile(existing.plain, "x", null, p.promise)
        assertEquals("EUNSPECIFIED", p.rejected().first)
    }

    @Test
    fun `createFileASCII writes the low byte of each number, and rejects an existing file`() {
        val target = File(tmp.root, "ascii.bin")
        val p = RecordingPromise()
        ReactNativeBlobUtilFS.createFileASCII(target.plain, JavaOnlyArray.of(104, 105, 256 + 33), p.promise)
        assertEquals(target.plain, p.resolved())
        assertArrayEquals(byteArrayOf(104, 105, 33), target.readBytes())

        val again = RecordingPromise()
        ReactNativeBlobUtilFS.createFileASCII(target.plain, JavaOnlyArray.of(1), again.promise)
        assertEquals("EEXIST" to "File at path `${target.plain}` already exists", again.rejected())
    }

    @Test
    fun `isAsset only matches the bundle-assets scheme`() {
        assertTrue(ReactNativeBlobUtilFS.isAsset("bundle-assets://image.png"))
        assertFalse(ReactNativeBlobUtilFS.isAsset("/data/bundle-assets://image.png"))
        assertFalse(ReactNativeBlobUtilFS.isAsset(null))
    }

    // File.list() is null for a directory that cannot be read, not only for a file.
    // lstat's `files!!` threw on AsyncTask's thread and ended the app; ls rejected
    // with the NullPointerException's message (#425). Both reject EACCES now.
    // Needs a host where a directory can be made unreadable: not Windows, not root.
    @Test
    fun `ls and lstat reject EACCES for a folder that cannot be read`() {
        val dir = tmp.newFolder("locked")
        File(dir, "inside.txt").writeText("x")
        try {
            Assume.assumeTrue("cannot make a folder unreadable here", dir.setReadable(false) && dir.list() == null)

            val ls = RecordingPromise()
            ReactNativeBlobUtilFS.ls(dir.plain, ls.promise)
            assertEquals("EACCES", ls.rejected().first)

            val lstat = RecordingPromise()
            ReactNativeBlobUtilFS.lstatIn(dir.path, lstat.promise)
            assertEquals("EACCES", lstat.rejected().first)
        } finally {
            dir.setReadable(true)
        }
    }
}
