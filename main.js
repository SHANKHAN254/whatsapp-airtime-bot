"use strict";

// Required modules
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const axios = require("axios");

// ====================
// CONFIGURATION & CONSTANTS
// ====================

// WhatsApp Bot token is managed by whatsapp-web.js (QR code login)
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_CHANNEL_ID = 529;

// Airtime API details
const AIRTIME_API_KEY = "6HyMVLHJMcBVBIhUKrHyjnakzWrYKYo8wo6hOmdTQV7gdIjbYV";
const AIRTIME_USERNAME = "fysproperty";

// Admin phone (international format without plus)
const ADMIN_PHONE = "254701339573";

// ====================
// BOT CONFIGURATION (Texts configurable by admin)
// ====================
let botConfig = {
  // Registration texts
  registrationWelcome: "👋 Welcome to *FYS_PROPERTY Investment Bot*! Please register.\nEnter your first name:",
  askLastName: "Enter your last name:",
  askPhone: "Enter your phone number (start with 07 or 01, 10 digits):",
  registrationSuccess: "Thank you, *{firstName} {lastName}*! Your registration is complete. Your referral code is *{referralCode}*.\nType *menu* to view options.",
  
  // Main Menu
  mainMenuText: "Main Menu:\n1) Deposit\n2) Buy Airtime\n3) Check Balance\n4) Help\n\nPlease reply with the number of your choice.",
  
  // Deposit messages
  depositPrompt: "Enter the deposit amount in Ksh (min 10, max 3000):",
  depositStatusSuccess: "🎉 Deposit successful! Your payment of Ksh {amount} was received on {date}.",
  depositStatusFailed: "❌ Deposit failed: {status}. Please try again.",
  
  // Airtime messages
  airtimePrompt: "Enter the airtime amount to buy (min 10, max 3000 Ksh):",
  airtimeRecipientPrompt: "Enter the recipient phone number (start with 07 or 01, 10 digits):",
  airtimeStatusSuccess: "🎉 Airtime of Ksh {amount} sent successfully to {recipient} on {date}.",
  airtimeStatusFailed: "❌ Airtime purchase failed: {status}.",
  
  // Balance message
  balanceMessage: "Your current balance is: Ksh {balance}.",
  
  // Admin & extra
  adminHelp: "Admin Commands:\n• msg [2547xxx,2547yyy] message - Broadcast message\n• Admin CMD - Show admin help\n• /genlink <userID> - Generate unique referral link\n• /resetdata, /clearhistory <number>, /exportdata, /adjust, etc.",
  
  // Other extras
  helpText: "Commands:\nmenu - Main menu\nhelp - Show commands\n",
  
  // Maintenance
  maintenanceMessage: "⚙️ The system is under maintenance. Please try again later."
};

// ====================
// EXTRA FEATURES (Motivational quotes, uptime, etc.)
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
  // In a production system, this would query a database. Here, we use a dummy leaderboard.
  return "Leaderboard feature coming soon!";
}

// ====================
// HELPER FUNCTIONS
// ====================
function parsePlaceholders(template, data) {
  return template
    .replace(/{firstName}/g, data.firstName || "")
    .replace(/{lastName}/g, data.lastName || "")
    .replace(/{amount}/g, data.amount || "")
    .replace(/{referralCode}/g, data.referralCode || "")
    .replace(/{recipient}/g, data.recipient || "")
    .replace(/{date}/g, data.date || "")
    .replace(/{status}/g, data.status || "")
    .replace(/{balance}/g, data.balance || "");
}

function isAdmin(userNum) {
  return userNum === ADMIN_PHONE + "@s.whatsapp.net" || userNum.includes(ADMIN_PHONE);
}

// ====================
// STATE MANAGEMENT
// ====================
// We use an in-memory object for simplicity. In production, use a database.
const userStates = {}; // e.g., { "2547xxx@s.whatsapp.net": { stage: "awaitingDepositAmount", amount: 50, registered: true, ... } }

// ====================
// UTILITY FUNCTIONS
// ====================
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
// PAYHERO STK PUSH (for deposit and airtime payment)
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

// ====================
// AIRTIME PURCHASE
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
// ADMIN ALERT
// ====================
function sendAdminAlert(text) {
  client.sendMessage(ADMIN_PHONE + "@s.whatsapp.net", text);
  logAdmin(text);
}

// ====================
// ADMIN LOGGING
// ====================
function logAdmin(message) {
  const timeStr = new Date().toLocaleString();
  const entry = `[${timeStr}] ${message}`;
  adminLog.push(entry);
  console.log(entry);
}

// ====================
// CLIENT INITIALIZATION
// ====================
const client = new Client({
  authStrategy: new LocalAuth()
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("WhatsApp Client is ready!");
  // Alert admin on startup
  sendAdminAlert("WhatsApp Airtime Bot is now deployed and running!");
});

client.initialize();

// ====================
// MESSAGE HANDLING
// ====================
client.on("message_create", async (msg) => {
  if (msg.fromMe) return; // ignore outgoing

  const userNum = msg.from; // e.g. "2547xxxx@s.whatsapp.net"
  const body = msg.body.trim();
  const lowerBody = body.toLowerCase();

  // ----- ADMIN COMMAND: "Admin CMD" -----
  if (isAdmin(userNum) && lowerBody === "admin cmd") {
    client.sendMessage(userNum, botConfig.adminHelp);
    return;
  }

  // ----- BASIC RESPONSES -----
  if (lowerBody === "hi" || lowerBody === "hello") {
    client.sendMessage(userNum, "Hello! Type 'menu' to view options or 'help' for commands.");
    return;
  }
  if (lowerBody === "help") {
    client.sendMessage(userNum,
      "Available Commands:\nmenu - Main menu\nhelp - Show commands\n"
    );
    return;
  }
  
  // ----- NUMERIC MENU -----
  if (lowerBody === "menu") {
    // Reset any previous state
    userStates[userNum] = { registered: true };
    client.sendMessage(userNum, botConfig.mainMenuText);
    return;
  }
  
  // ----- PROCESS NUMERIC SELECTION -----
  // If the user sends a single digit in reply to the menu:
  if (/^[1-4]$/.test(lowerBody)) {
    switch (lowerBody) {
      case "1":
        // Deposit
        userStates[userNum] = { stage: "awaitingDepositAmount", registered: true };
        client.sendMessage(userNum, botConfig.depositPrompt);
        break;
      case "2":
        // Buy Airtime
        userStates[userNum] = { stage: "awaitingAirtimeAmount", registered: true };
        client.sendMessage(userNum, botConfig.airtimeIntro || "Enter the airtime amount (min 10, max 3000 Ksh):");
        break;
      case "3":
        // Check Balance
        // In a real system, balance would be stored persistently. Here, we simulate it.
        client.sendMessage(userNum, botConfig.balanceMessage.replace("{balance}", "Your balance is not tracked in this demo."));
        break;
      case "4":
        // Help
        client.sendMessage(userNum, botConfig.helpText);
        break;
    }
    return;
  }
  
  // ----- DEPOSIT FLOW -----
  if (userStates[userNum]?.stage === "awaitingDepositAmount") {
    const amt = parseInt(body);
    if (isNaN(amt) || amt < 10 || amt > 3000) {
      client.sendMessage(userNum, "Invalid deposit amount. Must be between 10 and 3000 Ksh.");
      return;
    }
    userStates[userNum].amount = amt;
    userStates[userNum].stage = "processingDeposit";
    // Use the sender's number for payment (converted)
    const payPhone = formatPhoneForSTK(userNum);
    const ref = await sendSTKPush(amt, payPhone);
    if (!ref) {
      client.sendMessage(userNum, "❌ Error initiating payment. Please try again later.");
      delete userStates[userNum];
      return;
    }
    client.sendMessage(userNum, "Payment initiated. Checking status in 20 seconds...");
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
  
  // ----- AIRTIME FLOW -----
  if (userStates[userNum]?.stage === "awaitingAirtimeAmount") {
    const amt = parseInt(body);
    if (isNaN(amt) || amt < 10 || amt > 3000) {
      client.sendMessage(userNum, "Invalid airtime amount. Must be between 10 and 3000 Ksh.");
      return;
    }
    userStates[userNum].amount = amt;
    userStates[userNum].stage = "awaitingAirtimeRecipient";
    client.sendMessage(userNum, botConfig.airtimeRecipientPrompt || "Enter the recipient phone number (start with 07 or 01, 10 digits):");
    return;
  }
  
  if (userStates[userNum]?.stage === "awaitingAirtimeRecipient") {
    const recipient = body;
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
    client.sendMessage(userNum, `Payment initiated for Ksh ${amt}. Checking status in 20 seconds...`);
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
        client.sendMessage(userNum, "Payment successful! Proceeding to purchase airtime...");
        const airtimeResp = await buyAirtime(userStates[userNum].recipient, amt);
        if (airtimeResp && airtimeResp.status === true && airtimeResp.response?.Status === "Success") {
          const successMsg = parsePlaceholders(botConfig.airtimeStatusSuccess, {
            amount: amt,
            recipient: userStates[userNum].recipient,
            date: dateNow
          });
          client.sendMessage(userNum, successMsg);
          sendAdminAlert(`User ${userNum} purchased airtime Ksh ${amt} for ${userStates[userNum].recipient} on ${dateNow}.`);
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
  
  // Unrecognized command fallback
  client.sendMessage(userNum, "Unrecognized command. Type 'menu' or 'help' to see options.");
});

// ====================
// ADMIN HELP COMMAND (via "Admin CMD")
// ====================
// Already handled in the above message_create handler for admin.

// ====================
// End of Code
console.log("WhatsApp Airtime Bot loaded.");
