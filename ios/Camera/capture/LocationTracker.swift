import CoreLocation
import Foundation
import ImageIO

/**
 * The phone's position for geotagging (CameraSettings.geotag): Core Location updates while started, the latest fix
 * kept. Port of Android's LocationTracker. Access (when in use) is asked for only when geotagging is turned on.
 */
@MainActor
final class LocationTracker: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var running = false
    private var fix: CLLocation?
    private var onAuthorization: ((Bool) -> Void)?

    /** A shot is tagged with a fix up to this old (indoors the last fix outside is still close). */
    private static let maxAge: TimeInterval = 10 * 60

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
    }

    var authorized: Bool { [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus) }
    /** Never asked: requestAccess shows the system prompt. Afterwards only the Settings app changes the answer. */
    var undetermined: Bool { manager.authorizationStatus == .notDetermined }

    /** Asks for access while the app is in use (the system prompt, the first time only); [done] gets the answer. */
    func requestAccess(_ done: @escaping (Bool) -> Void) {
        guard undetermined else { return done(authorized) }
        onAuthorization = done
        manager.requestWhenInUseAuthorization()
    }

    func start() {
        guard !running, authorized else { return }
        running = true
        manager.startUpdatingLocation()
    }

    func stop() {
        guard running else { return }
        running = false
        manager.stopUpdatingLocation()
    }

    /** The latest fix no older than maxAge, or nil. */
    var current: CLLocation? {
        guard let fix, -fix.timestamp.timeIntervalSinceNow <= Self.maxAge else { return nil }
        return fix
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last(where: { $0.horizontalAccuracy >= 0 }) else { return }
        Task { @MainActor in self.fix = last }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            guard !self.undetermined, let done = self.onAuthorization else { return }
            self.onAuthorization = nil
            done(self.authorized)
        }
    }

    /**
     * [fix] as ImageIO's GPS dictionary, which the DNG gets (CameraController): position, altitude above sea level
     * and the fix's UTC date and time.
     */
    nonisolated static func gpsMetadata(_ fix: CLLocation) -> [String: Any] {
        let c = fix.coordinate
        var gps: [String: Any] = [
            kCGImagePropertyGPSVersion as String: [2, 3, 0, 0],
            kCGImagePropertyGPSLatitude as String: abs(c.latitude),
            kCGImagePropertyGPSLatitudeRef as String: c.latitude < 0 ? "S" : "N",
            kCGImagePropertyGPSLongitude as String: abs(c.longitude),
            kCGImagePropertyGPSLongitudeRef as String: c.longitude < 0 ? "W" : "E",
        ]
        if fix.verticalAccuracy >= 0 {
            gps[kCGImagePropertyGPSAltitude as String] = abs(fix.altitude)
            gps[kCGImagePropertyGPSAltitudeRef as String] = fix.altitude < 0 ? 1 : 0
        }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy:MM:dd"
        gps[kCGImagePropertyGPSDateStamp as String] = f.string(from: fix.timestamp)
        f.dateFormat = "HH:mm:ss.SSS"
        gps[kCGImagePropertyGPSTimeStamp as String] = f.string(from: fix.timestamp)
        return gps
    }
}
