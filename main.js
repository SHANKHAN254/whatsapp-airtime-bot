"use strict";

const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const axios = require("axios");

// PayHero Auth & Channel
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_CHANNEL_ID = 529;

// Admin phone (no plus, e.g. 254701339573)
const ADMIN_PHONE = "254701339573";

// Airtime API
const AIRTIME_API_KEY = "6HyMVLHJMcBVBIhUKrHyjnakzWrYKYo8wo6hOmdTQV7gdIjbYV";
const AIRTIME_USERNAME = "fysproperty";

// In-memory user state
const userStates = {}; // { userNumber: { stage: string, amount, recipient, etc. } }

// Helper to format phone for STK push if needed
function formatPhoneForSTK(waNumber) {
    // e.g. "2547xxxx@s.whatsapp.net"
    let cleaned = waNumber.replace("@s.whatsapp.net", "");
    // If starts with 07 or 01, convert to 254
    if (/^(07|01)\d{8}$/.test(cleaned)) {
        cleaned = "254" + cleaned.slice(1);
    }
    return cleaned;
}

// Send STK push
async function sendSTKPush(amount, phoneNumber) {
    // phoneNumber must be in "2547..." format
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
        const resp = await axios.post(
            "https://backend.payhero.co.ke/api/v2/payments",
            payload,
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": PAYHERO_AUTH
                }
            }
        );
        return resp.data.reference; 
    } catch (error) {
        console.error("STK Push Error:", error.response ? error.response.data : error);
        return null;
    }
}

// Fetch STK push status
async function fetchSTKStatus(ref) {
    try {
        const resp = await axios.get(
            `https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`,
            {
                headers: {
                    "Authorization": PAYHERO_AUTH
                }
            }
        );
        return resp.data; // e.g. { status: "SUCCESS"|"FAILED"|"QUEUED", ... }
    } catch (error) {
        console.error("Status Fetch Error:", error.response ? error.response.data : error);
        return null;
    }
}

// Buy airtime
async function buyAirtime(recipient, amount) {
    const payload = {
        api_key: AIRTIME_API_KEY,
        username: AIRTIME_USERNAME,
        recipient: recipient, // e.g. "0708344101"
        amount: String(amount)
    };
    try {
        const resp = await axios.post("https://payherokenya.com/sps/portal/app/airtime", payload);
        return resp.data; 
        // Example: { status: true, response: { Status: "Failed", Message: "Account is not yet verified." } }
    } catch (error) {
        console.error("Airtime API Error:", error.response ? error.response.data : error);
        return null;
    }
}

// Admin broadcast command pattern: "msg [2547xxx,2547yyy] message..."
function parseBroadcast(text) {
    const bracketStart = text.indexOf("[");
    const bracketEnd = text.indexOf("]");
    if (bracketStart < 0 || bracketEnd < 0) return null;
    const numbersStr = text.substring(bracketStart+1, bracketEnd).trim();
    const message = text.substring(bracketEnd+1).trim();
    const arr = numbersStr.split(",").map(x => x.trim());
    return { arr, message };
}

// Admin help text
function getAdminHelp() {
    return (
        "Admin Commands:\n" +
        "msg [2547xxx,2547yyy] message => broadcast to multiple numbers\n" +
        "Admin CMD => show this help\n" +
        "etc."
    );
}

// Create client
const client = new Client({
    authStrategy: new LocalAuth()
});

// On QR
client.on("qr", (qr) => {
    qrcode.generate(qr, { small: true });
});

// On ready
client.on("ready", () => {
    console.log("WhatsApp Client is ready!");
});

// On message
client.on("message_create", async (msg) => {
    if (msg.fromMe) return; // ignore outgoing

    const userNumber = msg.from; // e.g. "2547xxx@s.whatsapp.net"
    const text = msg.body.trim().toLowerCase();

    // Check if admin
    const isAdmin = userNumber.includes(ADMIN_PHONE);

    // 1) If admin typed broadcast or "Admin CMD"
    if (isAdmin) {
        if (text.startsWith("msg ")) {
            const data = parseBroadcast(msg.body);
            if (!data) {
                client.sendMessage(userNumber, "Invalid broadcast format. Use: msg [2547xxx,2547yyy] message...");
            } else {
                const { arr, message } = data;
                for (let phone of arr) {
                    const waNumber = phone + "@s.whatsapp.net";
                    try {
                        await client.sendMessage(waNumber, `*Admin Broadcast:*\n${message}`);
                    } catch (e) {
                        await client.sendMessage(userNumber, `Could not send to ${phone}`);
                    }
                }
                client.sendMessage(userNumber, "Broadcast complete.");
            }
            return;
        }

        if (msg.body.trim().toLowerCase() === "admin cmd") {
            client.sendMessage(userNumber, getAdminHelp());
            return;
        }
    }

    // 2) Basic usage
    if (text === "hi" || text === "hello") {
        client.sendMessage(userNumber, "Hello! Type 'menu' to see options or 'help' for commands.");
        return;
    }
    if (text === "help") {
        client.sendMessage(userNumber, 
            "Commands:\nmenu - show main menu\nhelp - show this help\n" +
            "deposit - start deposit flow\nbuy airtime - start airtime flow\n"
        );
        return;
    }
    if (text === "menu") {
        client.sendMessage(userNumber,
            "Main Menu:\n1) Deposit\n2) Buy Airtime\nType 'deposit' or 'buy airtime'."
        );
        return;
    }

    // Deposit flow
    if (text === "deposit") {
        userStates[userNumber] = { stage: "awaitingDepositAmount" };
        client.sendMessage(userNumber, "Please enter the amount to deposit (Ksh).");
        return;
    }

    // Airtime flow
    if (text === "buy airtime") {
        userStates[userNumber] = { stage: "awaitingAirtimeAmount" };
        client.sendMessage(userNumber, "Enter the airtime amount (min 10, max 3000).");
        return;
    }

    // If user is in deposit flow
    if (userStates[userNumber]?.stage === "awaitingDepositAmount") {
        const amt = parseInt(msg.body.trim());
        if (isNaN(amt) || amt <= 0) {
            client.sendMessage(userNumber, "Invalid deposit amount. Enter a positive number.");
            return;
        }
        userStates[userNumber].amount = amt;
        userStates[userNumber].stage = "processingDeposit";

        // Format phone
        const payPhone = formatPhoneForSTK(userNumber);
        const ref = await sendSTKPush(amt, payPhone);
        if (!ref) {
            client.sendMessage(userNumber, "❌ Error initiating STK push. Try later.");
            delete userStates[userNumber];
            return;
        }
        client.sendMessage(userNumber, `Payment initiated. We'll check status in 20s...`);
        setTimeout(async () => {
            const stData = await fetchSTKStatus(ref);
            if (!stData) {
                client.sendMessage(userNumber, "❌ Could not fetch payment status. Please try again.");
                delete userStates[userNumber];
                return;
            }
            const finalStatus = (stData.status || "").toUpperCase();
            if (finalStatus === "SUCCESS") {
                client.sendMessage(userNumber, `🎉 Deposit of Ksh ${amt} successful!`);
                // Alert admin
                client.sendMessage(ADMIN_PHONE + "@s.whatsapp.net", `User ${userNumber} deposited Ksh ${amt} successfully.`);
            } else {
                client.sendMessage(userNumber, `❌ Payment status: ${stData.status || "Failed"}`);
                client.sendMessage(ADMIN_PHONE + "@s.whatsapp.net", `User ${userNumber} deposit failed or pending.`);
            }
            delete userStates[userNumber];
        }, 20000);
        return;
    }

    // If user in airtime flow
    if (userStates[userNumber]?.stage === "awaitingAirtimeAmount") {
        const amt = parseInt(msg.body.trim());
        if (isNaN(amt) || amt < 10 || amt > 3000) {
            client.sendMessage(userNumber, "Invalid airtime amount (min 10, max 3000).");
            return;
        }
        userStates[userNumber].amount = amt;
        userStates[userNumber].stage = "awaitingAirtimeRecipient";
        client.sendMessage(userNumber, "Enter the recipient phone (start with 07 or 01, 10 digits).");
        return;
    }

    if (userStates[userNumber]?.stage === "awaitingAirtimeRecipient") {
        const phone = msg.body.trim();
        if (!/^(07|01)\d{8}$/.test(phone)) {
            client.sendMessage(userNumber, "Invalid phone. Must start 07 or 01, 10 digits total.");
            return;
        }
        const amt = userStates[userNumber].amount;
        userStates[userNumber].recipient = phone;
        userStates[userNumber].stage = "processingAirtimeSTK";

        const payPhone = formatPhoneForSTK(userNumber);
        const ref = await sendSTKPush(amt, payPhone);
        if (!ref) {
            client.sendMessage(userNumber, "❌ Error initiating STK push. Try again later.");
            delete userStates[userNumber];
            return;
        }
        client.sendMessage(userNumber, `Payment initiated for Ksh ${amt}. We'll confirm in 20s...`);
        setTimeout(async () => {
            const stData = await fetchSTKStatus(ref);
            if (!stData) {
                client.sendMessage(userNumber, "❌ Could not fetch payment status. Please try again.");
                delete userStates[userNumber];
                return;
            }
            const finalStatus = (stData.status || "").toUpperCase();
            if (finalStatus === "SUCCESS") {
                client.sendMessage(userNumber, "Payment successful! Sending airtime now...");
                const buyResp = await buyAirtime(userStates[userNumber].recipient, amt);
                if (!buyResp) {
                    client.sendMessage(userNumber, "❌ Error calling airtime API. Contact admin.");
                    client.sendMessage(ADMIN_PHONE + "@s.whatsapp.net", `User ${userNumber} airtime buy error calling API.`);
                } else {
                    if (buyResp.status === true && buyResp.response?.Status === "Success") {
                        client.sendMessage(userNumber, `🎉 Airtime of Ksh ${amt} sent to ${phone} successfully!`);
                        client.sendMessage(ADMIN_PHONE + "@s.whatsapp.net", `User ${userNumber} bought airtime Ksh ${amt} for ${phone}.`);
                    } else {
                        client.sendMessage(userNumber, `❌ Airtime purchase failed: ${buyResp.response?.Message || "Unknown"}`);
                        client.sendMessage(ADMIN_PHONE + "@s.whatsapp.net", `User ${userNumber} airtime purchase failed: ${buyResp.response?.Message}`);
                    }
                }
            } else {
                client.sendMessage(userNumber, `❌ Payment status: ${stData.status || "Failed"}`);
                client.sendMessage(ADMIN_PHONE + "@s.whatsapp.net", `User ${userNumber} airtime payment failed or pending.`);
            }
            delete userStates[userNumber];
        }, 20000);
        return;
    }

    // If unrecognized
    client.sendMessage(userNumber, "Unrecognized command. Type 'menu' or 'help'.");
});

// Provide an admin help on command /admin if from admin phone
function getAdminHelp() {
    return (
        "Admin Commands:\n" +
        "msg [2547xxx,2547yyy] message => broadcast to multiple numbers\n" +
        "Admin CMD => show this help\n" +
        "etc. (Add more as needed)\n"
    );
}
