package com.example.zcode_mobile.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerAddressTest {
    @Test fun `normalizes secure backend origins`() {
        assertEquals("https://relay.example.com", ServerAddress.origin(" https://relay.example.com/ "))
        assertEquals("https://relay.example.com:8443", ServerAddress.origin("https://relay.example.com:8443"))
    }
    @Test fun `rejects credentials insecure protocols and paths`() {
        listOf("http://relay.example.com", "https://user@relay.example.com", "https://relay.example.com/a", "https://relay.example.com?x=1", "garbage").forEach {
            assertNull(ServerAddress.origin(it))
        }
    }
}
