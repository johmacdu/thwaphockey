# Embeds the standalone Apple Watch app (ios/ThwapWatch) in the iPhone app
# (ios/App) so one archive of the App scheme ships both.
#
# Idempotent: run it again any time (for example after a tool rewrites
# App.xcodeproj) and it only adds what is missing.
#
#   cd ios && ruby scripts/embed-watch.rb
#
# Needs the xcodeproj gem, which ships with CocoaPods.
require 'xcodeproj'

IOS_DIR = File.expand_path('..', __dir__)
APP_PROJECT = File.join(IOS_DIR, 'App', 'App.xcodeproj')
WATCH_PROJECT = File.join(IOS_DIR, 'ThwapWatch', 'ThwapWatch.xcodeproj')
WORKSPACE = File.join(IOS_DIR, 'App', 'App.xcworkspace')
PHASE_NAME = 'Embed Watch Content'

project = Xcodeproj::Project.open(APP_PROJECT)
watch_project = Xcodeproj::Project.open(WATCH_PROJECT)
app_target = project.targets.find { |t| t.name == 'App' } or abort 'App target not found'
watch_target = watch_project.targets.find { |t| t.name == 'ThwapWatch' } or abort 'ThwapWatch target not found'

# 1. Subproject reference (App.xcodeproj -> ../ThwapWatch/ThwapWatch.xcodeproj).
sub_ref = project.files.find { |f| f.path.to_s.end_with?('ThwapWatch.xcodeproj') }
unless sub_ref
  # An absolute path here is stored relative to the group (../ThwapWatch/...).
  sub_ref = project.main_group.new_reference(WATCH_PROJECT)
  sub_ref.name = 'ThwapWatch.xcodeproj'
  puts 'added subproject reference'
end

# 2. Target dependency on the ThwapWatch watch app target.
has_dep = app_target.dependencies.any? do |d|
  d.target_proxy && d.target_proxy.remote_global_id_string == watch_target.uuid
end
unless has_dep
  app_target.add_dependency(watch_target)
  puts 'added target dependency'
end

# 3. Product proxy for the watch app (lives in the subproject's Products group).
proxy = project.objects.find do |o|
  o.isa == 'PBXReferenceProxy' && o.remote_ref &&
    o.remote_ref.remote_global_id_string == watch_target.product_reference.uuid
end
abort 'reference proxy for the watch app not found' unless proxy

# 4. "Embed Watch Content" copy-files phase -> $(CONTENTS_FOLDER_PATH)/Watch.
phase = app_target.copy_files_build_phases.find { |p| p.name == PHASE_NAME }
unless phase
  phase = app_target.new_copy_files_build_phase(PHASE_NAME)
  phase.dst_subfolder_spec = '16' # products directory
  phase.dst_path = '$(CONTENTS_FOLDER_PATH)/Watch'
  # Run right after Resources, before the CocoaPods script phases.
  app_target.build_phases.delete(phase)
  idx = app_target.build_phases.index { |p| p.isa == 'PBXResourcesBuildPhase' }
  app_target.build_phases.insert(idx ? idx + 1 : app_target.build_phases.size, phase)
  puts 'added Embed Watch Content phase'
end
unless phase.files_references.include?(proxy)
  bf = phase.add_file_reference(proxy, true)
  bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  puts 'added watch app to embed phase'
end

project.save

# 5. Workspace: list the watch project so its schemes show up next to App.
ws = Xcodeproj::Workspace.new_from_xcworkspace(WORKSPACE)
ref_path = '../ThwapWatch/ThwapWatch.xcodeproj'
unless ws.file_references.any? { |r| r.path == ref_path }
  ws << Xcodeproj::Workspace::FileReference.new(ref_path, 'group')
  ws.save_as(WORKSPACE)
  puts 'added ThwapWatch.xcodeproj to App.xcworkspace'
end

puts 'watch embed: ok'
