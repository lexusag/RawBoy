import XCTest
@testable import RawBoyEngine
import struct RawBoyBrowseKit.PhotoSidecar
import enum RawBoyBrowseKit.XmpSidecar
import typealias RawBoyBrowseKit.ExifOrientation

/** Web's browse.test.ts "XMP sidecars" cases, the Develop field and Desktop's file handling. */
final class XmpSidecarTests: XCTestCase {
    private let lightroom = """
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
         <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
          <rdf:Description rdf:about=""
            xmlns:xmp="http://ns.adobe.com/xap/1.0/"
            xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
           xmp:Rating="2"
           crs:Exposure2012="+0.35">
           <crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 0</rdf:li></rdf:Seq></crs:ToneCurvePV2012>
          </rdf:Description>
         </rdf:RDF>
        </x:xmpmeta>
        """

    func testRatingsRoundTripAndRejectIsMinusOne() throws {
        for r in [XmpSidecar.Rating(stars: 3), .init(stars: 0, flag: .reject), .init(stars: 5, flag: .pick)] {
            XCTAssertEqual(XmpSidecar.readRating(try XmpSidecar.writeRating(nil, r)), r)
        }
        XCTAssertTrue(try XmpSidecar.writeRating(nil, .init(stars: 4, flag: .reject)).contains(#"xmp:Rating="-1""#))
    }

    func testDevelopOnlyAddsItsOwnFieldToAnotherAppsSidecar() throws {
        let json = #"{"format":"rawboy-edit","version":1,"values":{"exposure":0.5}}"#
        let out = try XmpSidecar.writeDevelop(lightroom, json)
        XCTAssertEqual(XmpSidecar.readDevelop(out), json)
        // Remove what we added: the rest is byte for byte what it was.
        let back = out.replacingOccurrences(of: #"\n\s+xmlns:rawboy="[^"]+"\n\s+rawboy:Develop="[^"]*""#, with: "", options: .regularExpression)
        XCTAssertEqual(back, lightroom)
        // Writing nil takes the field out, leaving the namespace declaration, which is harmless.
        XCTAssertNil(XmpSidecar.readDevelop(try XmpSidecar.writeDevelop(out, nil)))
        XCTAssertEqual(XmpSidecar.readRating(out), .init(stars: 2))
    }

    func testDevelopReplacesInPlaceAndEscapesJson() throws {
        let first = try XmpSidecar.writeDevelop(nil, #"{"a":"x & <y> \"z\" 'q'"}"#)
        XCTAssertFalse(first.contains("<y>"))
        XCTAssertEqual(XmpSidecar.readDevelop(first), #"{"a":"x & <y> "z" 'q'"}"#.replacingOccurrences(of: #" "z" "#, with: #" \"z\" "#))
        let second = try XmpSidecar.writeDevelop(first, "{}")
        XCTAssertEqual(second.components(separatedBy: "rawboy:Develop").count - 1, 1)
        XCTAssertEqual(XmpSidecar.readDevelop(second), "{}")
        // The element form (darktable writes elements) is changed in place.
        let el = #"<rdf:Description rdf:about=""><rawboy:Develop>{&quot;x&quot;:1}</rawboy:Develop></rdf:Description>"#
        XCTAssertEqual(XmpSidecar.readDevelop(el), #"{"x":1}"#)
        XCTAssertEqual(try XmpSidecar.writeDevelop(el, "{}"), #"<rdf:Description rdf:about=""><rawboy:Develop>{}</rawboy:Develop></rdf:Description>"#)
    }

    func testRefusesTextThatIsNoSidecar() {
        XCTAssertThrowsError(try XmpSidecar.writeDevelop("hello", "{}")) { XCTAssertEqual($0 as? XmpSidecar.WriteError, .notASidecar) }
    }

    func testOrientationAndDelta() throws {
        XCTAssertEqual(XmpSidecar.readOrientation(try XmpSidecar.writeOrientation(nil, 6)), 6)
        XCTAssertNil(XmpSidecar.readOrientation(#"<rdf:Description tiff:Orientation="9"/>"#))
        // A sidecar saying "turned clockwise" on a photo whose file is already turned (6): up turns it back.
        XCTAssertEqual(ExifOrientation.delta(file: 1, sidecar: 6), ExifOrientation(quarterTurns: 1))
        XCTAssertEqual(ExifOrientation.delta(file: 6, sidecar: 6), ExifOrientation())
        XCTAssertEqual(ExifOrientation.delta(file: 6, sidecar: 1), ExifOrientation(quarterTurns: 3))
        XCTAssertEqual(ExifOrientation.delta(file: 1, sidecar: 2), ExifOrientation(mirrored: true))
        XCTAssertEqual(ExifOrientation.delta(file: 8, sidecar: 3), ExifOrientation(quarterTurns: 3))
    }

    // MARK: Files

    private func folder() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("rawboy-xmp-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return dir
    }

    func testSidecarChoiceFollowsTheWebsOrder() throws {
        let dir = try folder()
        let photo = dir.appendingPathComponent("IMG_1.RAF")
        XCTAssertEqual(PhotoSidecar(photo: photo).url.lastPathComponent, "IMG_1.xmp")           // new
        try "x".write(to: dir.appendingPathComponent("IMG_1.RAF.xmp"), atomically: true, encoding: .utf8)
        XCTAssertEqual(PhotoSidecar(photo: photo).url.lastPathComponent, "IMG_1.RAF.xmp")       // darktable's
        try "x".write(to: dir.appendingPathComponent("img_1.XMP"), atomically: true, encoding: .utf8)
        XCTAssertEqual(PhotoSidecar(photo: photo).url.lastPathComponent, "img_1.XMP")           // NAME.xmp wins, any case
    }

    func testWriteDevelopCreatesEditsAtomicallyAndKeepsTheRest() throws {
        let dir = try folder()
        let photo = dir.appendingPathComponent("IMG_2.DNG")
        let side = PhotoSidecar(photo: photo)
        try side.writeDevelop(nil)
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("IMG_2.xmp").path))  // nothing to say, no file
        try side.writeDevelop(#"{"format":"rawboy-edit","version":1,"values":{"contrast":5}}"#)
        XCTAssertEqual(side.readDevelop(), #"{"format":"rawboy-edit","version":1,"values":{"contrast":5}}"#)
        // Another app's data in a darktable-style sidecar survives.
        let dt = dir.appendingPathComponent("IMG_3.DNG.xmp")
        try lightroom.write(to: dt, atomically: true, encoding: .utf8)
        let other = PhotoSidecar(photo: dir.appendingPathComponent("IMG_3.DNG"))
        try other.writeDevelop("{}")
        try other.writeDevelop(nil)
        let text = try XCTUnwrap(other.readText())
        XCTAssertTrue(text.contains(#"crs:Exposure2012="+0.35""#))
        XCTAssertTrue(text.contains("<crs:ToneCurvePV2012>"))
        // No temporary files left behind.
        let names = try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
        XCTAssertEqual(names, ["IMG_2.xmp", "IMG_3.DNG.xmp"])
    }

    func testEditsThroughASidecarAndTheViewersGeometry() throws {
        var defaults = DevelopParams()
        defaults.temperature = 5200
        var p = defaults
        p.exposure = 0.4
        p.rotation = 1
        let json = try XCTUnwrap(Edits.encode(p, defaults: defaults))
        let dir = try folder()
        let side = PhotoSidecar(photo: dir.appendingPathComponent("a.CR2"))
        try side.writeDevelop(json)
        XCTAssertEqual(Edits.decode(try XCTUnwrap(side.readDevelop()), defaults: defaults), p)
        // RawBoy Viewer's write of a crop (sorted keys, six decimals) reads as the crop.
        let viewer = #"{"format":"rawboy-edit","values":{"cropBottom":0.85,"cropLeft":0.1,"cropRight":0.9,"cropTop":0.15,"flipHorizontal":true,"rotation":3},"version":1}"#
        let g = try XCTUnwrap(Edits.decode(viewer, defaults: defaults))
        XCTAssertEqual(g.rotation, 3)
        XCTAssertTrue(g.flipHorizontal)
        XCTAssertEqual([g.cropLeft, g.cropTop, g.cropRight, g.cropBottom], [0.1, 0.15, 0.9, 0.85])
    }

    // MARK: Shared fixtures

    /// `Fixtures/Xmp`, the same files and expectations as RawBoy Viewer's `RawBoyBrowseKitTests/Fixtures/Xmp`: what
    /// darktable, Lightroom and RawBoy's web write must read the same in both Swift copies of `XmpSidecar`.
    private struct Fixture {
        let name: String
        let text: String
        let rating: XmpSidecar.Rating
        let orientation: Int?
        let develop: String?
        let auto: String?
    }

    private func fixtures() throws -> [Fixture] {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/Xmp")
        let data = try Data(contentsOf: dir.appendingPathComponent("expected.json"))
        let all = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: [String: Any]])
        return try all.keys.sorted().map { name in
            let e = all[name]!
            let flag: XmpSidecar.Flag? = (e["flag"] as? String).map { $0 == "pick" ? .pick : .reject }
            return Fixture(name: name, text: try String(contentsOf: dir.appendingPathComponent(name), encoding: .utf8),
                           rating: .init(stars: e["stars"] as! Int, flag: flag), orientation: e["orientation"] as? Int,
                           develop: e["develop"] as? String, auto: e["auto"] as? String)
        }
    }

    func testFixturesReadAsExpected() throws {
        let all = try fixtures()
        XCTAssertGreaterThanOrEqual(all.count, 5)
        for f in all {
            XCTAssertEqual(XmpSidecar.readRating(f.text), f.rating, "\(f.name) rating")
            XCTAssertEqual(XmpSidecar.readOrientation(f.text), f.orientation, "\(f.name) orientation")
            XCTAssertEqual(XmpSidecar.readDevelop(f.text), f.develop, "\(f.name) develop")
            XCTAssertEqual(XmpSidecar.readAuto(f.text), f.auto, "\(f.name) auto")
        }
    }

    func testFixturesWritingWhatIsThereChangesNothing() throws {
        for f in try fixtures() {
            XCTAssertEqual(try XmpSidecar.writeRating(f.text, f.rating), f.text, "\(f.name) rating")
            XCTAssertEqual(try XmpSidecar.writeOrientation(f.text, f.orientation), f.text, "\(f.name) orientation")
            XCTAssertEqual(try XmpSidecar.writeDevelop(f.text, f.develop), f.text, "\(f.name) develop")
            XCTAssertEqual(try XmpSidecar.writeAuto(f.text, f.auto), f.text, "\(f.name) auto")
        }
    }

    func testFixturesARatingChangeTouchesOnlyTheRating() throws {
        for f in try fixtures() {
            let other = XmpSidecar.Rating(stars: f.rating.stars == 3 ? 4 : 3, flag: f.rating.flag == .reject ? nil : f.rating.flag)
            let changed = try XmpSidecar.writeRating(f.text, other)
            XCTAssertEqual(XmpSidecar.readRating(changed), other, f.name)
            XCTAssertEqual(XmpSidecar.readOrientation(changed), f.orientation, f.name)
            XCTAssertEqual(XmpSidecar.readDevelop(changed), f.develop, f.name)
            XCTAssertEqual(XmpSidecar.readAuto(changed), f.auto, f.name)
            XCTAssertEqual(try XmpSidecar.writeRating(changed, f.rating), f.text, "\(f.name) back")
        }
    }

    func testFixturesDevelopAndAutoLeaveTheRestOfAnotherAppsSidecarAlone() throws {
        let json = #"{"format":"rawboy-edit","version":1,"values":{"exposure":0.5}}"#
        for f in try fixtures() where f.develop == nil && f.auto == nil {
            let out = try XmpSidecar.writeAuto(XmpSidecar.writeDevelop(f.text, json), "{}")
            XCTAssertEqual(XmpSidecar.readDevelop(out), json, f.name)
            XCTAssertEqual(XmpSidecar.readRating(out), f.rating, f.name)
            let back = out.replacingOccurrences(of: #"\n\s+(rawboy:(Develop|Auto)|xmlns:rawboy)="[^"]*""#, with: "", options: .regularExpression)
            XCTAssertEqual(back, f.text, f.name)
            XCTAssertFalse(try XmpSidecar.writeDevelop(out, nil).contains("rawboy:Develop"), f.name)
        }
    }

    func testFixtureWebDevelopDecodesAsEdits() throws {
        let web = try XCTUnwrap(try fixtures().first { $0.name == "web-develop.xmp" })
        let defaults = DevelopParams()
        let p = try XCTUnwrap(Edits.decode(try XCTUnwrap(XmpSidecar.readDevelop(web.text)), defaults: defaults))
        XCTAssertEqual(p.rotation, 1)
        XCTAssertEqual([p.cropLeft, p.cropTop, p.cropRight, p.cropBottom], [0.1, 0.05, 0.9, 0.8])
    }
}
