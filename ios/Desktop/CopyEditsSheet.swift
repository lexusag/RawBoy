import RawBoyEngine
import SwiftUI

/** Which groups of edits ⌘C copies when pressed twice (Lightroom-style), ticked as a new preset's are. */
struct CopyEditsSheet: View {
    @Binding var isPresented: Bool
    let onCopy: (Set<PresetGroup>) -> Void
    @State private var groups = PresetGroup.defaultGroups

    private var all: Bool { groups.count == PresetGroup.allCases.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Copy edits").font(.headline)
                Spacer()
                Button(all ? "Deselect all" : "Select all") {
                    groups = all ? [] : Set(PresetGroup.allCases)
                }
                .buttonStyle(.link)
            }
            ForEach(PresetGroup.allCases, id: \.self) { g in
                Toggle(g.label, isOn: Binding(
                    get: { groups.contains(g) },
                    set: { on in if on { groups.insert(g) } else { groups.remove(g) } }
                ))
            }
            Text("Crop, rotation and brush strokes stay with each photo.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { isPresented = false }.keyboardShortcut(.cancelAction)
                Button("Copy") {
                    onCopy(groups)
                    isPresented = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(groups.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 340)
    }
}
