package com.ReactNativeBlobUtil

import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.BufferedInputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.Collections
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * A request that fails once the server may have received it is not sent again,
 * except a GET or HEAD (#504). The interceptor used to proceed a second time after
 * any exception, read timeouts included; retryOnConnectionFailure(true) let OkHttp
 * resend a POST after a pooled connection dropped; and OkHttp follows a 503 with
 * Retry-After: 0. A server that acts on a POST, a payment for one, acted on it twice.
 * Without that retry, the shared pool must not hand a POST a connection the server
 * has already closed for being idle.
 *
 * The clients here are wired as ReactNativeBlobUtilReq wires its own, against a
 * local server that counts the requests it reads.
 */
class ReactNativeBlobUtilResendTest {

    private enum class Reply { OK, UNAVAILABLE, CLOSE, HOLD }

    /**
     * An HTTP/1.1 server that answers the nth request on each connection as [reply]
     * says, and closes a connection idle for [idleMillis] (0: never).
     */
    private class Server(
        private val idleMillis: Int,
        private val reply: (indexOnConnection: Int) -> Reply,
    ) : Closeable {
        private val socket = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
        private val accepted = Collections.synchronizedList(mutableListOf<Socket>())
        private val methods = Collections.synchronizedList(mutableListOf<String>())
        val url = "http://127.0.0.1:${socket.localPort}/"

        init {
            thread(isDaemon = true) {
                while (!socket.isClosed) {
                    val client = try {
                        socket.accept()
                    } catch (e: IOException) {
                        break
                    }
                    accepted.add(client)
                    thread(isDaemon = true) { serve(client) }
                }
            }
        }

        val connections get() = accepted.size

        /** How many requests with [method] arrived, once a stray resend has had time to. */
        fun received(method: String): Int {
            Thread.sleep(300)
            return synchronized(methods) { methods.count { it == method } }
        }

        private fun serve(client: Socket) = try {
            client.use {
                client.soTimeout = idleMillis
                val input = BufferedInputStream(client.getInputStream())
                var index = 0
                while (true) {
                    methods.add(readRequest(input) ?: break)
                    val out = client.getOutputStream()
                    when (reply(index++)) {
                        Reply.OK -> out.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".toByteArray())
                        Reply.UNAVAILABLE -> out.write("HTTP/1.1 503 Service Unavailable\r\nRetry-After: 0\r\nContent-Length: 0\r\n\r\n".toByteArray())
                        Reply.CLOSE -> break
                        // Read until the client gives up and closes.
                        Reply.HOLD -> while (input.read() != -1) {}
                    }
                    out.flush()
                }
            }
        } catch (e: IOException) {
        }

        /** Reads one request and returns its method, or null at the end of the stream. */
        private fun readRequest(input: InputStream): String? {
            val head = StringBuilder()
            while (!head.endsWith("\r\n\r\n")) {
                val b = input.read()
                if (b == -1) return null
                head.append(b.toChar())
            }
            val lines = head.lines()
            val length = lines.firstOrNull { it.startsWith("content-length:", ignoreCase = true) }
                ?.substringAfter(':')?.trim()?.toInt() ?: 0
            repeat(length) { input.read() }
            return lines[0].substringBefore(' ')
        }

        override fun close() {
            socket.close()
            synchronized(accepted) { accepted.forEach { it.close() } }
        }
    }

    private val servers = mutableListOf<Server>()
    private val pool = ReactNativeBlobUtilReq.newConnectionPool()

    private fun server(idleMillis: Int = 0, reply: (Int) -> Reply) = Server(idleMillis, reply).also { servers.add(it) }

    @After
    fun stop() {
        pool.evictAll()
        servers.forEach { it.close() }
    }

    /** A client set up the way ReactNativeBlobUtilReq sets up the one for [method]. */
    private fun client(method: String, wrap: (Response) -> Response = { it }): OkHttpClient =
        OkHttpClient.Builder()
            .connectionPool(pool)
            .readTimeout(500, TimeUnit.MILLISECONDS)
            .addNetworkInterceptor { chain -> ReactNativeBlobUtilReq.withoutRetryAfter(chain.proceed(chain.request())) }
            .addInterceptor { chain -> ReactNativeBlobUtilReq.proceedOnce(chain, chain.request(), wrap) }
            .retryOnConnectionFailure(ReactNativeBlobUtilReq.mayResend(method))
            .build()

    private fun request(method: String, url: String): Request =
        Request.Builder().url(url).method(method, if (method == "POST") "{}".toByteArray().toRequestBody() else null).build()

    private fun send(method: String, url: String): Response = client(method).newCall(request(method, url)).execute()

    @Test
    fun `a POST whose reply does not arrive in time is sent once`() {
        val server = server { Reply.HOLD }
        assertThrows(SocketTimeoutException::class.java) { send("POST", server.url) }
        assertEquals(1, server.received("POST"))
    }

    // Every request runs on its own client, but they share one connection pool, so
    // the second request goes out on the connection the first one opened.
    @Test
    fun `a POST is not resent when a reused connection drops before the reply`() {
        val server = server { index -> if (index == 0) Reply.OK else Reply.CLOSE }
        send("GET", server.url).use { assertEquals(200, it.code) }
        assertThrows(IOException::class.java) { send("POST", server.url) }
        assertEquals(1, server.received("POST"))
    }

    @Test
    fun `a GET is still resent when a reused connection drops before the reply`() {
        val server = server { index -> if (index == 0) Reply.OK else Reply.CLOSE }
        send("GET", server.url).use { assertEquals(200, it.code) }
        send("GET", server.url).use { assertEquals(200, it.code) }
        assertEquals(3, server.received("GET"))
    }

    @Test
    fun `a POST answered with 503 and Retry-After 0 is sent once`() {
        val server = server { Reply.UNAVAILABLE }
        send("POST", server.url).use { assertEquals(503, it.code) }
        assertEquals(1, server.received("POST"))
    }

    @Test
    fun `a GET answered with 503 and Retry-After 0 is still resent`() {
        val server = server { Reply.UNAVAILABLE }
        send("GET", server.url).use { assertEquals(503, it.code) }
        assertEquals(2, server.received("GET"))
    }

    // Node's http server closes a connection after 5s idle by default. OkHttp only
    // checks a pooled connection before a POST once it has been idle for 10s, so
    // a POST 7s after the last request went out on the closed connection and
    // failed, and the server never saw it.
    @Test
    fun `a POST 7s after the last request is not sent on a connection the server closed`() {
        val server = server(idleMillis = 5000) { Reply.OK }
        send("GET", server.url).use { assertEquals(200, it.code) }
        Thread.sleep(7000)
        send("POST", server.url).use { assertEquals(200, it.code) }
        assertEquals(1, server.received("POST"))
        assertEquals(2, server.connections)
    }

    @Test
    fun `a POST 2s after the last request reuses the connection`() {
        val server = server(idleMillis = 5000) { Reply.OK }
        send("GET", server.url).use { assertEquals(200, it.code) }
        Thread.sleep(2000)
        send("POST", server.url).use { assertEquals(200, it.code) }
        assertEquals(1, server.received("POST"))
        assertEquals(1, server.connections)
    }

    // OkHttp rethrows anything but an IOException on its dispatcher thread after
    // onFailure, which crashes the app, so the interceptor hands it on as one.
    @Test
    fun `an exception while wrapping the response fails the call with an IOException`() {
        val server = server { Reply.OK }
        val failure = CompletableFuture<Throwable>()
        val call = client("POST") { throw IllegalStateException("wrap failed") }.newCall(request("POST", server.url))
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                failure.complete(e)
            }

            override fun onResponse(call: Call, response: Response) {
                response.close()
                failure.complete(AssertionError("onResponse was called"))
            }
        })
        val e = failure.get(5, TimeUnit.SECONDS)
        assertTrue(e.toString(), e is IOException && e.cause is IllegalStateException)
        assertEquals(1, server.received("POST"))
    }
}
