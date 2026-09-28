/* Net play (goalie) drill rotation for Thwap.
 *
 * Structure MIRRORS window.SHOOT_DAYS: an array of 5 rotation days, each a list
 * of drill objects { emoji, name, theme, cue, steps[] }. A goalie (Johnny, #1)
 * sees this in the third discipline slot ("Net play") where skaters see Shooting.
 * The storage slot stays `shoot` so the leaderboard/store/radar math is untouched;
 * only the DISPLAYED discipline (label, hero, drills) changes for a goalie.
 *
 * Content = standard, well-established youth-goalie fundamentals (stance, crease
 * movement, angles/depth, tracking, rebound control, recovery), written kid-first
 * (8-13). No video/audio yet: those are added when Woody supplies clips, exactly
 * like the skater drills grew their videos over time. Durations mirror the ~15 min
 * shooting session. Cues are short enough to remember skating onto the ice.
 */
window.NETPLAY_DAYS = [
  /* Day 1: Stance and ready position */
  [
    { emoji: '🧎', name: 'Ready Stance', theme: 'Set your base', cue: 'Get into a strong, comfortable stance you can hold and move from.',
      steps: ['Feet: A little wider than your shoulders.', 'Knees: Bend them so you feel ready to spring.', 'Stick: Flat on the ice, out in front of your toes.', 'Hands: Glove and blocker out where you can see them.', 'Hold it: Stay set for 10 seconds, then relax. Do it 10 times.'] },
    { emoji: '⬆️', name: 'Up and Down', theme: 'Butterfly reps', cue: 'Drop into the butterfly and get back up, smooth and balanced.',
      steps: ['Start set: Begin in your ready stance.', 'Drop: Go down into the butterfly. Pads flat, stick covering the five-hole.', 'Stay square: Keep your chest up and facing forward.', 'Recover: Push back up to your stance.', 'Reps: 10 clean up-and-downs. Quality over speed.'] },
    { emoji: '👀', name: 'Eyes on the Puck', theme: 'Track it', cue: 'Follow the puck with your eyes the whole way in.',
      steps: ['Watch: Have someone slowly carry or roll a puck toward you.', 'Track: Keep your eyes locked on it, do not look away.', 'Head still: Move your eyes, not your whole head.', 'Set: Stay in your stance as it comes in.', 'Repeat: Track 10 pucks from different angles.'] },
  ],
  /* Day 2: Crease movement */
  [
    { emoji: '↔️', name: 'Shuffle', theme: 'Move square', cue: 'Slide side to side while staying square and set.',
      steps: ['Set: Start in your stance in the middle of the net.', 'Push: Push off one leg and shuffle to the side.', 'Stay square: Keep your shoulders facing forward the whole time.', 'Stop set: Arrive already in your stance, not sliding past.', 'Reps: 10 shuffles each way.'] },
    { emoji: '📐', name: 'T-Push', theme: 'Cover the post', cue: 'Push across the crease to get to the far side fast.',
      steps: ['Set: Start on one post in your stance.', 'Open: Point your lead skate where you want to go (make a T).', 'Push: Drive off your back leg across the crease.', 'Arrive square: Stop set on the other post, facing the puck.', 'Reps: 5 pushes each direction.'] },
    { emoji: '🎯', name: 'Post Integration', theme: 'Seal the post', cue: 'Get tight to the post so there is no gap for a wraparound.',
      steps: ['Skate to the post: Move to one post and set.', 'Seal it: Put your pad and skate against the post, no space.', 'Look across: Keep your eyes on where the puck could come from.', 'Push off: Move to the middle when the puck moves out.', 'Both sides: Practice sealing each post 5 times.'] },
    { emoji: '🔄', name: 'Recover to Feet', theme: 'Get back up', cue: 'After you go down, get square and back on your feet quickly.',
      steps: ['Drop: Start in the butterfly.', 'Find the puck: Eyes up, know where the next shot could come from.', 'Recover: Get one skate under you, then the other.', 'Set: Finish in your ready stance facing the puck.', 'Reps: 10 quick recoveries.'] },
  ],
  /* Day 3: Angles and depth */
  [
    { emoji: '📍', name: 'Center the Puck', theme: 'Line it up', cue: 'Line your body up between the puck and the middle of the net.',
      steps: ['Watch: Have someone hold the puck out in front.', 'Line up: Move so you are right between the puck and the net.', 'Check: Your nose, the puck, and the middle of the net make a line.', 'Move with it: When the puck moves side to side, adjust with it.', 'Reps: Follow the puck to 10 different spots.'] },
    { emoji: '↕️', name: 'Depth Control', theme: 'Out and in', cue: 'Come out to cut down the angle, then back in as the puck gets close.',
      steps: ['Start deep: Begin near your goal line.', 'Come out: Skate out a bit to take away more net.', 'Stay set: Keep your stance as you move.', 'Back in: As the puck comes closer, glide back so you do not get beat wide.', 'Reps: 8 out-and-in reps.'] },
    { emoji: '📐', name: 'Angle from the Wing', theme: 'Take the side away', cue: 'When the shot comes from the wing, cover the near post first.',
      steps: ['Set on the post: Start square to a shooter on the side.', 'Near post: Make sure the near side is sealed.', 'Show the far side: The far side is a harder shot, let them try it.', 'Track: Follow the puck if it moves to the middle.', 'Both wings: Practice from each side 5 times.'] },
    { emoji: '🚦', name: 'Read and React', theme: 'Decide', cue: 'Watch the shooter and decide: stay set, or move with the puck.',
      steps: ['Set: Start in your stance facing a shooter.', 'Watch: Keep your eyes on the puck and their stick.', 'Decide: If they move the puck, move with it. If they shoot, stay big.', 'Stay square: Always keep your shoulders facing the puck.', 'Reps: React to 10 different plays.'] },
  ],
  /* Day 4: Making saves */
  [
    { emoji: '🧤', name: 'Glove Saves', theme: 'Catch high', cue: 'Catch high shots on your glove side and hold on to them.',
      steps: ['Set: Ready stance, glove out where you can see it.', 'Watch it in: Track the puck all the way to your glove.', 'Catch: Close your glove around it, do not swat.', 'Hold: Keep the puck, then cover or set it down for the whistle.', 'Reps: Catch 10 shots to the glove.'] },
    { emoji: '🛡️', name: 'Blocker Saves', theme: 'Steer wide', cue: 'Use your blocker to send the puck to the corner, not back out front.',
      steps: ['Set: Ready stance, blocker beside your body.', 'Angle it: Turn the blocker so the puck goes to the corner.', 'Firm: Meet the puck, do not let it push your arm back.', 'Track: Watch it hit the blocker.', 'Reps: Steer 10 shots to the corner.'] },
    { emoji: '🦵', name: 'Pad Saves', theme: 'Seal the ice', cue: 'On low shots, drop into the butterfly and seal the ice with your pads.',
      steps: ['Set: Start in your stance.', 'Drop: Go into the butterfly as the low shot comes.', 'Seal: Pads flat and together so nothing sneaks under.', 'Stick down: Keep your stick covering the five-hole.', 'Reps: 10 low shots, seal every time.'] },
    { emoji: '🔁', name: 'Rebound Control', theme: 'No second chance', cue: 'Steer rebounds to the corner or smother them, never leave one out front.',
      steps: ['Make the save: Stop the first shot.', 'Direct it: Send the rebound to the corner or into your body.', 'Cover: If it is close, cover it for the whistle.', 'Recover: If it stays loose, get set again fast.', 'Reps: Control 10 rebounds.'] },
    { emoji: '🎯', name: 'Track Through Traffic', theme: 'Find the puck', cue: 'Move your head to find the puck when someone is in front of you.',
      steps: ['Set: Start in your stance with a screen (a cone or person) in front.', 'Look around: Move your head to see the puck past the screen.', 'Stay square: Keep facing the puck once you find it.', 'Save: Make the save on what you can see.', 'Reps: 10 pucks through a screen.'] },
  ],
  /* Day 5: Mixed review (one proven drill from each earlier day) */
  [
    { emoji: '🧎', name: 'Stance Warm-Up', theme: 'Get set', cue: 'Start with a few clean up-and-downs to warm up your base.',
      steps: ['Set: Ready stance.', 'Drop and recover: 5 smooth butterflies up and down.', 'Balance: Chest up, square, in control the whole time.'] },
    { emoji: '↔️', name: 'Shuffle and Set', theme: 'Move square', cue: 'Shuffle post to post and arrive already set each time.',
      steps: ['Start on a post: Set square.', 'Shuffle: Move to the other post staying square.', 'Arrive set: Stop in your stance, not sliding.', 'Reps: 6 post to post.'] },
    { emoji: '📍', name: 'Center the Puck', theme: 'Line it up', cue: 'Follow the puck and keep your body lined up with the net.',
      steps: ['Watch: Follow a puck moving side to side.', 'Line up: Stay between the puck and the middle of the net.', 'Check the line: Nose, puck, middle of net.', 'Reps: Track to 8 spots.'] },
    { emoji: '🦵', name: 'Butterfly Saves', theme: 'Seal low', cue: 'Drop and seal the ice on low shots, stick covering the five-hole.',
      steps: ['Set: Ready stance.', 'Drop: Butterfly on the low shot.', 'Seal: Pads together, stick down.', 'Reps: 8 low shots.'] },
    { emoji: '🔁', name: 'Rebound Finish', theme: 'Control it', cue: 'Make the save and put the rebound where nobody can score.',
      steps: ['Save: Stop the shot.', 'Direct: Rebound to the corner or cover it.', 'Recover: Get set again if it stays loose.', 'Reps: Control 8 rebounds.'] },
  ],
];
