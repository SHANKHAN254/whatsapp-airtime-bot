"use strict";

/*
  WhatsApp Airtime Bot with:
   - Channel ID = 724
   - Webpage QR code display
   - Admin discount for airtime ("/setdiscount <percentage>")
   - Order format: FY'S-xxxxx
   - M-Pesa transaction code shown
   - Additional user-friendly texts & emojis
   - SMS integration: sends admin alerts to WhatsApp and SMS
*/

// ====================
// DEPENDENCIES
// ====================
const express = require("express");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const axios = require("axios");

// ====================
// CONFIGURATION & CONSTANTS
// ====================

// PayHero API
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_CHANNEL_ID = 724;

// Airtime API
const AIRTIME_API_KEY = "6HyMVLHJMcBVBIhUKrHyjnakzWrYKYo8wo6hOmdTQV7gdIjbYV";
const AIRTIME_USERNAME = "fysproperty";

// Admin phone
const ADMIN_PHONE = "254701339573";

// SMS API credentials
const SMS_API_KEY = "cca05a3cffa4dcd47dbc70f0c9694aa6";
const SMS_PARTNER_ID = "9233";

// ====================
// BOT CONFIGURATION
// ====================
let botConfig = {
  mainMenuText: "📋 *Main Menu:*\n1️⃣ Deposit\n2️⃣ Buy Airtime\n3️⃣ Check Balance\n4️⃣ Help\n5️⃣ Check Order Status\n\n_Reply with the number of your choice._",

  // Deposit
  depositPrompt: "💰 *Deposit Flow*\nEnter deposit amount (10-3000 Ksh):",
  depositStatusSuccess: "🎉 *Deposit Successful!*\nYour payment of Ksh {amount} was received on {date}.",
  depositStatusFailed: "❌ *Deposit Failed:* {status}.",
  depositFooter: "🙏 Thank you for using FYS_PROPERTY! Type 'menu' to continue.",

  // Airtime
  airtimeAmountPrompt: "📱 *Airtime Purchase*\nEnter amount (10-3000 Ksh):",
  airtimeRecipientPrompt: "📲 Enter recipient phone (07/01..., 10 digits):",
  airtimePayerPrompt: "💳 Enter payer phone (07/01..., 10 digits):",
  airtimeStatusSuccess: "🎉 *Airtime Transferred!*\nOrder: {orderNumber}\nPayer: {payer}\nRecipient: {recipient}\nM-Pesa Code: {mpesaCode}\nDate: {date}\nStatus: TRANSFERRED✅",
  airtimeStatusFailed: "❌ *Airtime Purchase Failed:* {status}.",

  // Orders
  orderStatusText: "📄 *Order Status:*\nOrder: {orderNumber}\nPayer: {payer}\nRecipient: {recipient}\nAmount: {amount}\nM-Pesa Code: {mpesaCode}\nDate: {date}\nStatus: {status}\nRemarks: {remark}",

  // Balance & help
  balanceMessage: "💵 Your current balance is: Ksh {balance}.",
  helpText: "💡 *Help*\nCommands:\n• menu – Main menu\n• help – Show commands\n• deposit – Deposit\n• buy airtime – Buy airtime\n• order status <OrderNumber> – Check order status",

  // Admin
  adminHelp: "🛠️ *Admin Commands:*\n• msg [2547xxx,2547yyy] msg\n• /genlink <userID>\n• /setdiscount <percentage>\n• /updateorder <OrderNumber> <Status> <Remark>\nType 'Admin CMD' for help again.",
  maintenanceMessage: "⚙️ The system is under maintenance. Try later.",

  // Airtime discount (default 0)
  airtimeDiscountPercent: 0
};

// ====================
// EXTRA FEATURES & UTILITIES
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

// Utility: Replace placeholders in messages
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

// Utility: Check if user is admin
function isAdmin(userNum) {
  return userNum.includes(ADMIN_PHONE);
}

// Utility: Uptime display
function getUptime() {
  const diff = Date.now() - botStartTime;
  const s = Math.floor(diff / 1000) % 60;
  const m = Math.floor(diff / (1000 * 60)) % 60;
  const h = Math.floor(diff / (1000 * 60 * 60));
  return `${h}h ${m}m ${s}s`;
}

// In-memory data storage
const userStates = {};
const orders = {};  // { orderNumber: { payer, recipient, amount, mpesaCode, date, status, remark } }

// Utility: Format phone numbers
function formatPhoneNumber(numStr) {
  let cleaned = numStr.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.slice(1);
  }
  return cleaned;
}

// Utility: Generate order number: "FY'S-xxxxx"
function generateOrderNumber() {
  return "FY'S-" + Math.floor(10000 + Math.random() * 90000);
}

// ====================
// PAYMENT FUNCTIONS
// ====================

// STK push for deposits/airtime payments
async function sendSTKPush(amount, phoneNumber) {
  const payload = {
    amount,
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

// Fetch STK payment status
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

// Airtime purchase
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
// ADMIN & ALERT FUNCTIONS
// ====================

// Log admin activity
function logAdmin(message) {
  const timeStr = new Date().toLocaleString();
  const entry = `[${timeStr}] ${message}`;
  adminLog.push(entry);
  console.log(entry);
}

// Function to send SMS alerts using Bulk SMS API
async function sendSMSAlert(message) {
  const payload = {
    apikey: SMS_API_KEY,
    partnerID: SMS_PARTNER_ID,
    message: message,
    shortcode: "TextSMS", // Change this sender ID if required
    mobile: ADMIN_PHONE
  };
  try {
    const response = await axios.post("https://sms.textsms.co.ke/api/services/sendsms/", payload, {
      headers: {
        "Content-Type": "application/json"
      }
    });
    console.log("SMS sent:", response.data);
  } catch (error) {
    console.error("Error sending SMS:", error.response ? error.response.data : error);
  }
}

// Admin alert: send via WhatsApp and SMS
function sendAdminAlert(text) {
  client.sendMessage(ADMIN_PHONE + "@s.whatsapp.net", text);
  logAdmin(text);
  // Send SMS alert with the same text
  sendSMSAlert(text);
}

// ====================
// EXPRESS SERVER FOR QR CODE DISPLAY
// ====================
const app = express();
let currentQR = "";
app.get("/qr", (req, res) => {
  if (currentQR) {
    qrcode.toDataURL(currentQR, function (err, url) {
      if (err) {
        res.status(500).send("Error generating QR code.");
      } else {
        res.send(`
          <html>
            <head><title>WhatsApp Bot QR Code</title></head>
            <body style="background:#f0f0f0; text-align:center; font-family:Arial,sans-serif; padding-top:50px;">
              <h1>Scan QR Code to Login</h1>
              <img src="${url}" alt="QR Code"/>
            </body>
          </html>
        `);
      }
    });
  } else {
    res.send("QR code not available at the moment.");
  }
});
app.listen(3000, () => {
  console.log("Express server on port 3000. Visit http://localhost:3000/qr to see QR code.");
});

// ====================
// INITIALIZE WHATSAPP CLIENT
// ====================
const client = new Client({
  authStrategy: new LocalAuth()
});

// Display QR code in terminal when generated
client.on("qr", (qr) => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
});

// When WhatsApp client is ready, send a welcome alert and display linked device name
client.on("ready", () => {
  console.log("WhatsApp Client is ready!");
  // Send a message to admin with the linked device name in an interesting way
  const welcomeMsg = "✨ *FY'S PROPERTY* is now connected as your linked device! Ready to rock your transactions! 🚀";
  sendAdminAlert(welcomeMsg);
});

// Initialize WhatsApp client
client.initialize();

// ====================
// MESSAGE HANDLER
// ====================
client.on("message_create", async (msg) => {
  if (msg.fromMe) return;

  const userNum = msg.from;
  const body = msg.body.trim();
  const lowerBody = body.toLowerCase();

  // Admin CMD
  if (isAdmin(userNum) && lowerBody === "admin cmd") {
    client.sendMessage(userNum, botConfig.adminHelp);
    return;
  }

  // Admin discount: /setdiscount <percentage>
  if (isAdmin(userNum) && lowerBody.startsWith("/setdiscount")) {
    const parts = body.split(" ");
    if (parts.length === 2) {
      const disc = parseFloat(parts[1]);
      if (!isNaN(disc) && disc >= 0 && disc <= 100) {
        botConfig.airtimeDiscountPercent = disc;
        client.sendMessage(userNum, `✅ Airtime discount set to ${disc}%`);
      } else {
        client.sendMessage(userNum, "❌ Invalid discount percentage. Must be 0-100.");
      }
    } else {
      client.sendMessage(userNum, "Usage: /setdiscount <percentage>");
    }
    return;
  }

  // Basic responses
  if (lowerBody === "hi" || lowerBody === "hello") {
    client.sendMessage(userNum, "👋 Hello! Type 'menu' for options or 'help' for commands.");
    return;
  }
  if (lowerBody === "help") {
    client.sendMessage(userNum, botConfig.helpText);
    return;
  }

  // Main menu
  if (lowerBody === "menu") {
    userStates[userNum] = { registered: true };
    client.sendMessage(userNum, botConfig.mainMenuText);
    return;
  }

  // Numeric menu selection
  if (/^[1-5]$/.test(lowerBody)) {
    switch (lowerBody) {
      case "1":
        // Deposit
        userStates[userNum] = { stage: "awaitingDepositAmount", registered: true };
        client.sendMessage(userNum, botConfig.depositPrompt);
        break;
      case "2":
        // Airtime
        userStates[userNum] = { stage: "awaitingAirtimeAmount", registered: true };
        client.sendMessage(userNum, botConfig.airtimeAmountPrompt);
        break;
      case "3":
        // Balance
        client.sendMessage(userNum, botConfig.balanceMessage.replace("{balance}", "Not implemented in demo."));
        break;
      case "4":
        // Help
        client.sendMessage(userNum, botConfig.helpText);
        break;
      case "5":
        // Order status
        client.sendMessage(userNum, "📄 Enter your Order Number (FY'S-xxxxx):");
        userStates[userNum] = { stage: "awaitingOrderStatus" };
        break;
    }
    return;
  }

  // Deposit flow
  if (userStates[userNum]?.stage === "awaitingDepositAmount") {
    const amt = parseInt(body);
    if (isNaN(amt) || amt < 10 || amt > 3000) {
      client.sendMessage(userNum, "❌ Invalid deposit amount (10-3000).");
      return;
    }
    userStates[userNum].amount = amt;
    userStates[userNum].stage = "awaitingDepositPayer";
    client.sendMessage(userNum, "📞 Enter payer phone (07/01..., 10 digits):");
    return;
  }

  if (userStates[userNum]?.stage === "awaitingDepositPayer") {
    const payer = body;
    if (!/^(07|01)\d{8}$/.test(payer)) {
      client.sendMessage(userNum, "❌ Invalid payer phone. Must be 10 digits (07/01...).");
      return;
    }
    userStates[userNum].payer = payer;
    userStates[userNum].stage = "processingDeposit";
    const payPhone = formatPhoneNumber(payer);
    const amt = userStates[userNum].amount;
    const ref = await sendSTKPush(amt, payPhone);
    if (!ref) {
      client.sendMessage(userNum, "❌ Error initiating payment. Try again.");
      delete userStates[userNum];
      return;
    }
    client.sendMessage(userNum, "⏳ Payment initiated. Checking status in 20s...");
    setTimeout(async () => {
      const stData = await fetchSTKStatus(ref);
      const dateNow = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      if (!stData) {
        client.sendMessage(userNum, "❌ Could not fetch payment status. Try again.");
        delete userStates[userNum];
        return;
      }
      const finalStatus = (stData.status || "").toUpperCase();
      if (finalStatus === "SUCCESS") {
        const successMsg = parsePlaceholders(botConfig.depositStatusSuccess, {
          amount: amt,
          date: dateNow
        });
        const fullMsg = `${successMsg}\n📞 Payer: ${userStates[userNum].payer}\n💳 M-Pesa Code: ${stData.provider_reference || "N/A"}`;
        client.sendMessage(userNum, fullMsg);
        sendAdminAlert(`💸 Deposit\nUser: ${userNum}\nAmount: Ksh ${amt}\nPayer: ${userStates[userNum].payer}\nM-Pesa Code: ${stData.provider_reference || "N/A"}\nDate: ${dateNow}`);
      } else {
        const failMsg = parsePlaceholders(botConfig.depositStatusFailed, {
          status: stData.status || "Failed"
        });
        client.sendMessage(userNum, failMsg);
        sendAdminAlert(`❌ Deposit Failed\nUser: ${userNum}\nAmount: Ksh ${amt}\nStatus: ${stData.status || "Failed"}\nDate: ${dateNow}`);
      }
      delete userStates[userNum];
    }, 20000);
    return;
  }

  // Airtime flow
  if (userStates[userNum]?.stage === "awaitingAirtimeAmount") {
    const amt = parseInt(body);
    if (isNaN(amt) || amt < 10 || amt > 3000) {
      client.sendMessage(userNum, "❌ Invalid airtime amount (10-3000).");
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
      client.sendMessage(userNum, "❌ Invalid recipient phone. Must be 10 digits (07/01...).");
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
      client.sendMessage(userNum, "❌ Invalid payer phone. Must be 10 digits (07/01...).");
      return;
    }
    userStates[userNum].payer = payer;
    userStates[userNum].stage = "processingAirtimePayment";
    
    // Apply discount
    const discountPercent = botConfig.airtimeDiscountPercent || 0;
    const amt = userStates[userNum].amount;
    const discountedAmt = Math.round(amt * (1 - discountPercent/100));

    const payPhone = formatPhoneNumber(payer);
    const ref = await sendSTKPush(discountedAmt, payPhone);
    if (!ref) {
      client.sendMessage(userNum, "❌ Error initiating payment. Try again.");
      delete userStates[userNum];
      return;
    }
    client.sendMessage(userNum, `⏳ Payment initiated for Ksh ${discountedAmt} (after ${discountPercent}% discount). Checking status in 20s...`);
    setTimeout(async () => {
      const stData = await fetchSTKStatus(ref);
      const dateNow = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      if (!stData) {
        client.sendMessage(userNum, "❌ Could not fetch payment status. Try again.");
        delete userStates[userNum];
        return;
      }
      const finalStatus = (stData.status || "").toUpperCase();
      if (finalStatus === "SUCCESS") {
        client.sendMessage(userNum, "✅ Payment successful! Sending airtime now...");
        // Call airtime API
        await buyAirtime(userStates[userNum].recipient, amt); // ignoring the response
        const orderNumber = generateOrderNumber();
        const orderRecord = {
          orderNumber,
          payer,
          recipient: userStates[userNum].recipient,
          amount: amt,
          mpesaCode: stData.provider_reference || "N/A",
          date: dateNow,
          status: "TRANSFERRED✅",
          remark: ""
        };
        orders[orderNumber] = orderRecord;

        const successMsg = parsePlaceholders(botConfig.airtimeStatusSuccess, {
          orderNumber,
          payer,
          recipient: userStates[userNum].recipient,
          mpesaCode: orderRecord.mpesaCode,
          date: dateNow
        });
        client.sendMessage(userNum, successMsg);
        sendAdminAlert(`📦 Airtime Order ${orderNumber}:\nUser: ${userNum}\nAmount: Ksh ${amt}\nDiscount: ${discountPercent}%\nPayer: ${payer}\nRecipient: ${orderRecord.recipient}\nM-Pesa Code: ${orderRecord.mpesaCode}\nDate: ${dateNow}\nStatus: TRANSFERRED✅`);
      } else {
        client.sendMessage(userNum, `❌ Payment status: ${stData.status || "Failed"}`);
        sendAdminAlert(`Airtime Payment Failed\nUser: ${userNum}\nAmount: Ksh ${amt}\nPayer: ${payer}\nStatus: ${stData.status || "Failed"}\nDate: ${dateNow}`);
      }
      delete userStates[userNum];
    }, 20000);
    return;
  }

  // Order status check: "order status FY'S-xxxxx"
  if (lowerBody.startsWith("order status")) {
    const parts = body.split(" ");
    if (parts.length < 3) {
      client.sendMessage(userNum, "❌ Provide order number: order status FY'S-xxxxx");
      return;
    }
    const orderNumber = parts[2].trim();
    if (!orders[orderNumber]) {
      client.sendMessage(userNum, "❌ Order not found.");
      return;
    }
    const ord = orders[orderNumber];
    const orderMsg = parsePlaceholders(botConfig.orderStatusText, {
      orderNumber: ord.orderNumber,
      payer: ord.payer,
      recipient: ord.recipient,
      amount: ord.amount,
      mpesaCode: ord.mpesaCode,
      date: ord.date,
      status: ord.status,
      remark: ord.remark || "None"
    });
    client.sendMessage(userNum, orderMsg);
    return;
  }

  // Fallback for unrecognized commands
  client.sendMessage(userNum, "❓ Unrecognized command. Type 'menu' or 'help' for options.");
});

console.log("WhatsApp Airtime Bot loaded.");
