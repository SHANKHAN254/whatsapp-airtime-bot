"use strict";

// Required modules
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const axios = require("axios");

// ====================
// CONFIGURATION & CONSTANTS
// ====================

// PayHero API details (for both STK push and checking payment status)
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_CHANNEL_ID = 724;

// Airtime API details
const AIRTIME_API_KEY = "6HyMVLHJMcBVBIhUKrHyjnakzWrYKYo8wo6hOmdTQV7gdIjbYV";
const AIRTIME_USERNAME = "fysproperty";

// Admin phone (international format without plus)
const ADMIN_PHONE = "254701339573";

// ====================
// BOT CONFIGURATION (Customizable texts)
// ====================
let botConfig = {
  // Main Menu text (numeric options)
  mainMenuText: "Main Menu:\n1) Deposit\n2) Buy Airtime\n3) Check Balance\n4) Help\n5) Check Order Status\n\nReply with the number of your choice.",

  // Deposit messages
  depositPrompt: "💰 Enter the deposit amount in Ksh (min 10, max 3000):",
  depositStatusSuccess: "🎉 Deposit successful! Your payment of Ksh {amount} was received on {date}.",
  depositStatusFailed: "❌ Deposit failed: {status}. Please try again.",
  depositFooter: "Thank you for using FYS_PROPERTY! Type 'menu' to continue.",

  // Airtime purchase messages (enhanced flow)
  airtimeAmountPrompt: "📱 Enter the airtime amount you wish to buy (min 10, max 3000 Ksh):",
  airtimeRecipientPrompt: "📲 Enter the recipient phone number (this number will receive airtime; must start with 07 or 01, 10 digits):",
  airtimePayerPrompt: "💳 Enter the phone number that will pay for the airtime (must start with 07 or 01, 10 digits):",
  airtimePaymentInitiated: "*⏳ Payment initiated!* Checking status in {seconds} seconds...",
  airtimeStatusSuccess: "🎉 Airtime purchase successful!\nOrder: {orderNumber}\nPayer: {payer}\nRecipient: {recipient}\nM-Pesa Code: {mpesaCode}\nDate: {date}",
  airtimeStatusFailed: "❌ Airtime purchase failed: {status}.",
  
  // Order status (when user checks order status)
  orderStatusText: "📄 Order Status:\nOrder: {orderNumber}\nPayer: {payer}\nRecipient: {recipient}\nAmount: Ksh {amount}\nM-Pesa Code: {mpesaCode}\nDate: {date}\nStatus: {status} \nRemarks: {remark}",
  
  // Balance message (dummy demo)
  balanceMessage: "💵 Your current balance is: Ksh {balance}.",
  
  // Help text for users
  helpText: "Commands:\nmenu – Main menu\nhelp – Show commands\n",
  
  // Admin help text
  adminHelp: "Admin Commands:\n• msg [2547xxx,2547yyy] message – Broadcast message\n• /genlink <userID> – Generate unique referral link for a user\n• /updateorder <orderNumber> <status> <remark> – Update order status\n• /resetdata, /clearhistory <number>, /exportdata, /adjust, etc.\nType 'Admin CMD' to view this help.",

  // Maintenance message
  maintenanceMessage: "⚙️ The system is under maintenance. Please try again later."
};

// ====================
// EXTRA FEATURES (Motivational quotes, uptime, about, etc.)
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
  return "Leaderboard feature coming soon!";
}

// ====================
// HELPER FUNCTIONS
// ====================
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

// ====================
// STATE MANAGEMENT (In-memory)
// ====================
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
// Deposit flow uses a similar structure.

// In-memory orders storage:
const orders = {};  // { orderNumber: { payer, recipient, amount, mpesaCode, date, status, remark } }

// Utility: format a phone number (e.g. "0712345678" -> "254712345678")
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

function generateOrderNumber() {
  // Order number starts with FY'S- followed by 5 random digits (we remove the apostrophe in code to avoid issues)
  return "FYSPROP-" + Math.floor(10000 + Math.random() * 90000);
}

// ====================
// PAYHERO STK PUSH & STATUS FUNCTIONS
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
// AIRTIME PURCHASE FUNCTION
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
// ADMIN ALERT & LOGGING
// ====================
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
  sendAdminAlert("WhatsApp Airtime Bot is now deployed and running!");
});

client.initialize();

// ====================
// MESSAGE HANDLING
// ====================
client.on("message_create", async (msg) => {
  if (msg.fromMe) return; // ignore outgoing messages

  const userNum = msg.from; // e.g. "2547xxxx@s.whatsapp.net"
  const body = msg.body.trim();
  const lowerBody = body.toLowerCase();

  // ----- ADMIN COMMAND: "Admin CMD"
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
    client.sendMessage(userNum, "Commands:\nmenu - Main menu\nhelp - Show commands\ndeposit - Deposit funds\nbuy airtime - Buy airtime\norder status <orderNumber> - Check your order status");
    return;
  }
  
  // ----- MAIN MENU -----
  if (lowerBody === "menu") {
    // Reset state and mark user as registered
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
        // Buy Airtime flow
        userStates[userNum] = { stage: "awaitingAirtimeAmount", registered: true };
        client.sendMessage(userNum, botConfig.airtimeAmountPrompt);
        break;
      case "3":
        // Check Balance (dummy message)
        client.sendMessage(userNum, botConfig.balanceMessage.replace("{balance}", "Balance tracking not implemented in this demo."));
        break;
      case "4":
        // Help
        client.sendMessage(userNum, botConfig.helpText);
        break;
      case "5":
        // Check Order Status
        client.sendMessage(userNum, "Please enter your Order Number (format: FYSPROP-xxxxx):");
        // Set state to check order status
        userStates[userNum] = { stage: "awaitingOrderStatus" };
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
    userStates[userNum].stage = "awaitingDepositPayer";
    client.sendMessage(userNum, "Enter the phone number that will pay for the deposit (start with 07 or 01, 10 digits):");
    return;
  }
  
  if (userStates[userNum]?.stage === "awaitingDepositPayer") {
    const payer = body;
    if (!/^(07|01)\d{8}$/.test(payer)) {
      client.sendMessage(userNum, "Invalid payer phone. Must be 10 digits starting with 07 or 01.");
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
        // Include m-pesa transaction code (provider_reference)
        const successMsg = parsePlaceholders(botConfig.depositStatusSuccess, {
          amount: userStates[userNum].amount,
          date: dateNow
        });
        // Append payer details and mpesa code
        const fullMsg = `${successMsg}\nPayer: ${userStates[userNum].payer}\nM-Pesa Code: ${stData.provider_reference || "N/A"}`;
        client.sendMessage(userNum, fullMsg);
        sendAdminAlert(`Deposit Order: ${generateInvestmentCode()} \nUser: ${userNum}\nAmount: Ksh ${userStates[userNum].amount}\nPayer: ${userStates[userNum].payer}\nM-Pesa Code: ${stData.provider_reference || "N/A"}\nDate: ${dateNow}`);
        // Optionally, store deposit order details here.
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
    client.sendMessage(userNum, botConfig.airtimeRecipientPrompt);
    return;
  }
  
  if (userStates[userNum]?.stage === "awaitingAirtimeRecipient") {
    const recipient = body;
    if (!/^(07|01)\d{8}$/.test(recipient)) {
      client.sendMessage(userNum, "Invalid recipient phone. Must be 10 digits starting with 07 or 01.");
      return;
    }
    userStates[userNum].recipient = recipient;
    userStates[userNum].stage = "awaitingAirtimePayer";
    client.sendMessage(userNum, botConfig.airtimePayerPrompt);
    return;
  }
  
  if (userStates[userNum]?.stage === "awaitingAirtimePayer") {
    const payer = body;
    if (!/^(07|01)\d{8}$/.test(payer)) {
      client.sendMessage(userNum, "Invalid payer phone. Must be 10 digits starting with 07 or 01.");
      return;
    }
    userStates[userNum].payer = payer;
    userStates[userNum].stage = "processingAirtimePayment";
    const payPhone = formatPhoneNumber(payer);
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
        client.sendMessage(userNum, "Payment successful! Sending airtime now...");
        // Call airtime API
        const airtimeResp = await buyAirtime(userStates[userNum].recipient, amt);
        // Generate order number
        const orderNumber = generateOrderNumber();
        // Build order record
        const orderRecord = {
          orderNumber: orderNumber,
          payer: userStates[userNum].payer,
          recipient: userStates[userNum].recipient,
          amount: amt,
          mpesaCode: stData.provider_reference || "N/A",
          date: dateNow,
          status: "Completed",
          remark: ""
        };
        orders[orderNumber] = orderRecord;
        if (airtimeResp && airtimeResp.status === true && airtimeResp.response?.Status === "Success") {
          const successMsg = parsePlaceholders(botConfig.airtimeStatusSuccess, {
            amount: amt,
            recipient: userStates[userNum].recipient,
            date: dateNow
          });
          // Append order details
          const fullMsg = `${successMsg}\nOrder: ${orderNumber}\nPayer: ${userStates[userNum].payer}\nM-Pesa Code: ${orderRecord.mpesaCode}`;
          client.sendMessage(userNum, fullMsg);
          sendAdminAlert(`Order ${orderNumber}:\nUser: ${userNum}\nAmount: Ksh ${amt}\nPayer: ${userStates[userNum].payer}\nRecipient: ${userStates[userNum].recipient}\nM-Pesa Code: ${orderRecord.mpesaCode}\nDate: ${dateNow}\nStatus: Completed`);
        } else {
          // Even if airtime API returns failure, we record the order for admin review.
          orderRecord.status = "Failed";
          const failMsg = parsePlaceholders(botConfig.airtimeStatusFailed, {
            status: airtimeResp?.response?.Message || "Unknown error"
          });
          const fullMsg = `${failMsg}\nOrder: ${orderNumber}\nPayer: ${userStates[userNum].payer}\nM-Pesa Code: ${stData.provider_reference || "N/A"}\nDate: ${dateNow}`;
          client.sendMessage(userNum, fullMsg);
          sendAdminAlert(`Order ${orderNumber}:\nUser: ${userNum}\nAmount: Ksh ${amt}\nPayer: ${userStates[userNum].payer}\nRecipient: ${userStates[userNum].recipient}\nM-Pesa Code: ${stData.provider_reference || "N/A"}\nDate: ${dateNow}\nStatus: Failed`);
        }
      } else {
        client.sendMessage(userNum, `❌ Payment status: ${stData.status || "Failed"}`);
        sendAdminAlert(`User ${userNum} airtime payment failed: ${stData.status || "Failed"} on ${dateNow}.`);
      }
      delete userStates[userNum];
    }, 20000);
    return;
  }
  
  // ----- ORDER STATUS CHECK (User can type "order status FYSPROP-xxxxx")
  if (lowerBody.startsWith("order status")) {
    const parts = body.split(" ");
    if (parts.length < 3) {
      client.sendMessage(userNum, "Please provide an order number. Format: order status FYSPROP-xxxxx");
      return;
    }
    const orderNumber = parts[2].trim();
    if (!orders[orderNumber]) {
      client.sendMessage(userNum, "Order not found.");
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
  client.sendMessage(userNum, "Unrecognized command. Type 'menu' or 'help' to see options.");
});

console.log("WhatsApp Airtime Bot loaded.");
