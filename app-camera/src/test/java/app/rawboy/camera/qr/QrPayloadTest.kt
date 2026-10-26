package app.rawboy.camera.qr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QrPayloadTest {
    @Test
    fun links() {
        val l = QrPayload.parse(" https://www.example.com/a?b=1 ") as QrPayload.Link
        assertEquals("https://www.example.com/a?b=1", l.url)
        assertEquals("example.com", l.label)
        // Alphanumeric-mode codes: scheme and host in capitals, the path kept as it is.
        val upper = QrPayload.parse("HTTPS://EXAMPLE.COM/ABC") as QrPayload.Link
        assertEquals("https://example.com/ABC", upper.url)
        val bare = QrPayload.parse("www.rawboy.app/camera") as QrPayload.Link
        assertEquals("https://www.rawboy.app/camera", bare.url)
        assertEquals("rawboy.app", bare.host)
        assertEquals("host.test", (QrPayload.parse("http://user@host.test:8080/x") as QrPayload.Link).host)
    }

    @Test
    fun wifi() {
        val w = QrPayload.parse("WIFI:T:WPA;S:My\\;Net;P:pa\\:ss\\\\word;H:true;;") as QrPayload.Wifi
        assertEquals("My;Net", w.ssid)
        assertEquals("pa:ss\\word", w.password)
        assertEquals("WPA", w.security)
        assertTrue(w.hidden)
        assertEquals("Wi-Fi My;Net", w.label)
        val open = QrPayload.parse("WIFI:S:\"Cafe\";T:nopass;P:;;") as QrPayload.Wifi
        assertEquals("Cafe", open.ssid)
        assertEquals("", open.security)
        assertNull(open.password)
        assertEquals("SAE", (QrPayload.parse("wifi:S:x;T:WPA3;P:12345678;;") as QrPayload.Wifi).security)
        // No network name: just text.
        assertTrue(QrPayload.parse("WIFI:T:WPA;P:x;;") is QrPayload.Text)
    }

    @Test
    fun actions() {
        val mail = QrPayload.parse("mailto:a@b.test?subject=Hi") as QrPayload.Action
        assertEquals("mailto:a@b.test?subject=Hi", mail.uri)
        assertEquals("a@b.test", mail.label)
        assertEquals("Email", mail.verb)
        assertEquals("tel:+380441234567", (QrPayload.parse("TEL:+380441234567") as QrPayload.Action).uri)
        val sms = QrPayload.parse("SMSTO:+123:See you at 5") as QrPayload.Action
        assertEquals("smsto:+123", sms.uri)
        assertEquals("See you at 5", sms.body)
        assertEquals("hello", (QrPayload.parse("sms:+123?body=hello") as QrPayload.Action).body)
        assertEquals("geo:50.45,30.52", (QrPayload.parse("geo:50.45,30.52") as QrPayload.Action).uri)
    }

    @Test
    fun text() {
        val t = QrPayload.parse("Just some words that go on for rather longer than the chip has room for\nsecond line")
        assertTrue(t is QrPayload.Text)
        assertEquals(40, t.label.length)
        assertTrue(t.label.endsWith("…"))
        assertTrue(QrPayload.parse("mailto:") is QrPayload.Text)
        assertTrue(QrPayload.parse("javascript:alert(1)") is QrPayload.Text)
    }
}
