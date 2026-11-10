package com.example.zcode_mobile.remote

import java.net.URI

object ServerAddress {
    fun origin(raw: String): String? {
        val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return null
        if (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank() ||
            uri.userInfo != null || uri.query != null || uri.fragment != null ||
            (uri.path != "" && uri.path != "/") || uri.port !in -1..65535
        ) return null
        return URI("https", null, uri.host.lowercase(), uri.port, null, null, null).toASCIIString()
    }
}
