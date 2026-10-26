package app.rawboy.camera.qr

/**
 * What a QR code holds, sorted by what tapping it in the viewfinder does: [Link] opens the browser, [Wifi] offers to
 * join the network, [Action] hands a mailto:/tel:/sms:/geo: address to the app for it, [Text] is copied.
 * Kept in step with iOS `capture/QrPayload.swift`.
 */
sealed class QrPayload {
    /** The code's text as read. */
    abstract val text: String

    /** The few words the viewfinder shows for the code. */
    abstract val label: String

    /** What a tap does, as the chip says it. */
    abstract val verb: String

    data class Link(override val text: String, val url: String, val host: String) : QrPayload() {
        override val label get() = host
        override val verb get() = "Open"
    }

    /** A Wi-Fi network (the `WIFI:` format); [security] is "WPA", "WEP", "SAE" or "" for an open network. */
    data class Wifi(
        override val text: String,
        val ssid: String,
        val password: String?,
        val security: String,
        val hidden: Boolean,
    ) : QrPayload() {
        override val label get() = "Wi-Fi $ssid"
        override val verb get() = "Join"
    }

    /** [uri] for the phone's own app: mail, dialler, messages (with [body]) or maps. */
    data class Action(
        override val text: String,
        val uri: String,
        override val label: String,
        override val verb: String,
        val body: String? = null,
    ) : QrPayload()

    data class Text(override val text: String) : QrPayload() {
        override val label get() = text.lineSequence().first().let { if (it.length > LABEL_LENGTH) it.take(LABEL_LENGTH - 1) + "…" else it }
        override val verb get() = "Copy"
    }

    companion object {
        private const val LABEL_LENGTH = 40

        private val WEB = Regex("^(https?)://([^/?#\\s]+)(.*)$", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))

        fun parse(raw: String): QrPayload {
            val text = raw.trim()
            WEB.matchEntire(text)?.let { m -> return link(text, m.groupValues[1], m.groupValues[2], m.groupValues[3]) }
            // Printed as www.… without a scheme.
            if (text.startsWith("www.", ignoreCase = true) && text.none { it.isWhitespace() }) {
                val authority = text.takeWhile { it != '/' && it != '?' && it != '#' }
                return link(text, "https", authority, text.substring(authority.length))
            }
            val colon = text.indexOf(':')
            val scheme = if (colon > 0) text.substring(0, colon).lowercase() else ""
            val rest = if (colon > 0) text.substring(colon + 1) else ""
            return when (scheme) {
                "wifi" -> wifi(text, rest) ?: Text(text)
                "mailto" -> rest.substringBefore('?').takeIf { it.isNotBlank() }
                    ?.let { Action(text, "mailto:$rest", it, "Email") } ?: Text(text)
                "tel" -> rest.takeIf { it.isNotBlank() }?.let { Action(text, "tel:$it", it, "Call") } ?: Text(text)
                // SMSTO:number:message (the common QR form) and sms:number?body=message.
                "smsto", "sms" -> {
                    val number = rest.substringBefore(':').substringBefore('?')
                    val body = when {
                        scheme == "smsto" && rest.contains(':') -> rest.substringAfter(':')
                        rest.contains("?body=") -> rest.substringAfter("?body=")
                        else -> null
                    }?.takeIf { it.isNotEmpty() }
                    if (number.isBlank()) Text(text) else Action(text, "smsto:$number", number, "Message", body)
                }
                "geo" -> if (rest.isNotBlank()) Action(text, "geo:$rest", "Location", "Map") else Text(text)
                else -> Text(text)
            }
        }

        /** Codes in QR's upper-case alphanumeric mode spell the scheme and host in capitals: Android matches schemes case-sensitively. */
        private fun link(text: String, scheme: String, authority: String, rest: String): Link {
            val host = authority.substringAfterLast('@').substringBefore(':').lowercase()
            return Link(text, scheme.lowercase() + "://" + authority.lowercase() + rest, host.removePrefix("www."))
        }

        /** `WIFI:T:WPA;S:name;P:password;H:true;;` in any field order; `\` escapes `;` `,` `:` `"` and itself. */
        private fun wifi(text: String, fields: String): Wifi? {
            val values = HashMap<String, String>()
            var key: String? = null
            val current = StringBuilder()
            var i = 0
            while (i < fields.length) {
                val c = fields[i]
                when {
                    c == '\\' && i + 1 < fields.length -> {
                        current.append(fields[i + 1])
                        i++
                    }
                    c == ':' && key == null -> {
                        key = current.toString().uppercase()
                        current.clear()
                    }
                    c == ';' -> {
                        key?.let { values.putIfAbsent(it, current.toString()) }
                        key = null
                        current.clear()
                    }
                    else -> current.append(c)
                }
                i++
            }
            key?.let { values.putIfAbsent(it, current.toString()) }
            val ssid = values["S"]?.let(::unquote)?.takeIf { it.isNotEmpty() } ?: return null
            val security = when (val t = values["T"].orEmpty().uppercase()) {
                "", "NOPASS", "NONE" -> ""
                "WPA2", "WPA" -> "WPA"
                "WPA3" -> "SAE"
                else -> t
            }
            val password = values["P"]?.let(::unquote)?.takeIf { it.isNotEmpty() && security.isNotEmpty() }
            return Wifi(text, ssid, password, security, values["H"].equals("true", ignoreCase = true))
        }

        private fun unquote(s: String) = if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s.substring(1, s.length - 1) else s
    }
}
