package app.rawboy.camera.i18n

import java.util.Locale
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

class StringsTest {
    @After
    fun restore() = Strings.choose(AppLanguage.SYSTEM)

    @Test
    fun followsThePhoneByDefault() {
        Strings.choose(AppLanguage.SYSTEM)
        assertEquals("uk", Strings.effective(Locale("uk", "UA")))
        assertEquals("en", Strings.effective(Locale.FRANCE))
    }

    @Test
    fun aPickedLanguageOverridesThePhone() {
        Strings.choose(AppLanguage.ENGLISH)
        assertEquals("en", Strings.effective(Locale("uk")))
        Strings.choose(AppLanguage.UKRAINIAN)
        assertEquals("uk", Strings.effective(Locale.US))
    }

    @Test
    fun englishAndUnknownTextComeBackAsWritten() {
        Strings.choose(AppLanguage.ENGLISH)
        assertEquals("Saving 3…", tr("Saving %s…", 3))
        Strings.choose(AppLanguage.UKRAINIAN)
        assertEquals("Not in the table 5", tr("Not in the table %s", 5))
    }

    @Test
    fun ukrainianFillsPlaceholdersInOrder() {
        Strings.choose(AppLanguage.UKRAINIAN)
        assertEquals("Збереження 2…", tr("Saving %s…", 2))
        assertEquals("Довга витримка 40% · торкніться, щоб зупинити", tr("Long exposure %s% · tap to stop", 40))
    }

    @Test
    fun everyTranslationKeepsItsPlaceholders() {
        for ((english, ukrainian) in UKRAINIAN) {
            assertEquals(english, Regex("%s").findAll(english).count(), Regex("%s").findAll(ukrainian).count())
        }
    }
}
