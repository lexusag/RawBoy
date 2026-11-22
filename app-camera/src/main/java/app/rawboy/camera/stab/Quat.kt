package app.rawboy.camera.stab

import kotlin.math.acos
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** A unit quaternion (Hamilton, w first) for camera orientations: [times] composes, [matrix] is row-major 3x3. */
data class Quat(val w: Double, val x: Double, val y: Double, val z: Double) {
    operator fun times(o: Quat) = Quat(
        w * o.w - x * o.x - y * o.y - z * o.z,
        w * o.x + x * o.w + y * o.z - z * o.y,
        w * o.y - x * o.z + y * o.w + z * o.x,
        w * o.z + x * o.y - y * o.x + z * o.w,
    )

    /** The inverse rotation (the conjugate of a unit quaternion). */
    fun inv() = Quat(w, -x, -y, -z)

    fun dot(o: Quat) = w * o.w + x * o.x + y * o.y + z * o.z

    fun normalized(): Quat {
        val n = sqrt(w * w + x * x + y * y + z * z)
        return Quat(w / n, x / n, y / n, z / n)
    }

    operator fun unaryMinus() = Quat(-w, -x, -y, -z)

    /** Row-major rotation matrix. */
    fun matrix(): DoubleArray {
        val xx = x * x; val yy = y * y; val zz = z * z
        val xy = x * y; val xz = x * z; val yz = y * z
        val wx = w * x; val wy = w * y; val wz = w * z
        return doubleArrayOf(
            1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
            2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
            2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
        )
    }

    companion object {
        val IDENTITY = Quat(1.0, 0.0, 0.0, 0.0)

        /** The rotation by |v| radians about v. */
        fun fromRotvec(vx: Double, vy: Double, vz: Double): Quat {
            val a = sqrt(vx * vx + vy * vy + vz * vz)
            if (a < 1e-12) return Quat(1.0, vx / 2, vy / 2, vz / 2).normalized()
            val s = sin(a / 2) / a
            return Quat(cos(a / 2), vx * s, vy * s, vz * s)
        }

        /** Spherical interpolation from [a] (t = 0) to [b] (t = 1), the short way round. */
        fun slerp(a: Quat, b0: Quat, t: Double): Quat {
            var b = b0
            var d = a.dot(b)
            if (d < 0) {
                b = -b
                d = -d
            }
            if (d > 0.9995) {
                return Quat(a.w + (b.w - a.w) * t, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
                    .normalized()
            }
            val th = acos(d.coerceIn(-1.0, 1.0))
            val s = sin(th)
            val ka = sin((1 - t) * th) / s
            val kb = sin(t * th) / s
            return Quat(a.w * ka + b.w * kb, a.x * ka + b.x * kb, a.y * ka + b.y * kb, a.z * ka + b.z * kb)
        }
    }
}
