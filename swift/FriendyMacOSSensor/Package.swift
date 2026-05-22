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
        .target(
            name: "ContactsHistoryBridge",
            path: "Sources/ContactsHistoryBridge",
            publicHeadersPath: "include"
        ),
        .executableTarget(
            name: "FriendyMacOSSensor",
            dependencies: ["ContactsHistoryBridge"],
            path: "Sources/FriendyMacOSSensor"
        )
    ]
)
