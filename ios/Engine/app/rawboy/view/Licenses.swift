import SwiftUI

/**
 * licenses/THIRD_PARTY_NOTICES.txt (bundled with the engine, the same in every app), including the DNG patent notice.
 */
public struct LicensesView: View {
    @Environment(\.dismiss) private var dismiss

    public init() {}

    public var body: some View {
        NavigationStack {
            ScrollView {
                Text(Self.notices)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding()
            }
            .navigationTitle("Open-source licences")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
    }

    static var notices: String {
        guard let url = LutRepository.resourceBundle.url(forResource: "THIRD_PARTY_NOTICES", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return "Licences not found." }
        return text
    }
}
