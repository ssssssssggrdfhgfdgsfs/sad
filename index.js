require('dotenv').config();
const puppeteer = require('puppeteer');
const axios = require('axios');

const CAPSOLVER_KEY = process.env.CAPSOLVER_API_KEY || "CAP-07402409B94CCB22D4BC7F48F4DE29F601DFD0F7BB7C28CF9B5CB29BAEDDF806";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://discord.com/api/webhooks/1498621566274109600/gYEkpZwMsV2KOy7ayjAkSUskfCBaftNdUTiMs6E2dDMPIf6J0GpklAGySgd5OKTbF8Fw";

function randomString(len) {
    return Math.random().toString(36).substring(2, 2+len);
}
function generateUsername() {
    const prefixes = ['Cool', 'Pro', 'Mega', 'Super', 'Fast', 'Epic', 'King', 'Shadow'];
    return prefixes[Math.floor(Math.random() * prefixes.length)] + randomString(5);
}
function generatePassword() {
    return randomString(10) + 'A1!';
}

async function solveCaptcha(page) {
    // Wait for FunCaptcha iframe
    const iframe = await page.waitForSelector('iframe[src*="funcaptcha"]', { timeout: 15000 });
    const frame = await iframe.contentFrame();
    const url = await frame.evaluate(() => window.location.href);
    const pkeyMatch = url.match(/pkey=([^&]+)/);
    const publicKey = pkeyMatch ? pkeyMatch[1] : '476068BF-9607-4799-B53D-966BE98E2B81';
    
    // Create Capsolver task
    const task = {
        clientKey: CAPSOLVER_KEY,
        task: {
            type: 'FunCaptchaTaskProxyless',
            websiteURL: 'https://www.roblox.com/',
            websitePublicKey: publicKey,
            data: '{}'
        }
    };
    let create = await axios.post('https://api.capsolver.com/createTask', task);
    let taskId = create.data.taskId;
    
    // Poll for result
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        let poll = await axios.post('https://api.capsolver.com/getTaskResult', { clientKey: CAPSOLVER_KEY, taskId });
        if (poll.data.status === 'ready') return poll.data.solution.token;
    }
    throw new Error('CAPTCHA timeout');
}

async function createAccount(browser) {
    const page = await browser.newPage();
    const username = generateUsername();
    const password = generatePassword();
    
    try {
        console.log(`[+] Trying: ${username}`);
        await page.goto('https://www.roblox.com/account/signupredir', { waitUntil: 'domcontentloaded', timeout: 20000 });
        
        // Fill form – correct selectors
        await page.waitForSelector('#signup-username', { timeout: 8000 });
        await page.type('#signup-username', username);
        await page.type('#signup-password', password);
        
        // Birthday dropdowns
        await page.select('#MonthDropdown', 'Jan');
        await page.select('#DayDropdown', '15');
        await page.select('#YearDropdown', '2000');
        
        // Click signup button
        await page.click('#signup-button');
        
        // Check for CAPTCHA quickly
        let captchaPresent = false;
        try {
            const iframe = await page.$('iframe[src*="funcaptcha"]');
            if (iframe) captchaPresent = true;
        } catch(e) {}
        
        if (captchaPresent) {
            console.log(`[+] CAPTCHA detected, solving...`);
            const token = await solveCaptcha(page);
            // Inject token and submit
            await page.evaluate((t) => {
                let input = document.querySelector('input[name="captcha-solution"]');
                if (input) input.value = t;
                let form = document.querySelector('form');
                if (form) form.submit();
            }, token);
        } else {
            // No CAPTCHA – just submit the form again
            await page.evaluate(() => { document.querySelector('form')?.submit(); });
        }
        
        // Wait for navigation to home page
        await page.waitForFunction(() => window.location.href.includes('/home'), { timeout: 30000 });
        
        // Extract cookie
        const cookies = await page.cookies();
        const robloxCookie = cookies.find(c => c.name === '.ROBLOSECURITY')?.value;
        if (!robloxCookie) throw new Error('No cookie');
        
        console.log(`[SUCCESS] ${username} | ${password}`);
        return { username, password, cookie: robloxCookie };
    } catch (err) {
        console.error(`[FAIL] ${username}: ${err.message}`);
        return null;
    } finally {
        await page.close();
    }
}

async function sendToDiscord(account) {
    const embed = {
        title: '✅ Roblox Account',
        color: 0x57F287,
        fields: [
            { name: 'Username', value: account.username, inline: true },
            { name: 'Password', value: `||${account.password}||`, inline: true },
            { name: 'Cookie', value: `||${account.cookie}||`, inline: false }
        ]
    };
    try {
        await axios.post(WEBHOOK_URL, { embeds: [embed] });
        console.log(`[+] Webhook sent`);
    } catch(e) { console.error(`Webhook error: ${e.message}`); }
}

async function main() {
    console.log(`🚀 Starting minimalist Roblox generator`);
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    let fails = 0;
    while (true) {
        const account = await createAccount(browser);
        if (account) {
            await sendToDiscord(account);
            fails = 0;
        } else {
            fails++;
            if (fails > 5) {
                console.log(`Too many failures, restarting browser...`);
                await browser.close();
                browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                fails = 0;
            }
        }
        // Very short delay to avoid hammering
        await new Promise(r => setTimeout(r, 1000));
    }
}

main();
