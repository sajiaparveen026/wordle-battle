# Supabase setup for Wordle Battle accounts

Do these once. Nothing below needs a paid plan.

## 1. Create the database tables and security rules
1. Supabase dashboard > **SQL Editor** > **New query**.
2. Paste the whole of `supabase/migrations/001_auth_profiles.sql` and click **Run**. Safe to run again.

### 1b. Add the tutorial flag (one more small script)
Run `supabase/migrations/002_tutorial_flag.sql` the same way. (Without it the tutorial still works, but it is only
remembered on each device instead of on your account.)

### 1c. Allow "Delete Account" (Settings > Privacy & Security)
Run `supabase/migrations/004_delete_account.sql` the same way. It adds one small function that lets a signed-in player
delete only their own account (their profile, cloud save and free-coin record are removed with it). Without it, Delete
Account shows "Account deletion isn't set up yet" and nothing is deleted. (Free coins, migration 003, is separate.)

### 1d. Turn on the Leaderboard
Run `supabase/migrations/005_leaderboard.sql` the same way. It creates the public ranking table (username, avatar, level, XP and wins only)
for registered players and guests. Nobody can read or write the table directly: only the app's functions can, and they never return emails
or secrets. Without it the Leaderboard shows a friendly "couldn't load" message and the rest of the app works as before.
Note: solo scores are reported by the player's device, so this board is not cheat-proof until online battles are verified on the server.

### 1e. Turn on Friend Battle (online 1v1 rooms)
Run these three scripts in order, the same way (each is safe to run again):
1. `supabase/migrations/006_friend_battle.sql` - the battle tables and the server functions that run every battle.
2. `supabase/migrations/006b_battle_words.sql` - the word list the server uses to pick secret words and check guesses.
3. `supabase/migrations/006c_battle_clues.sql` - the clues for the Clue button.

Then check **Realtime** is on: Dashboard > **Project Settings > API** (or **Realtime > Settings**) > make sure **Allow public access** to
Realtime channels is enabled (it is by default). The app uses Realtime *broadcast* only; no table needs to be added to a Realtime publication.
Nobody can read the battle tables directly: the secret word and the opponent's guesses stay inside the database until the battle ends.
The server applies timeouts and 60-second reconnect forfeits the next time either player's browser checks in, so no scheduled job is needed.

### 1f. Turn on Friends (friend list, requests, battle invitations)
Run `supabase/migrations/007_friends.sql` the same way, **after** 005 and 006. It adds the friends, requests, invitations and
notifications tables (locked down: only the app's checked functions can touch them) and uses the same Realtime broadcast as battles.
Without it the Friends page shows a "not set up yet" message and everything else works as before. Guests and registered players both
can use it; a guest's friends live on that device until they create an account, when they move over.

### 1g. Turn on the Spin Wheel
Run `supabase/migrations/008_spin_wheel.sql` the same way. It stores the prize list (edit the `wheel_prizes` table to change prizes, odds or amounts),
each player's free-spin day and their spin history, and picks every prize on the server. Without it the wheel still works for guests; signed-in
players see a "not set up yet" message. Guests use the prize list inside `js/wheel.js` (`WHEEL_PRIZES`): keep the two lists equal.

### 1h. Turn on Team Zone (3 to 5 players)
Run `supabase/migrations/009_team_zone.sql` the same way, **after** 006 and 006b. It adds its own tables (`tz_rooms`, `tz_players`) and
functions (`tz_*`). Friend Zone's functions are not changed. Until it is run, Team Zone shows a "not set up yet" message and nothing else is affected.

### 1i. Team Zone gameplay
Run `supabase/migrations/010_team_zone_play.sql` after 009. It adds guesses, hints, solving, timeouts and placements. It replaces the
Team Zone functions it needs (Friend Zone is unchanged).

### 1j. Team Zone results, rewards, rematch
Run `supabase/migrations/011_team_zone_results.sql` after 010. It needs **007_friends.sql** to have been run first (Add Friend uses
it). It adds placement rewards (edit the `tz_rewards` table to change amounts), the rematch, and a Friend Zone rule: a player
who is in a Team Zone battle cannot be put into a Friend Zone room. Players who see a generic "Something went wrong" when
joining a Friend Zone room are most likely in a Team Zone battle.

### 1k. Invite friends into a waiting lobby (Friend Zone and Team Zone)
Run `supabase/migrations/012_room_invites.sql` after 011 (it needs 006, 007, 009, 010 and 011). It adds the **Invite Friends**
button in both waiting lobbies. The host picks a friend, the friend gets a live notification with Accept / Decline, and
accepting seats them in that same room without typing the code. The server checks that only the host invites, that the
room still has a free seat, that the friend is not already in another battle, and it never allows two invitations to the same
friend for the same room. Invitations close by themselves when the room fills up, starts, is cancelled or expires.
Room codes and sharing work exactly as before. It uses only the public (anon) key, never the service-role key.
It replaces the `fr_overview` function from 007 with a version that also returns room invitations (safe to run again).

### 1l. Team Zone rematch: host-controlled
Run `supabase/migrations/013_team_rematch_host.sql` after 011 (012 is separate; run it in any order relative to 013). Only the host (the
player who created the room) can start a Team Zone rematch, and the server checks that, not just the screen. Each request gets its
own id and lasts 30 seconds. The others answer Accept or Decline, the host sees a live list of who accepted, declined or has not
answered, and the new battle starts only when everyone has accepted: same players, size and difficulty, a new room, and a new secret
word. One decline, a timeout, or the host cancelling ends the request and the host can send a fresh one. Friend Zone is not changed.
Safe to run again. Until it is run, the old rematch (anyone can ask) keeps working, but without the new host popup details.

## 2. Allow your site's addresses (needed for email links, password reset and Google)
Dashboard > **Authentication > URL Configuration**
- **Site URL**: your Vercel address, e.g. `https://wordle-battle.vercel.app`
- **Redirect URLs** (add each, keep the trailing slash):
  - `https://wordle-battle.vercel.app/`
  - `http://localhost:8000/` (for testing on your computer)

## 3. Email sign-in settings
Dashboard > **Authentication > Sign In / Providers > Email**
- Email provider: **on**. **Confirm email**: **on** (recommended).
- Password rules: minimum length **8** and require lowercase, uppercase and digits. The app checks this too,
  but this setting is the one that is enforced by the server.
- Dashboard > **Authentication > Rate Limits**: keep the defaults or lower them.
- Heads up: the built-in email sender is limited to a few emails per hour. For real players, add your own
  SMTP provider under **Authentication > SMTP Settings**.

## 4. Google login (optional; the Google button only appears once this works)
1. console.cloud.google.com > create/select a project > **APIs & Services > OAuth consent screen** (External, add your app name and email).
2. **Credentials > Create credentials > OAuth client ID > Web application**.
   - Authorized JavaScript origins: your Vercel address.
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (Supabase shows this exact address on its Google provider page).
3. Copy the **Client ID** and **Client secret** into Supabase > **Authentication > Sign In / Providers > Google**, switch it on, **Save**.

## 5. Put your PUBLIC keys in the app
Dashboard > **Project Settings > API (or API Keys)**: copy the **Project URL** and the **anon / publishable** key.
Never use the `service_role` / secret key in this app (the build refuses it).

Choose ONE way:
- **Vercel (recommended):** Project > **Settings > Environment Variables**: add `SUPABASE_URL` and
  `SUPABASE_ANON_KEY`, then redeploy. `scripts/stamp-version.js` writes `js/config.js` from them at build time.
- **Or edit `js/config.js`** and commit it (these two values are public by design).

## 6. Testing checklist
1. Open the app in a private window: the Welcome screen appears with Create Account / Log In / Play as Guest.
2. Create an account: you land on "Check your email". Open the link (same browser), then Log In. Dashboard shows your username.
3. Try wrong password: you get "Incorrect email or password." (same message for an unknown email).
4. Forgot password > email > link opens "Choose a new password" > save > you return to Log In.
5. Play a game, reload: coins/XP/stats are still there. Log in on another device: the same progress appears.
6. As a guest with some progress, create an account and log in: you are asked once whether to move guest progress.
7. Home > gear (Settings) > Log Out > confirm: you return to Welcome; "Play as Guest" shows your old guest progress.
7b. Settings > Privacy & Security > Change Password (needs your current password), Account Security (shows your email;
   "Sign out other devices" logs out your other phones/computers) and Delete Account (type DELETE; needs migration 004).
8. Table Editor: `profiles` and `solo_saves` rows exist; try editing `coins` with the anon key from the browser console
   (it must be refused).