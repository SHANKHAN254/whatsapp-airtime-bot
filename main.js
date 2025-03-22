"use strict";

// ---------- Required Modules ----------
const express = require("express");
const qrcode = require("qrcode"); // for generating data URL of QR code
const qrcodeTerminal = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const axios = require("axios");

// ---------- Configuration & Constants ----------

// PayHero API details
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_CHANNEL_ID = 724;  // updated channel id

// Airtime API details
const AIRTIME_API_KEY = "6HyMVLHJMcBVBIhUKrHyjnakzWrYKYo8wo6hOmdTQV7gdIjbYV";
const AIRTIME_USERNAME = "fysproperty";

// Admin phone (international format without plus)
const ADMIN_PHONE = "254701339573";

// ---------- Bot Configuration (Customizable texts) ----------
let botConfig = {
  mainMenuText: "📋 *Main Menu:*\n1️⃣ Deposit\n2️⃣ Buy Airtime\n3️⃣ Check Balance\n4️⃣ Help\n5️⃣ Check Order Status\n\n_Reply with the number of your choice._",
  
  // Deposit texts
  depositPrompt: "💰 *Deposit Flow*\nEnter the deposit amount in Ksh (min 10, max 3000):",
  depositStatusSuccess: "🎉 *Deposit Successful!*\nYour payment of Ksh {amount} was received on {date}.",
  depositStatusFailed: "❌ *Deposit Failed:* {status}. Please try again.",
  depositFooter: "🙏 Thank you for using FYS_PROPERTY! Type 'menu' to continue.",
  
  // Airtime texts – new flow:
  airtimeAmountPrompt: "📱 *Airtime Purchase*\nEnter the airtime amount you wish to buy (min 10, max 3000 Ksh):",
  airtimeRecipientPrompt: "📲 Enter the recipient phone number (this number will receive airtime; must start with 07 or 01, 10 digits):",
  airtimePayerPrompt: "💳 Enter the phone number that will pay for the airtime (must start with 07 or 01, 10 digits):",
  airtimePaymentInitiated: "*⏳ Payment initiated!* Checking status in {seconds} seconds...",
  airtimeStatusSuccess: "🎉 *Airtime Transferred!*\nOrder: {orderNumber}\nPayer: {payer}\nRecipient: {recipient}\nM-Pesa Code: {mpesaCode}\nDate: {date}\nStatus: TRANSFERRED✅",
  airtimeStatusFailed: "❌ *Airtime Purchase Failed:* {status}.",
  
  // Order status text (for user order lookup)
  orderStatusText: "📄 *Order Status:*\nOrder: {orderNumber}\nPayer: {payer}\nRecipient: {recipient}\nAmount: Ksh {amount}\nM-Pesa Code: {mpesaCode}\nDate: {date}\nStatus: {status}\nRemarks: {remark}",
  
  // Balance text
  balanceMessage: "💵 Your current balance is: Ksh {balance}.",
  
  // Help text for users
  helpText: "💡 *Help*\nCommands:\n• menu – Main menu\n• help – Show commands\n• deposit – Deposit funds\n• buy airtime – Buy airtime\n• order status <OrderNumber> – Check your order status",
  
  // Admin help text
  adminHelp: "🛠️ *Admin Commands:*\n• msg [2547xxx,2547yyy] message – Broadcast message\n• /genlink <userID> – Generate unique referral link for a user\n• /setdiscount <percentage> – Set airtime discount percentage\n• /updateorder <OrderNumber> <Status> <Remark> – Update order status\n• /resetdata, /clearhistory <number>, /exportdata, /adjust, etc.\nType 'Admin CMD' to view this help.",
  
  // Maintenance message
  maintenanceMessage: "⚙️ The system is under maintenance. Please try again later.",
  
  // Airtime discount percentage (default 0%)
  airtimeDiscountPercent: 0
};

// ---------- EXTRA FEATURES ----------
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
  return "Leaderboard feature coming soon!";
}

// ---------- HELPER FUNCTIONS ----------
function parsePlaceholders(template, data) {
  return template
    .replace(/{amount}/g, data.amount || "")
    .replace(/{recipient}/g, data.recipient || "")
    .replace(/{payer}/g, data.payer || "")
    .replace(/{date}/g, data.date || "")
    .replace(/{mpesaCode}/g, data.mpesaCode || "")
    .replace(/{orderNumber}/g, data.orderNumber || "")
    .replace(/{status}/g, data.status || "")
    .replace(/{remark}/g, data.remark || "")
    .replace(/{balance}/g, data.balance || "");
}

function isAdmin(userNum) {
  return userNum === ADMIN_PHONE + "@s.whatsapp.net" || userNum.includes(ADMIN_PHONE);
}

// ---------- STATE MANAGEMENT ----------
const userStates = {};  
// Example structure for airtime flow:
// {
//    "2547xxx@s.whatsapp.net": {
//         stage: "awaitingAirtimeAmount" | "awaitingAirtimeRecipient" | "awaitingAirtimePayer" | "processingAirtimePayment",
//         amount: 50,
//         recipient: "0712345678",
//         payer: "0711111111"
//    }
// }

const orders = {};  // { orderNumber: { payer, recipient, amount, mpesaCode, date, status, remark } }

// ---------- UTILITY FUNCTIONS ----------
function formatPhoneNumber(numStr) {
  let cleaned = numStr.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.slice(1);
  }
  return cleaned;
}

function generateOrderNumber() {
  // Order number format: FY'S-xxxxx (apostrophe included in display)
  return "FY'S-" + Math.floor(10000 + Math.random() * 90000);
}

function generateInvestmentCode() {
  return "INV-" + Math.floor(1000000 + Math.random() * 9000000);
}

function generateReferralCode() {
  return "FYSPROP-" + Math.floor(10000 + Math.random() * 9000000);
}

// ---------- PAYHERO STK PUSH & STATUS ----------
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

// ---------- AIRTIME PURCHASE ----------
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

// ---------- ADMIN ALERT & LOGGING ----------
function sendAdminAlert(text) {
  client.sendMessage(ADMIN_PHONE + "@s.whatsapp.net", text);
  logAdmin(text);
}

function logAdmin(message) {
  const timeStr = new Date().toLocaleString();
  const entry = `[${timeStr}] ${message}`;
  adminLog.push(entry);
  console.log(entry);
}

// ---------- EXPRESS SERVER FOR QR CODE ----------

const app = express();
let currentQR = ""; // Will hold the latest QR code string
app.get("/qr", (req, res) => {
  if (currentQR) {
    // Generate a data URL for the QR code
    qrcode.toDataURL(currentQR, function (err, url) {
      if (err) {
        res.status(500).send("Error generating QR code.");
      } else {
        res.send(`
          <html>
            <head>
              <title>WhatsApp Bot QR Code</title>
              <style>
                body { background: #f0f0f0; font-family: Arial, sans-serif; text-align: center; padding-top: 50px; }
                h1 { color: #333; }
              </style>
            </head>
            <body>
              <h1>Scan the QR Code to Login</h1>
              <img src="${url}" alt="QR Code" />
            </body>
          </html>
        `);
      }
    });
  } else {
    res.send("QR code not available.");
  }
});
app.listen(3000, () => {
  console.log("Express server running on port 3000. Visit http://localhost:3000/qr to view the QR code.");
});

// ---------- CLIENT INITIALIZATION ----------
const client = new Client({
  authStrategy: new LocalAuth()
});

client.on("qr", (qr) => {
  currentQR = qr; // update the QR code for the webpage
  qrcodeTerminal.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("WhatsApp Client is ready!");
  sendAdminAlert("WhatsApp Airtime Bot is now deployed and running!");
});

client.initialize();

// ---------- MESSAGE HANDLING ----------
client.on("message_create", async (msg) => {
  if (msg.fromMe) return; // Ignore outgoing messages

  const userNum = msg.from; // e.g. "2547xxxx@s.whatsapp.net"
  const body = msg.body.trim();
  const lowerBody = body.toLowerCase();

  // ----- ADMIN COMMAND: "Admin CMD"
  if (isAdmin(userNum) && lowerBody === "admin cmd") {
    client.sendMessage(userNum, botConfig.adminHelp);
    return;
  }
  
  // ----- ADMIN COMMAND: Set discount, e.g. "/setdiscount 5"
  if (isAdmin(userNum) && body.startsWith("/setdiscount")) {
    const parts = body.split(" ");
    if (parts.length === 2) {
      const disc = parseFloat(parts[1]);
      if (!isNaN(disc) && disc >= 0 && disc <= 100) {
        botConfig.airtimeDiscountPercent = disc;
        client.sendMessage(userNum, `✅ Airtime discount set to ${disc}%`);
      } else {
        client.sendMessage(userNum, "❌ Invalid discount percentage. Must be between 0 and 100.");
      }
    } else {
      client.sendMessage(userNum, "Usage: /setdiscount <percentage>");
    }
    return;
  }
  
  // ----- BASIC RESPONSES -----
  if (lowerBody === "hi" || lowerBody === "hello") {
    client.sendMessage(userNum, "👋 Hello! Type 'menu' to view options or 'help' for commands.");
    return;
  }
  if (lowerBody === "help") {
    client.sendMessage(userNum, "💡 Commands:\nmenu - Main menu\nhelp - Show commands\ndeposit - Deposit funds\nbuy airtime - Buy airtime\norder status <OrderNumber> - Check order status");
    return;
  }
  
  // ----- MAIN MENU -----
  if (lowerBody === "menu") {
    userStates[userNum] = { registered: true };
    client.sendMessage(userNum, botConfig.mainMenuText);
    return;
  }
  
  // ----- PROCESS NUMERIC MENU SELECTION -----
  if (/^[1-5]$/.test(lowerBody)) {
    switch (lowerBody) {
      case "1":
        // Deposit flow
        userStates[userNum] = { stage: "awaitingDepositAmount", registered: true };
        client.sendMessage(userNum, botConfig.depositPrompt);
        break;
      case "2":
        // Airtime flow – ask for airtime amount
        userStates[userNum] = { stage: "awaitingAirtimeAmount", registered: true };
        client.sendMessage(userNum, botConfig.airtimeAmountPrompt);
        break;
      case "3":
        // Check Balance (dummy)
        client.sendMessage(userNum, botConfig.balanceMessage.replace("{balance}", "Not implemented in demo."));
        break;
      case "4":
        // Help
        client.sendMessage(userNum, botConfig.helpText);
        break;
      case "5":
        // Order status check
        client.sendMessage(userNum, "📄 Please enter your Order Number (format: FY'S-xxxxx):");
        userStates[userNum] = { stage: "awaitingOrderStatus" };
        break;
    }
    return;
  }
  
  // ----- DEPOSIT FLOW -----
  if (userStates[userNum]?.stage === "awaitingDepositAmount") {
    const amt = parseInt(body);
    if (isNaN(amt) || amt < 10 || amt > 3000) {
      client.sendMessage(userNum, "❌ Invalid deposit amount. Must be between 10 and 3000 Ksh.");
      return;
    }
    userStates[userNum].amount = amt;
    userStates[userNum].stage = "awaitingDepositPayer";
    client.sendMessage(userNum, "📞 Enter the phone number that will pay for the deposit (must start with 07 or 01, 10 digits):");
    return;
  }
  
  if (userStates[userNum]?.stage === "awaitingDepositPayer") {
    const payer = body;
    if (!/^(07|01)\d{8}$/.test(payer)) {
      client.sendMessage(userNum, "❌ Invalid payer phone. Must be 10 digits starting with 07 or 01.");
      return;
    }
    userStates[userNum].payer = payer;
    userStates[userNum].stage = "processingDeposit";
    const payPhone = formatPhoneNumber(payer);
    const amt = userStates[userNum].amount;
    const ref = await sendSTKPush(amt, payPhone);
    if (!ref) {
      client.sendMessage(userNum, "❌ Error initiating payment. Please try again later.");
      delete userStates[userNum];
      return;
    }
    client.sendMessage(userNum, "⏳ Payment initiated. Checking status in 20 seconds...");
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
        const fullMsg = `${successMsg}\n📞 Payer: ${userStates[userNum].payer}\n💳 M-Pesa Code: ${stData.provider_reference || "N/A"}`;
        client.sendMessage(userNum, fullMsg);
        sendAdminAlert(`💸 Deposit Order\nUser: ${userNum}\nAmount: Ksh ${userStates[userNum].amount}\nPayer: ${userStates[userNum].payer}\nM-Pesa Code: ${stData.provider_reference || "N/A"}\nDate: ${dateNow}`);
      } else {
        const failMsg = parsePlaceholders(botConfig.depositStatusFailed, {
          status: stData.status || "Failed"
        });
        client.sendMessage(userNum, failMsg);
        sendAdminAlert(`❌ Deposit Failed\nUser: ${userNum}\nAmount: Ksh ${userStates[userNum].amount}\nStatus: ${stData.status || "Failed"}\nDate: ${dateNow}`);
      }
      delete userStates[userNum];
    }, 20000);
    return;
  }
  
  // ----- AIRTIME FLOW -----
  // Step 1: Ask for airtime amount
  if (userStates[userNum]?.stage === "awaitingAirtimeAmount") {
    const amt = parseInt(body);
    if (isNaN(amt) || amt < 10 || amt > 3000) {
      client.sendMessage(userNum, "❌ Invalid airtime amount. Must be between 10 and 3000 Ksh.");
      return;
    }
    userStates[userNum].amount = amt;
    userStates[userNum].stage = "awaitingAirtimeRecipient";
    client.sendMessage(userNum, botConfig.airtimeRecipientPrompt);
    return;
  }
  
  // Step 2: Ask for recipient number
  if (userStates[userNum]?.stage === "awaitingAirtimeRecipient") {
    const recipient = body;
    if (!/^(07|01)\d{8}$/.test(recipient)) {
      client.sendMessage(userNum, "❌ Invalid recipient phone. Must be 10 digits starting with 07 or 01.");
      return;
    }
    userStates[userNum].recipient = recipient;
    userStates[userNum].stage = "awaitingAirtimePayer";
    client.sendMessage(userNum, botConfig.airtimePayerPrompt);
    return;
  }
  
  // Step 3: Ask for payer number and process airtime order
  if (userStates[userNum]?.stage === "awaitingAirtimePayer") {
    const payer = body;
    if (!/^(07|01)\d{8}$/.test(payer)) {
      client.sendMessage(userNum, "❌ Invalid payer phone. Must be 10 digits starting with 07 or 01.");
      return;
    }
    userStates[userNum].payer = payer;
    userStates[userNum].stage = "processingAirtimePayment";
    
    // Apply admin discount if any
    const discountPercent = botConfig.airtimeDiscountPercent || 0;
    const amt = userStates[userNum].amount;
    const discountedAmt = Math.round(amt * (1 - discountPercent/100));  // Final amount to be charged
    
    const payPhone = formatPhoneNumber(payer);
    const ref = await sendSTKPush(discountedAmt, payPhone);
    if (!ref) {
      client.sendMessage(userNum, "❌ Error initiating payment. Please try again later.");
      delete userStates[userNum];
      return;
    }
    client.sendMessage(userNum, `⏳ Payment initiated for Ksh ${discountedAmt} (after ${discountPercent}% discount). Checking status in 20 seconds...`);
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
        client.sendMessage(userNum, "✅ Payment successful! Initiating airtime transfer...");
        // Call airtime API
        const airtimeResp = await buyAirtime(userStates[userNum].recipient, amt);
        // Generate order number in the format FY'S-xxxxx
        const orderNumber = generateOrderNumber();
        // Build order record (we mark order status as TRANSFERRED✅ even if raw API says error)
        const orderRecord = {
          orderNumber: orderNumber,
          payer: userStates[userNum].payer,
          recipient: userStates[userNum].recipient,
          amount: amt,
          mpesaCode: stData.provider_reference || "N/A",
          date: dateNow,
          status: "TRANSFERRED✅",
          remark: ""
        };
        orders[orderNumber] = orderRecord;
        const successMsg = parsePlaceholders(botConfig.airtimeStatusSuccess, {
          amount: amt,
          recipient: userStates[userNum].recipient,
          date: dateNow,
          orderNumber: orderNumber,
          payer: userStates[userNum].payer,
          mpesaCode: orderRecord.mpesaCode
        });
        client.sendMessage(userNum, successMsg);
        sendAdminAlert(`📦 Airtime Order ${orderNumber}:\nUser: ${userNum}\nAmount: Ksh ${amt}\nPayer: ${userStates[userNum].payer}\nRecipient: ${userStates[userNum].recipient}\nM-Pesa Code: ${orderRecord.mpesaCode}\nDate: ${dateNow}\nStatus: TRANSFERRED✅`);
      } else {
        client.sendMessage(userNum, `❌ Payment status: ${stData.status || "Failed"}`);
        sendAdminAlert(`User ${userNum} airtime payment failed: ${stData.status || "Failed"} on ${dateNow}.`);
      }
      delete userStates[userNum];
    }, 20000);
    return;
  }
  
  // ----- ORDER STATUS CHECK -----
  if (lowerBody.startsWith("order status")) {
    const parts = body.split(" ");
    if (parts.length < 3) {
      client.sendMessage(userNum, "❌ Please provide an order number. Format: order status FY'S-xxxxx");
      return;
    }
    const orderNumber = parts[2].trim();
    if (!orders[orderNumber]) {
      client.sendMessage(userNum, "❌ Order not found.");
      return;
    }
    const order = orders[orderNumber];
    const orderMsg = parsePlaceholders(botConfig.orderStatusText, {
      orderNumber: order.orderNumber,
      payer: order.payer,
      recipient: order.recipient,
      amount: order.amount,
      mpesaCode: order.mpesaCode,
      date: order.date,
      status: order.status,
      remark: order.remark || "None"
    });
    client.sendMessage(userNum, orderMsg);
    return;
  }
  
  // ----- FALLBACK -----
  client.sendMessage(userNum, "❓ Unrecognized command. Type 'menu' or 'help' to see options.");
});

console.log("WhatsApp Airtime Bot loaded.");
