# Supabase setup for Wordle Battle accounts

Do these once. Nothing below needs a paid plan.

## 1. Create the database tables and security rules
1. Supabase dashboard > **SQL Editor** > **New query**.
2. Paste the whole of `supabase/migrations/001_auth_profiles.sql` and click **Run**. Safe to run again.

<<<<<<< HEAD
### 1b. Add the tutorial flag (one more small script)
Run `supabase/migrations/002_tutorial_flag.sql` the same way. (Without it the tutorial still works, but it is only
remembered on each device instead of on your account.)

=======
>>>>>>> 478442e6ee11fecb2857034e47a1ca71f1f668bf
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
7. Profile > Log out: you return to Welcome; "Play as Guest" shows your old guest progress.
8. Table Editor: `profiles` and `solo_saves` rows exist; try editing `coins` with the anon key from the browser console
   (it must be refused).
