// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FriendyMacOSSensor",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "friendy-macos-sensor", targets: ["FriendyMacOSSensor"])
    ],
    targets: [
        .executableTarget(name: "FriendyMacOSSensor")
    ]
)
