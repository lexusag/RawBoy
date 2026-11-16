Sidecars as other apps and RawBoy's web write them, with what `XmpSidecar` must read from each (`expected.json`).
The same folder is in RawBoy (`ios/EngineTests/Fixtures/Xmp`) and RawBoyImageViewer (`Packages/Tests/RawBoyBrowseKitTests/Fixtures/Xmp`); both
test suites check it, so keep the copies identical. Files are bytes, not text: `.gitattributes` stops line-ending changes (crlf.xmp).
