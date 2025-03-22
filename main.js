"use strict";

const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const axios = require("axios");

// ====================
// CONFIGURATION & CONSTANTS
// ====================
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw"; // Your Bot Token
const ADMIN_PHONE = "254701339573"; // Admin's phone (without +)
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_CHANNEL_ID = 529;
const AIRTIME_API_KEY = "6HyMVLHJMcBVBIhUKrHyjnakzWrYKYo8wo6hOmdTQV7gdIjbYV";
const AIRTIME_USERNAME = "fysproperty";

// ====================
// Bot configurable messages (editable by admin via /edit)
// ====================
let botConfig = {
  // Registration texts
  registrationWelcome: "👋 *Welcome to FYS_PROPERTY Investment Bot!* \nBefore you begin, please register.\nEnter your *first name*:",
  askLastName: "Great! Now, please enter your *last name*:",
  askPhone: "Please enter your *phone number* (must start with 07 or 01, 10 digits):",
  registrationSuccess: "Thank you, *{firstName} {lastName}*! Your registration is complete. Your referral code is *{referralCode}*.\nType menu to see our options.",
  
  // Main menu text
  mainMenuText: "Hello, *{firstName}*! Please select an option:\n1) Deposit\n2) Buy Airtime\nType 'deposit' or 'buy airtime'.",
  
  // Deposit flow messages
  depositIntro: "💰 *Deposit Flow Started!* Please enter the deposit amount in Ksh:",
  depositPhonePrompt: "📱 Enter your M-PESA phone number (start with 07 or 01):",
  paymentInitiated: "*⏳ Payment initiated!* Checking status in {seconds} seconds...",
  countdownUpdate: "*⏳ {seconds} seconds left...*",
  depositStatusSuccess: "🎉 Deposit successful! Your payment of Ksh {amount} was successful on {date}.",
  depositStatusFailed: "❌ Payment failed: {status}. Please try again or contact support.",
  depositFooter: "Thank you for using FYS_PROPERTY! Type menu to continue.",

  // Airtime flow messages
  airtimeIntro: "📱 *Airtime Purchase Initiated!* Enter the airtime amount (min 10, max 3000 Ksh):",
  airtimeRecipientPrompt: "Please enter the recipient phone number (start with 07 or 01, 10 digits):",
  airtimeStatusSuccess: "🎉 Airtime purchase successful! Airtime of Ksh {amount} sent to {recipient} on {date}.",
  airtimeStatusFailed: "❌ Airtime purchase failed: {status}. Please try again or contact support.",
  
  // Withdrawal flow messages
  withdrawPrompt: "💸 *Withdrawal Requested!* Enter the amount to withdraw (min Ksh {min}, max Ksh {max}):",
  askWithdrawNumber: "Now, enter your M-PESA number (start with 07 or 01, 10 digits):",
  
  // Referral & balance
  balanceMessage: "*💵 Your current balance is:* Ksh {balance}",
  
  // Admin & extra
  fromAdmin: "FYS_PROPERTY Bot",
  userHelp: "Commands:\nmenu - Main menu\nhelp - Show commands\ndeposit - Deposit funds\nbuy airtime - Buy airtime\n",
  
  // Extra: referral
  referralBonus: 200,
  botUsername: "shankfy_bot",
  
  // Withdrawal fee percent
  withdrawalFeePercent: 6,
  
  // Admin help text (editable via /edit as well)
  adminHelp: "Admin Commands:\n- msg [number1,number2] message => broadcast\n- genlink <userID> => generate referral link for a user\n- /resetdata, /clearhistory <number>, /exportdata, /adjust, etc."
};

// ====================
// EXTRA FEATURES & UTILITY FUNCTIONS
// ====================
const motivationalQuotes = [
  "Believe you can and you're halfway there. – Theodore Roosevelt",
  "Your limitation—it’s only your imagination.",
  "Push yourself, because no one else is going to do it for you.",
  "Great things never come from comfort zones.",
  "Dream it. Wish it. Do it."
];

let adminLog = [];
const botStartTime = Date.now();

function getUptime() {
  const diff = Date.now() - botStartTime;
  const seconds = Math.floor(diff / 1000) % 60;
  const minutes = Math.floor(diff / (1000 * 60)) % 60;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  return `${hours}h ${minutes}m ${seconds}s`;
}

function getRandomQuote() {
  return motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)];
}

function getAbout() {
  return "FYS_PROPERTY Investment Bot v1.0\nDeveloped by FY'S PROPERTY 🕊️\nEnjoy our services!";
}

function getLeaderboard() {
  let leaderboard = [];
  for (let uid in depositHistory) {
    const total = depositHistory[uid].reduce((sum, rec) => sum + rec.amount, 0);
    leaderboard.push({ uid, total });
  }
  leaderboard.sort((a, b) => b.total - a.total);
  return leaderboard.slice(0, 5);
}

// ====================
// IN-MEMORY DATA STORAGE
// ====================
const userStates = {}; // { userNumber: { stage, amount, recipient, ... } }

// ====================
// BOT CREATION
// ====================
const client = new Client({
  authStrategy: new LocalAuth()
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("WhatsApp Client is ready!");
});

client.initialize();

// ====================
// MAINTENANCE MODE CHECK
// ====================
function maintenanceCheck(userNum, callback) {
  // For simplicity, we assume if maintenanceMode is true, non-admin users get a maintenance message.
  if (maintenanceMode && !userNum.includes(ADMIN_PHONE)) {
    client.sendMessage(userNum, "⚙️ " + maintenanceMessage);
    return;
  }
  callback();
}

// ====================
// ADMIN LOGGING FUNCTION
// ====================
function logAdmin(message) {
  const timeStr = new Date().toLocaleString();
  const entry = `[${timeStr}] ${message}`;
  adminLog.push(entry);
  sendAdminAlert(entry);
}

// ====================
// HELPER FUNCTIONS
// ====================
function parsePlaceholders(template, data) {
  return template
    .replace(/{firstName}/g, data.firstName || "")
    .replace(/{lastName}/g, data.lastName || "")
    .replace(/{amount}/g, data.amount || "")
    .replace(/{package}/g, data.package || "")
    .replace(/{recipient}/g, data.recipient || "")
    .replace(/{min}/g, data.min || "")
    .replace(/{mpesaCode}/g, data.mpesaCode || "")
    .replace(/{seconds}/g, data.seconds || "")
    .replace(/{date}/g, data.date || "")
    .replace(/{invCode}/g, data.invCode || "")
    .replace(/{balance}/g, data.balance || "")
    .replace(/{code}/g, data.code || "")
    .replace(/{bonus}/g, data.bonus || "")
    .replace(/{depositNumber}/g, data.depositNumber || "")
    .replace(/{footer}/g, botConfig.depositFooter);
}

function isAdmin(userNum) {
  // We assume userNum is like "254701339573@s.whatsapp.net"
  return userNum === ADMIN_PHONE + "@s.whatsapp.net" || userNum.includes(ADMIN_PHONE);
}

function isRegistered(userNum) {
  // For this bot, we can check if the user state exists (in a production bot you would use a DB)
  return userStates[userNum] && userStates[userNum].registered;
}

function formatPhoneNumber(numStr) {
  let cleaned = numStr.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.slice(1);
  }
  return cleaned;
}

function generateInvestmentCode() {
  return "INV-" + Math.floor(1000000 + Math.random() * 9000000);
}

function generateReferralCode() {
  return "FYSPROP-" + Math.floor(10000 + Math.random() * 90000);
}

// ====================
// STK PUSH (Deposit)
// ====================
async function sendSTKPush(amount, phoneNumber) {
  const payload = {
    amount: amount,
    phone_number: phoneNumber,
    channel_id: PAYHERO_CHANNEL_ID,
    provider: "m-pesa",
    external_reference: "INV-009",
    customer_name: "WhatsAppUser",
    callback_url: "https://dummy-callback.com",
    account_reference: "WABot",
    transaction_desc: "WABot Payment",
    remarks: "WhatsApp Bot",
    business_name: "WhatsAppBot",
    companyName: "WhatsAppBot"
  };
  try {
    const resp = await axios.post("https://backend.payhero.co.ke/api/v2/payments", payload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": PAYHERO_AUTH
      }
    });
    return resp.data.reference;
  } catch (error) {
    console.error("STK Push Error:", error.response ? error.response.data : error);
    return null;
  }
}

async function fetchSTKStatus(ref) {
  try {
    const resp = await axios.get(`https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`, {
      headers: {
        "Authorization": PAYHERO_AUTH
      }
    });
    return resp.data;
  } catch (error) {
    console.error("Status Fetch Error:", error.response ? error.response.data : error);
    return null;
  }
}

function sendAdminAlert(text) {
  client.sendMessage(ADMIN_PHONE + "@s.whatsapp.net", text);
}

// ====================
// BUY AIRTIME
// ====================
async function buyAirtime(recipient, amount) {
  const payload = {
    api_key: AIRTIME_API_KEY,
    username: AIRTIME_USERNAME,
    recipient: recipient,
    amount: String(amount)
  };
  try {
    const resp = await axios.post("https://payherokenya.com/sps/portal/app/airtime", payload);
    return resp.data;
  } catch (error) {
    console.error("Airtime API Error:", error.response ? error.response.data : error);
    return null;
  }
}

// ====================
// MESSAGE HANDLING
// ====================
client.on("message_create", async (msg) => {
  if (msg.fromMe) return;

  const userNum = msg.from; // e.g. "2547xxxx@s.whatsapp.net"
  const text = msg.body.trim().toLowerCase();

  // If admin sends "Admin CMD", show admin help
  if (isAdmin(userNum) && text === "admin cmd") {
    client.sendMessage(userNum, getAdminHelp());
    return;
  }

  // Basic commands
  if (text === "hi" || text === "hello") {
    client.sendMessage(userNum, "Hello! Type 'menu' to see options or 'help' for commands.");
    return;
  }

  if (text === "help") {
    client.sendMessage(userNum,
      "Commands:\nmenu - show main menu\nhelp - show commands\ndeposit - deposit funds\nbuy airtime - buy airtime\n"
    );
    return;
  }

  if (text === "menu") {
    client.sendMessage(userNum,
      "Main Menu:\n1) Deposit\n2) Buy Airtime\nType 'deposit' or 'buy airtime'."
    );
    return;
  }

  // ADMIN BROADCAST: if admin sends "msg [2547xxx,2547yyy] message"
  if (isAdmin(userNum) && msg.body.startsWith("msg ")) {
    const data = parseBroadcast(msg.body);
    if (!data) {
      client.sendMessage(userNum, "Invalid broadcast format. Use: msg [2547xxx,2547yyy] message...");
    } else {
      const { arr, message } = data;
      for (let phone of arr) {
        const waNumber = phone + "@s.whatsapp.net";
        try {
          await client.sendMessage(waNumber, `*Admin Broadcast:*\n${message}`);
        } catch (e) {
          await client.sendMessage(userNum, `Could not send to ${phone}`);
        }
      }
      client.sendMessage(userNum, "Broadcast complete.");
    }
    return;
  }

  // --------------------
  // Deposit Flow
  // --------------------
  if (text === "deposit") {
    userStates[userNum] = { stage: "awaitingDepositAmount" };
    client.sendMessage(userNum, "Please enter the deposit amount in Ksh (minimum 10, maximum 3000).");
    return;
  }

  if (userStates[userNum]?.stage === "awaitingDepositAmount") {
    const amt = parseInt(msg.body);
    if (isNaN(amt) || amt < 10 || amt > 3000) {
      client.sendMessage(userNum, "Invalid deposit amount. Must be between 10 and 3000 Ksh.");
      return;
    }
    userStates[userNum].amount = amt;
    userStates[userNum].stage = "processingDeposit";
    // For deposit, we use the user's WhatsApp number (converted)
    const payPhone = formatPhoneForSTK(userNum);
    const ref = await sendSTKPush(amt, payPhone);
    if (!ref) {
      client.sendMessage(userNum, "❌ Error initiating payment. Please try again later.");
      delete userStates[userNum];
      return;
    }
    client.sendMessage(userNum, `Payment initiated. We'll check status in 20 seconds...`);
    setTimeout(async () => {
      const stData = await fetchSTKStatus(ref);
      const dateNow = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      if (!stData) {
        client.sendMessage(userNum, "❌ Could not fetch payment status. Please try again.");
        delete userStates[userNum];
        return;
      }
      const finalStatus = (stData.status || "").toUpperCase();
      if (finalStatus === "SUCCESS") {
        const successMsg = parsePlaceholders(botConfig.depositStatusSuccess, {
          amount: userStates[userNum].amount,
          date: dateNow
        });
        client.sendMessage(userNum, successMsg);
        sendAdminAlert(`User ${userNum} deposited Ksh ${userStates[userNum].amount} successfully on ${dateNow}.`);
      } else {
        const failMsg = parsePlaceholders(botConfig.depositStatusFailed, {
          status: stData.status || "Failed"
        });
        client.sendMessage(userNum, failMsg);
        sendAdminAlert(`User ${userNum} deposit failed: ${stData.status || "Failed"} on ${dateNow}.`);
      }
      delete userStates[userNum];
    }, 20000);
    return;
  }

  // --------------------
  // Airtime Flow
  // --------------------
  if (text === "buy airtime") {
    userStates[userNum] = { stage: "awaitingAirtimeAmount" };
    client.sendMessage(userNum, "Please enter the airtime amount you want to buy (min 10, max 3000 Ksh).");
    return;
  }

  if (userStates[userNum]?.stage === "awaitingAirtimeAmount") {
    const amt = parseInt(msg.body);
    if (isNaN(amt) || amt < 10 || amt > 3000) {
      client.sendMessage(userNum, "Invalid airtime amount. Must be between 10 and 3000 Ksh.");
      return;
    }
    userStates[userNum].amount = amt;
    userStates[userNum].stage = "awaitingAirtimeRecipient";
    client.sendMessage(userNum, "Please enter the recipient phone number (start with 07 or 01, 10 digits).");
    return;
  }

  if (userStates[userNum]?.stage === "awaitingAirtimeRecipient") {
    const recipient = msg.body.trim();
    if (!/^(07|01)\d{8}$/.test(recipient)) {
      client.sendMessage(userNum, "Invalid recipient phone. Must be 10 digits starting with 07 or 01.");
      return;
    }
    userStates[userNum].recipient = recipient;
    userStates[userNum].stage = "processingAirtimePayment";
    const payPhone = formatPhoneForSTK(userNum);
    const amt = userStates[userNum].amount;
    const ref = await sendSTKPush(amt, payPhone);
    if (!ref) {
      client.sendMessage(userNum, "❌ Error initiating payment. Please try again later.");
      delete userStates[userNum];
      return;
    }
    client.sendMessage(userNum, `Payment initiated for Ksh ${amt}. We'll confirm in 20 seconds...`);
    setTimeout(async () => {
      const stData = await fetchSTKStatus(ref);
      const dateNow = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      if (!stData) {
        client.sendMessage(userNum, "❌ Could not fetch payment status. Please try again.");
        delete userStates[userNum];
        return;
      }
      const finalStatus = (stData.status || "").toUpperCase();
      if (finalStatus === "SUCCESS") {
        client.sendMessage(userNum, "Payment successful! Initiating airtime purchase...");
        const airtimeResp = await buyAirtime(userStates[userNum].recipient, amt);
        if (airtimeResp && airtimeResp.status === true && airtimeResp.response?.Status === "Success") {
          const successMsg = parsePlaceholders(botConfig.airtimeStatusSuccess, {
            amount: amt,
            recipient: userStates[userNum].recipient,
            date: dateNow
          });
          client.sendMessage(userNum, successMsg);
          sendAdminAlert(`User ${userNum} purchased airtime of Ksh ${amt} for ${userStates[userNum].recipient} on ${dateNow}.`);
        } else {
          const failMsg = parsePlaceholders(botConfig.airtimeStatusFailed, {
            status: airtimeResp?.response?.Message || "Unknown error"
          });
          client.sendMessage(userNum, failMsg);
          sendAdminAlert(`User ${userNum} airtime purchase failed: ${airtimeResp?.response?.Message || "Unknown error"} on ${dateNow}.`);
        }
      } else {
        client.sendMessage(userNum, `❌ Payment status: ${stData.status || "Failed"}`);
        sendAdminAlert(`User ${userNum} airtime payment failed: ${stData.status || "Failed"} on ${dateNow}.`);
      }
      delete userStates[userNum];
    }, 20000);
    return;
  }

  // If command not recognized
  client.sendMessage(userNum, "Unrecognized command. Type 'menu' or 'help' to see options.");
});

// ====================
// ADMIN COMMAND: /admin CMD (only admin)
// ====================
client.on("message_create", async (msg) => {
  if (msg.fromMe) return;
  const userNum = msg.from;
  const text = msg.body.trim().toLowerCase();
  if (isAdmin(userNum) && text === "admin cmd") {
    client.sendMessage(userNum, getAdminHelp());
  }
});

// ====================
// ADMIN HELP FUNCTION
// ====================
function getAdminHelp() {
  return (
    "Admin Commands:\n" +
    "msg [2547xxx,2547yyy] message => Broadcast message to multiple numbers\n" +
    "/genlink <userID> => Generate a unique referral link for a user\n" +
    "/resetdata => Reset all user data\n" +
    "/clearhistory <number> => Clear deposit history for a user\n" +
    "/exportdata => Export data to console\n" +
    "/adjust <number> <amount> => Adjust user's balance\n" +
    "/maintenance on|off => Toggle maintenance mode\n" +
    "/maintenanceMsg <text> => Set maintenance message\n" +
    "Type 'Admin CMD' to view this help message."
  );
}

console.log("WhatsApp Bot loaded.");
