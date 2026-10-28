import Foundation

/// Pure, clock-free drill timer. The view feeds it elapsed seconds (from a
/// `TimelineView` or a Date delta) and reads back the phase, the countdown and
/// any events crossed since the last read. No Timer, no Date inside, so it is
/// deterministic and unit-testable.
///
/// Phases walk: set 1 work, rest, set 2 work, rest, ... last set work. No rest
/// after the final set.
public struct DrillTimer: Equatable, Sendable {
    public enum Phase: Equatable, Sendable {
        case work(set: Int)   // 1-based
        case rest(afterSet: Int)
        case finished
    }

    public enum Event: Equatable, Sendable {
        case setEnded(Int)    // haptic: set end
        case finished         // haptic: drill end
    }

    public struct State: Equatable, Sendable {
        public var phase: Phase
        /// Whole seconds left in this phase, rounded up (shows 20 at t=0).
        public var remaining: Int
        /// 0...1 progress through THIS phase, for the countdown ring.
        public var phaseProgress: Double
    }

    public let plan: DrillPlan

    public init(plan: DrillPlan) { self.plan = plan }

    /// Total seconds from start to finish.
    public var totalSeconds: Int {
        plan.sets * plan.workSeconds + (plan.sets - 1) * plan.restSeconds
    }

    /// Phase segments in order with their start offsets.
    private var segments: [(phase: Phase, start: Int, length: Int)] {
        var out: [(Phase, Int, Int)] = []
        var t = 0
        for set in 1...plan.sets {
            out.append((.work(set: set), t, plan.workSeconds))
            t += plan.workSeconds
            if set < plan.sets && plan.restSeconds > 0 {
                out.append((.rest(afterSet: set), t, plan.restSeconds))
                t += plan.restSeconds
            }
        }
        return out
    }

    public func state(at elapsed: Double) -> State {
        let e = max(0, elapsed)
        if e >= Double(totalSeconds) {
            return State(phase: .finished, remaining: 0, phaseProgress: 1)
        }
        for seg in segments {
            let end = Double(seg.start + seg.length)
            if e < end {
                let into = e - Double(seg.start)
                let left = Double(seg.length) - into
                return State(phase: seg.phase,
                             remaining: Int(left.rounded(.up)),
                             phaseProgress: into / Double(seg.length))
            }
        }
        return State(phase: .finished, remaining: 0, phaseProgress: 1)
    }

    /// Events whose boundary lies in (from, to]. Calling with overlapping or
    /// repeated windows never re-fires an event, so a view can call this every
    /// frame and play haptics exactly once per boundary.
    public func events(from: Double, to: Double) -> [Event] {
        guard to > from else { return [] }
        var out: [Event] = []
        for set in 1...plan.sets {
            let boundary = Double(set * plan.workSeconds + (set - 1) * plan.restSeconds)
            if boundary > from && boundary <= to {
                out.append(set == plan.sets ? .finished : .setEnded(set))
            }
        }
        return out
    }
}
