package com.example.zcode_mobile.remote

import android.net.Uri

// FORK(android-remote): 根据用户选择的后端限制远控地址。
object RemoteControlUrlPolicy {
    var serverOrigin: String? = null

    fun resolve(raw: String?): String? = resolve(runCatching { Uri.parse(raw?.trim().orEmpty()) }.getOrNull())

    fun resolve(uri: Uri?): String? {
        val origin = serverOrigin ?: return null
        if (uri == null) return null
        if (uri.scheme == "zcode" && uri.host == "remote") {
            return Uri.parse("$origin/remote/v4").buildUpon()
                .encodedQuery(uri.encodedQuery).encodedFragment(uri.encodedFragment).build().toString()
        }
        val hostOrigin = ServerAddress.origin("${uri.scheme}://${uri.encodedAuthority}") ?: return null
        val path = uri.path.orEmpty()
        // Bugfix: 只允许用户配置的后端，避免远控壳内导航到其他站点。
        if (hostOrigin != origin || !(path == "/remote" || path.startsWith("/remote/"))) return null
        return uri.toString()
    }
}
