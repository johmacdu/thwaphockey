import SwiftUI
import ThwapCore

/// The pages of the watch home, top to bottom. The Digital Crown flips them
/// one at a time (a vertical paged TabView), like Apple's Activity app.
enum HomePage: Hashable {
    case hello
    case category(Discipline)
    case season
    case team
    case more
}

/// Home: Hello, one page per category of today's list, My Season, Team, and a
/// last small page for sync status and Sign out.
struct HomePager: View {
    @EnvironmentObject var model: AppModel
    @Binding var page: HomePage
    @Binding var showGoals: Bool
    @Binding var openCategory: Discipline?

    var body: some View {
        TabView(selection: $page) {
            HelloPage(page: $page, showGoals: $showGoals)
                .tag(HomePage.hello)
            ForEach(model.categories) { summary in
                CategoryPage(summary: summary) { openCategory = summary.discipline }
                    .tag(HomePage.category(summary.discipline))
            }
            SeasonPage()
                .tag(HomePage.season)
            TeamPage()
                .tag(HomePage.team)
            MorePage()
                .tag(HomePage.more)
        }
        .tabViewStyle(.verticalPage)
        .toolbar(.hidden, for: .navigationBar)
    }
}

/// Shared frame for one home page: leading aligned, full height, Thwap
/// background, clear of the page indicator on the right.
struct PageFrame<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.leading, 12)
        .padding(.trailing, 14)
        .padding(.top, 4)
        .padding(.bottom, 10)
        .ignoresSafeArea(edges: .bottom)
        .containerBackground(ThwapTheme.bg, for: .tabView)
    }
}

/// Page 1: the greeting, and today's categories at a glance.
struct HelloPage: View {
    @EnvironmentObject var model: AppModel
    @Binding var page: HomePage
    @Binding var showGoals: Bool

    var body: some View {
        PageFrame {
            Eyebrow(text: model.team?.teamName ?? "Thwap")
                .padding(.top, 16)
            VStack(alignment: .leading, spacing: 0) {
                Text("Hey")
                    .foregroundStyle(ThwapTheme.ice)
                Text(model.firstName)
                    .foregroundStyle(ThwapTheme.lime)
            }
            .font(ThwapTheme.display(26, relativeTo: .title2))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .layoutPriority(1)
            .padding(.top, 4)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Hey \(model.firstName)")

            if let plan = model.plan {
                let cats = model.categories
                if cats.isEmpty {
                    Text(TodayPlan.restHeading)
                        .font(ThwapTheme.body(15))
                        .foregroundStyle(ThwapTheme.green2)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 14)
                    Spacer(minLength: 0).layoutPriority(-1)
                } else {
                    HStack(spacing: 6) {
                        ForEach(cats) { c in
                            Button { page = .category(c.discipline) } label: {
                                VStack(spacing: 4) {
                                    CategoryIcon(discipline: c.discipline, size: 26)
                                    Text(c.tileLine)
                                        .font(ThwapTheme.body(12, .black, relativeTo: .caption))
                                        .foregroundStyle(ThwapTheme.color(c.discipline))
                                        .lineLimit(1)
                                }
                                .frame(maxWidth: .infinity, minHeight: 50)
                                .padding(.vertical, 6)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(ThwapTheme.card))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(c.accessibilityLine)
                            .accessibilityHint("Goes to the \(c.title) page")
                        }
                    }
                    .padding(.top, 14)
                    Spacer(minLength: 0).layoutPriority(-1)
                    if plan.isGameDay {
                        Button { showGoals = true } label: {
                            HStack(spacing: 4) {
                                Text("🎯 Game day goals")
                                    .font(ThwapTheme.body(14, .black))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.8)
                                    .layoutPriority(1)
                                Spacer(minLength: 0).layoutPriority(-1)
                                Image(systemName: "chevron.right").font(.footnote.weight(.bold))
                                    .foregroundStyle(ThwapTheme.muted)
                            }
                            .foregroundStyle(ThwapTheme.ice)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Shows the goals you picked for today's game")
                    } else {
                        if plan.dayHeading == TodayPlan.bonusHeading {
                            Text(TodayPlan.bonusHeading)
                                .font(ThwapTheme.body(12, .black, relativeTo: .caption))
                                .foregroundStyle(ThwapTheme.green2)
                                .frame(maxWidth: .infinity)
                                .padding(.bottom, 2)
                        }
                        Text("Turn the crown to start")
                            .font(ThwapTheme.body(12, .bold, relativeTo: .caption))
                            .foregroundStyle(ThwapTheme.muted)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .layoutPriority(1)
                            .frame(maxWidth: .infinity)
                            .padding(.bottom, 4)
                    }
                }
            } else if model.loadFailed {
                Text("No signal. Try again at the rink.")
                    .font(ThwapTheme.body(14, .bold))
                    .foregroundStyle(ThwapTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 14)
                Spacer(minLength: 0).layoutPriority(-1)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.top, 14)
                Spacer(minLength: 0).layoutPriority(-1)
            }
        }
    }
}

/// One category: big icon, name, progress, and one button. Everything on the
/// page opens the category's drill list, where the player picks the drill.
/// Nothing starts on its own.
struct CategoryPage: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let summary: CategorySummary
    let openList: () -> Void

    var body: some View {
        let accent = ThwapTheme.color(summary.discipline)
        PageFrame {
            Button(action: openList) {
                VStack(alignment: .leading, spacing: 0) {
                    CategoryIcon(discipline: summary.discipline, size: 56)
                        .padding(.top, 2)
                    Text(summary.title)
                        .font(ThwapTheme.display(30, relativeTo: .title))
                        .foregroundStyle(ThwapTheme.ice)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .layoutPriority(1)
                        .padding(.top, 10)
                    Text(summary.progressLine)
                        .font(ThwapTheme.body(15))
                        .foregroundStyle(summary.isComplete ? ThwapTheme.lime : accent)
                        .lineLimit(1)
                        .padding(.top, 4)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHidden(true)

            ProgressBar(fraction: summary.fraction, color: summary.isComplete ? ThwapTheme.lime : accent)
                .frame(height: 8)
                .padding(.top, 10)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.3), value: summary.fraction)

            Spacer(minLength: 8).layoutPriority(-1)

            PillButton(title: summary.buttonTitle,
                       fill: summary.isComplete ? ThwapTheme.soft : accent,
                       text: summary.isComplete ? ThwapTheme.text2 : ThwapTheme.ink,
                       action: openList)
                .accessibilityLabel(summary.pageAccessibilityLine)
                .accessibilityHint("Opens the \(summary.title) drills")
        }
    }
}

/// The last page: what this watch still has to sync, and Sign out.
struct MorePage: View {
    @EnvironmentObject var model: AppModel
    @State private var confirmSignOut = false

    var body: some View {
        PageFrame {
            Eyebrow(text: "This watch")
                .padding(.top, 16)
            Text(model.waitingToSync > 0
                 ? "\(model.waitingToSync) waiting to sync"
                 : "All synced")
                .font(ThwapTheme.body(15))
                .foregroundStyle(ThwapTheme.ice)
                .padding(.top, 6)
            if let notice = model.notice {
                Text(notice)
                    .font(ThwapTheme.body(12, .bold, relativeTo: .caption))
                    .foregroundStyle(ThwapTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
            Spacer(minLength: 8).layoutPriority(-1)
            PillButton(title: "Sign out", fill: ThwapTheme.soft, text: ThwapTheme.text2) { confirmSignOut = true }
        }
        .alert("Sign out?", isPresented: $confirmSignOut) {
            Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            Button("Stay", role: .cancel) {}
        } message: {
            Text(model.pendingCount > 0
                 ? "\(model.pendingCount) \(model.pendingCount == 1 ? "drill has" : "drills have") not synced yet. Sign out anyway?"
                 : "A parent will need to approve this watch again.")
        }
    }
}

