package app.rawboy.camera.capture

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log

/**
 * The gyroscope and accelerometer for motion data, running while video mode with motion data is on (not only while
 * recording), and keeping the last [KEEP_NS] of samples. Started with the recording, the sensors delivered their first
 * sample 23-106 ms after the video's first frame (Pixel 9 Pro), so the start of every clip had no gyro; now a
 * recording ([attach]) begins with the samples already kept.
 *
 * Samples arrive on the sensors' own thread; [attach]/[detach] may come from any thread.
 */
class MotionSensors private constructor(
    private val manager: SensorManager,
    val gyro: Sensor,
    val accel: Sensor?,
) : SensorEventListener {
    /** Where samples go: a recording ([MotionRecording]). */
    interface Sink {
        fun gyro(t: Long, x: Float, y: Float, z: Float, dx: Float, dy: Float, dz: Float)
        fun accel(t: Long, x: Float, y: Float, z: Float)
    }

    private val lock = Any()
    private var sink: Sink? = null
    private var thread: HandlerThread? = null

    // The kept samples, oldest first, in a ring: kind (0 gyro, 1 accel), time, up to 6 values.
    private val kinds = ByteArray(RING)
    private val times = LongArray(RING)
    private val values = FloatArray(RING * 6)
    private var head = 0
    private var count = 0

    val running get() = thread != null

    fun start() {
        synchronized(lock) {
            if (thread != null) return
            val t = HandlerThread("RawBoy-motion").apply { start() }
            thread = t
            count = 0
            val handler = Handler(t.looper)
            manager.registerListener(this, gyro, SAMPLING_US, 0, handler)
            accel?.let { manager.registerListener(this, it, SAMPLING_US, 0, handler) }
        }
    }

    fun stop() {
        synchronized(lock) {
            val t = thread ?: return
            manager.unregisterListener(this)
            t.quitSafely()
            thread = null
            count = 0
        }
    }

    /** Hands [s] the kept samples of the last [KEEP_NS], then every new one, until [detach]. */
    fun attach(s: Sink) {
        synchronized(lock) {
            val since = SystemClock.elapsedRealtimeNanos() - KEEP_NS
            for (i in 0 until count) {
                val k = (head - count + i + RING) % RING
                if (times[k] < since) continue
                val v = k * 6
                if (kinds[k].toInt() == 0) {
                    s.gyro(times[k], values[v], values[v + 1], values[v + 2], values[v + 3], values[v + 4], values[v + 5])
                } else {
                    s.accel(times[k], values[v], values[v + 1], values[v + 2])
                }
            }
            sink = s
        }
    }

    fun detach(s: Sink) {
        synchronized(lock) { if (sink === s) sink = null }
    }

    override fun onSensorChanged(e: SensorEvent) {
        val v = e.values
        synchronized(lock) {
            val k = head
            val o = k * 6
            when (e.sensor.type) {
                Sensor.TYPE_GYROSCOPE_UNCALIBRATED -> {
                    kinds[k] = 0
                    for (i in 0 until 6) values[o + i] = v[i]
                }
                Sensor.TYPE_GYROSCOPE -> {
                    kinds[k] = 0
                    for (i in 0 until 3) values[o + i] = v[i]
                    for (i in 3 until 6) values[o + i] = Float.NaN
                }
                Sensor.TYPE_ACCELEROMETER -> {
                    kinds[k] = 1
                    for (i in 0 until 3) values[o + i] = v[i]
                }
                else -> return
            }
            times[k] = e.timestamp
            head = (head + 1) % RING
            if (count < RING) count++
            val s = sink ?: return
            if (kinds[k].toInt() == 0) {
                s.gyro(e.timestamp, values[o], values[o + 1], values[o + 2], values[o + 3], values[o + 4], values[o + 5])
            } else {
                s.accel(e.timestamp, values[o], values[o + 1], values[o + 2])
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    companion object {
        private const val TAG = "RawBoyMotion"

        /** 400 Hz: the Pixel 9 Pro's gyro maximum (needs HIGH_SAMPLING_RATE_SENSORS from Android 12; else 200 Hz). */
        private const val SAMPLING_US = 2_500

        /** How much a recording gets from before it started: well over the 106 ms the first frame came before the gyro. */
        const val KEEP_NS = 500_000_000L

        /** Gyro and accelerometer at 400 Hz for [KEEP_NS], with room to spare. */
        private const val RING = 1024

        /** The phone's sensors, or null without a gyroscope. */
        fun create(context: Context): MotionSensors? {
            val manager = context.getSystemService(SensorManager::class.java) ?: return null
            val gyro = manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE_UNCALIBRATED)
                ?: manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
                ?: return null.also { Log.w(TAG, "no gyroscope: no motion data") }
            return MotionSensors(manager, gyro, manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER))
        }
    }
}
