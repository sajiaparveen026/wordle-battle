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