import WatchKit

/// One place for every haptic, so the map is easy to tune on a real wrist.
///
/// | Moment              | WKHapticType     |
/// |---------------------|------------------|
/// | Timer starts        | `.start`         |
/// | Any set ends        | `.notification`  |
/// | Check-off stamp     | `.success`       |
///
/// Why `.notification` for set end: it is the strongest, longest tap in the
/// set, so a kid mid-rep with eyes on the puck still feels it through a glove
/// cuff. Why `.success` for the stamp: `.notification` reads as "look at me",
/// while `.success` is a firm rising double tap that reads as "got it", which
/// is what a stamp is. Keeping `.success` for the stamp alone keeps it special.
/// Both need a real watch to judge; the simulator plays no haptics.
enum Haptics {
    static func timerStart() { play(.start) }
    static func setEnd() { play(.notification) }
    static func stamp() { play(.success) }

    private static func play(_ type: WKHapticType) {
        WKInterfaceDevice.current().play(type)
    }
}
