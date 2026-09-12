const REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const D2 = new Set(Array.from({length:12}, (_,i)=>i+13));
const D3 = new Set(Array.from({length:12}, (_,i)=>i+25));

const NORMAL_SPEED_MS = 2000;
// Cloudflare free-tier friendly Turbo. 500 ms continuous use would exceed 100k requests/day.
const TURBO_SPEED_MS = 1000;

function json(obj, status=200) {
  return Response.json(obj, { status });
}

function defaultState(userId) {
  return {
    userId: String(userId),
    strategyVersion: 2,
    balance: 1000,
    startBalance: 1000,
    unit: 1,
    target: 50,
    stoploss: 100,
    stage: 1,
    deficit: 0,
    maxRiskPct: 35,
    cyclePl: 0,
    spins: 0,
    cycles: 0,
    wins: 0,
    losses: 0,
    peakBalance: 1000,
    maxDrawdown: 0,
    running: false,
    runId: null,
    speedMs: NORMAL_SPEED_MS,
    pendingInput: null,
    pendingWithdrawalAmount: null,
    demoWithdrawals: [],
    history: [],
    autoTarget: null,
    mode: "demo",
    poolContributions: [],
    poolPendingInput: null,
    poolPendingAmount: null,
    poolName: null
  };
}

function unitsAt(stage, deficit=0) {
  if (stage === 1) return 1;
  if (stage === 2) return 2;
  if (stage === 3) return 3;
  return stage % 2 === 1 ? deficit : 2 * deficit;
}

function stageInfo(stage, unit, deficit=0) {
  const units = unitsAt(stage, deficit);
  const isRed = stage % 2 === 1;
  return {
    units,
    risk: units * unit,
    isRed,
    title: isRed ? `LEVEL ${stage} — RED` : `LEVEL ${stage} — 2ND + 3RD DOZENS`
  };
}

function resultFor(stage, n, unit, deficit=0) {
  const info = stageInfo(stage, unit, deficit);
  if (info.isRed) {
    return REDS.has(n)
      ? { pnl: info.risk, label: "RED WIN", complete: true }
      : { pnl: -info.risk, label: "RED LOSS", complete: false };
  }
  const hit = D2.has(n) || D3.has(n);
  return hit
    ? { pnl: info.risk / 2, label: "DOZENS WIN", complete: true }
    : { pnl: -info.risk, label: "DOZENS LOSS", complete: false };
}

function fmt(n) { return Number(n).toFixed(2); }
function fmtSigned(n) { return `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}`; }

function statusText(st, result=null, reason=null) {
  const session = st.balance - st.startBalance;
  const total = st.wins + st.losses;
  const wr = total ? (st.wins / total * 100) : 0;
  const info = stageInfo(st.stage || 1, st.unit, Number(st.deficit || 0));
  let betLines = "";
  if (info.isRed) {
    betLines = `${info.units} unit${info.units === 1 ? "" : "s"} • Red`;
  } else {
    const half = info.units / 2;
    betLines = `${half} units • 2nd Dozen\n${half} units • 3rd Dozen\nTotal risk • ${info.units} units`;
  }

  let top = "";
  if (result) {
    top += `🎲 LAST SPIN: ${result.number}   (Spin #${result.spin})\n`;
    top += `Step ${result.stage} — ${result.label}\n`;
    top += `Spin P/L: ${fmtSigned(result.pnl)}\n────────────────────\n`;
  }
  if (reason) top += `⛔ ${reason}\n────────────────────\n`;

  return top +
`🎰 COMMUNITY DEMO BOT
Mode        ${st.mode === "pool" ? "COMMUNITY POOL" : "DEMO"}
────────────────────
Balance     ${fmt(st.balance)}
Session P/L ${fmtSigned(session)}
Unit        ${fmt(st.unit)}
Spins       ${st.spins}
Cycles      ${st.cycles}
Win Rate    ${wr.toFixed(1)}%
Drawdown    ${fmt(st.maxDrawdown)}
Deficit     ${fmt((st.deficit || 0) * st.unit)}
────────────────────
${info.title}
${betLines}
Current risk • ${fmt(info.risk)} (${info.units}u)
────────────────────
Auto • ${st.running ? "RUNNING" : "STOPPED"}`;
}

function statsText(st) {
  const session = st.balance - st.startBalance;
  const total = st.wins + st.losses;
  const wr = total ? st.wins / total * 100 : 0;
  return `📊 SESSION STATS

Balance: ${fmt(st.balance)} credits
Session P/L: ${fmtSigned(session)}
Unit Size: ${fmt(st.unit)}
Profit Target: +${fmt(st.target)}
Stop Target: -${fmt(st.stoploss)}

Spins: ${st.spins}
Cycles: ${st.cycles}
Wins: ${st.wins}
Losses: ${st.losses}
Win Rate: ${wr.toFixed(1)}%
Max Drawdown: ${fmt(st.maxDrawdown)}
Recovery Level: ${st.stage || 1}
Recovery Deficit: ${fmt((st.deficit || 0) * st.unit)}
Max Recovery Risk: ${st.maxRiskPct || 35}% bankroll

Auto: ${st.running ? "RUNNING" : "STOPPED"}`;
}

function historyText(st) {
  const rows = (st.history || []).slice(0, 12);
  if (!rows.length) return "🧾 HISTORY\n\nNo spins yet.";
  return "🧾 LAST 12 SPINS\n\n" + rows.map(r =>
    `#${r.spin} • ${r.number} • L${r.stage} • ${r.label} • ${fmtSigned(r.pnl)} • Bal ${fmt(r.balance)}`
  ).join("\n");
}

function mainKeyboard(st) {
  const turbo = st.speedMs <= TURBO_SPEED_MS;

  const rows = [
    [
      { text: st.mode === "demo" ? "✅ DEMO" : "🎮 Demo", callback_data: "mode_demo" },
      { text: st.mode === "pool" ? "✅ COMMUNITY POOL" : "🤝 Community Pool", callback_data: "mode_pool" }
    ]
  ];

  if (st.mode === "demo") {
    rows.push(
      [
        { text: st.running ? "⏹ Stop Auto" : "▶️ Start Auto", callback_data: st.running ? "stop" : "start" },
        { text: turbo ? "⚡ TURBO ON" : "⚡ Turbo Speed", callback_data: turbo ? "speed_normal" : "speed_turbo" }
      ],
      [
        { text: "⚙️ Bet Settings", callback_data: "settings" },
        { text: "📊 Stats", callback_data: "stats" }
      ],
      [
        { text: "🧾 History", callback_data: "history" },
        { text: "🔄 Reset", callback_data: "reset" }
      ],
      [
        { text: "➕ Demo Deposit", callback_data: "deposit100" },
        { text: "➖ Demo Withdraw", callback_data: "demo_withdraw" }
      ],
      [
        { text: "₿ Support with BTC", callback_data: "btc_support" },
        { text: "📋 Demo Withdrawals", callback_data: "demo_withdrawals" }
      ]
    );
  } else {
    rows.push(
      [
        { text: "🏦 Pool Summary", callback_data: "pool_summary" },
        { text: "➕ Record Contribution", callback_data: "pool_add" }
      ],
      [
        { text: "📜 My Contributions", callback_data: "pool_mine" },
        { text: "🗳 Governance", callback_data: "pool_governance" }
      ],
      [
        { text: "₿ Treasury Address", callback_data: "pool_address" },
        { text: "🎰 Back to Demo", callback_data: "mode_demo" }
      ]
    );
  }

  return { inline_keyboard: rows };
}



function poolSummaryText(st) {
  const mine = st.poolContributions || [];
  const myTotal = mine.reduce((a, x) => a + Number(x.amount || 0), 0);

  return `🤝 COMMUNITY POOL

Your recorded contributions: ${mine.length}
Your recorded total: ${myTotal.toFixed(8)} BTC

This pool is for community/development funding only.
It is NOT a gambling bankroll and does not create wagering credits or gambling withdrawal rights.

Use "Record Contribution" to log a contribution you made to the community treasury.`;
}

function poolMineText(st) {
  const mine = (st.poolContributions || []).slice(0, 20);
  if (!mine.length) {
    return "📜 MY CONTRIBUTIONS\n\nNo community contributions recorded yet.";
  }

  const total = mine.reduce((a, x) => a + Number(x.amount || 0), 0);
  const lines = mine.map((x, i) =>
    `${i + 1}. ${Number(x.amount).toFixed(8)} BTC • ${x.status || "RECORDED"}${x.note ? `\n${x.note}` : ""}`
  ).join("\n\n");

  return `📜 MY CONTRIBUTIONS\n\n${lines}\n\nTotal recorded: ${total.toFixed(8)} BTC`;
}

function poolAddressText(env) {
  const address = String(env.SUPPORT_BTC_ADDRESS || "").trim();
  if (!address) return "₿ COMMUNITY TREASURY\n\nTreasury address is not configured yet.";

  return `₿ COMMUNITY TREASURY

BTC address:
${address}

Community funding only.

Sending BTC here does NOT add roulette credits, create a gambling balance, or create any entitlement to gambling winnings or withdrawals.`;
}

function governanceText() {
  return `🗳 COMMUNITY GOVERNANCE

Suggested uses for the community pool:
• Hosting and infrastructure
• Bot development
• Design and maintenance
• Community tools and services
• Other non-gambling project expenses approved by the group

This version tracks funding only. It does not spend funds automatically and does not use the treasury as a roulette bankroll.`;
}

function settingsKeyboard() {
  return { inline_keyboard: [
    [{ text: "💰 Unit Size", callback_data: "input_unit" }],
    [{ text: "🎯 Profit Target", callback_data: "input_target" }],
    [{ text: "🛑 Stop Target", callback_data: "input_stop" }],
    [{ text: "🎰 Dashboard", callback_data: "dashboard" }]
  ]};
}

function viewKeyboard() {
  return { inline_keyboard: [
    [{ text: "🎰 Dashboard", callback_data: "dashboard" }],
    [{ text: "📊 Stats", callback_data: "stats" }, { text: "🧾 History", callback_data: "history" }],
    [{ text: "🔄 Reset Session", callback_data: "reset" }]
  ]};
}

async function telegramApi(env, method, payload) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || "unknown error"}`);
  return data.result;
}

async function safeEdit(env, chatId, messageId, text, replyMarkup) {
  try {
    await telegramApi(env, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: replyMarkup
    });
  } catch (e) {
    if (!String(e.message).includes("message is not modified")) throw e;
  }
}

function normalizeId(v) {
  return String(v ?? "").trim().replace(/^["']|["']$/g, "");
}

function isAdmin(env, userId) {
  const configured = normalizeId(env.ADMIN_TELEGRAM_ID);
  return configured.length > 0 && configured === normalizeId(userId);
}

function demoWithdrawalText(st) {
  const rows = (st.demoWithdrawals || []).slice(0, 10);
  if (!rows.length) return "💸 DEMO WITHDRAWALS\n\nNo demo withdrawal requests yet.";
  return "💸 DEMO WITHDRAWALS\n\n" + rows.map((w, i) =>
    `${i + 1}. ${Number(w.amount).toFixed(2)} credits • ${w.status}\nTest address: ${w.address}`
  ).join("\n\n") + "\n\n⚠️ Simulation only — no real BTC is owed or sent.";
}

function supportText(env) {
  const address = String(env.SUPPORT_BTC_ADDRESS || "").trim();
  if (!address) return "₿ SUPPORT WITH BITCOIN\n\nSupport address is not configured yet.";
  return `₿ SUPPORT WITH BITCOIN

BTC address:
${address}

⚠️ Support payments are separate from the roulette demo. Sending BTC here does NOT add demo credits, create a wagering balance, or create any withdrawal entitlement.`;
}

function adminQueueText(queue) {
  const rows = queue.slice(0, 10);
  if (!rows.length) return "🛠 DEMO ADMIN QUEUE\n\nNo demo withdrawal requests.";
  return "🛠 DEMO ADMIN QUEUE\n\n" + rows.map(w =>
    `${w.id} • User ${w.userId}\n${Number(w.amount).toFixed(2)} credits • ${w.status}\n${w.address}`
  ).join("\n\n") + "\n\nSimulation only. Status controls do not send BTC.";
}

function adminQueueKeyboard(queue) {
  const pending = queue.filter(w => w.status === "PENDING (DEMO)").slice(0, 4);
  const buttons = pending.map(w => [
    { text: `✅ ${w.id}`, callback_data: `wa:${w.id}` },
    { text: `❌ ${w.id}`, callback_data: `wr:${w.id}` },
    { text: `🧪 Paid ${w.id}`, callback_data: `wp:${w.id}` }
  ]);
  buttons.push([{ text: "🎰 Dashboard", callback_data: "dashboard" }]);
  return { inline_keyboard: buttons };
}

async function queueStub(env) {
  const id = env.WITHDRAWALS.idFromName("global");
  return env.WITHDRAWALS.get(id);
}

async function queueGet(env) {
  const stub = await queueStub(env);
  const r = await stub.fetch("https://queue.local/list");
  return r.json();
}

async function queueAdd(env, item) {
  const stub = await queueStub(env);
  const r = await stub.fetch("https://queue.local/add", {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify(item)
  });
  return r.json();
}

async function queueAction(env, id, action) {
  const stub = await queueStub(env);
  const r = await stub.fetch("https://queue.local/action", {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify({id, action})
  });
  return r.json();
}

export class WithdrawalQueue {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/list") {
      return json((await this.storage.get("queue")) || []);
    }
    if (url.pathname === "/add" && req.method === "POST") {
      const item = await req.json();
      const queue = (await this.storage.get("queue")) || [];
      const next = [item, ...queue].slice(0, 200);
      await this.storage.put("queue", next);
      return json(next);
    }
    if (url.pathname === "/action" && req.method === "POST") {
      const {id, action} = await req.json();
      const queue = (await this.storage.get("queue")) || [];
      const item = queue.find(w => w.id === id);
      if (item) {
        item.status = action === "wa" ? "APPROVED (DEMO)"
          : action === "wr" ? "REJECTED (DEMO)"
          : "MARKED PAID (DEMO)";
        item.updatedAt = Date.now();
        if (action === "wr") item.refunded = true;
        await this.storage.put("queue", queue);
      }
      return json({ item, queue });
    }
    return new Response("Not found", {status:404});
  }
}

export class PlayerState {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
    this.env = env;
  }

  async getState(userId) {
    let st = await this.storage.get("state");
    if (!st) {
      st = defaultState(userId);
      await this.storage.put("state", st);
    }
    return st;
  }

  async saveState(st) {
    await this.storage.put("state", st);
    return st;
  }

  async executeSpin(st, expectedRunId=null) {
    if (expectedRunId && (!st.running || st.runId !== expectedRunId)) {
      return { stopped:true, state:st };
    }

    const stage = st.stage || 1;
    const deficit = Number(st.deficit || 0);
    const {risk, units} = stageInfo(stage, st.unit, deficit);
    const riskPct = st.balance > 0 ? (risk / st.balance * 100) : 100;

    if (stage > 1 && riskPct > Number(st.maxRiskPct || 35)) {
      st.running = false;
      st.runId = null;
      st.autoTarget = null;
      return {
        stopped:true,
        reason:`Recovery stopped: next wager is ${riskPct.toFixed(1)}% of bankroll, above the ${st.maxRiskPct || 35}% limit.`,
        state:st
      };
    }

    if (st.balance + 1e-9 < risk) {
      st.running = false;
      st.runId = null;
      st.autoTarget = null;
      return { stopped:true, reason:"Insufficient demo balance for the next wager.", state:st };
    }

    const n = Math.floor(Math.random() * 37);
    const r = resultFor(stage, n, st.unit, deficit);
    const balance = st.balance + r.pnl;
    const cyclePl = st.cyclePl + r.pnl;
    const spins = st.spins + 1;
    const cycles = st.cycles + (r.complete ? 1 : 0);
    const wins = st.wins + (r.pnl > 0 ? 1 : 0);
    const losses = st.losses + (r.pnl <= 0 ? 1 : 0);
    const peakBalance = Math.max(st.peakBalance, balance);
    const drawdown = Math.max(0, peakBalance - balance);
    const maxDrawdown = Math.max(st.maxDrawdown, drawdown);

    Object.assign(st, {
      balance,
      stage: r.complete ? 1 : stage + 1,
      deficit: r.complete ? 0 : deficit + units,
      cyclePl: r.complete ? 0 : cyclePl,
      spins, cycles, wins, losses, peakBalance, maxDrawdown
    });

    const item = { spin:spins, number:n, stage, label:r.label, pnl:r.pnl, balance, ts:Date.now() };
    st.history = [item, ...(st.history || [])].slice(0, 50);

    const session = st.balance - st.startBalance;
    let reason = null;
    if (st.target > 0 && session >= st.target) {
      st.running = false;
      st.runId = null;
      st.autoTarget = null;
      reason = `Profit target reached: ${fmtSigned(session)} credits.`;
    } else if (st.stoploss > 0 && session <= -st.stoploss) {
      st.running = false;
      st.runId = null;
      st.autoTarget = null;
      reason = `Stop target reached: ${fmtSigned(session)} credits.`;
    }

    return { state:st, result:item, reason };
  }

  async showSettings(chatId, messageId, st) {
    const text = `⚙️ BET SETTINGS

Current Unit Size: ${st.unit.toFixed(2)} credits
Profit Target: +${st.target.toFixed(2)} credits
Stop Target: -${st.stoploss.toFixed(2)} credits

Choose the value you want to change:`;
    return safeEdit(this.env, chatId, messageId, text, settingsKeyboard());
  }

  async handleCallback(q, st) {
    const data = q.data;
    const userId = String(q.from.id);
    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;

    await telegramApi(this.env, "answerCallbackQuery", {callback_query_id:q.id});

    if (/^w[arp]:/.test(data)) {
      if (!isAdmin(this.env, userId)) {
        return safeEdit(this.env, chatId, messageId, "⛔ Admin access required.", viewKeyboard());
      }
      const [action, id] = data.split(":");
      const result = await queueAction(this.env, id, action);
      if (result.item) {
        const ownerId = String(result.item.userId);
        const targetId = this.env.PLAYERS.idFromName(ownerId);
        const target = this.env.PLAYERS.get(targetId);
        await target.fetch("https://player.local/admin-update-withdrawal", {
          method:"POST",
          headers:{"content-type":"application/json"},
          body:JSON.stringify({
            id,
            status: result.item.status,
            refund: action === "wr" && !result.item.ownerRefundApplied,
            amount: result.item.amount
          })
        });
        if (action === "wr" && !result.item.ownerRefundApplied) {
          // Mark refund applied globally to make rejection idempotent.
          const stub = await queueStub(this.env);
          await stub.fetch("https://queue.local/mark-refund", {
            method:"POST",
            headers:{"content-type":"application/json"},
            body:JSON.stringify({id})
          });
        }
      }
      const queue = await queueGet(this.env);
      return safeEdit(this.env, chatId, messageId, adminQueueText(queue), adminQueueKeyboard(queue));
    }


    if (data === "mode_demo") {
      st.mode = "demo";
      st.poolPendingInput = null;
      st.poolPendingAmount = null;
      await this.saveState(st);
      return safeEdit(this.env, chatId, messageId, "🎮 DEMO MODE\n\n" + statusText(st), mainKeyboard(st));
    }

    if (data === "mode_pool") {
      st.mode = "pool";
      st.running = false;
      st.runId = null;
      st.autoTarget = null;
      st.pendingInput = null;
      await this.storage.deleteAlarm();
      await this.saveState(st);
      return safeEdit(this.env, chatId, messageId, poolSummaryText(st), mainKeyboard(st));
    }

    if (data === "pool_summary") {
      st.mode = "pool";
      await this.saveState(st);
      return safeEdit(this.env, chatId, messageId, poolSummaryText(st), mainKeyboard(st));
    }

    if (data === "pool_mine") {
      return safeEdit(this.env, chatId, messageId, poolMineText(st), mainKeyboard(st));
    }

    if (data === "pool_governance") {
      return safeEdit(this.env, chatId, messageId, governanceText(), mainKeyboard(st));
    }

if (data === "pool_address") {
  const address = String(this.env.SUPPORT_BTC_ADDRESS || "").trim();

  const rows = [];

  if (address) {
    rows.push([
      {
        text: "₿ Open Bitcoin Wallet",
        url: `bitcoin:${address}`
      }
    ]);
  }

  rows.push([
    {
      text: "🤝 Community Pool",
      callback_data: "mode_pool"
    }
  ]);

  return telegramApi(this.env, "sendMessage", {
    chat_id: chatId,
    text: poolAddressText(this.env),
    reply_markup: {
      inline_keyboard: rows
    }
  });
}
    if (data === "pool_add") {
      st.mode = "pool";
      st.poolPendingInput = "amount";
      st.poolPendingAmount = null;
      await this.saveState(st);
      return safeEdit(this.env, chatId, messageId,
        "➕ RECORD COMMUNITY CONTRIBUTION\n\nEnter the BTC amount you contributed.\n\nExample: 0.001\n\nThis only records community funding. It does not create roulette credits or gambling withdrawal rights.",
        { inline_keyboard:[[ {text:"⬅️ Cancel", callback_data:"mode_pool"} ]] }
      );
    }

    if (data === "dashboard") {
      st.pendingInput = null;
      await this.saveState(st);
      return safeEdit(this.env, chatId, messageId, statusText(st), mainKeyboard(st));
    }

    if (data === "settings") {
      st.pendingInput = null;
      await this.saveState(st);
      return this.showSettings(chatId, messageId, st);
    }

    if (["input_unit","input_target","input_stop"].includes(data)) {
      st.pendingInput = data.replace("input_", "");
      await this.saveState(st);
      const labels = {
        unit:["💰 UNIT SIZE","Type your new unit size.\n\nExample: 0.10"],
        target:["🎯 PROFIT TARGET","Type the profit amount that should automatically stop Auto Spin.\n\nExample: 10"],
        stop:["🛑 STOP TARGET","Type the maximum session loss that should automatically stop Auto Spin.\n\nExample: 20"]
      };
      const [title, body] = labels[st.pendingInput];
      return safeEdit(this.env, chatId, messageId, `${title}\n\n${body}`, {
        inline_keyboard:[[ {text:"⬅️ Cancel", callback_data:"settings"} ]]
      });
    }

    if (data === "speed_turbo") {
      st.speedMs = TURBO_SPEED_MS;
      await this.saveState(st);
      return safeEdit(this.env, chatId, messageId, statusText(st) + "\n\n⚡ Speed • CLOUDFLARE TURBO (1 sec)", mainKeyboard(st));
    }

    if (data === "speed_normal") {
      st.speedMs = NORMAL_SPEED_MS;
      await this.saveState(st);
      return safeEdit(this.env, chatId, messageId, statusText(st) + "\n\n⏱ Speed • NORMAL (2 sec)", mainKeyboard(st));
    }

    if (data === "start") {
      if (!st.running) {
        st.running = true;
        st.runId = crypto.randomUUID();
        st.autoTarget = {chatId, messageId, runId:st.runId};
        await this.saveState(st);
        await safeEdit(this.env, chatId, messageId, statusText(st), mainKeyboard(st));
        await this.storage.setAlarm(Date.now() + 250);
      } else {
        await safeEdit(this.env, chatId, messageId, statusText(st), mainKeyboard(st));
      }
      return;
    }

    if (data === "stop") {
      st.running = false;
      st.runId = null;
      st.autoTarget = null;
      await this.saveState(st);
      await this.storage.deleteAlarm();
      return safeEdit(this.env, chatId, messageId, statusText(st), mainKeyboard(st));
    }

    if (data === "stats") return safeEdit(this.env, chatId, messageId, statsText(st), viewKeyboard());
    if (data === "history") return safeEdit(this.env, chatId, messageId, historyText(st), viewKeyboard());

    if (data === "reset") {
      st.running = false;
      st.runId = null;
      st.autoTarget = null;
      st.startBalance = st.balance;
      st.stage = 1;
      st.deficit = 0;
      st.cyclePl = 0;
      st.spins = 0;
      st.cycles = 0;
      st.wins = 0;
      st.losses = 0;
      st.peakBalance = st.balance;
      st.maxDrawdown = 0;
      st.pendingInput = null;
      st.history = [];
      await this.saveState(st);
      await this.storage.deleteAlarm();
      return safeEdit(this.env, chatId, messageId, "✅ Session reset.\n\n" + statusText(st), mainKeyboard(st));
    }

if (data === "btc_support") {
  const address = String(this.env.SUPPORT_BTC_ADDRESS || "").trim();

  const rows = [];

  if (address) {
    rows.push([
      {
        text: "₿ Open Bitcoin Wallet",
        url: `bitcoin:${address}`
      }
    ]);
  }

  rows.push([
    {
      text: "🎰 Dashboard",
      callback_data: "dashboard"
    }
  ]);

  return telegramApi(this.env, "sendMessage", {
    chat_id: chatId,
    text: supportText(this.env),
    reply_markup: {
      inline_keyboard: rows
    }
  });
}

    if (data === "demo_withdraw") {
      st.pendingInput = "withdraw_amount";
      st.pendingWithdrawalAmount = null;
      await this.saveState(st);
      return safeEdit(this.env, chatId, messageId,
        "💸 DEMO WITHDRAWAL\n\nEnter the number of DEMO credits you want to withdraw.\n\nThis is a simulation and does not create a real BTC payout entitlement.",
        {inline_keyboard:[[ {text:"⬅️ Cancel", callback_data:"dashboard"} ]]}
      );
    }

    if (data === "demo_withdrawals") {
      return safeEdit(this.env, chatId, messageId, demoWithdrawalText(st), viewKeyboard());
    }

    if (data === "deposit100") {
      st.balance += 100;
      st.peakBalance = Math.max(st.peakBalance, st.balance);
      await this.saveState(st);
      return safeEdit(this.env, chatId, messageId, "✅ Demo deposit +100 credits.\n\n" + statusText(st), mainKeyboard(st));
    }
  }

  async handleText(message, st) {
    const userId = String(message.from.id);
    const chatId = message.chat.id;
    const text = (message.text || "").trim();

    if (text === "/start" || text === "/dashboard") {
      st.pendingInput = null;
      await this.saveState(st);
      return telegramApi(this.env, "sendMessage", {
        chat_id:chatId, text:statusText(st), reply_markup:mainKeyboard(st)
      });
    }

    if (text === "/pool") {
      st.mode = "pool";
      st.running = false;
      st.runId = null;
      st.autoTarget = null;
      await this.storage.deleteAlarm();
      await this.saveState(st);
      return telegramApi(this.env, "sendMessage", {
        chat_id: chatId,
        text: poolSummaryText(st),
        reply_markup: mainKeyboard(st)
      });
    }

    if (text === "/stats") {
      return telegramApi(this.env, "sendMessage", {chat_id:chatId, text:statsText(st), reply_markup:viewKeyboard()});
    }

    if (text === "/history") {
      return telegramApi(this.env, "sendMessage", {chat_id:chatId, text:historyText(st), reply_markup:viewKeyboard()});
    }

    if (text === "/myid") {
      return telegramApi(this.env, "sendMessage", {
        chat_id:chatId,
        text:`Your Telegram ID: ${userId}\nAdmin ID configured: ${normalizeId(this.env.ADMIN_TELEGRAM_ID) ? "YES" : "NO"}\nAdmin match: ${isAdmin(this.env, userId) ? "YES" : "NO"}`
      });
    }

    if (text === "/admin") {
      if (!isAdmin(this.env, userId)) {
        return telegramApi(this.env, "sendMessage", {chat_id:chatId, text:"⛔ Admin access required. Send /myid to diagnose the admin ID."});
      }
      const queue = await queueGet(this.env);
      return telegramApi(this.env, "sendMessage", {
        chat_id:chatId, text:adminQueueText(queue), reply_markup:adminQueueKeyboard(queue)
      });
    }

    if (st.poolPendingInput === "amount") {
      const amount = Number(text.replaceAll(",", ""));
      if (!Number.isFinite(amount) || amount <= 0 || amount > 21_000_000) {
        return telegramApi(this.env, "sendMessage", {
          chat_id: chatId,
          text: "Enter a valid BTC amount greater than 0. Example: 0.001"
        });
      }

      st.poolPendingAmount = amount;
      st.poolPendingInput = "note";
      await this.saveState(st);

      return telegramApi(this.env, "sendMessage", {
        chat_id: chatId,
        text: `Contribution amount: ${amount.toFixed(8)} BTC\n\nNow enter a short note or transaction reference.\n\nExample: September community contribution`
      });
    }

    if (st.poolPendingInput === "note") {
      const note = text.slice(0, 200);
      const amount = Number(st.poolPendingAmount || 0);

      if (!(amount > 0)) {
        st.poolPendingInput = null;
        st.poolPendingAmount = null;
        await this.saveState(st);
        return telegramApi(this.env, "sendMessage", {
          chat_id: chatId,
          text: "Contribution amount was lost. Start again from Community Pool."
        });
      }

      const entry = {
        amount,
        note,
        status: "RECORDED",
        ts: Date.now()
      };

      st.poolContributions = [entry, ...(st.poolContributions || [])].slice(0, 100);
      st.poolPendingInput = null;
      st.poolPendingAmount = null;
      st.mode = "pool";
      await this.saveState(st);

      return telegramApi(this.env, "sendMessage", {
        chat_id: chatId,
        text: `✅ Community contribution recorded: ${amount.toFixed(8)} BTC\n\n${poolSummaryText(st)}`,
        reply_markup: mainKeyboard(st)
      });
    }

    if (!st.pendingInput) return;

    if (st.pendingInput === "withdraw_address") {
      const addr = text.replace(/\s+/g, "");
      if (addr.length < 14 || addr.length > 90) {
        return telegramApi(this.env, "sendMessage", {chat_id:chatId, text:"Enter a BTC-style TEST address for the demo request."});
      }
      const amount = Number(st.pendingWithdrawalAmount || 0);
      if (!(amount > 0) || amount > st.balance) {
        st.pendingInput = null;
        st.pendingWithdrawalAmount = null;
        await this.saveState(st);
        return telegramApi(this.env, "sendMessage", {chat_id:chatId, text:"Demo withdrawal amount is no longer available. Start the request again."});
      }

      st.balance -= amount;
      const id = `W${Date.now().toString(36).slice(-6).toUpperCase()}`;
      const request = {id, userId, amount, address:addr, status:"PENDING (DEMO)", ts:Date.now(), ownerRefundApplied:false};
      st.demoWithdrawals = [request, ...(st.demoWithdrawals || [])].slice(0, 50);
      await queueAdd(this.env, request);
      st.pendingInput = null;
      st.pendingWithdrawalAmount = null;
      await this.saveState(st);

      return telegramApi(this.env, "sendMessage", {
        chat_id:chatId,
        text:`✅ Demo withdrawal request recorded: ${amount.toFixed(2)} credits.\n\n⚠️ Simulation only — this does not create a real BTC payout.\n\n${statusText(st)}`,
        reply_markup:mainKeyboard(st)
      });
    }

    const value = Number(text.replaceAll("$","").replaceAll(",",""));
    if (!Number.isFinite(value) || value <= 0) {
      return telegramApi(this.env, "sendMessage", {chat_id:chatId, text:"Please enter a number greater than 0. Example: 0.10"});
    }

    let label;
    if (st.pendingInput === "withdraw_amount") {
      if (value > st.balance) {
        return telegramApi(this.env, "sendMessage", {chat_id:chatId, text:`Demo balance is only ${st.balance.toFixed(2)} credits.`});
      }
      st.pendingWithdrawalAmount = value;
      st.pendingInput = "withdraw_address";
      await this.saveState(st);
      return telegramApi(this.env, "sendMessage", {
        chat_id:chatId,
        text:`Demo withdrawal amount: ${value.toFixed(2)} credits.\n\nNow enter a BTC-style TEST address to attach to this simulated request.\n\n⚠️ No real BTC will be sent.`
      });
    } else if (st.pendingInput === "unit") {
      if (value > 10000) return telegramApi(this.env, "sendMessage", {chat_id:chatId, text:"Unit size is too large."});
      st.unit = value;
      label = `💰 Unit size changed to ${value.toFixed(2)} credits.`;
    } else if (st.pendingInput === "target") {
      st.target = value;
      label = `🎯 Profit target changed to +${value.toFixed(2)} credits.`;
    } else {
      st.stoploss = value;
      label = `🛑 Stop target changed to -${value.toFixed(2)} credits.`;
    }

    st.pendingInput = null;
    await this.saveState(st);
    return telegramApi(this.env, "sendMessage", {
      chat_id:chatId,
      text:`${label}\n\n${statusText(st)}`,
      reply_markup:mainKeyboard(st)
    });
  }

  async alarm() {
    const st = await this.storage.get("state");
    if (!st || !st.running || !st.runId || !st.autoTarget) return;

    const target = st.autoTarget;
    if (target.runId !== st.runId) return;

    const out = await this.executeSpin(st, st.runId);
    await this.saveState(out.state);

    try {
      if (out.result) {
        await safeEdit(this.env, target.chatId, target.messageId, statusText(out.state, out.result, out.reason), mainKeyboard(out.state));
      } else if (out.reason) {
        await safeEdit(this.env, target.chatId, target.messageId, statusText(out.state, null, out.reason), mainKeyboard(out.state));
      }
    } catch (e) {
      console.error("Telegram edit failed during alarm:", e);
    }

    if (!out.stopped && !out.reason && out.state.running && out.state.runId === target.runId) {
      await this.storage.setAlarm(Date.now() + Math.max(Number(out.state.speedMs || NORMAL_SPEED_MS), TURBO_SPEED_MS));
    }
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/admin-update-withdrawal" && req.method === "POST") {
      const {id, status, refund, amount} = await req.json();
      const st = await this.storage.get("state");
      if (!st) return json({ok:false});
      const local = (st.demoWithdrawals || []).find(w => w.id === id);
      if (local) {
        local.status = status;
        if (refund && !local.refunded) {
          st.balance += Number(amount || 0);
          local.refunded = true;
        }
      }
      await this.saveState(st);
      return json({ok:true});
    }

    if (url.pathname === "/update" && req.method === "POST") {
      const update = await req.json();
      const userId = String(update.callback_query?.from?.id || update.message?.from?.id || "");
      if (!userId) return json({ok:true});
      const st = await this.getState(userId);
      try {
        if (update.callback_query) await this.handleCallback(update.callback_query, st);
        else if (update.message?.text) await this.handleText(update.message, st);
        return json({ok:true});
      } catch (e) {
        console.error(e);
        return json({ok:false, error:String(e?.message || e)});
      }
    }

    return new Response("Not found", {status:404});
  }
}

// Extend queue handler after class definition without duplicating queue state logic.
const originalQueueFetch = WithdrawalQueue.prototype.fetch;
WithdrawalQueue.prototype.fetch = async function(req) {
  const url = new URL(req.url);
  if (url.pathname === "/mark-refund" && req.method === "POST") {
    const {id} = await req.json();
    const queue = (await this.storage.get("queue")) || [];
    const item = queue.find(w => w.id === id);
    if (item) {
      item.ownerRefundApplied = true;
      await this.storage.put("queue", queue);
    }
    return json({ok:true});
  }
  return originalQueueFetch.call(this, req);
};

async function setWebhook(env, origin) {
  const payload = {
    url: `${origin}/telegram`,
    allowed_updates:["message","callback_query"],
    drop_pending_updates:true
  };
  const secret = String(env.WEBHOOK_SECRET || "").trim();
  if (secret) payload.secret_token = secret;
  await telegramApi(env, "setWebhook", payload);
  return telegramApi(env, "getWebhookInfo", {});
}

function landing() {
  return new Response(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Roulette Telegram Demo Bot</title>
<style>
body{font-family:system-ui;background:#101114;color:#eee;max-width:760px;margin:60px auto;padding:0 20px}
.card{background:#191b20;border:1px solid #30343b;border-radius:18px;padding:26px}
code{background:#0b0c0e;padding:3px 7px;border-radius:6px}
small{color:#aeb4bf}
</style></head>
<body><div class="card">
<h1>🎰 Roulette Telegram Demo Bot</h1>
<p>Cloudflare Workers + Durable Objects version is online with Demo and Community Pool modes.</p>
<p>Telegram webhook endpoint: <code>/telegram</code></p>
<p>Webhook setup endpoint: <code>/setup-webhook?key=YOUR_SETUP_KEY</code></p>
<small>Demo credits only. No real-money gambling deposits or payouts are implemented.</small>
</div></body></html>`, {headers:{"content-type":"text/html; charset=UTF-8"}});
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/") return landing();

    if (url.pathname === "/setup-webhook" && req.method === "GET") {
      if (!env.SETUP_KEY || url.searchParams.get("key") !== env.SETUP_KEY) {
        return new Response("Invalid setup key.", {status:403});
      }
      try {
        const info = await setWebhook(env, url.origin);
        return json({
          ok:true,
          message:"Telegram webhook configured for Cloudflare.",
          webhook:info.url,
          pending_update_count:info.pending_update_count
        });
      } catch (e) {
        return json({ok:false, error:String(e?.message || e)}, 500);
      }
    }

    if (url.pathname === "/telegram") {
      if (req.method !== "POST") return json({ok:true, service:"telegram-webhook"});

      const secret = String(env.WEBHOOK_SECRET || "").trim();
      if (secret) {
        const got = req.headers.get("x-telegram-bot-api-secret-token");
        if (got !== secret) return json({ok:false}, 403);
      }

      try {
        const update = await req.json();
        const userId = String(update.callback_query?.from?.id || update.message?.from?.id || "");
        if (!userId) return json({ok:true});

        const id = env.PLAYERS.idFromName(userId);
        const stub = env.PLAYERS.get(id);
        // Return quickly after the user's object has handled the update.
        await stub.fetch("https://player.local/update", {
          method:"POST",
          headers:{"content-type":"application/json"},
          body:JSON.stringify(update)
        });
        return json({ok:true});
      } catch (e) {
        console.error(e);
        // Keep Telegram from repeatedly re-delivering a malformed/problem update.
        return json({ok:false, error:String(e?.message || e)});
      }
    }

    return new Response("Not found", {status:404});
  }
};
