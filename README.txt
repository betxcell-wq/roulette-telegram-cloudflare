ROULETTE TELEGRAM BOT — CLOUDFLARE WORKERS V1
==============================================

WHAT THIS IS
------------
This is the Cloudflare Workers + Durable Objects replacement for the previous
Netlify V3 demo bot.

It keeps:
- Exact-recovery roulette DEMO strategy
- Demo balance / unit / profit target / stop target
- Normal Auto Spin
- Cloudflare Turbo Auto Spin
- Stats, history, reset
- Demo deposit
- Demo withdrawal simulation
- Admin demo-withdrawal queue
- /myid admin diagnostic
- Separate BTC support button that does NOT credit demo/wager balance

IMPORTANT
---------
This project does NOT implement real-money gambling deposits, real wagering
balances, or actual BTC gambling withdrawals/payouts.

CLOUDFLARE DESIGN
-----------------
- Worker receives Telegram webhook updates.
- Each Telegram user gets a SQLite-backed Durable Object.
- Durable Object storage keeps that user's demo state.
- Durable Object alarms drive Auto Spin without a 15-minute Netlify background
  function window.
- A second Durable Object stores the global demo-withdrawal queue.

Cloudflare Turbo is set to 1 second instead of the old Netlify 0.5 second mode.
This is intentionally friendlier to Cloudflare's free request allowance.

FILES
-----
src/index.js
wrangler.jsonc
package.json

DEPLOY THROUGH CLOUDFLARE + GITHUB
----------------------------------
1. Create a NEW GitHub repository, for example:
      roulette-telegram-cloudflare

2. Upload the three project items:
      src/
      package.json
      wrangler.jsonc

3. In Cloudflare:
      Workers & Pages
      Create / Import a repository
      Select your GitHub repository

4. Use:
      Build command: npm install
      Deploy command: npx wrangler deploy

   If Cloudflare detects Wrangler automatically, keep its suggested Worker
   deployment settings.

5. After first deploy, open the Worker:
      Settings -> Variables and Secrets

6. Add these variables/secrets:
      TELEGRAM_BOT_TOKEN     = your CURRENT Telegram bot token
      WEBHOOK_SECRET         = make a new random secret
      SETUP_KEY              = make a new random setup key
      ADMIN_TELEGRAM_ID      = your numeric Telegram user ID
      SUPPORT_BTC_ADDRESS    = your existing support BTC address

   Keep TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET and SETUP_KEY as secrets.

7. Redeploy after adding/changing variables if Cloudflare asks you to.

8. Open:
      https://YOUR-WORKER.workers.dev/setup-webhook?key=YOUR_SETUP_KEY

   You should see:
      "Telegram webhook configured for Cloudflare."

9. In Telegram send:
      /start

ADMIN CHECK
-----------
Send:
      /myid

Expected:
      Your Telegram ID: ...
      Admin ID configured: YES
      Admin match: YES

Then send:
      /admin

SWITCHING FROM NETLIFY
----------------------
Telegram can have one webhook URL at a time. Calling the Cloudflare
/setup-webhook endpoint automatically points your existing bot to Cloudflare.
You do not have to delete the old Netlify site first.

ROLLBACK
--------
If you need to go back to Netlify, run the old Netlify /setup-webhook URL again.
That will point Telegram back to Netlify.

NOTES
-----
- Existing Netlify demo balances/history are not automatically migrated because
  Netlify Blobs and Cloudflare Durable Objects are separate storage systems.
  New Cloudflare users start with 1000 demo credits.
- The exact-recovery progression is unchanged:
      1u Red
      2u total on 2nd + 3rd Dozens
      3u Red
      then exact-recovery levels 12u, 18u, 72u, 108u, 432u...
- Recovery risk guard remains 35% of current demo bankroll.
