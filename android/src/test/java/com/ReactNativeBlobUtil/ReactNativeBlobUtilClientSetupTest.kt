package com.ReactNativeBlobUtil

import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * How a request's client is set up and what JS gets back from a response, in the
 * parts ReactNativeBlobUtilReq keeps as plain functions.
 */
class ReactNativeBlobUtilClientSetupTest {

    /** React Native's base client, which every request's client derives from, has no timeouts. */
    private fun baseClient(): OkHttpClient.Builder = OkHttpClient.Builder()
        .connectTimeout(0, TimeUnit.MILLISECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(0, TimeUnit.MILLISECONDS)

    // An upload whose body the server stopped reading never timed out: the write
    // timeout was left at the base client's none (#384).
    @Test
    fun `timeout bounds connecting, reading and writing`() {
        val client = ReactNativeBlobUtilReq.applyTimeouts(baseClient(), 1500, toFile = false).build()
        assertEquals(1500, client.connectTimeoutMillis)
        assertEquals(1500, client.readTimeoutMillis)
        assertEquals(1500, client.writeTimeoutMillis)
    }

    @Test
    fun `a download to a file has no read timeout, but still a write timeout`() {
        val client = ReactNativeBlobUtilReq.applyTimeouts(baseClient(), 1500, toFile = true).build()
        assertEquals(1500, client.connectTimeoutMillis)
        assertEquals(0, client.readTimeoutMillis)
        assertEquals(1500, client.writeTimeoutMillis)
    }

    @Test
    fun `a negative timeout leaves the base client's`() {
        val client = ReactNativeBlobUtilReq.applyTimeouts(baseClient().writeTimeout(7, TimeUnit.SECONDS), -1, toFile = false).build()
        assertEquals(0, client.connectTimeoutMillis)
        assertEquals(0, client.readTimeoutMillis)
        assertEquals(7000, client.writeTimeoutMillis)
    }
}
