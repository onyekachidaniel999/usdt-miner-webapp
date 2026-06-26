require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const db = require('./database');

const BOT_TOKEN  = process.env.BOT_TOKEN;
const ADMIN_IDS  = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim()));
const WEBAPP_URL = process.env.WEBAPP_URL;

const MINING_DURATION   = 3 * 60 * 60;     // 3 hours in seconds
const USDT_PER_SEC_GHS  = 0.000018;
const AD_COOLDOWN       = 30 * 60;          // 30 minutes
const AD_GHS_REWARD     = 1;
const BOOST_GHS_REWARD  = 3;
const MIN_WITHDRAWAL    = 20.0;

const bot = new Telegraf(BOT_TOKEN);

// ── Helpers ───────────────────────────────────────────────────────────────────
const now = () => Math.floor(Date.now() / 1000);

function calcEarned(user) {
  if (!user.mining_start) return 0;
  const elapsed = Math.min(now() - user.mining_start, MINING_DURATION);
  return parseFloat((elapsed * USDT_PER_SEC_GHS * user.ghs).toFixed(6));
}

function miningDone(user) {
  if (!user.mining_start) return false;
  return (now() - user.mining_start) >= MINING_DURATION;
}

function remaining(user) {
  if (!user.mining_start) return 0;
  return Math.max(0, MINING_DURATION - (now() - user.mining_start));
}

function formatTime(secs) {
  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

// ── Dashboard builder ─────────────────────────────────────────────────────────
function buildDashboard(user, firstName) {
  const earned   = calcEarned(user);
  const done     = miningDone(user);
  const isMining = !!user.mining_start && !done;
  const rem      = remaining(user);
  const adReady  = (now() - user.last_ad_watch) >= AD_COOLDOWN;

  let status = '💤 Idle';
  if (isMining) status = '⛏ Mining...';
  if (done)     status = '✅ Ready to Claim!';

  let text =
    `⚡ *USDT Mining Bot*\n\n` +
    `👤 *${firstName}*\n` +
    `💎 *Hashrate:* \`${user.ghs.toLocaleString('en', { maximumFractionDigits: 1 })} GH/s\`\n` +
    `💰 *Balance:* \`${user.balance.toFixed(6)} USDT\`\n` +
    `⏳ *Session Earnings:* \`${earned.toFixed(6)} USDT\`\n` +
    `🔄 *Status:* ${status}\n`;

  if (isMining) text += `⏱ *Time Left:* \`${formatTime(rem)}\`\n`;
  text += `\n📋 *Min Withdrawal:* \`${MIN_WITHDRAWAL} USDT\``;

  // Action button row
  const actionRow = [];
  if (done)          actionRow.push(Markup.button.callback('💰 Claim Rewards', 'claim'));
  else if (!isMining) actionRow.push(Markup.button.callback('⛏ Start Mining', 'mine'));
  else               actionRow.push(Markup.button.callback('🔄 Refresh', 'refresh'));

  // Ad buttons
  const adRow = [];
  if (adReady) {
    adRow.push(Markup.button.webApp(
      `📺 Watch Ad (+${AD_GHS_REWARD} GH/s)`,
      `${WEBAPP_URL}?type=ad&uid=${user.user_id}&reward=${AD_GHS_REWARD}&cooldown=1`
    ));
  }
  adRow.push(Markup.button.webApp(
    `🚀 Boost Ad (+${BOOST_GHS_REWARD} GH/s)`,
    `${WEBAPP_URL}?type=boost&uid=${user.user_id}&reward=${BOOST_GHS_REWARD}&cooldown=0`
  ));

  const keyboard = Markup.inlineKeyboard([
    actionRow,
    adRow,
    [
      Markup.button.callback('👥 Referrals', 'referrals'),
      Markup.button.callback('💳 Withdraw', 'withdraw'),
    ],
    [
      Markup.button.callback('🏆 Leaderboard', 'leaderboard'),
      Markup.button.callback('ℹ️ Info', 'info'),
    ],
  ]);

  return { text, keyboard };
}

// ── /start ────────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const tgUser    = ctx.from;
  const payload   = ctx.startPayload;
  let referredBy  = null;

  if (payload && payload.startsWith('ref_')) {
    const refId = parseInt(payload.split('_')[1]);
    if (refId && refId !== tgUser.id) referredBy = refId;
  }

  const existing = db.getUser(tgUser.id);
  if (!existing) {
    db.createUser(tgUser.id, tgUser.username || '', tgUser.first_name, referredBy);
    if (referredBy) {
      try {
        await ctx.telegram.sendMessage(
          referredBy,
          `🎉 *New referral!* ${tgUser.first_name} joined using your link.\n+15 GH/s added to your hashrate!`,
          { parse_mode: 'Markdown' }
        );
      } catch (_) {}
    }
  }

  const user = db.getUser(tgUser.id);
  const { text, keyboard } = buildDashboard(user, tgUser.first_name);
  await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
});

// ── /menu (re-open dashboard) ─────────────────────────────────────────────────
bot.command('menu', async (ctx) => {
  const user = db.getUser(ctx.from.id);
  if (!user) return ctx.reply('Please send /start first.');
  const { text, keyboard } = buildDashboard(user, ctx.from.first_name);
  await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
});

// ── Callback: mine ────────────────────────────────────────────────────────────
bot.action('mine', async (ctx) => {
  await ctx.answerCbQuery();
  const user = db.getUser(ctx.from.id);
  if (user.mining_start && !miningDone(user)) {
    return ctx.answerCbQuery('⛏ Already mining!', { show_alert: true });
  }
  db.startMining(ctx.from.id);
  await ctx.answerCbQuery('⛏ Mining started! Come back in 3 hours.', { show_alert: true });
  const updated = db.getUser(ctx.from.id);
  const { text, keyboard } = buildDashboard(updated, ctx.from.first_name);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

// ── Callback: claim ───────────────────────────────────────────────────────────
bot.action('claim', async (ctx) => {
  await ctx.answerCbQuery();
  const user = db.getUser(ctx.from.id);
  if (!miningDone(user)) {
    return ctx.answerCbQuery('⏳ Not ready yet!', { show_alert: true });
  }
  const earned = calcEarned(user);
  db.claimMining(ctx.from.id, earned);
  await ctx.answerCbQuery(`✅ Claimed ${earned.toFixed(6)} USDT!`, { show_alert: true });
  const updated = db.getUser(ctx.from.id);
  const { text, keyboard } = buildDashboard(updated, ctx.from.first_name);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

// ── Callback: refresh ─────────────────────────────────────────────────────────
bot.action('refresh', async (ctx) => {
  await ctx.answerCbQuery('🔄 Refreshed!');
  const user = db.getUser(ctx.from.id);
  const { text, keyboard } = buildDashboard(user, ctx.from.first_name);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

// ── Callback: back ────────────────────────────────────────────────────────────
bot.action('back', async (ctx) => {
  await ctx.answerCbQuery();
  const user = db.getUser(ctx.from.id);
  const { text, keyboard } = buildDashboard(user, ctx.from.first_name);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
});

// ── Referrals screen ──────────────────────────────────────────────────────────
bot.action('referrals', async (ctx) => {
  await ctx.answerCbQuery();
  const user    = db.getUser(ctx.from.id);
  const botInfo = await ctx.telegram.getMe();
  const link    = `https://t.me/${botInfo.username}?start=ref_${ctx.from.id}`;

  const text =
    `👥 *Your Referrals*\n\n` +
    `📊 Total Referred: \`${user.referral_count}\` users\n` +
    `💎 Per Referral: \`+15 GH/s\`\n\n` +
    `🎯 *Milestone Bonuses:*\n` +
    `3 refs → +50 GH/s\n` +
    `5 refs → +90 GH/s\n` +
    `10 refs → +220 GH/s\n` +
    `20 refs → +470 GH/s\n` +
    `50 refs → +1,200 GH/s\n` +
    `100 refs → +2,500 GH/s\n` +
    `200 refs → +5,000 GH/s\n` +
    `500 refs → +10,000 GH/s\n\n` +
    `🔗 *Your Invite Link:*\n\`${link}\``;

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back')]]),
  });
});

// ── Withdraw screen ───────────────────────────────────────────────────────────
bot.action('withdraw', async (ctx) => {
  await ctx.answerCbQuery();
  const user   = db.getUser(ctx.from.id);
  const wallet = user.wallet_address || '_Not set_';
  let text =
    `💳 *Withdrawal*\n\n` +
    `💰 Balance: \`${user.balance.toFixed(6)} USDT\`\n` +
    `📋 Min Withdrawal: \`${MIN_WITHDRAWAL} USDT\`\n` +
    `🔑 Wallet: ${wallet}\n\n`;

  const buttons = [];

  if (user.balance >= MIN_WITHDRAWAL) {
    text += '✅ You are eligible to withdraw!';
    buttons.push([Markup.button.callback(`💸 Withdraw ${user.balance.toFixed(4)} USDT`, `confirm_wd_${user.balance.toFixed(6)}`)]);
  } else {
    text += `❌ You need at least *${MIN_WITHDRAWAL} USDT* to withdraw.\nKeep mining! ⛏`;
  }

  buttons.push([Markup.button.callback('💳 Set Wallet Address', 'set_wallet')]);
  buttons.push([Markup.button.callback('⬅️ Back', 'back')]);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// ── Confirm withdrawal ────────────────────────────────────────────────────────
bot.action(/^confirm_wd_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const amount = parseFloat(ctx.match[1]);
  const user   = db.getUser(ctx.from.id);

  if (!user.wallet_address) {
    return ctx.answerCbQuery('⚠️ Please set your wallet address first!', { show_alert: true });
  }
  if (user.balance < MIN_WITHDRAWAL) {
    return ctx.answerCbQuery('❌ Insufficient balance!', { show_alert: true });
  }

  db.createWithdrawal(ctx.from.id, amount, user.wallet_address);

  // Notify admins
  for (const adminId of ADMIN_IDS) {
    try {
      await ctx.telegram.sendMessage(
        adminId,
        `💸 *New Withdrawal Request*\n` +
        `User: ${ctx.from.first_name} (\`${ctx.from.id}\`)\n` +
        `Amount: \`${amount} USDT\`\n` +
        `Wallet: \`${user.wallet_address}\``,
        { parse_mode: 'Markdown' }
      );
    } catch (_) {}
  }

  await ctx.editMessageText(
    `✅ *Withdrawal Requested!*\n\n` +
    `Amount: \`${amount.toFixed(6)} USDT\`\n` +
    `Wallet: \`${user.wallet_address}\`\n\n` +
    `Admin will process within 24–48 hours. ⏳`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back')]]) }
  );
});

// ── Set wallet ────────────────────────────────────────────────────────────────
const awaitingWallet = new Set();

bot.action('set_wallet', async (ctx) => {
  await ctx.answerCbQuery();
  awaitingWallet.add(ctx.from.id);
  await ctx.editMessageText(
    '💳 Please send your USDT wallet address (TRC20 / ERC20):',
    Markup.inlineKeyboard([[Markup.button.callback('⬅️ Cancel', 'back')]])
  );
});

// ── Leaderboard ───────────────────────────────────────────────────────────────
bot.action('leaderboard', async (ctx) => {
  await ctx.answerCbQuery();
  const top    = db.getTopUsers(10);
  const medals = ['🥇', '🥈', '🥉', '🔹', '🔹', '🔹', '🔹', '🔹', '🔹', '🔹'];
  const lines  = ['🏆 *Top 10 Miners*\n'];
  top.forEach((row, i) => {
    lines.push(`${medals[i]} ${row.full_name} — \`${row.balance.toFixed(4)} USDT\` | \`${row.ghs.toLocaleString('en', { maximumFractionDigits: 0 })} GH/s\``);
  });
  await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back')]]),
  });
});

// ── Info ──────────────────────────────────────────────────────────────────────
bot.action('info', async (ctx) => {
  await ctx.answerCbQuery();
  const text =
    `ℹ️ *How It Works*\n\n` +
    `⛏ *Mining*\n` +
    `Click 'Start Mining' to begin a 3-hour session.\n` +
    `Earnings = \`GH/s × 0.000018 USDT/sec\`\n\n` +
    `📺 *Ads*\n` +
    `• Watch ad every 30 mins → +1 GH/s\n` +
    `• Boost ad anytime → +3 GH/s\n\n` +
    `👥 *Referrals*\n` +
    `• +15 GH/s per referral\n` +
    `• Milestone bonuses up to +10,000 GH/s\n\n` +
    `💳 *Withdrawal*\n` +
    `• Minimum: 20 USDT\n` +
    `• Processed manually within 24–48hrs\n`;

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back')]]),
  });
});

// ── Text message handler (wallet input + web_app_data) ────────────────────────
bot.on('message', async (ctx) => {
  // Web App data (ad reward)
  if (ctx.message.web_app_data) {
    try {
      const payload  = JSON.parse(ctx.message.web_app_data.data);
      const reward   = parseInt(payload.reward || 0);
      const cooldown = !!payload.cooldown;
      const userId   = ctx.from.id;
      const user     = db.getUser(userId);

      if (cooldown) {
        const elapsed = now() - user.last_ad_watch;
        if (elapsed < AD_COOLDOWN) {
          const wait = AD_COOLDOWN - elapsed;
          return ctx.reply(`⏳ Ad cooldown: please wait \`${formatTime(wait)}\` before watching again.`, { parse_mode: 'Markdown' });
        }
        db.updateAdWatch(userId);
      }

      db.addGhs(userId, reward);
      const updated = db.getUser(userId);
      await ctx.reply(
        `✅ *+${reward} GH/s* added!\n` +
        `💎 Your hashrate: \`${updated.ghs.toLocaleString('en', { maximumFractionDigits: 1 })} GH/s\`\n\n` +
        `Keep mining! ⛏`,
        { parse_mode: 'Markdown' }
      );
      return;
    } catch (e) {
      return ctx.reply('⚠️ Error processing ad reward. Please try again.');
    }
  }

  // Wallet address input
  if (awaitingWallet.has(ctx.from.id)) {
    const wallet = ctx.message.text?.trim();
    if (!wallet) return;
    awaitingWallet.delete(ctx.from.id);
    db.setWallet(ctx.from.id, wallet);
    await ctx.reply(`✅ Wallet saved:\n\`${wallet}\``, { parse_mode: 'Markdown' });
    const user = db.getUser(ctx.from.id);
    const { text, keyboard } = buildDashboard(user, ctx.from.first_name);
    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    return;
  }
});

// ── Admin: /withdrawals ───────────────────────────────────────────────────────
bot.command('withdrawals', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const pending = db.getPendingWithdrawals();
  if (!pending.length) return ctx.reply('✅ No pending withdrawals.');

  for (const w of pending) {
    await ctx.reply(
      `💸 *Withdrawal #${w.id}*\n` +
      `User: ${w.full_name} (\`${w.user_id}\`)\n` +
      `Amount: \`${w.amount} USDT\`\n` +
      `Wallet: \`${w.wallet}\``,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[
          Markup.button.callback('✅ Approve', `admin_approve_${w.id}_${w.user_id}`),
          Markup.button.callback('❌ Reject',  `admin_reject_${w.id}_${w.user_id}`),
        ]]),
      }
    );
  }
});

bot.action(/^admin_(approve|reject)_(\d+)_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Not authorized.');
  await ctx.answerCbQuery();

  const action = ctx.match[1];
  const wId    = parseInt(ctx.match[2]);
  const userId = parseInt(ctx.match[3]);
  const wd     = db.getWithdrawalById(wId);

  if (!wd || wd.status !== 'pending') {
    return ctx.editMessageText('⚠️ Already processed.');
  }

  if (action === 'approve') {
    db.updateWithdrawalStatus(wId, 'approved');
    await ctx.editMessageText(`✅ Withdrawal #${wId} approved.`);
    try {
      await ctx.telegram.sendMessage(userId, '✅ Your withdrawal has been *approved* and is being processed!', { parse_mode: 'Markdown' });
    } catch (_) {}
  } else {
    db.refundWithdrawal(userId, wd.amount);
    db.updateWithdrawalStatus(wId, 'rejected');
    await ctx.editMessageText(`❌ Withdrawal #${wId} rejected. Balance refunded.`);
    try {
      await ctx.telegram.sendMessage(userId, '❌ Your withdrawal was *rejected*. Your balance has been refunded.', { parse_mode: 'Markdown' });
    } catch (_) {}
  }
});

// ── Launch ────────────────────────────────────────────────────────────────────
db.initDb();
bot.launch().then(() => console.log('🤖 Bot is running...'));

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
