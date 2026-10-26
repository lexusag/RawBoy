import Foundation

/**
 * What a QR code holds, sorted by what tapping it in the viewfinder does: a link opens in the browser, a Wi-Fi
 * network's password is copied, a mailto:/tel:/sms:/geo: address goes to the app for it, text is copied.
 * Port of Android's `qr/QrPayload.kt` (keep the two in step).
 */
enum QrPayload: Equatable {
    case link(text: String, url: String, host: String)
    /** security: "WPA", "WEP", "SAE" or "" for an open network. */
    case wifi(text: String, ssid: String, password: String?, security: String, hidden: Bool)
    /** uri for the phone's own app: mail, phone, messages (with body) or maps. */
    case action(text: String, uri: String, label: String, verb: String, body: String?)
    case text(String)

    /** The code's text as read. */
    var text: String {
        switch self {
        case let .link(text, _, _), let .wifi(text, _, _, _, _), let .action(text, _, _, _, _), let .text(text): text
        }
    }

    /** The few words the viewfinder shows for the code. */
    var label: String {
        switch self {
        case let .link(_, _, host): host
        case let .wifi(_, ssid, _, _, _): "Wi-Fi \(ssid)"
        case let .action(_, _, label, _, _): label
        case let .text(text): Self.firstLine(text)
        }
    }

    private static func firstLine(_ text: String) -> String {
        let line = text.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? text
        return line.count > labelLength ? String(line.prefix(labelLength - 1)) + "…" : line
    }

    /** What a tap does, as the bar says it. iOS lets no app join a network without an entitlement: Wi-Fi copies. */
    var verb: String {
        switch self {
        case .link: "Open"
        case let .wifi(_, _, password, _, _): password != nil ? "Copy password" : "Copy name"
        case let .action(_, _, _, verb, _): verb
        case .text: "Copy"
        }
    }

    private static let labelLength = 40

    static func parse(_ raw: String) -> QrPayload {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = text.lowercased()
        for scheme in ["https", "http"] where lower.hasPrefix(scheme + "://") {
            let after = text.dropFirst(scheme.count + 3)
            let authority = String(after.prefix { $0 != "/" && $0 != "?" && $0 != "#" && !$0.isWhitespace })
            if !authority.isEmpty { return link(text, scheme, authority, String(after.dropFirst(authority.count))) }
        }
        // Printed as www.… without a scheme.
        if lower.hasPrefix("www."), !text.contains(where: \.isWhitespace) {
            let authority = String(text.prefix { $0 != "/" && $0 != "?" && $0 != "#" })
            return link(text, "https", authority, String(text.dropFirst(authority.count)))
        }
        guard let colon = text.firstIndex(of: ":"), colon > text.startIndex else { return .text(text) }
        let scheme = text[..<colon].lowercased()
        let rest = String(text[text.index(after: colon)...])
        switch scheme {
        case "wifi":
            return wifi(text, rest) ?? .text(text)
        case "mailto":
            let address = String(rest.prefix { $0 != "?" })
            return address.trimmingCharacters(in: .whitespaces).isEmpty
                ? .text(text) : .action(text: text, uri: "mailto:\(rest)", label: address, verb: "Email", body: nil)
        case "tel":
            return rest.trimmingCharacters(in: .whitespaces).isEmpty
                ? .text(text) : .action(text: text, uri: "tel:\(rest)", label: rest, verb: "Call", body: nil)
        case "smsto", "sms":
            // SMSTO:number:message (the common QR form) and sms:number?body=message.
            let number = String(rest.prefix { $0 != ":" && $0 != "?" })
            var body: String?
            if scheme == "smsto", let c = rest.firstIndex(of: ":") {
                body = String(rest[rest.index(after: c)...])
            } else if let r = rest.range(of: "?body=") {
                body = String(rest[r.upperBound...])
            }
            if body?.isEmpty == true { body = nil }
            return number.trimmingCharacters(in: .whitespaces).isEmpty
                ? .text(text) : .action(text: text, uri: "smsto:\(number)", label: number, verb: "Message", body: body)
        case "geo":
            return rest.trimmingCharacters(in: .whitespaces).isEmpty
                ? .text(text) : .action(text: text, uri: "geo:\(rest)", label: "Location", verb: "Map", body: nil)
        default:
            return .text(text)
        }
    }

    /** Codes in QR's upper-case alphanumeric mode spell the scheme and host in capitals. */
    private static func link(_ text: String, _ scheme: String, _ authority: String, _ rest: String) -> QrPayload {
        var host = authority.lowercased()
        if let at = host.lastIndex(of: "@") { host = String(host[host.index(after: at)...]) }
        host = String(host.prefix { $0 != ":" })
        if host.hasPrefix("www.") { host.removeFirst(4) }
        return .link(text: text, url: scheme.lowercased() + "://" + authority.lowercased() + rest, host: host)
    }

    /** `WIFI:T:WPA;S:name;P:password;H:true;;` in any field order; `\` escapes `;` `,` `:` `"` and itself. */
    private static func wifi(_ text: String, _ fields: String) -> QrPayload? {
        var values: [String: String] = [:]
        var key: String?
        var current = ""
        var escaped = false
        for c in fields {
            if escaped {
                current.append(c)
                escaped = false
            } else if c == "\\" {
                escaped = true
            } else if c == ":" && key == nil {
                key = current.uppercased()
                current = ""
            } else if c == ";" {
                if let key, values[key] == nil { values[key] = current }
                key = nil
                current = ""
            } else {
                current.append(c)
            }
        }
        if let key, values[key] == nil { values[key] = current }
        guard let ssid = values["S"].map(unquote), !ssid.isEmpty else { return nil }
        let security: String = switch (values["T"] ?? "").uppercased() {
        case "", "NOPASS", "NONE": ""
        case "WPA2", "WPA": "WPA"
        case "WPA3": "SAE"
        case let t: t
        }
        let password = values["P"].map(unquote).flatMap { $0.isEmpty || security.isEmpty ? nil : $0 }
        return .wifi(text: text, ssid: ssid, password: password, security: security,
                     hidden: values["H"]?.lowercased() == "true")
    }

    private static func unquote(_ s: String) -> String {
        s.count >= 2 && s.hasPrefix("\"") && s.hasSuffix("\"") ? String(s.dropFirst().dropLast()) : s
    }
}

/**
 * Which code the viewfinder shows, from one sighting after another: a code stays up for holdSeconds after its last
 * sighting, so a missed frame doesn't make it blink, and a dismissed code stays away until it has been out of view
 * for holdSeconds. Port of Android's QrTracker.
 */
struct QrTracker {
    var holdSeconds: TimeInterval = 1.5
    /** The code shown, or nil. */
    private(set) var shown: QrPayload?
    private var lastSeen: TimeInterval = 0
    private var dismissed: String?
    private var dismissedSeen: TimeInterval = 0

    /** A sighting at now: text, or nil for no code. Returns whether shown changed. */
    mutating func update(_ text: String?, now: TimeInterval) -> Bool {
        let before = shown
        let code = text?.trimmingCharacters(in: .whitespacesAndNewlines)
        let seen = code?.isEmpty == false ? code : nil
        if let seen, seen == dismissed { dismissedSeen = now }
        if dismissed != nil && now - dismissedSeen > holdSeconds { dismissed = nil }
        if let seen, seen != dismissed {
            if shown?.text != seen { shown = QrPayload.parse(seen) }
            lastSeen = now
        } else if shown != nil && now - lastSeen > holdSeconds {
            shown = nil
        }
        return shown != before
    }

    /** The bar's ✕: hides the code shown until it leaves the view. */
    mutating func dismiss(now: TimeInterval) {
        guard let s = shown else { return }
        dismissed = s.text
        dismissedSeen = now
        shown = nil
    }

    mutating func clear() {
        shown = nil
        dismissed = nil
    }
}
