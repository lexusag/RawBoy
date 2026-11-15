import XCTest
@testable import RawBoyEngine

/** Web's lensfun.test.ts, on the database bundled with the engine. */
final class LensfunTests: XCTestCase {
    private static let folder = LutRepository.resourceBundle.resourceURL!.appendingPathComponent("lensfun", isDirectory: true)
    private static let index = try! Lensfun.parseIndex(Data(contentsOf: folder.appendingPathComponent("index.json")))
    private var index: Lensfun.Index { Self.index }

    private func setsOf(_ name: String) throws -> (sets: [Lensfun.CalibrationSet], lens: Lensfun.Lens) {
        let lens = try XCTUnwrap(index.lenses.first { $0.model == name })
        let chunk = try Data(contentsOf: Self.folder.appendingPathComponent("calib-\(index.chunks[lens.chunk]).json"))
        return (try Lensfun.calibrations(chunk, lensId: lens.id), lens)
    }

    private let shot = Lensfun.Shot(crop: 1.534, focal: 16, aperture: 2.8, distance: 1000)

    // MARK: - Database

    func testDatabaseHasTheExpectedSizeAndSource() {
        XCTAssertGreaterThan(index.cameras.count, 900)
        XCTAssertGreaterThan(index.lenses.count, 1400)
        XCTAssertNotNil(index.commit.range(of: "^[0-9a-f]{40}$", options: .regularExpression))
    }

    func testMatchesExifCameraAndLensNames() throws {
        let cam = try XCTUnwrap(Lensfun.matchCamera(index, make: "SONY", model: "NEX-7"))
        XCTAssertEqual(cam.model, "NEX-7")
        XCTAssertEqual(cam.crop, 1.534, accuracy: 0.0005)
        XCTAssertEqual(Lensfun.matchCamera(index, make: "NIKON CORPORATION", model: "NIKON D750")?.model, "Nikon D750")
        XCTAssertNil(Lensfun.matchCamera(index, make: "Nobody", model: "Imaginary 9000"))
        XCTAssertEqual(Lensfun.matchLens(index, lensMake: "Sony", lensModel: "E 16mm F2.8", camera: cam, focal: 16)?.model, "E 16mm f/2.8")
        XCTAssertNil(Lensfun.matchLens(index, lensMake: "", lensModel: "Some Unknown 17-35mm lens", camera: cam, focal: 20))
        let fuji = try XCTUnwrap(Lensfun.matchCamera(index, make: "FUJIFILM", model: "X-T3"))
        let xf = try XCTUnwrap(Lensfun.matchLens(index, lensMake: "FUJIFILM", lensModel: "XF18-55mmF2.8-4 R LM OIS", camera: fuji, focal: 30))
        XCTAssertNotNil(xf.model.range(of: #"XF ?18-55mm ?F ?2\.8-4"#, options: [.regularExpression, .caseInsensitive]), xf.model)
        // The mount keeps a Canon EF lens off a Fuji body.
        XCTAssertNil(Lensfun.matchLens(index, lensMake: "Canon", lensModel: "EF50mm f/1.8 II", camera: fuji, focal: 50))
    }

    func testSearchesByWords() {
        let hits = Lensfun.searchByWords(index.lenses, "sony 16 f/2.8") { "\($0.maker) \($0.model)" }
        XCTAssertTrue(hits.contains { $0.model == "E 16mm f/2.8" })
    }

    func testNamesAreSquashedAndSplitAsOnTheWeb() {
        XCTAssertEqual(Lensfun.squash("XF18-55mmF2.8-4 R LM OIS"), Lensfun.squash("XF 18-55mm f/2.8-4 R LM OIS"))
        XCTAssertEqual(Lensfun.tokens("The XF 18-55mm f/2.8-4 lens"), ["xf", "18", "55", "mm", "f", "2.8", "4"])
        XCTAssertEqual(Lensfun.makerKey("NIKON CORPORATION"), "nikon")
    }

    // MARK: - Correction

    func testWarpReproducesThePtlensModel() throws {
        let (sets, lens) = try setsOf("E 16mm f/2.8")
        let c = Lensfun.correction(sets, shot, lens: lens)
        let warp = try XCTUnwrap(c.warp)
        XCTAssertEqual(warp.planes, 3)
        XCTAssertEqual(warp.coefficients.count, 18)
        XCTAssertLessThan(c.warpError, 2e-4)
        // Direct evaluation of the model at the corner (a, b, c from the database, one set, exact focal).
        let f = Lensfun.distortionFactor(sets[0].distortion[0], sets[0], shotCrop: shot.crop, realFocal: 16)
        let k = warp.coefficients
        XCTAssertEqual(k[6] + k[7] + k[8] + k[9], f(1), accuracy: 0.0005)
        XCTAssertEqual(c.summary, "distortion, chromatic aberration, vignetting")
    }

    func testVignettingGainAtTheCornerEqualsTheModel() throws {
        let (sets, lens) = try setsOf("E 16mm f/2.8")
        let k = try XCTUnwrap(Lensfun.correction(sets, shot, lens: lens).vignette).k
        let gain = 1 + k[0] + k[1] + k[2] + k[3] + k[4]
        let e = try XCTUnwrap(sets[0].vignetting.first { $0[1] == 2.8 && $0[2] == 1000 })
        XCTAssertLessThan(abs(gain / (1 / (1 + e[3] + e[4] + e[5])) - 1), 0.01)
        XCTAssertGreaterThan(gain, 1.5)
    }

    func testIdentityAtTheCentreAndNoData() throws {
        let (sets, lens) = try setsOf("E 16mm f/2.8")
        let c = Lensfun.correction(sets, shot, lens: lens)
        XCTAssertEqual(try XCTUnwrap(c.warp).coefficients[0], 1, accuracy: 0.05)
        XCTAssertNil(Lensfun.correction([], shot).warp)
        XCTAssertEqual(Lensfun.correction([], shot).summary, "")
    }

    func testFollowsLensfunsCropRule() throws {
        let (sets, lens) = try setsOf("E 16mm f/2.8")
        // No profile for a bigger sensor than the lens was measured on.
        XCTAssertNil(Lensfun.correction(sets, Lensfun.Shot(crop: 1, focal: 16, aperture: 2.8), lens: lens).warp)
        // A smaller sensor (Micro Four Thirds crop 2) uses the central part: weaker vignetting at its corner.
        let small = Lensfun.correction(sets, Lensfun.Shot(crop: 2, focal: 16, aperture: 2.8), lens: lens)
        let full = Lensfun.correction(sets, shot, lens: lens)
        func corner(_ k: [Double]) -> Double { k.reduce(1, +) }
        XCTAssertLessThan(corner(try XCTUnwrap(small.vignette).k), corner(try XCTUnwrap(full.vignette).k))
    }

    // MARK: - Maths

    func testPoly3AndPtlensWithEqualTermsAgree() {
        let set = Lensfun.CalibrationSet(crop: 1, aspect: 1.5)
        let p3 = Lensfun.distortionFactor([50, 0, 0, 0.02], set, shotCrop: 1, realFocal: 50)
        let pt = Lensfun.distortionFactor([50, 0, 2, 0, 0.02, 0], set, shotCrop: 1, realFocal: 50)
        for u in [0, 0.3, 0.7, 1] { XCTAssertEqual(p3(u), pt(u), accuracy: 1e-9) }
    }

    func testFitsAnEvenPolynomialExactly() {
        let k = Lensfun.fitEven({ u in 1 + 0.1 * u * u - 0.05 * pow(u, 4) }, terms: 4, first: 0)
        XCTAssertEqual(k[0], 1, accuracy: 1e-6)
        XCTAssertEqual(k[1], 0.1, accuracy: 1e-6)
        XCTAssertEqual(k[2], -0.05, accuracy: 1e-6)
        XCTAssertEqual(k[3], 0, accuracy: 1e-6)
    }

    func testInterpolatesBetweenFocalLengths() throws {
        let set = Lensfun.CalibrationSet(crop: 1, aspect: 1.5, distortion: [[20, 0, 2, 0, 0.04, 0], [40, 0, 2, 0, 0, 0]])
        func k1(_ focal: Double) throws -> Double {
            abs(try XCTUnwrap(Lensfun.correction([set], Lensfun.Shot(crop: 1, focal: focal, aperture: 4)).warp).coefficients[1])
        }
        XCTAssertGreaterThan(try k1(20), try k1(30))
        XCTAssertGreaterThan(try k1(30), try k1(40))
    }

    // MARK: - Generic lenses

    func testGenericLensHasNoDataWithoutCoefficients() {
        XCTAssertEqual(Lensfun.genericCalibration(Lensfun.GenericLens()), [])
        var g = Lensfun.GenericLens()
        g.crop = 1.5
        g.a = 0.01
        g.k1 = -0.5
        let c = Lensfun.correction(Lensfun.genericCalibration(g), Lensfun.Shot(crop: 1.5, focal: 50, aperture: 2.8))
        XCTAssertNotNil(c.warp)
        XCTAssertEqual(c.warp?.planes, 1)
        XCTAssertNotNil(c.vignette)
    }

    func testFisheyeFieldOfView() {
        // Full frame 15 mm equidistant: 21.63 mm half diagonal / 15 mm = 1.442 rad → 165°.
        XCTAssertEqual(Lensfun.fisheyeFov(.fisheye, focal: 15, crop: 1), 165.2, accuracy: 0.5)
        XCTAssertEqual(Lensfun.fisheyeFov(.equisolid, focal: 15, crop: 1), 180, accuracy: 5)
        XCTAssertEqual(Lensfun.fisheyeFov(.rectilinear, focal: 15, crop: 1), 0)
        XCTAssertEqual(Lensfun.cropFactor(width: 36, height: 24), 1, accuracy: 1e-6)
        XCTAssertEqual(Lensfun.cropFactor(width: 23.5, height: 15.6), 1.534, accuracy: 0.005)
    }

    // MARK: - In the lens transform

    func testProfileMovesEachColourPlaneAsTheModelSays() throws {
        let (sets, lens) = try setsOf("E 16mm f/2.8")
        let c = Lensfun.correction(sets, shot, lens: lens)
        let base = LensInfo(lensName: "", width: 6000, height: 4000, sensorWidth: 6000, sensorHeight: 4000, orientation: 1,
                            warp: nil, vignette: nil, shading: nil, gainMapsApplied: 0)
        let info = base.withLensfun(warp: c.warp, vignette: c.vignette, label: "x")
        XCTAssertTrue(info.hasProfile)
        XCTAssertEqual(info.lensfunLabel, "x")
        XCTAssertNil(base.lensfunLabel)
        let t = LensTransform(info: info, params: DevelopParams(), knownZoom: 1)
        let fd = Lensfun.distortionFactor(sets[0].distortion[0], sets[0], shotCrop: shot.crop, realFocal: 16)
        let g = t.source(0, 0, plane: 1)
        // Corner (0, 0) is u = 1 from the centre; the source is the centre plus the offset times the factor.
        // Within a pixel at the corner of a 24 MP frame (the even-polynomial fit's error).
        XCTAssertLessThan(abs(g[0] - (3000 - 3000 * fd(1))), 1)
        XCTAssertLessThan(abs(g[1] - (2000 - 2000 * fd(1))), 1)
        // The red and blue planes differ from green by the (small) lateral CA.
        let gm = t.source(1200, 800, plane: 1)[0]
        let r = t.source(1200, 800, plane: 0)[0]
        let b = t.source(1200, 800, plane: 2)[0]
        XCTAssertGreaterThan(abs(r - gm), 0.3)
        XCTAssertLessThan(abs(r - gm), 20)
        XCTAssertLessThan(abs(b - gm), 20)
        XCTAssertNil(info.fisheyeCircle)
    }

    func testBundledDataLoadsThroughTheActor() async throws {
        let data = LensfunData()
        let db = try await data.index()
        let lens = try XCTUnwrap(db.lenses.first { $0.model == "E 16mm f/2.8" })
        let sets = try await data.calibrations(lens)
        XCTAssertFalse(sets.isEmpty)
    }
}
