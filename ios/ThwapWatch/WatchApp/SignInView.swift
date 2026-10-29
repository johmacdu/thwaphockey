import SwiftUI
import ThwapCore

/// First launch: team code + player code, then a parent approves by email.
/// The kid never types an email and never sees one. Big targets (48pt+).
struct SignInView: View {
    @EnvironmentObject var model: AppModel
    @State private var teamCode = ""
    @State private var playerCode = ""

    private var ready: Bool {
        !teamCode.trimmingCharacters(in: .whitespaces).isEmpty && playerCode.count >= 3 && !model.signingIn
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Hey 👋")
                    .font(.system(.title3, design: .rounded).weight(.black))
                Text("Sign in to Thwap.")
                    .font(.footnote)
                    .foregroundStyle(ThwapTheme.green2)

                field("Team code", text: $teamCode)
                    .textInputAutocapitalization(.characters)
                    .onChange(of: teamCode) { _, v in
                        let clean = String(v.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(16))
                        if clean != v { teamCode = clean }
                    }
                    .accessibilityHint("Letters and numbers. Your coach has it.")

                field("Your code", text: $playerCode)
                    .onChange(of: playerCode) { _, v in
                        let clean = String(v.filter(\.isNumber).prefix(8))
                        if clean != v { playerCode = clean }
                    }
                    .accessibilityHint("Your secret number. Ask your coach if you are not sure.")

                Text("Ask your coach if you are not sure.")
                    .font(.caption2)
                    .foregroundStyle(ThwapTheme.muted)

                if let err = model.signInError {
                    Text(err)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(ThwapTheme.green2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.updatesFrequently)
                }

                Button {
                    Task { await model.requestApproval(teamCode: teamCode, code: playerCode) }
                } label: {
                    Group {
                        if model.signingIn { ProgressView() } else { Text("Ask a parent") }
                    }
                    .font(.system(.headline, design: .rounded).weight(.black))
                    .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent)
                .tint(ThwapTheme.lime)
                .foregroundStyle(ThwapTheme.ink)
                .disabled(!ready)
                .accessibilityHint("Emails your parent to approve this watch")
            }
            .padding(.horizontal, 4)
        }
        .background(ThwapTheme.bg)
    }

    private func field(_ label: String, text: Binding<String>) -> some View {
        TextField(label, text: text)
            .autocorrectionDisabled()
            .font(.system(.body, design: .rounded).weight(.heavy))
            .frame(minHeight: 48)
            .accessibilityLabel(label)
    }
}

/// "Ask a parent": waits for the Approve tap. The poller runs in the model;
/// this screen only shows where it got to.
struct WaitingView: View {
    @EnvironmentObject var model: AppModel
    let sent: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                switch model.waitEnd {
                case nil: waiting
                case .denied: ended("Not this time.", "Your parent said no for now.")
                case .expired: ended("Link ran out.", "Ask again and your parent gets a new email.")
                case .timedOut: ended("Still waiting?", "Ask again and your parent gets a new email.")
                }
            }
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity)
        }
        .background(ThwapTheme.bg)
    }

    private var waiting: some View {
        VStack(spacing: 8) {
            Text("📧")
                .font(.system(size: 34))
                .accessibilityHidden(true)
            Text("Ask a parent")
                .font(.system(.title3, design: .rounded).weight(.black))
            Text(sent ? "We emailed your parent. Ask them to tap Approve."
                      : "No parent email on file. Ask your coach to add one.")
                .font(.footnote)
                .foregroundStyle(ThwapTheme.green2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            ProgressView()
                .tint(ThwapTheme.lime)
                .accessibilityLabel("Waiting for your parent")
            Button("Cancel") { model.cancelWaiting() }
                .font(.system(.headline, design: .rounded).weight(.heavy))
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .accessibilityElement(children: .contain)
    }

    private func ended(_ title: String, _ body: String) -> some View {
        VStack(spacing: 8) {
            Text(title)
                .font(.system(.title3, design: .rounded).weight(.black))
                .multilineTextAlignment(.center)
            Text(body)
                .font(.footnote)
                .foregroundStyle(ThwapTheme.green2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                model.cancelWaiting()
            } label: {
                Text("Try again")
                    .font(.system(.headline, design: .rounded).weight(.black))
                    .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.borderedProminent)
            .tint(ThwapTheme.lime)
            .foregroundStyle(ThwapTheme.ink)
        }
    }
}
