// lib/drills.js
//
// THE drill library, daily rotation and guided-timer scripts for Thwap. One
// source of truth for the web app (index.html), the server (api/done.js
// ?view=today / ?view=rings) and, through those endpoints, the Apple Watch.
//
// How index.html gets it: scripts/gen-drills-inline.mjs copies the source of
// createThwapDrills() below, verbatim, into a generated <script> block in
// index.html (between the THWAP-DRILLS markers) that runs
//   window.ThwapDrills = (createThwapDrills)(window);
// test/drills-inline-drift.test.js fails if that block and this file differ.
// So: edit drills HERE, then run  node scripts/gen-drills-inline.mjs .
//
// Rules that keep the factory loadable in both places:
//   - everything lives INSIDE createThwapDrills (no imports, no module-level
//     helpers), because only the function's own source text is copied;
//   - plain ES5 (var/function), like the rest of index.html;
//   - no DOM, no storage, no clock: callers pass the day number (di = whole
//     days since 1970-01-01 UTC for the player's calendar date).
//
// The factory's parameter is named window on purpose. In the browser it IS
// window, so the library keeps publishing window.DRILLS, window.SHOOT_DAYS,
// window.WORKOUTS, window.NETPLAY_DAYS, window.THWAP_DRILL_SCRIPT and
// window.NETPLAY_ENABLED exactly as the inline code did (the stats page, coach
// drill picker and tests read them). On the server it is a throwaway object.
//
// Drill ids are POSITIONAL within one day's list: 'stick:0', 'shoot:2',
// 'dryland:3' (a goalie's Net play rows also use 'shoot:<i>', with discipline
// 'netplay'). Done records in KV reference them, so never reorder a day's list
// without migrating. test/drills-stable-ids.test.js freezes the mapping.

export function createThwapDrills(window) {
/* How-to steps + cue + emoji per movement, defined once. Real reps (dose) are passed per workout. */
var MOVE={
  will:{emoji:'🔢', cue:'Quick, light hops through the square. Head up. 20 seconds each.',
    video:'https://www.youtube.com/watch?v=TiUZ2JfD0do', audio:'dry_01',
    steps:['Set up: Mark a square on the floor. Number the corners 1, 2, 3, 4. Stay low.','Both feet: Hop 1-2, then 1-3, then 1-4. Do each for 20 seconds.','Right foot only: Same patterns. Hop 1-2, 1-3, 1-4. 20 seconds each.','Left foot only: Same thing. Hop 1-2, 1-3, 1-4. 20 seconds each.','Both feet, long patterns: 1-2-3, 1-4-2, 1-2-4-3 and more. 20 seconds each. Push hard, land light, head up.']},
  skater:{emoji:'⛸️', cue:'Jump sideways, stick the landing.', video:'https://www.youtube.com/watch?v=_FuKfMEM0HQ', audio:'dry_02',
    steps:['Start: One leg, knee bent, like a skater push-off.','Jump: Jump sideways and land soft on the other leg.','Stick it: Bend the knee. Hold your balance for one second.','Back: Jump back the other way. Control matters more than distance.']},
  broad:{emoji:'🐸', cue:'Jump forward as far as you can. Land soft.', video:'https://www.youtube.com/watch?v=CwJjpm9bLqA', audio:'dry_03',
    steps:['Stand tall: Feet about hip-width apart.','Load up: Swing your arms back and bend your knees.','Explode: Swing your arms up. Jump as far as you can.','Land soft: Both feet, knees bent. Hold the landing before the next jump.']},
  box:{emoji:'⬆️', cue:'Jump up onto a low box. Land quiet.', video:'https://www.youtube.com/watch?v=L3w73JlNLhY', audio:'dry_04',
    steps:['Face it: Stand facing a sturdy low box or step.','Load: Bend your knees and swing your arms back.','Jump: Jump up and land soft on top with both feet, knees bent.','Step down: Stand up tall. Step (don\'t jump) back down. Reset and repeat.']},
  lunge:{emoji:'🚶', icon:'login/icon-lunge.webp', cue:'Step back, drop down, drive up.', video:'https://www.youtube.com/watch?v=xJh9TACU70s', audio:'dry_05',
    steps:['Stand tall: Hands on hips or out for balance.','Step back: Step one foot straight back. Lower until both knees are an L shape.','Stay tall: Keep your chest up and front knee over your ankle, not past your toes.','Drive up: Push through the front heel to stand back up. Switch legs each rep.']},
  rdl:{emoji:'⚖️', cue:'Balance on one leg. Tip forward like a seesaw.', video:'https://www.youtube.com/watch?v=75fr-5DtU5k', audio:'dry_06',
    steps:['Balance: Stand on one leg with a soft bend in that knee.','Tip: Bend at the hips. Reach toward the floor as your back leg lifts behind you.','Stay level: Keep your back flat and hips level, like a seesaw tipping.','Stand up: Squeeze the standing leg to stand back up tall. Do all reps, then switch legs.']},
  wallsit:{emoji:'🪑', cue:'Sit against the wall. No chair allowed.', video:'https://www.youtube.com/watch?v=M5MKJ4T4e2k', audio:'dry_07',
    steps:['Back flat: Put your back flat against a wall and walk your feet out.','Slide down: Slide down until your knees make an L shape, like sitting in a chair.','Hold: Keep your back flat on the wall. Weight in your heels.','Breathe: Hold for the time. Breathe steady. Then stand up and shake it out.']},
  situps:{emoji:'💪', cue:'Curl up with your belly, not your neck.', video:'https://www.youtube.com/watch?v=sYszIZLOrDc', audio:'dry_08',
    steps:['Down: Lie on your back, knees bent, feet flat on the floor.','Arms: Cross your arms or reach your hands toward your knees.','Curl: Curl up slowly using your belly, not your neck.','Lower: Lower back down with control. Breathe out on the way up.']},
  plank:{emoji:'🪵', icon:'login/icon-plank.webp', cue:'Hold a strong plank. Tap the opposite shoulder. Don\'t rock.', video:'https://www.youtube.com/watch?v=3aLPIhE4AiY', audio:'dry_09',
    steps:['Set up: Get on your hands and toes, arms straight, body in one straight line.','Stay strong: Squeeze your belly so your hips don\'t sag or twist.','Tap across: Lift one hand and tap the opposite shoulder. Put it back down.','Switch hands: Tap the other way. Keep going, slow and steady. Try not to rock your hips.']},
  stairs:{emoji:'🏃', cue:'Run up the stairs fast. Walk back down slow.', video:'https://www.youtube.com/watch?v=RoANiVsltEs', audio:'dry_10',
    steps:['Start: Find a safe set of stairs and start at the bottom.','Sprint: Run up quick and light, one or two steps at a time. Pump your arms.','Eyes up: Keep your eyes up and steps smooth.','Recover: Walk back down slowly to recover. Then go again.']},
  sprint:{emoji:'🏁', cue:'Explode into your first few steps as fast as you can.', video:'https://www.youtube.com/watch?v=Bt2IK8j5SM0', audio:'dry_11',
    steps:['Stance: Ready position, one foot slightly back, knees bent, leaning forward.','Go: On "go," drive your back leg and pump your arms hard.','Explode: Burst into a few fast, powerful steps.','Reset: Slow down safely, walk back, and reset before the next start.']},
  reaction:{emoji:'👀', cue:'Your partner drops a ball. Catch it before the second bounce.', video:'https://www.youtube.com/watch?v=6dAqdNBrW_M', audio:'dry_12',
    steps:['Face up: Face a partner a few steps away. They hold a ball out.','Ready: Stay in a ready position, eyes on the ball, ready to move.','Go: When they drop it, sprint and try to catch it before the second bounce.','Again: Reset and go again. React to the drop, don\'t guess.']},
  splitsquat:{emoji:'🦵', cue:'Drop into a lunge and hold it. Don\'t come up.', video:'https://www.youtube.com/watch?v=ZeLJm2Aw-GM', audio:'dry_13',
    steps:['Lunge: Step into a lunge, one foot forward, one back.','Drop: Lower straight down until both knees are an L shape.','Hold: Keep your chest tall and weight balanced between both legs.','Switch: Hold still for the time, then switch legs.']},
  calf:{emoji:'🩰', cue:'Push up tall on your toes. Come down slow.', video:'https://www.youtube.com/watch?v=L4DjEq33n6g', audio:'dry_14',
    steps:['Stand tall: Feet about hip-width apart. Use a wall for balance.','Up: Push up onto the balls of your feet as high as you can.','Pause: Pause at the top for a second.','Down: Lower slowly back down with control. Repeat.']},
  deadbug:{emoji:'🐞', cue:'Opposite arm and opposite leg go down. Slow and smooth.', video:'https://www.youtube.com/watch?v=ivKimjEpO-4', audio:'dry_15',
    steps:['Start: Lie on your back, arms reaching up, knees bent up over your hips.','Press: Press your low back into the floor. Keep it there.','Lower: Slowly lower one arm overhead and the opposite leg toward the floor.','Switch: Bring them back and switch sides. Keep it slow.']},
  mcdavid:{emoji:'🏒', cue:'Feet moving. Hands working. Eyes up, call the numbers.',
    video:'https://www.youtube.com/watch?v=GQK1RBm8Vx4&t=17', audio:'dry_16',
    steps:['Stance: Get low in a hockey stance. Keep your feet moving fast. Shuffle or crossover over a line.','Stickhandle: Stickhandle a ball or puck right in front of you. Soft, fast touches.','Eyes up: Keep your eyes on your partner. Call out every number they flash.','All at once: Chest forward. Let your hands and feet work. Eyes just read the numbers.']},
  run20:{emoji:'🏃‍♂️', cue:'Go for a 20 minute run. Keep a steady pace you can hold.', video:'', audio:'', noTimer:true,
    steps:['Pace: Easy enough to talk.','Steady: Keep moving the whole 20 minutes.','Finish strong: Pick it up a little at the end.']},
  shuttle:{emoji:'💨', cue:'Sprint 20 feet, touch the line, sprint back. Go hard every rep.', video:'', audio:'dry_17',
    steps:['Mark it: Set two lines about 20 feet apart.','Sprint: Run hard to the far line and touch it.','Back: Sprint back and touch the start.','That is 1 rep: Catch your breath, then go again.']}
};
/* Category per movement, used to build a balanced daily block. */
var CAT={will:'Agility', skater:'Power',broad:'Power',box:'Power', stairs:'Speed',sprint:'Speed',reaction:'Speed',run20:'Speed',shuttle:'Speed', lunge:'Strength',rdl:'Strength',wallsit:'Strength',splitsquat:'Strength',calf:'Strength', situps:'Core',plank:'Core',deadbug:'Core',mcdavid:'Core'};
/* d(key, dose) builds a drill from the shared MOVE library plus this workout's reps. */
function d(k,dose,nameOverride){var m=MOVE[k];return {key:k, cat:CAT[k]||'', emoji:m.emoji, icon:m.icon||'', name:nameOverride||({will:"Will's Squares (4-sq Drill)",skater:'Skater Jumps',broad:'Broad Jumps',box:'Box Jumps',lunge:'Reverse Lunges',rdl:'Single-Leg RDL',wallsit:'Wall Sit',situps:'Sit-ups',plank:'Plank with Shoulder Taps',stairs:'Stair Sprints',sprint:'Sprint Starts',reaction:'Reaction Start',splitsquat:'Split Squat Hold',calf:'Calf Raises',deadbug:'Dead Bugs',mcdavid:"McDavid's",run20:'20-Minute Run',shuttle:'Sprints'}[k]), dose:dose, cue:m.cue, video:m.video||'', audio:m.audio||'', steps:m.steps, noTimer:m.noTimer||false};}

var WORKOUTS=window.WORKOUTS=[
  /* Week 1 */
  {id:'w1wed', name:'Power: Base & Technique', emoji:'💥', time:'25-30 min', blurb:'Week 1. Wednesday. Learn the movements, clean landings, confidence.',
   drills:[d('will','4 sets of 30'),d('skater','4 sets of 20'),d('broad','4 sets of 8'),d('box','4 sets of 10'),d('lunge','4 sets of 10 per leg'),d('rdl','4 sets of 8 per leg'),d('wallsit','4 sets of 30 sec'),d('situps','4 sets of 15'),d('plank','4 sets of 30 sec')]},
  {id:'w1thu', name:'Speed: Base & Technique', emoji:'🚀', time:'25-30 min', blurb:'Week 1. Thursday. Sharp feet and quick reactions.',
   drills:[d('will','4 sets of 30'),d('stairs','4 sets, 10 yards'),d('sprint','4 sets'),d('run20','20 minutes'),d('shuttle','5 reps, 20 feet'),d('reaction','4 sets of 10'),d('splitsquat','4 sets of 20 sec per leg'),d('calf','4 sets of 20'),d('deadbug','4 sets of 10 per side'),d('plank','4 sets of 30 sec')]},
  {id:'w1fri', name:'Light / Balance', emoji:'⚡', time:'20-25 min', blurb:'Week 1. Friday. Lighter day, balance and control.',
   drills:[d('will','4 sets of 30'),d('skater','4 sets of 20'),d('box','4 sets of 10'),d('rdl','4 sets of 8 per leg'),d('wallsit','4 sets of 30 sec'),d('situps','4 sets of 15'),d('mcdavid','4 sets of 60 sec')]},
  /* Week 2 - build */
  {id:'w2wed', name:'Power: Build', emoji:'💥', time:'25-30 min', blurb:'Week 2. Wednesday. Slight volume increase, same movements.',
   drills:[d('will','4 sets of 30'),d('skater','4 sets of 20'),d('broad','4 sets of 8'),d('box','4 sets of 10'),d('lunge','4 sets of 10 per leg'),d('rdl','4 sets of 8 per leg'),d('wallsit','4 sets of 30 sec'),d('situps','4 sets of 15'),d('plank','4 sets of 30 sec')]},
  {id:'w2fri', name:'Speed: Build', emoji:'🚀', time:'25-30 min', blurb:'Week 2. Friday. Faster feet, more reps.',
   drills:[d('will','4 sets of 30'),d('stairs','4 sets, 10 yards'),d('sprint','4 sets'),d('run20','20 minutes'),d('shuttle','5 reps, 20 feet'),d('reaction','4 sets of 10'),d('splitsquat','4 sets of 20 sec per leg'),d('calf','4 sets of 20'),d('deadbug','4 sets of 10 per side'),d('plank','4 sets of 30 sec')]},
  {id:'w2sat', name:'Light / Balance', emoji:'⚡', time:'20-25 min', blurb:'Week 2. Saturday. Lighter day, balance and control.',
   drills:[d('will','4 sets of 30'),d('skater','4 sets of 20'),d('box','4 sets of 10'),d('rdl','4 sets of 8 per leg'),d('wallsit','4 sets of 30 sec'),d('situps','4 sets of 15'),d('mcdavid','4 sets of 60 sec')]},
  /* Week 3 - peak (lower volume, max speed) */
  {id:'w3wed', name:'Power: Peak', emoji:'💥', time:'25-30 min', blurb:'Week 3. Wednesday. Peak intensity, lower volume. Faster, sharper, not tired.',
   drills:[d('will','4 sets of 30'),d('skater','4 sets of 20'),d('broad','4 sets of 8'),d('box','4 sets of 10'),d('lunge','4 sets of 10 per leg'),d('rdl','4 sets of 8 per leg'),d('wallsit','4 sets of 30 sec'),d('situps','4 sets of 15'),d('plank','4 sets of 30 sec')]},
  {id:'w3fri', name:'Speed: Peak', emoji:'🚀', time:'25-30 min', blurb:'Week 3. Friday. Peak intensity, sharp and fast.',
   drills:[d('will','4 sets of 30'),d('stairs','4 sets, 10 yards'),d('sprint','4 sets'),d('run20','20 minutes'),d('shuttle','5 reps, 20 feet'),d('reaction','4 sets of 10'),d('splitsquat','4 sets of 20 sec per leg'),d('calf','4 sets of 20'),d('deadbug','4 sets of 10 per side'),d('plank','4 sets of 30 sec')]},
  {id:'w3sat', name:'Light / Balance', emoji:'⚡', time:'20-25 min', blurb:'Week 3. Saturday. Lighter day, balance and control.',
   drills:[d('will','4 sets of 30'),d('skater','4 sets of 20'),d('box','4 sets of 10'),d('rdl','4 sets of 8 per leg'),d('wallsit','4 sets of 30 sec'),d('situps','4 sets of 15'),d('mcdavid','4 sets of 60 sec')]},
  /* Week 4 - taper & pop */
  {id:'w4wed', name:'Power: Taper', emoji:'💥', time:'20-25 min', blurb:'Week 4. Wednesday. Fresh legs, nervous system sharp.',
   drills:[d('will','4 sets of 30'),d('skater','4 sets of 20'),d('broad','4 sets of 8'),d('box','4 sets of 10'),d('lunge','4 sets of 10 per leg'),d('rdl','4 sets of 8 per leg'),d('wallsit','4 sets of 30 sec'),d('situps','4 sets of 15'),d('plank','4 sets of 30 sec')]},
  {id:'w4fri', name:'Speed: Taper', emoji:'🚀', time:'20-25 min', blurb:'Week 4. Friday. Fresh and fast, then rest for game day.',
   drills:[d('will','4 sets of 30'),d('stairs','4 sets, 10 yards'),d('sprint','4 sets'),d('run20','20 minutes'),d('shuttle','5 reps, 20 feet'),d('reaction','4 sets of 10'),d('splitsquat','4 sets of 20 sec per leg'),d('calf','4 sets of 20'),d('mcdavid','4 sets of 60 sec')]}
];

/* Real content (Woody-provided). cat groups; steps are short bold-label cues. */
var DRILLS=window.DRILLS=[
  {cat:'Fundamental Rhythm', emoji:'↔️', icon:'login/icon-sidetoside.webp', name:'Stationary Side-to-Side', cue:'Move the puck side to side across your body. Quick and smooth.', video:'https://www.youtube.com/watch?v=9YnPKTBpm3I', audio:'stick_01',
   steps:['Stance: Ready position, knees bent, hands out front.','Move it: Slide the puck side to side across your body.','Stay quick: Small, fast touches. Head up.']},
  {cat:'Fundamental Rhythm', emoji:'🔁', icon:'login/icon-fronttoback.webp', name:'Front-to-Back', cue:'Push the puck out in front, then pull it back to your toes.', video:'https://www.youtube.com/watch?v=pgPp6lDVMaw', audio:'stick_02',
   steps:['Push out: Reach the puck straight out in front.','Pull back: Draw it back to your toes.','Keep rhythm: Smooth push-pull, soft hands.']},
  {cat:'Fundamental Rhythm', emoji:'L', icon:'login/icon-lshape.webp', name:'The "L" Shape', cue:'Push forward, drag back, then push wide to one side.', video:'https://www.youtube.com/watch?v=Icy5KTq8Amg', audio:'stick_03',
   steps:['Forward: Push the puck out in front.','Back: Drag it back to you.','Wide: Push it out to one side to make an L.']},
  {cat:'Fundamental Rhythm', emoji:'🙌', icon:'login/icon-wideextensions.webp', name:'Wide Extensions', cue:'Reach as far to each side as you can, forehand and backhand.', video:'https://www.youtube.com/watch?v=BIRR2Kb0aEA', audio:'stick_04',
   steps:['Forehand: Reach the puck out wide on your strong side.','Backhand: Reach it out wide the other way.','Shift weight: Lean into each reach. Stay balanced.']},
  {cat:'Fundamental Rhythm', emoji:'💨', icon:'login/icon-narrowtowide.webp', name:'Narrow-to-Wide', cue:'Three tiny stickhandles, then push the puck out wide.', video:'https://www.youtube.com/watch?v=5daeyw6mRzA', audio:'stick_05',
   steps:['Narrow: 3 quick, tiny touches in tight.','Wide: Push the puck out wide right away.','Repeat: Tiny-tiny-tiny, then explode wide.']},
  {cat:'Multi-Directional', emoji:'♾️', icon:'login/icon-figure8.webp', name:'Figure-8 Around Cones', cue:'Guide the puck in a figure-8 around two cones. Keep it flowing.', video:'https://www.youtube.com/watch?v=kdm4LXlkZzE', audio:'stick_06',
   steps:['Set up: Two cones about a stick-length apart.','Weave: Guide the puck in a figure-8 around them.','Smooth: Keep it flowing. No stops.']},
  {cat:'Multi-Directional', emoji:'🔺', icon:'login/icon-triangle.webp', name:'The Triangle Drill', cue:'Move the puck in a big triangle around your feet.', video:'https://www.youtube.com/watch?v=nLWR4flibTs', audio:'stick_07',
   steps:['Shape: Picture a big triangle around your feet.','Trace it: Move the puck from point to point.','Control: Go slow and clean before you try fast.']},
  {cat:'Multi-Directional', emoji:'💎', icon:'login/icon-diamond.webp', name:'The Diamond Matrix', cue:'Four cones in a diamond, weave the puck around each point.', video:'https://www.youtube.com/watch?v=PJ68MZcHbD8', audio:'stick_08',
   steps:['Set up: 4 cones in a diamond shape.','Weave: Take the puck around each point.','Head up: Glance up between points.']},
  {cat:'Multi-Directional', emoji:'⚡', icon:'login/icon-zpattern.webp', name:'Z-Pattern Slalom', cue:'Move the puck in a zig-zag, forward-left, then forward-right.', video:'https://www.youtube.com/watch?v=HGDPIu_E-GU', audio:'stick_09',
   steps:['Zig: Push the puck forward-left, then forward-right.','Zig-zag: Keep the Z going down the floor.','Quick feet: Move with the puck.']},
  {cat:'Multi-Directional', emoji:'⬛', icon:'login/icon-square.webp', name:'The Square Box', cue:'Trace a square with the puck, front, side, back, side.', video:'https://www.youtube.com/watch?v=qxzMas4lAp8', audio:'stick_10',
   steps:['Front: Push the puck forward.','Side: Move it out to the side.','Back then side: Pull it back, then across. Trace the whole box.']},
  {cat:'Strength & Coordination', emoji:'☝️', icon:'login/icon-tophand.webp', name:'Top-Hand Only', cue:'Control the puck with only your top hand on the stick.', video:'https://www.youtube.com/watch?v=bF0t9F2OpAU', audio:'stick_11',
   steps:['One hand: Top hand only on the stick.','Control: Small, smooth moves.','Build strength: Feel your forearm work.']},
  {cat:'Strength & Coordination', emoji:'🔄', icon:'login/icon-figure8roll.webp', name:'Figure-8 Roll', cue:'Roll the puck in a figure 8 with a loose, light grip.', video:'https://www.youtube.com/watch?v=gzfPlIE8EJ8', audio:'stick_12',
   steps:['Make an 8: Weave the puck in a figure 8 shape.','Loose hands: Hold a PVC pipe or paper towel roll so you cannot squeeze.','Soft and smooth: Light touch, no death grip.']},
  {cat:'Strength & Coordination', emoji:'🪝', icon:'login/icon-toedrag.webp', name:'Toe Drag & Rescue', cue:'Push the puck wide, then hook it back with the toe of your blade.', video:'https://www.youtube.com/watch?v=UlkAnet3d-A', audio:'stick_13',
   steps:['Push wide: Send the puck out to the side.','Toe hook: Use the toe of the blade to pull it back.','Rescue it: Reel it back under control.']},
  {cat:'Strength & Coordination', emoji:'🔃', icon:'login/icon-heeltotoe.webp', name:'Heel-to-Toe Flips', cue:'Roll the puck from heel to toe and pop it up.', video:'https://www.youtube.com/watch?v=GbSaXtdiGpk', audio:'stick_14',
   steps:['Heel: Start the puck at the heel of the blade.','Roll: Roll it out toward the toe.','Lift: Give it a small pop as it reaches the toe.']},
  {cat:'Strength & Coordination', emoji:'🆙', icon:'login/icon-flipover.webp', name:'Flip Over Objects', cue:'Chip the puck or ball over a stick or low barrier.', video:'https://www.youtube.com/watch?v=h4GCR69cabQ', audio:'stick_15',
   steps:['Barrier: Lay a stick flat on the floor.','Chip: Gently lift the puck over it.','Catch it: Settle it on the other side.']},
  {cat:'Reaction & Game', emoji:'👀', icon:'login/icon-eyesup.webp', name:'Eyes-Up Glancing', cue:'Stickhandle without looking at the puck. Eyes on a target.', video:'https://www.youtube.com/watch?v=bYFiH1BF_HA', audio:'stick_16',
   steps:['Eyes up: Look at a target, a parent, the wall, anything. Not the puck.','Feel it: Trust your hands to find the puck.','Hold it: Keep your head up the whole time.']},
  {cat:'Reaction & Game', emoji:'🧱', icon:'login/icon-wallbounce.webp', name:'The Wall Bounce', cue:'Pass a ball against a wall and catch the rebound soft.', video:'https://www.youtube.com/watch?v=DHitlrzSHuI', audio:'stick_17',
   steps:['Pass: Send the ball into the wall.','Catch it soft: Catch the rebound soft.','Repeat: Quick, smooth, and steady.']},
  {cat:'Reaction & Game', emoji:'🚧', icon:'login/icon-coneweave.webp', name:'Cone Weave Course', cue:'Line up 5 cones and weave the puck through them.', video:'https://www.youtube.com/watch?v=ONAG3fYkrNs', audio:'stick_18',
   steps:['Set up: 5 cones in a straight line.','Weave: Take the puck through each one.','Speed up: Go faster once it feels clean.']},
  {cat:'Reaction & Game', emoji:'🌀', icon:'login/icon-chaos.webp', name:'Chaos Dribbling', cue:'Drop 10 random things on the floor and weave through them.', video:'https://www.youtube.com/watch?v=P5dO2zNmxhc', audio:'stick_19',
   steps:['Scatter: Drop about 10 items on the floor.','Weave: Move through them any way you can.','React: No set path. Read and go.']}
];

/* Shooting: 4 rotating days, 5 drills each, for 10U-12U. Real coaching content
   supplied by the coach (verbatim). The four days are four problems to solve:
   shoot while moving, use the backhand, finish in tight, handle game-like pucks. */
var SHOOT_DAYS=window.SHOOT_DAYS=[
  /* Day 1: Shooting While Moving */
  [ {emoji:'🏃', icon:'login/icon-movingwarmup.webp', name:'Moving Warm-Up', theme:'Feet moving', cue:'Get comfortable shooting without stopping your feet.', video:'https://www.youtube.com/watch?v=ntdPFTKDRt8', audio:'shoot_01',
     steps:['Start: 15-20 feet from the net with a puck.','Move: Stickhandle toward the net. Keep your feet moving the whole time.','Pick a corner: Don\'t stop. Shoot with your feet still going.','Reset: Grab another puck and go again from a different angle.']},
    {emoji:'📐', icon:'login/icon-changeangle.webp', name:'Change the Angle', theme:'Create space', cue:'Move the puck around something and shoot right away from the new angle.', video:'https://www.youtube.com/watch?v=niIQ_SlFJm8', audio:'shoot_02',
     steps:['Set up: Put a cone between you and the net.','Come in: Carry the puck toward the cone with your feet moving.','Move it: Pull or push the puck around it to one side.','Shoot: As soon as the puck clears it, shoot.','Switch sides: Do it the other way.']},
    {emoji:'🎯', icon:'login/icon-randomtarget.webp', name:'Random Target', theme:'Read and react', cue:'Start moving before you know where you\'re shooting.', video:'https://www.youtube.com/watch?v=EWB-NMNI9fM', audio:'shoot_03',
     steps:['Set up: Create four target areas on the net.','Move: Start with the puck. Keep your head up.','Listen: Have Thwap, a parent, or a partner call out a target.','Find it: Look at the target with your eyes.','Shoot: Don\'t stop. Reset and get a new target.']},
    {emoji:'⏱️', icon:'login/icon-undertwoseconds.webp', name:'Under Two Seconds', theme:'Quick release', cue:'Get the puck off your stick fast. No overthinking.', video:'https://www.youtube.com/watch?v=xlSZAM0oxR0', audio:'shoot_04',
     steps:['Ready: Start with your stick on the ice in a ready position.','Get: Have someone pass you the puck (or use a rebounder).','Control it: Catch it, find your target.','Fire: Release the shot in under two seconds.','Reset: Move to a different spot and do it again.']},
    {emoji:'🔁', icon:'login/icon-tengoals.webp', name:'Ten Different Goals', theme:'Change release', cue:'Score 10 goals without using the same release twice in a row.', video:'https://www.youtube.com/watch?v=DmtTLZC__y8', audio:'shoot_05',
     steps:['Start: Grab a puck. Move before you shoot.','Score: Pick a way to attack and score a goal.','Change it: On the next one, change something: angle, release point, forehand, backhand, pull, or push.','Keep going: Score 10 different goals. If you repeat yourself, it doesn\'t count!']} ],
  /* Day 2: Backhand */
  [ {emoji:'🔄', icon:'login/icon-backhand.webp', name:'Backhand Basics', theme:'Feel blade', cue:'Learn to load the puck on your backhand and release it cleanly.', video:'https://www.youtube.com/watch?v=nVQNjWsNSG4', audio:'shoot_06',
     steps:['Set up: Stand 8-10 feet from the net. Put the puck on your backhand.','Cup it: Cup the puck with the blade. Hands slightly away from your body.','Weight: Shift your weight toward the net.','Sweep: Sweep through the puck.','Finish: End with the blade pointing at your target.']},
    {emoji:'🥅', icon:'login/icon-backhandaccuracy.webp', name:'Backhand Accuracy', theme:'Pick corners', cue:'Use your backhand to hit different spots on the net on purpose.', video:'https://www.youtube.com/watch?v=mNaXHeY_mFY', audio:'shoot_07',
     steps:['Start close: Get near the net. Puck on your backhand.','Look first: Look at your target before you shoot.','Shoot: Aim for one corner.','Reset: Pick a different target.','All four: Work your way around all four corners.']},
    {emoji:'🏃', icon:'login/icon-movingbackhand.webp', name:'Moving Backhand', theme:'Backhand moving', cue:'Shoot a backhand while your feet are still going.', video:'https://www.youtube.com/watch?v=4tB1VWYJUOg', audio:'shoot_08',
     steps:['Carry it: Start 15 feet from the net. Move the puck toward it.','Keep moving: Don\'t stop your feet.','Backhand: Move the puck to your backhand. Hands away from your body.','Shoot: Shoot without stopping.','Repeat: Try coming in from different angles.']},
    {emoji:'↔️', icon:'login/icon-forehandtobackhand.webp', name:'Forehand to Backhand', theme:'Change sides', cue:'Show your forehand first, then switch to your backhand and shoot.', video:'https://www.youtube.com/watch?v=GG_ckEPfwQo', audio:'shoot_09',
     steps:['Come in: Come in with the puck on your forehand.','Pull across: Pull the puck across your body onto your backhand.','Don\'t wait: No extra stickhandle, shoot right away.','Mix it up: Try it from straight on and from an angle.']},
    {emoji:'🔂', icon:'login/icon-backhandonly.webp', name:'Backhand Only', theme:'Finish backhand', cue:'The only way to score is with a backhand. Nothing else counts.', video:'https://www.youtube.com/watch?v=u1--ABaQNMw', audio:'shoot_10',
     steps:['Start anywhere: Puck on either side. Move toward the net.','Create space: Stickhandle however you want to find an opening.','Backhand: Move the puck to your backhand.','Finish: It only counts if the final shot is a backhand.','Goal: Try to score 10 backhand goals.']} ],
  /* Day 3: In Close */
  [ {emoji:'⚡', icon:'login/icon-quickhands.webp', name:'Quick Hands', theme:'Tight space', cue:'Control the puck close to the net without needing lots of room.', video:'https://www.youtube.com/watch?v=XsYW-ZhEBHk', audio:'shoot_11',
     steps:['Start close: A few feet from the net. Keep the puck near your body.','Quick moves: Two or three quick stickhandles.','Outside: Move the puck outside your feet.','Shoot: Shoot right away.','Switch: Reset on the other side and do it again.']},
    {emoji:'🧤', icon:'login/icon-catchrelease.webp', name:'Catch and Release', theme:'One touch', cue:'Get a pass near the net and release it before the goalie can reset.', video:'https://www.youtube.com/watch?v=PCgQecgPwq0', audio:'shoot_12',
     steps:['Ready: Start near the net with your stick ready.','Get: Get a pass from the side. Catch it soft on your blade.','No extras: Don\'t add extra stickhandles.','Fire: Shoot right away.','Mix it up: Change where the passes come from each time.']},
    {emoji:'↔️', icon:'login/icon-pullacross.webp', name:'Pull Across', theme:'Move goalie', cue:'Pull the puck across your body before finishing from the new angle.', video:'https://www.youtube.com/watch?v=4dZ70sKTZoI', audio:'shoot_13',
     steps:['Come in: Start a few feet from the net with the puck on one side.','Sell it: Fake the shot from that side.','Pull: Pull the puck across your body. Keep your hands away from your feet.','Shoot: Shoot as soon as you create the new angle.','Switch: Switch directions each time.']},
    {emoji:'🔀', icon:'login/icon-fbfinish.webp', name:'Forehand / Backhand Finish', theme:'Two options', cue:'Go to the net and decide at the last second which side you\'ll use.', video:'https://www.youtube.com/watch?v=M6K50VmUoic', audio:'shoot_14',
     steps:['Move in: Start with the puck in front of you. Head toward the net.','Head up: Keep your eyes up.','Decide late: At the last moment, pick forehand or backhand.','Finish: Move the puck to that side and finish quick.','Mix it up: Don\'t always pick your favorite side.']},
    {emoji:'🔁', icon:'login/icon-reboundfinish.webp', name:'Rebound Finish', theme:'Second chance', cue:'Stay near the net after your first shot and finish the rebound.', video:'https://www.youtube.com/watch?v=L4KpjbHB9bw', audio:'shoot_15',
     steps:['Shoot low: Shoot low to create a rebound. Don\'t watch your shot.','Move in: Get toward the net right away.','Find it: Find the rebound. Get your stick on it.','Finish: Use whichever side is open.','Reset: Only reset after the second try.']} ],
  /* Day 4: Puck Skills + Shooting */
  [ {emoji:'🔗', icon:'login/icon-carrypassshoot.webp', name:'Carry / Pass / Shoot', theme:'Pass and move', cue:'Connect carrying, passing, and shooting into one play.', video:'https://www.youtube.com/watch?v=ptXnlWG0AsQ', audio:'shoot_16',
     steps:['Carry: Start away from the net. Move the puck forward with your feet going.','Pass: Pass to a parent, partner, wall, or rebounder.','Move: Move right after you pass. Get your stick ready for the return.','Get and shoot: Get the puck back and shoot quickly.']},
    {emoji:'🌀', icon:'login/icon-badpuck.webp', name:'Bad Puck Challenge', theme:'Solve chaos', cue:'Learn to shoot pucks that aren\'t sitting perfectly on your blade.', video:'https://www.youtube.com/watch?v=XXugXgjQvl4', audio:'shoot_17',
     steps:['Messy pass: Have someone send you a messy puck. It can bounce, roll, or land in your feet.','Find it: Get your blade on the puck.','Quick control: Control it as fast as you can.','Shoot: Shoot without trying to make everything perfect.','Again: Get a different kind of bad puck each time.']},
    {emoji:'📐', icon:'login/icon-angleattack.webp', name:'Angle Attack', theme:'Escape obstacle', cue:'Carry the puck toward a cone, move around it, and shoot from the new lane.', video:'https://www.youtube.com/watch?v=yFuA30qWzf4', audio:'shoot_18',
     steps:['Set up: Place a cone between you and the net.','Attack: Carry the puck toward it. Wait until you\'re close.','Escape: Move the puck quickly to one side. Move your body with it.','Shoot: Shoot from the new lane.','Switch: Switch sides each time.']},
    {emoji:'🎯', icon:'login/icon-randomtarget.webp', name:'Random Target', theme:'React fast', cue:'Let Thwap decide where your shot goes after the play has already started.', video:'https://www.youtube.com/watch?v=EWB-NMNI9fM', audio:'shoot_03',
     steps:['Go: Start with a puck. Move toward the net.','Target: Thwap randomly shows a target.','Find it: Look at the target with your eyes.','Shoot: Adjust the puck if you need to and shoot quickly.','Keep moving: Don\'t stop your feet just to hit the target.']},
    {emoji:'⏱️', icon:'login/icon-quickrelease.webp', name:'Quick Release Challenge', theme:'Beat clock', cue:'See how fast you can turn a pass into a quality shot.', video:'https://www.youtube.com/watch?v=9ERlW5wBz-s', audio:'shoot_19',
     steps:['Start empty: No puck on your blade.','Get: Get a pass. Control it. Find the net.','Fire: Shoot in under two seconds.','Quality: It only counts if it\'s smooth and on target.','Streak: Try to string together 5 good quick releases in a row.']} ],
  /* Day 5: Mixed Review (pulls one proven drill from each earlier day) */
  [ {emoji:'🏃', icon:'login/icon-movingwarmup.webp', name:'Moving Warm-Up', theme:'Feet moving', cue:'Get comfortable shooting without stopping your feet.', video:'https://www.youtube.com/watch?v=ntdPFTKDRt8', audio:'shoot_01',
     steps:['Start: 15-20 feet from the net with a puck.','Move: Stickhandle toward the net. Keep your feet moving the whole time.','Pick a corner: Don\'t stop. Shoot with your feet still going.','Reset: Grab another puck and go again from a different angle.']},
    {emoji:'🥅', icon:'login/icon-backhandaccuracy.webp', name:'Backhand Accuracy', theme:'Pick corners', cue:'Use your backhand to hit different spots on the net on purpose.', video:'https://www.youtube.com/watch?v=mNaXHeY_mFY', audio:'shoot_07',
     steps:['Start close: Get near the net. Puck on your backhand.','Look first: Look at your target before you shoot.','Shoot: Aim for one corner.','Reset: Pick a different target.','All four: Work your way around all four corners.']},
    {emoji:'🧤', icon:'login/icon-catchrelease.webp', name:'Catch and Release', theme:'One touch', cue:'Get a pass near the net and release it before the goalie can reset.', video:'https://www.youtube.com/watch?v=PCgQecgPwq0', audio:'shoot_12',
     steps:['Ready: Start near the net with your stick ready.','Get: Get a pass from the side. Catch it soft on your blade.','No extras: Don\'t add extra stickhandles.','Fire: Shoot right away.','Mix it up: Change where the passes come from each time.']},
    {emoji:'🔗', icon:'login/icon-carrypassshoot.webp', name:'Carry / Pass / Shoot', theme:'Pass and move', cue:'Connect carrying, passing, and shooting into one play.', video:'https://www.youtube.com/watch?v=ptXnlWG0AsQ', audio:'shoot_16',
     steps:['Carry: Start away from the net. Move the puck forward with your feet going.','Pass: Pass to a parent, partner, wall, or rebounder.','Move: Move right after you pass. Get your stick ready for the return.','Get and shoot: Get the puck back and shoot quickly.']},
    {emoji:'🔁', icon:'login/icon-tengoals.webp', name:'Ten Different Goals', theme:'Change release', cue:'Score 10 goals without using the same release twice in a row.', video:'https://www.youtube.com/watch?v=DmtTLZC__y8', audio:'shoot_05',
     steps:['Start: Grab a puck. Move before you shoot.','Score: Pick a way to attack and score a goal.','Change it: On the next one, change something: angle, release point, forehand, backhand, pull, or push.','Keep going: Score 10 different goals. If you repeat yourself, it doesn\'t count!']} ]
];
window.NETPLAY_DAYS=[[{"emoji":"🧎","name":"Ready Stance","theme":"Set your base","cue":"Build a strong, comfortable stance you can hold and spring from.","steps":["Feet: A little wider than your shoulders.","Knees: Bend them so you feel springy, not stiff.","Hands: Out in front where you can see them.","Tall and calm: Chest up, eyes forward.","Hold it: Stay set 10 seconds, relax, repeat 10 times."]},{"emoji":"⬆️","name":"Butterfly Down-Ups","theme":"Drop and recover","cue":"Drop to your knees and pop back up, smooth and balanced.","steps":["Start set: Begin in your ready stance on a soft surface (carpet or a mat).","Drop: Go down to both knees, knees apart, chest up.","Stay square: Shoulders facing forward the whole time.","Pop up: Push back to your stance in one smooth move.","Reps: 10 clean down-ups. Quality over speed."]},{"emoji":"⏱️","name":"Butterfly Holds","theme":"Strong legs","cue":"Hold the butterfly to build the legs that get you up fast.","steps":["Drop: Go down into your butterfly.","Hold: Stay there, chest up, for 15 seconds.","Rest: Stand up and shake it out.","Again: Do 5 holds.","Goal: Add 5 seconds when it gets easy."]}],[{"emoji":"🩹","name":"Tape Your Line","theme":"Set it up","cue":"Make a line and two marks on the floor to be your crease.","steps":["Tape: Put a strip of tape on the floor, about as wide as a doorway.","Marks: Add a mark near each end (those are your posts).","Middle: Add one mark in the middle.","Ready: Stand on the middle mark in your stance.","This is your crease for the next drills."]},{"emoji":"↔️","name":"Shuffle the Crease","theme":"Move square","cue":"Slide side to side along your line, staying square.","steps":["Set: Start on the middle mark in your stance.","Push: Push off one leg and shuffle toward a post mark.","Stay square: Keep your shoulders facing forward, do not turn.","Arrive set: Stop on the mark already in your stance.","Reps: 10 shuffles each way."]},{"emoji":"📐","name":"T-Push to the Post","theme":"Cover the post","cue":"Push across to the far mark fast and arrive set.","steps":["Set: Start on one post mark.","Point: Turn your lead foot toward the far mark (make a T).","Push: Drive off your back leg across the line.","Arrive square: Stop on the far mark, facing forward.","Reps: 5 pushes each direction."]},{"emoji":"🔄","name":"Recover to Your Feet","theme":"Get back up","cue":"Drop, then get square and back on your feet quickly.","steps":["Drop: Go into your butterfly on the middle mark.","Eyes up: Look straight ahead.","Recover: Get one foot under you, then the other.","Set: Finish standing in your stance, facing forward.","Reps: 10 quick recoveries."]}],[{"emoji":"🎾","name":"Wall Toss Catch","theme":"Soft hands","cue":"Throw a tennis ball at a wall and catch it clean.","steps":["Stand: A few steps from a wall in your stance.","Throw: Toss the ball at the wall.","Watch: Follow it all the way back with your eyes.","Catch: Catch it soft, close your hand around it.","Reps: 25 clean catches. Move where the ball goes."]},{"emoji":"🧤","name":"Glove-Side Catches","theme":"Catch high","cue":"Catch balls to your glove hand and hold on.","steps":["Set: Ready stance, glove hand ready.","Throw: Toss the ball to your glove side (or have someone toss it).","Track: Watch it into your hand.","Catch and hold: Squeeze, do not swat.","Reps: 20 glove catches."]},{"emoji":"⚡","name":"Two-Ball Drop","theme":"React fast","cue":"A helper drops one of two balls, you catch it before it double-bounces.","steps":["Helper: Someone holds a ball in each hand, arms out.","Watch: You stay in your stance, eyes on their hands.","React: They drop ONE ball without warning.","Catch: Move and grab it before it bounces twice.","Reps: 15 drops. Switch which hand they use."]},{"emoji":"🤹","name":"Bounce and React","theme":"Quick hands","cue":"Bounce a ball off the ground or wall and snag the funny hops.","steps":["Throw low: Bounce the ball hard off the floor near a wall.","Read it: Watch which way it kicks.","Move: Get your body and hand to it.","Catch: Grab it clean.","Reps: 20 bounces. The weird hops are the point."]}],[{"emoji":"👀","name":"Follow the Ball","theme":"Track it","cue":"Keep your eyes glued to a ball the whole way in.","steps":["Helper: Someone slowly moves a ball around in front of you.","Track: Follow it with your eyes only.","Head still: Move your eyes, not your whole head.","Stay set: Hold your stance while you track.","Time it: Track for 30 seconds, rest, do 5 rounds."]},{"emoji":"🔦","name":"Head on a Swivel","theme":"Find it fast","cue":"Snap your eyes to a ball that appears from the side.","steps":["Set: Stance, eyes forward.","Surprise: A helper holds a ball out to one side, then the other.","Snap: Find it fast with your eyes and turn your head to face it.","Square up: Turn your shoulders toward it too.","Reps: 20 snaps, mixing sides."]},{"emoji":"🎯","name":"Track Behind a Screen","theme":"See past traffic","cue":"Find the ball when something is partly in the way.","steps":["Screen: Put a chair (or have a helper stand) a bit in front of you.","Move: A helper moves a ball behind and beside the screen.","Look around it: Shift your head to keep eyes on the ball.","Stay square: Face the ball once you find it.","Reps: 10 tracks past the screen."]},{"emoji":"📍","name":"Line Up the Shooter","theme":"Angles","cue":"Move so you are always between the ball and your net line.","steps":["Line: Use your taped line as the net.","Helper: Someone holds a ball and moves side to side in front of you.","Line up: Move so you are between the ball and the middle of your line.","Check: Your nose, the ball, and the middle mark make a straight line.","Reps: Follow the ball to 10 spots."]}],[{"emoji":"🧎","name":"Stance Warm-Up","theme":"Get set","cue":"A few clean butterfly down-ups to warm up your base.","steps":["Set: Ready stance.","Down-ups: 5 smooth drops and recoveries.","Balance: Chest up, square, in control."]},{"emoji":"↔️","name":"Shuffle and Set","theme":"Move square","cue":"Shuffle post to post on your line and arrive set.","steps":["Start: On a post mark, set.","Shuffle: Slide to the other mark staying square.","Arrive set: Stop in your stance, not sliding.","Reps: 6 post to post."]},{"emoji":"🎾","name":"Wall Toss Catch","theme":"Soft hands","cue":"Throw and catch off the wall, clean every time.","steps":["Throw: Toss the ball at the wall.","Track: Watch it back.","Catch: Soft hands, squeeze it.","Reps: 20 clean catches."]},{"emoji":"👀","name":"Follow the Ball","theme":"Track it","cue":"Eyes locked on a moving ball, head still.","steps":["Helper moves a ball; you track with your eyes.","Stay in your stance.","Time it: 3 rounds of 30 seconds."]},{"emoji":"⏱️","name":"Butterfly Hold Finish","theme":"Strong legs","cue":"End with a couple of butterfly holds to build recovery power.","steps":["Drop: Into your butterfly.","Hold: 15 seconds, chest up.","Reps: 3 holds, then shake it out."]}]];
var NETPLAY_DAYS=window.NETPLAY_DAYS;
/* Net play gate: the off-ice goalie drills in NETPLAY_DAYS are agent-authored
   placeholder fundamentals, NOT content Woody has vetted, and have no videos.
   Per the no-invented-training-content rule, keep Net play "coming soon" (no
   markable drills, no stats accrue) until real goalie drills land -- exactly the
   Passing pattern (PASS_DAYS empty). Flip to true and the drills + stats light up
   with no rebuild. */
var NETPLAY_ENABLED=window.NETPLAY_ENABLED=false;

/* Guided drill timer (V1): on-screen only, no audio. A "script" describes the
   drill as an ordered list of PHASES the engine walks: a setup pause, a
   countdown ("Starting in 5..1, GO"), then either REPS (tick a big count 1..N,
   one every perRep seconds) or a HOLD (count DOWN seconds), optionally repeated
   for a second direction. On the last phase it calls onDone() once, which is the
   same done+stamp logic the old "Mark done" button ran.

   THWAP_DRILL_SCRIPT is the editable table. Key by drill NAME (exact). Woody
   tweaks the numbers here. Types:
     {type:'reps', reps, perRep, sides:1|2, sideLabels:[..]}
     {type:'hold', seconds, sides:1|2, sideLabels:[..]}
     {type:'rounds', rounds, workLabel, restSeconds}
     {type:'callout', shots, everySeconds, spots:[..]}   // Random Target
   A drill with no entry falls back to reps 10 / 1.5s / 1 side. */
var SETUP_SECS=5, COUNTDOWN=5;
window.THWAP_DRILL_SCRIPT={
  /* --- Stickhandling --- */
  'Stationary Side-to-Side':{type:'reps',reps:20,perRep:1.0,sides:1,sets:4,restSeconds:15},
  'Front-to-Back':{type:'reps',reps:20,perRep:1.0,sides:1,sets:4,restSeconds:15},
  'The "L" Shape':{type:'reps',reps:10,perRep:1.5,sides:2,sideLabels:['One way','Mirror it'],sets:4,restSeconds:15},
  'Wide Extensions':{type:'reps',reps:10,perRep:1.5,sides:2,sideLabels:['Forehand','Backhand'],sets:4,restSeconds:15},
  'Narrow-to-Wide':{type:'reps',reps:10,perRep:2.0,sides:2,sideLabels:['One way','Other way'],sets:4,restSeconds:15},
  'Figure-8 Around Cones':{type:'reps',reps:10,perRep:2.0,sides:2,sideLabels:['One way','Reverse'],sets:4,restSeconds:15},
  'The Triangle Drill':{type:'reps',reps:10,perRep:2.0,sides:2,sideLabels:['One way','Reverse'],sets:4,restSeconds:15},
  'The Diamond Matrix':{type:'reps',reps:10,perRep:2.0,sides:2,sideLabels:['One way','Reverse'],sets:4,restSeconds:15},
  'Z-Pattern Slalom':{type:'reps',reps:8,perRep:2.0,sides:2,sideLabels:['One way','Reverse'],sets:4,restSeconds:15},
  'The Square Box':{type:'reps',reps:10,perRep:2.0,sides:2,sideLabels:['One way','Reverse'],sets:4,restSeconds:15},
  'Top-Hand Only':{type:'reps',reps:15,perRep:1.5,sides:1,sets:4,restSeconds:15},
  'Figure-8 Roll':{type:'reps',reps:15,perRep:1.5,sides:1,sets:4,restSeconds:15},
  'Toe Drag & Rescue':{type:'reps',reps:10,perRep:2.0,sides:2,sideLabels:['Right','Left'],sets:4,restSeconds:15},
  'Heel-to-Toe Flips':{type:'reps',reps:10,perRep:1.5,sides:1,sets:4,restSeconds:15},
  'Flip Over Objects':{type:'reps',reps:10,perRep:2.0,sides:1,sets:4,restSeconds:15},
  'Eyes-Up Glancing':{type:'reps',reps:20,perRep:1.5,sides:1,sets:4,restSeconds:15},
  'The Wall Bounce':{type:'reps',reps:20,perRep:1.5,sides:1,sets:4,restSeconds:15},
  'Cone Weave Course':{type:'reps',reps:6,perRep:4.0,sides:2,sideLabels:['Down','Back'],sets:4,restSeconds:15},
  'Chaos Dribbling':{type:'hold',seconds:30,sides:1,sets:4,restSeconds:15},
  /* --- Dryland --- */
  "Will's Squares (4-sq Drill)":{type:'reps',reps:30,perRep:1.0,sides:1,sets:4,restSeconds:15},
  'Skater Jumps':{type:'reps',reps:10,perRep:1.5,sides:2,sideLabels:['Right','Left'],sets:4,restSeconds:15},
  'Broad Jumps':{type:'reps',reps:8,perRep:3.0,sides:1,sets:4,restSeconds:15},
  'Box Jumps':{type:'reps',reps:10,perRep:3.0,sides:1,sets:4,restSeconds:15},
  'Reverse Lunges':{type:'reps',reps:10,perRep:2.0,sides:2,sideLabels:['Right leg','Left leg'],sets:4,restSeconds:15},
  'Single-Leg RDL':{type:'reps',reps:8,perRep:2.5,sides:2,sideLabels:['Right leg','Left leg'],sets:4,restSeconds:15},
  'Wall Sit':{type:'hold',seconds:30,sides:1,sets:4,restSeconds:15},
  'Sit-ups':{type:'reps',reps:15,perRep:2.0,sides:1,sets:4,restSeconds:15},
  'Plank with Shoulder Taps':{type:'hold',seconds:30,sides:1,sets:4,restSeconds:15},
  'Stair Sprints':{type:'rounds',rounds:4,workLabel:'Sprint up',restSeconds:15},
  'Sprint Starts':{type:'rounds',rounds:4,workLabel:'Sprint',restSeconds:15},
  'Sprints':{type:'rounds',rounds:5,workLabel:'Sprint',restSeconds:30},
  'Reaction Start':{type:'reps',reps:10,perRep:3.0,sides:1,sets:4,restSeconds:15},
  'Split Squat Hold':{type:'hold',seconds:20,sides:2,sideLabels:['Right leg','Left leg'],sets:4,restSeconds:15},
  'Calf Raises':{type:'reps',reps:20,perRep:1.5,sides:1,sets:4,restSeconds:15},
  'Dead Bugs':{type:'reps',reps:10,perRep:2.0,sides:2,sideLabels:['Right','Left'],sets:4,restSeconds:15},
  "McDavid's":{type:'hold',seconds:60,sides:1,sets:4,restSeconds:15},
  /* --- Shooting (shots, not timed reps; Random Target uses on-screen callouts) --- */
  'Moving Warm-Up':{type:'rounds',rounds:12,workLabel:'Shot',restSeconds:9},
  'Change the Angle':{type:'rounds',rounds:8,workLabel:'Shot',restSeconds:5,sides:2,sideLabels:['One side','Other side'],sets:4,setRestSeconds:15},
  'Random Target':{type:'callout',shots:10,everySeconds:4,spots:['Top right','Bottom right','Top left','Bottom left','Glove-side armpit','Blocker-side armpit','Left ear','Right ear','Five hole'],sets:4,setRestSeconds:15},
  'Under Two Seconds':{type:'rounds',rounds:10,workLabel:'Quick shot',restSeconds:4,sets:4,setRestSeconds:15},
  'Ten Different Goals':{type:'rounds',rounds:10,workLabel:'Goal',restSeconds:5,sets:4,setRestSeconds:15},
  'Backhand Basics':{type:'rounds',rounds:12,workLabel:'Backhand',restSeconds:9},
  'Backhand Accuracy':{type:'rounds',rounds:8,workLabel:'Corner',restSeconds:5,sets:4,setRestSeconds:15},
  'Moving Backhand':{type:'rounds',rounds:8,workLabel:'Shot',restSeconds:5,sets:4,setRestSeconds:15},
  'Forehand to Backhand':{type:'rounds',rounds:8,workLabel:'Shot',restSeconds:5,sets:4,setRestSeconds:15},
  'Backhand Only':{type:'rounds',rounds:10,workLabel:'Goal',restSeconds:5,sets:4,setRestSeconds:15},
  'Quick Hands':{type:'rounds',rounds:8,workLabel:'Shot',restSeconds:4,sides:2,sideLabels:['One side','Other side'],sets:4,setRestSeconds:15},
  'Catch and Release':{type:'rounds',rounds:10,workLabel:'Shot',restSeconds:4,sets:4,setRestSeconds:15},
  'Pull Across':{type:'rounds',rounds:8,workLabel:'Shot',restSeconds:5,sides:2,sideLabels:['One way','Other way'],sets:4,setRestSeconds:15},
  'Forehand / Backhand Finish':{type:'rounds',rounds:8,workLabel:'Finish',restSeconds:5,sets:4,setRestSeconds:15},
  'Rebound Finish':{type:'rounds',rounds:8,workLabel:'Rebound',restSeconds:5,sets:4,setRestSeconds:15},
  'Carry / Pass / Shoot':{type:'rounds',rounds:8,workLabel:'Play',restSeconds:6,sets:4,setRestSeconds:15},
  'Bad Puck Challenge':{type:'rounds',rounds:8,workLabel:'Shot',restSeconds:8},
  'Angle Attack':{type:'rounds',rounds:8,workLabel:'Shot',restSeconds:5,sides:2,sideLabels:['One side','Other side'],sets:4,setRestSeconds:15},
  'Quick Release Challenge':{type:'rounds',rounds:5,workLabel:'Quick release',restSeconds:5,sets:4,setRestSeconds:15}
};
function scriptFor(name){ return window.THWAP_DRILL_SCRIPT[name] || {type:'reps',reps:10,perRep:1.5,sides:1}; }
/* Build the ordered step list for a script. Each step: {phase,big,sub,ms,au}
   `au` is the audio-segment cue key the timer fires when the step is painted.
   Numbers use n<K>; shared cues (go, switch, done, side setup) reuse one clip set;
   the per-drill setup line is the drill's own slug. */
function buildSteps(sc, slug, rng){
  var rnd=rng||Math.random;
  var steps=[];
  steps.push({phase:'Set up',big:'',sub:'Get the drill set up',ms:SETUP_SECS*1000, au:slug?('drill/'+slug+'/setup'):''});
  var sides=sc.sides||1;
  var labels=sc.sideLabels||[];
  if(sc.type==='session'){
    // ONE continuous block: 5-count in, then a single MM:SS countdown for the
    // whole drill, no rests. Light spoken cues at the halfway and final-10 marks;
    // the metronome carries the beat. mm:ss shown as the big number.
    var total=Math.max(30, sc.seconds||210);
    for(var cc=COUNTDOWN;cc>=1;cc--) steps.push({phase:'Ready',big:String(cc),sub:'',ms:1000, au:(cc<=5?'n'+cc:'')});
    steps.push({phase:'Go',big:'GO',sub:'',ms:800, au:'cue/go'});
    var mmss=function(sec){ var m=Math.floor(sec/60), s2=sec%60; return m+':'+(s2<10?'0':'')+s2; };
    var half=Math.round(total/2);
    for(var t=total;t>=1;t--){
      var au='';
      if(t===half) au='cue/keepgoing';
      else if(t===10) au='cue/almostdone';
      steps.push({phase:'Keep shooting',big:mmss(t),sub:'',ms:1000, au:au, work:true, small:true});
    }
  } else if(sc.type==='reps'||sc.type==='hold'){
    // N SETS of the work (both sides run inside each set), with a rest between
    // sets. sets defaults to 1 (unchanged). The number/switch/go/rest/done clips
    // are all reused per set, so more sets need no new audio.
    var sets=sc.sets||1, restSec=sc.restSeconds||(sets>1?15:0);
    for(var set=1;set<=sets;set++){
      var setNote=sets>1?('Set '+set+' of '+sets):'';
      for(var c=(set===1?COUNTDOWN:3);c>=1;c--) steps.push({phase:setNote||'Ready',big:String(c),sub:'',ms:1000, au:(c<=5?'n'+c:'')});
      steps.push({phase:setNote||'Go',big:'GO',sub:'',ms:800, au:'cue/go'});
      for(var s=0;s<sides;s++){
        var sideNote=sides>1?(labels[s]||('Side '+(s+1))):'';
        var lab=setNote||sideNote||(sc.type==='hold'?'Hold':'Reps');
        if(s>0) steps.push({phase:'Switch',big:'\u21C4',sub:(labels[s]||'other way'),ms:3000, au:'cue/switch'});
        if(sc.type==='reps'){
          for(var r=1;r<=sc.reps;r++) steps.push({phase:lab,big:String(r),sub:'of '+sc.reps,ms:Math.round((sc.perRep||1.5)*1000), au:'n'+r, work:true});
        } else {
          for(var h=sc.seconds;h>=1;h--) steps.push({phase:lab,big:String(h),sub:'seconds',ms:1000, au:(h<=5?('n'+h):(h%10===0?'cue/keepgoing':'')), work:true});
        }
      }
      if(set<sets) for(var rest=restSec;rest>=1;rest--) steps.push({phase:'Rest',big:String(rest),sub:'catch your breath',ms:1000, au:(rest===restSec?'cue/rest':'')});
    }
  } else {
    // Shooting: N SETS of the shot block (both sides run inside each set), with a
    // longer breather between sets. `sets` defaults to 1 (unchanged). NOTE the two
    // rests differ: restSeconds is the short reset BETWEEN SHOTS; setRestSeconds is
    // the catch-your-breath rest BETWEEN SETS (default 15). All clips are reused, so
    // more sets need no new audio.
    var sets2=sc.sets||1, setRest=sc.setRestSeconds||(sets2>1?15:0);
    for(var set2=1;set2<=sets2;set2++){
      var setNote2=sets2>1?('Set '+set2+' of '+sets2):'';
      for(var si=0;si<sides;si++){
        var sNote=setNote2||(sides>1?(labels[si]||('Set '+(si+1))):'');
        if(si>0) steps.push({phase:'Switch',big:'\u21C4',sub:(labels[si]||'other way'),ms:3000, au:'cue/switch'});
        for(var c2=(set2===1&&si===0?COUNTDOWN:3);c2>=1;c2--) steps.push({phase:sNote||'Ready',big:String(c2),sub:'',ms:1000, au:(c2<=5?'n'+c2:'')});
        steps.push({phase:sNote||'Go',big:'GO',sub:'',ms:800, au:'cue/go'});
        if(sc.type==='rounds'){
          for(var rd=1;rd<=sc.rounds;rd++){
            steps.push({phase:setNote2||((sc.workLabel||'Round')+' '+rd),big:String(rd),sub:'of '+sc.rounds,ms:3000, au:'n'+rd, work:true});
            if(rd<sc.rounds) for(var rest2=(sc.restSeconds||10);rest2>=1;rest2--) steps.push({phase:'Rest',big:String(rest2),sub:'catch your breath',ms:1000, au:(rest2===(sc.restSeconds||10)?'cue/rest':'')});
          }
        } else if(sc.type==='callout'){
          for(var sh=0;sh<sc.shots;sh++){
            var spot=sc.spots[Math.floor(rnd()*sc.spots.length)];
            steps.push({phase:setNote2||('Shot '+(sh+1)+' of '+sc.shots),big:spot,sub:(setNote2?('shot '+(sh+1)+' of '+sc.shots):'hit it'),ms:Math.round((sc.everySeconds||4)*1000),small:true, au:'n'+(sh+1), work:true});
          }
        }
      }
      if(set2<sets2) for(var srest=setRest;srest>=1;srest--) steps.push({phase:'Rest',big:String(srest),sub:'catch your breath',ms:1000, au:(srest===setRest?'cue/rest':'')});
    }
  }
  steps.push({phase:'Done',big:'✓',sub:'Nice work!',ms:3200,last:true, au:'cue/done'});
  return steps;
}

/* ---- Calendar ----
   di is a whole-day number (days since 1970-01-01 UTC) for the player's local
   calendar date. Fixed weekly training plan (Option A): Monday-Friday are slots
   0-4, the SAME plan every week; Saturday and Sunday are rest / game days.
   di 0 = Thu 1970-01-01, so weekday = (di+4) mod 7 with 0=Sun..6=Sat. */
function weekday(di){ return ((((di%7)+7)%7)+4)%7; }  /* 0=Sun..6=Sat */
function isRestDay(di){ var w=weekday(di); return w===0||w===6; }
function weekdaySlot(di){ var w=weekday(di); return (w>=1&&w<=5)?(w-1):-1; }  /* Mon0..Fri4, weekend -1 */
function isWeekend(di){ var w=weekday(di); return w===0||w===6; }
/* 'YYYY-MM-DD' -> di. Returns NaN for a malformed string. */
function dayIndexForDate(str){
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str||''));
  if(!m) return NaN;
  return Math.floor(Date.UTC(+m[1],+m[2]-1,+m[3])/86400000);
}
var DAY_KEYS=['sun','mon','tue','wed','thu','fri','sat'];
function coachDayKey(di){ return DAY_KEYS[weekday(di)]||''; }

/* ---- Coach-picked drills ----
   The coach plan stores, per weekday per category, the EXACT drill names the
   coach chose: plan[day] = { dryland:['20-Minute Run', ...] }. Today's names for
   a category, honoring both plan shapes. The legacy array-of-categories shape
   carries no names, so it returns []. An empty array (category on, no specific
   drills) also returns [] -> the built-in rotation is the fallback. */
function coachDrillNames(plan, di, cat){
  try{
    if(!plan) return [];
    var day=plan[coachDayKey(di)]; if(!day||typeof day!=='object'||Array.isArray(day)) return [];
    var arr=day[cat]; if(!Array.isArray(arr)) return [];
    return arr.filter(function(x){ return x && x!=='__all__'; });
  }catch(e){ return []; }
}
/* Map coach-picked dryland drill NAMES back to full drill objects from the
   WORKOUTS library (so cue/steps/video/emoji/noTimer all come along). Dose is
   pulled from the first WORKOUTS occurrence of that name. Unknown names drop. */
function drylandFromNames(names){
  if(!names||!names.length) return [];
  var byName={};
  (WORKOUTS||[]).forEach(function(wk){ (wk.drills||[]).forEach(function(x){ if(x&&x.name&&!byName[x.name]) byName[x.name]=x; }); });
  var out=[]; names.forEach(function(nm){ var dr=byName[nm]; if(dr) out.push(dr); });
  return out;
}

/* ---- Dryland rotation ---- */
function todaysWorkout(di){var s=weekdaySlot(di);return WORKOUTS[(s<0?0:s)%WORKOUTS.length];}

/* Build a balanced ~15-min block: 1-2 exercises from each category present today,
   capped at 6, in a sensible order. Which ones (when a category has several) rotates by day. */
var CAT_ORDER=['Agility','Power','Speed','Strength','Core'];
function trimDrills(dr, di){
  /* Dryland shows up to 4 drills/day (reduced from 6 so it is less intense).
     On a conditioning (Speed) day that includes the 20-Minute Run we allow a 5th
     slot so the run is guaranteed AND a rotating Speed sibling (Sprints / Stair
     Sprints / Sprint Starts / Reaction Start) still shows and varies day to day,
     instead of the anchored run squeezing every other Speed drill out. */
  var hasRun=dr.some(function(x){ return x.key==='run20'; });
  var CAP=hasRun?5:4;
  if(dr.length<=CAP) return dr;
  var byCat={};
  dr.forEach(function(x){ (byCat[x.cat]=byCat[x.cat]||[]).push(x); });
  var cats=CAT_ORDER.filter(function(c){return byCat[c];});
  var pick=[];
  /* first pass: one per category. The rotation offset is multiplied by the
     category position so EVERY category advances a different amount each day
     (di*k), not all stepping by the same +1, which is what made consecutive
     days look identical. The 20-Minute Run (run20) is a fixed anchor of its
     Speed day: when it is present it is always the first Speed pick, so a
     scheduled run day ALWAYS shows the run instead of it competing one-in-five
     in the rotation. */
  cats.forEach(function(c,ci){
    var g=byCat[c];
    var run=null; for(var ri=0;ri<g.length;ri++){ if(g[ri].key==='run20'){ run=g[ri]; break; } }
    if(run){ pick.push(run); return; }
    pick.push(g[(di*(ci+1))%g.length]);
  });
  /* second pass: fill remaining slots with a rotating 2nd drill from the
     categories that have more. Speed goes FIRST so that on a run day the second
     Speed drill (Sprints / Stair Sprints / Sprint Starts / Reaction Start) still
     surfaces alongside the anchored run and rotates day to day, instead of the
     run squeezing every other Speed drill out. The run itself is skipped as a
     candidate so it is never doubled. */
  var order=cats.slice().sort(function(a,b){ return (a==='Speed'?-1:0)-(b==='Speed'?-1:0); });
  for(var r=0; r<order.length && pick.length<CAP; r++){
    var g=byCat[order[r]].filter(function(x){ return x.key!=='run20'; });
    if(g.length){ var second=g[(di*(r+1)+1)%g.length]; if(pick.indexOf(second)<0) pick.push(second); }
  }
  /* the first pass can already exceed the cap when there are many categories; trim */
  pick=pick.slice(0,CAP);
  /* keep the original workout order so it still reads sensibly */
  return dr.filter(function(x){return pick.indexOf(x)>=0;});
}

/* Today's dryland list. Follow the coach: if he picked specific dryland drills
   for today, show exactly those (first 3, no trim). Otherwise the built-in
   WORKOUTS day through trimDrills (which anchors the run and varies day to
   day). Callers check isRestDay first: dryland rests on weekends. */
function drylandForDay(di, coachNames){
  var coachDrills=(coachNames&&coachNames.length)?drylandFromNames(coachNames).slice(0,3):[];
  return coachDrills.length?coachDrills:trimDrills(todaysWorkout(di).drills, di);
}

/* ---- Stickhandling rotation ---- */
/* Show STICK_PER_DAY distinct stickhandling drills, rotating by weekday slot so
   the set changes day to day and wraps cleanly. 3 keeps the daily load sensible
   for 10U now that each drill is a full guided run (bump to 4 if wanted). */
var STICK_PER_DAY=3;
function stickForDay(di){
  var s=weekdaySlot(di); if(s<0) s=0;
  var n=DRILLS.length;
  var out=[], seen={};
  for(var k=0;k<STICK_PER_DAY && out.length<n;k++){
    var idx=(s*STICK_PER_DAY+k)%n;
    while(seen[idx]) idx=(idx+1)%n;   /* skip a wrap collision so all picks are distinct */
    seen[idx]=1; out.push(DRILLS[idx]);
  }
  return out;
}

/* ---- Shooting / Net play rotation ----
   The third discipline: Shooting for skaters, Net play for goalies. 4 shooting
   days (5 for Net play) rotate by weekday slot; a weekend shows slot 0. Each day
   shows 2 fewer drills than the day list so the session is less intense (keep
   at least 1). Every shooting drill runs as one flat 2:30 countdown. */
var SHOOT_TIMER_SECONDS=150;
function shootDayIndex(di){ var s=weekdaySlot(di); if(s<0) s=0; return s%SHOOT_DAYS.length; }
function netplayLive(on){ return !!(on && Array.isArray(NETPLAY_DAYS) && NETPLAY_DAYS.length); }
/* goalie + Net play not live -> null ("coming soon", no markable drills). */
function shootForDay(di, goalie, netplayOn){
  var on=(netplayOn===undefined)?NETPLAY_ENABLED:netplayOn;
  if(goalie && !netplayLive(on)) return null;
  var DAYS=(goalie && netplayLive(on)) ? NETPLAY_DAYS : SHOOT_DAYS;
  var set=DAYS[shootDayIndex(di)%DAYS.length]||[];
  return set.slice(0, Math.max(1, set.length-2));
}

/* The line under a drill's name on its row: stickhandling shows its group,
   shooting its theme, dryland its dose. */
function rowSubtitle(discipline, dr, goalie){
  if(discipline==='stick') return dr.cat||'';
  if(discipline==='shoot'||discipline==='netplay') return dr.theme||(goalie?'Net play':'Shooting');
  return dr.dose||'';
}

/* ---- Position ----
   Goalies train Net play where skaters train Shooting. The web app knows a
   player by first name (bfPlayer); the server reads the member store's
   position first and falls back to these ids (lib/positions.js). */
var GOALIE_FIRST_NAMES=['johnny'];
function isGoaliePosition(pos){ var p=String(pos||'').trim().toLowerCase(); return p==='g'||p==='goalie'||p==='goaltender'||p==='goalkeeper'; }
function thirdDiscipline(goalie){ return goalie?'netplay':'shoot'; }
function disciplinesFor(goalie){ return ['stick', thirdDiscipline(goalie), 'dryland']; }

/* ---- Weekly ring goals ----
   The player view fills each discipline's weekly ring toward the number of
   distinct activities in that discipline's library (buildCatalog in
   index.html: deduped by name). Same numbers here. */
function uniqueNames(list){ var seen={}, out=[]; list.forEach(function(x){ if(x&&x.name&&!seen[x.name]){ seen[x.name]=1; out.push(x.name); } }); return out; }
function flat(days){ var out=[]; (days||[]).forEach(function(d){ (d||[]).forEach(function(x){ out.push(x); }); }); return out; }
function catalog(){
  var dry=[]; WORKOUTS.forEach(function(w){ (w.drills||[]).forEach(function(x){ dry.push(x); }); });
  return { stick:uniqueNames(DRILLS), shoot:uniqueNames(flat(SHOOT_DAYS)), netplay:uniqueNames(flat(NETPLAY_DAYS)), dryland:uniqueNames(dry) };
}
function weekGoals(goalie){
  var c=catalog(), out={};
  disciplinesFor(goalie).forEach(function(k){ out[k]=c[k].length; });
  return out;
}

/* ---- Timer summary for the watch ----
   The watch runs the same phases as the web runner (buildSteps). This is the
   short form for a list row: work seconds per set, rest between sets, and the
   raw script so the watch can rebuild the exact phases. null = no timer (a
   drill like the 20-Minute Run is just marked done). */
function timerFor(discipline, dr){
  if(!dr || dr.noTimer) return null;
  var sc=(discipline==='shoot'||discipline==='netplay')
    ? {type:'session', seconds:SHOOT_TIMER_SECONDS}
    : scriptFor(dr.name);
  var steps=buildSteps(sc, '', function(){ return 0; });
  var sets=sc.sets||1, work=0, total=0;
  steps.forEach(function(st){ total+=st.ms; if(st.work) work+=st.ms; });
  var rest=(sc.type==='reps'||sc.type==='hold')
    ? (sc.restSeconds||(sets>1?15:0))
    : ((sc.type==='rounds'||sc.type==='callout') ? (sc.setRestSeconds||(sets>1?15:0)) : 0);
  return {
    type: sc.type, sets: sets,
    workSeconds: Math.round(work/1000/sets), restSeconds: sets>1?rest:0,
    totalSeconds: Math.round(total/1000),
    script: JSON.parse(JSON.stringify(sc))
  };
}

/* ---- Today's whole list (the watch and GET /api/done?view=today) ----
   opts: { goalie, coachPlan, netplayEnabled }. Same drills, same order, same
   ids the web app renders that day. A rest day (Sat/Sun) is a dryland rest
   only: the web still shows Hands and the third discipline as optional bonus
   skills, so the list carries those (each flagged bonus:true) and bonusDay:true.
   restDay stays true on weekends so an older watch build keeps its rest copy. */
function todayList(di, opts){
  opts=opts||{};
  var goalie=!!opts.goalie, out=[], rest=isRestDay(di);
  function add(disc, prefix, list){
    (list||[]).forEach(function(dr,i){
      var row={ id:prefix+':'+i, discipline:disc, name:dr.name, dose:rowSubtitle(disc, dr, goalie),
        cue:dr.cue||'', steps:(dr.steps||[]).slice(), timer:timerFor(disc, dr) };
      if(rest) row.bonus=true;
      out.push(row);
    });
  }
  add('stick', 'stick', stickForDay(di));
  add(thirdDiscipline(goalie), 'shoot', shootForDay(di, goalie, opts.netplayEnabled));
  if(rest) return { restDay:true, bonusDay:out.length>0, drills:out };
  add('dryland', 'dryland', drylandForDay(di, coachDrillNames(opts.coachPlan, di, 'dryland')));
  return { restDay:false, bonusDay:false, drills:out };
}

return {
  MOVE:MOVE, CAT:CAT, WORKOUTS:WORKOUTS, DRILLS:DRILLS, SHOOT_DAYS:SHOOT_DAYS, NETPLAY_DAYS:NETPLAY_DAYS,
  NETPLAY_ENABLED:NETPLAY_ENABLED, DRILL_SCRIPT:window.THWAP_DRILL_SCRIPT, SETUP_SECS:SETUP_SECS, COUNTDOWN:COUNTDOWN,
  STICK_PER_DAY:STICK_PER_DAY, SHOOT_TIMER_SECONDS:SHOOT_TIMER_SECONDS, GOALIE_FIRST_NAMES:GOALIE_FIRST_NAMES,
  scriptFor:scriptFor, buildSteps:buildSteps, timerFor:timerFor,
  weekday:weekday, isRestDay:isRestDay, weekdaySlot:weekdaySlot, isWeekend:isWeekend, dayIndexForDate:dayIndexForDate,
  coachDayKey:coachDayKey, coachDrillNames:coachDrillNames, drylandFromNames:drylandFromNames,
  todaysWorkout:todaysWorkout, trimDrills:trimDrills, drylandForDay:drylandForDay,
  stickForDay:stickForDay, shootDayIndex:shootDayIndex, netplayLive:netplayLive, shootForDay:shootForDay,
  rowSubtitle:rowSubtitle, isGoaliePosition:isGoaliePosition, thirdDiscipline:thirdDiscipline, disciplinesFor:disciplinesFor,
  catalog:catalog, weekGoals:weekGoals, todayList:todayList
};
}

// Server / Node copy. The browser builds its own from the inlined factory.
export const ThwapDrills = createThwapDrills({});
export const {
  MOVE, CAT, WORKOUTS, DRILLS, SHOOT_DAYS, NETPLAY_DAYS, NETPLAY_ENABLED, DRILL_SCRIPT, SETUP_SECS, COUNTDOWN,
  STICK_PER_DAY, SHOOT_TIMER_SECONDS, GOALIE_FIRST_NAMES,
  scriptFor, buildSteps, timerFor,
  weekday, isRestDay, weekdaySlot, isWeekend, dayIndexForDate,
  coachDayKey, coachDrillNames, drylandFromNames,
  todaysWorkout, trimDrills, drylandForDay,
  stickForDay, shootDayIndex, netplayLive, shootForDay,
  rowSubtitle, isGoaliePosition, thirdDiscipline, disciplinesFor,
  catalog, weekGoals, todayList,
} = ThwapDrills;
