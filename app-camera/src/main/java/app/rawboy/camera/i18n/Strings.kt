package app.rawboy.camera.i18n

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.Locale

/** The language setting: follow the phone, or force one of the supported languages. */
enum class AppLanguage(val code: String?) {
    SYSTEM(null),
    ENGLISH("en"),
    UKRAINIAN("uk"),
    ;

    companion object {
        fun of(name: String?): AppLanguage = entries.firstOrNull { it.name == name } ?: SYSTEM
    }
}

/**
 * Translations for the camera's own text. The code keeps its English text as the key: `tr("Settings")` returns it
 * as written unless the language in force has a translation, so a string nobody translated yet shows in English
 * and the English build needs no lookup at all. Placeholders are `%s`, filled by the `args` of `tr`.
 *
 * `preference` is Compose state: text read while composing follows it, so changing the language redraws the screen.
 */
object Strings {
    var preference by mutableStateOf(AppLanguage.SYSTEM)
        private set

    /** Languages with a translation table; English is the keys themselves. */
    private val tables: Map<String, Map<String, String>> = mapOf("uk" to UKRAINIAN)

    fun choose(language: AppLanguage) {
        preference = language
    }

    /** The language code in force: the choice, else the phone's language when we have it, else English. */
    fun effective(phone: Locale = Locale.getDefault()): String {
        val code = preference.code ?: phone.language
        return if (code in tables) code else "en"
    }

    fun translate(text: String, vararg args: Any?): String {
        val table = tables[effective()]
        val pattern = table?.get(text) ?: text
        return if (args.isEmpty()) pattern else formatPattern(pattern, args)
    }

    /** `%s` placeholders in order; `%%` stays a percent sign. Not String.format: translations may reorder nothing, and a stray `%` mustn't throw. */
    internal fun formatPattern(pattern: String, args: Array<out Any?>): String {
        val out = StringBuilder()
        var next = 0
        var i = 0
        while (i < pattern.length) {
            val c = pattern[i]
            if (c == '%' && i + 1 < pattern.length) {
                val n = pattern[i + 1]
                if (n == 's' && next < args.size) {
                    out.append(args[next++])
                    i += 2
                    continue
                }
                if (n == '%') {
                    out.append('%')
                    i += 2
                    continue
                }
            }
            out.append(c)
            i++
        }
        return out.toString()
    }
}

/** Translate [text] into the language in force. */
fun tr(text: String, vararg args: Any?): String = Strings.translate(text, *args)
