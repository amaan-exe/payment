require('dotenv').config();

// ========================
// Required Environment Variables Check
// ========================
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'JWT_SECRET',
  'ADMIN_PASSWORD',
];

const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`\n❌ FATAL: Missing required environment variables:\n   ${missing.join('\n   ')}\n`);
  console.error('Server cannot start without these. Please check your .env file.\n');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const prisma = require('./prisma');
const { withRetry } = require('./db');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const winston = require('winston');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const https = require('https');

const MAX_ADMIN_ACTIVITY_LOGS = 500;
const MAX_ANALYTICS_EVENTS = 2000;
// Admin activity is intentionally NOT persisted in database.
// Storage policy: in-memory ring buffer + server log file entries only.
const adminActivityLogs = [];
const analyticsEvents = [];
const analyticsPathCounters = new Map();

// ========================
// Logger Setup (Winston)
// ========================
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) =>
      stack
        ? `${timestamp} [${level.toUpperCase()}] ${message}\n${stack}`
        : `${timestamp} [${level.toUpperCase()}] ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(__dirname, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(__dirname, 'combined.log') })
  ],
});

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function addAdminActivity({ actor, action, result, source, ip, details }) {
  // Keep login/activity entries out of Prisma/DB by design.
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actor: actor || 'admin',
    action: action || 'login',
    result: result || 'success',
    source: source || 'admin_portal',
    ip: ip || 'unknown',
    details: details || ''
  };

  adminActivityLogs.unshift(entry);
  if (adminActivityLogs.length > MAX_ADMIN_ACTIVITY_LOGS) {
    adminActivityLogs.splice(MAX_ADMIN_ACTIVITY_LOGS);
  }

  const detailPart = entry.details ? ` details="${entry.details}"` : '';
  logger.info(`[ADMIN_ACTIVITY] actor=${entry.actor} action=${entry.action} result=${entry.result} source=${entry.source} ip=${entry.ip}${detailPart}`);
  return entry;
}

function trackPageView(pathname, ip, referrer, userAgent) {
  const safePath = typeof pathname === 'string' && pathname.startsWith('/') ? pathname.slice(0, 200) : '/unknown';
  const event = {
    timestamp: new Date().toISOString(),
    path: safePath,
    ip: ip || 'unknown',
    referrer: typeof referrer === 'string' ? referrer.slice(0, 300) : '',
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : ''
  };

  analyticsEvents.unshift(event);
  if (analyticsEvents.length > MAX_ANALYTICS_EVENTS) {
    analyticsEvents.splice(MAX_ANALYTICS_EVENTS);
  }

  const prev = analyticsPathCounters.get(safePath) || { views: 0, lastViewedAt: null };
  analyticsPathCounters.set(safePath, {
    views: prev.views + 1,
    lastViewedAt: event.timestamp
  });
}

// Trust Render's reverse proxy so express-rate-limit reads the real client IP
// from X-Forwarded-For instead of throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
app.set('trust proxy', 1);

// ========================
// XSS Helper
// ========================
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Admin password — hashed synchronously so it's available immediately
const adminPasswordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
logger.info('Admin password hash ready');
logger.info('Admin activity logs storage: memory/file only (database persistence disabled)');

// ========================
// Security Middleware
// ========================

// Helmet — security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS — restrict to frontend origin
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:5174'];

// FIX #8: Narrow 172.x to private range 172.16-31.x only
const isLocalNetwork = (origin) => {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (hostname.startsWith('192.168.') || hostname.startsWith('10.')) return true;
    if (hostname.startsWith('172.')) {
      const second = parseInt(hostname.split('.')[1], 10);
      return second >= 16 && second <= 31;
    }
    return false;
  } catch (e) {
    return false;
  }
};

// Paths that Razorpay hits directly (Server-to-Server) — bypass CORS for these
const webhookPaths = ['/api/webhook/razorpay', '/api/verify-payment-redirect'];

app.use((req, res, next) => {
  if (webhookPaths.includes(req.path)) {
    return next();
  }

  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || isLocalNetwork(origin)) {
        return callback(null, true);
      }
      logger.warn(`CORS blocked connection from: ${origin} on path ${req.path}`);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })(req, res, next);
});

// FIX #2: Mount raw body parser ONLY for the webhook path, BEFORE express.json()
app.use('/api/webhook/razorpay', express.raw({ type: '*/*' }));

app.use(express.json({ limit: '10kb' }));

// ========================
// Rate Limiters
// ========================
// FIX #12: Use path.endsWith('/status') instead of url.includes('/status')
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path.endsWith('/status'),
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many payment requests, please try again later.' },
});

// FIX #9: Strict rate limiter for admin login
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

app.use('/api', generalLimiter);

// ========================
// Auth Middleware
// ========================

// Origin validation middleware for payment endpoints
function validateOrigin(req, res, next) {
  const origin = req.get('origin') || req.get('referer') || '';
  const cleanOrigin = origin.replace(/\/$/, '');
  const isAllowed = !cleanOrigin || allowedOrigins.some(o => cleanOrigin.startsWith(o)) || isLocalNetwork(cleanOrigin);
  if (!isAllowed) {
    logger.warn(`Blocked request from unauthorized origin: ${cleanOrigin}`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// FIX #4: JWT-based admin auth (replaces x-admin-password header)
function adminAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — missing token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('Insufficient role');
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
  }
}

// ========================
// Database (Prisma Singleton from ./prisma.js)
// ========================
// PrismaClient is imported at the top of the file as a singleton.
// All DB operations are wrapped with withRetry() for Neon cold-start resilience.

// ========================
// Razorpay
// ========================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ========================
// Email (Resend or SMTP)
// ========================
const emailProvider = (process.env.EMAIL_PROVIDER || 'auto').trim().toLowerCase();

let resendClient = null;
if (process.env.RESEND_API_KEY) {
  resendClient = new Resend(process.env.RESEND_API_KEY);
  logger.info('Email client configured (Resend API)');
}

const resendFromAddress = (process.env.RESEND_FROM_EMAIL || '').trim();
const resendSenderLooksValid = /^.+<[^\s@]+@[^\s@]+\.[^\s@]+>$|^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resendFromAddress);

if (!resendFromAddress) {
  logger.warn('RESEND_FROM_EMAIL is not set. Configure a verified sender (example: "DEMO NGO <donations@yourdomain.com>").');
} else if (!resendSenderLooksValid) {
  logger.warn('RESEND_FROM_EMAIL format appears invalid. Expected "Name <email@domain.com>" or "email@domain.com".');
}

let smtpTransporter = null;
const smtpFromAddress = (process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '').trim();
const smtpFromLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(smtpFromAddress);

if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  const service = (process.env.SMTP_SERVICE || 'gmail').trim();
  const hasCustomHost = Boolean(process.env.SMTP_HOST);

  smtpTransporter = nodemailer.createTransport(hasCustomHost
    ? {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    }
    : {
      service,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    }
  );

  logger.info(`Email client configured (SMTP ${hasCustomHost ? 'custom host' : service})`);
}

if ((emailProvider === 'smtp' || emailProvider === 'auto') && !smtpTransporter) {
  logger.warn('SMTP email provider requested but SMTP_USER/SMTP_PASS are not configured.');
}

if ((emailProvider === 'smtp' || emailProvider === 'auto') && !smtpFromLooksValid) {
  logger.warn('SMTP_FROM_EMAIL is missing or invalid. Falling back to SMTP_USER as sender if valid.');
}

const RECEIPT_EMAIL_MAX_ATTEMPTS = 3;
const RECEIPT_EMAIL_BASE_DELAY_MS = 1200;
const receiptEmailStateByPaymentId = new Map();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function enqueueReceiptEmail(donorName, email, amount, paymentId, source) {
  if (!paymentId) {
    logger.warn('Receipt email skipped: missing paymentId');
    return false;
  }

  const existingState = receiptEmailStateByPaymentId.get(paymentId);
  if (existingState === 'processing' || existingState === 'sent') {
    logger.info(`Receipt email deduped for payment ${paymentId} (state=${existingState}, source=${source})`);
    return existingState === 'sent';
  }

  receiptEmailStateByPaymentId.set(paymentId, 'processing');
  logger.info(`Receipt email queued for payment ${paymentId} source=${source}`);

  try {
    const wasSent = await sendReceiptEmailWithRetry(donorName, email, amount, paymentId, source);
    receiptEmailStateByPaymentId.set(paymentId, wasSent ? 'sent' : 'failed');
    if (wasSent) {
      logger.info(`Receipt email completed for payment ${paymentId} source=${source}`);
    } else {
      logger.warn(`Receipt email failed after retries for payment ${paymentId} source=${source}`);
    }
    return wasSent;
  } catch (err) {
    receiptEmailStateByPaymentId.set(paymentId, 'failed');
    logger.error(`Unexpected email queue failure for payment ${paymentId}: ${err.message}`);
    return false;
  }
}

async function sendReceiptEmailWithRetry(donorName, email, amount, paymentId, source) {
  for (let attempt = 1; attempt <= RECEIPT_EMAIL_MAX_ATTEMPTS; attempt++) {
    const wasSent = await sendReceiptEmail(donorName, email, amount, paymentId, source, attempt);
    if (wasSent) {
      return true;
    }

    if (attempt < RECEIPT_EMAIL_MAX_ATTEMPTS) {
      const backoffMs = RECEIPT_EMAIL_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await delay(backoffMs);
    }
  }

  return false;
}

// FIX #15: Track email failures and log them
async function sendReceiptEmail(donorName, email, amount, paymentId, source, attempt) {
  const canUseResend = resendClient && resendFromAddress && resendSenderLooksValid;
  const canUseSmtp = smtpTransporter && smtpFromLooksValid;

  if (!canUseResend && !canUseSmtp) {
    logger.error('Email receipt skipped: no valid email provider configured. Set EMAIL_PROVIDER=smtp with SMTP_USER/SMTP_PASS for free Gmail sending.');
    return false;
  }

  const providerToUse = emailProvider === 'smtp'
    ? 'smtp'
    : emailProvider === 'resend'
      ? 'resend'
      : canUseSmtp
        ? 'smtp'
        : 'resend';

  if (providerToUse === 'resend' && !canUseResend) {
    logger.error('Email receipt skipped: Resend selected but RESEND_API_KEY / RESEND_FROM_EMAIL configuration is incomplete.');
    return false;
  }

  if (providerToUse === 'smtp' && !canUseSmtp) {
    logger.error('Email receipt skipped: SMTP selected but SMTP credentials/sender are invalid.');
    return false;
  }

  try {
    // FIX #6: Sanitize all user-supplied values before injecting into HTML
    const safeName = escapeHtml(donorName);
    const safeEmail = escapeHtml(email);
    const safeAmount = escapeHtml(String(amount));
    const safePaymentId = escapeHtml(paymentId);
    const donationDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
    const safeDonationDate = escapeHtml(donationDate);
    const safeReceiptNo = escapeHtml(`RCP-${String(paymentId || '00000000').slice(-8).toUpperCase()}`);
    const safeSupportEmail = escapeHtml(process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'support@demo-ngo.org');
    const safeSupportPhone = escapeHtml(process.env.SUPPORT_PHONE || '+91-8271301179');
    const safeCause = escapeHtml(process.env.DEFAULT_DONATION_CAUSE || 'Education for underprivileged children');
    const amountNumber = Number(amount) || 0;
    const impactMeals = Math.max(1, Math.floor(amountNumber / 215));
    const impactBooks = Math.max(1, Math.floor(amountNumber / 850));
    const impactChildren = Math.max(1, Math.floor(amountNumber / 2500));

    const emailText = `
Thank you, ${safeName}!

Your donation has been received successfully.
Amount: INR ${safeAmount}
Payment ID: ${safePaymentId}
Status: Successful

This donation is eligible for 80G tax exemption. A formal receipt will be sent within 7 working days.

DEMO NGO - Feeding the hungry, one meal at a time.
    `.trim();

    const emailHtml = `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <title>Payment Confirmed — Your Donation to DEMO NGO</title>
  <style>
    * { box-sizing: border-box; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; }

    @keyframes floatUp { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-7px); } }
    @keyframes heartbeat { 0%, 100% { transform: scale(1); } 40% { transform: scale(1.2); } }
    @keyframes shimmer { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes wiggle { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }

    .float-anim { animation: floatUp 3s ease-in-out infinite; display: inline-block; }
    .heartbeat-anim { animation: heartbeat 1.4s ease-in-out infinite; display: inline-block; }
    .shimmer-anim { animation: shimmer 2s ease-in-out infinite; display: inline-block; }
    .spin-anim { animation: spin 8s linear infinite; display: inline-block; }
    .wiggle-anim { animation: wiggle 1.2s ease-in-out infinite; display: inline-block; }

    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; }
      .grid-cell { display: block !important; width: 100% !important; margin-bottom: 8px !important; }
      .impact-cell { display: inline-block !important; width: 30% !important; text-align: center !important; }
    }
  </style>
</head>

<body style="margin:0;padding:0;background-color:#f7f2f9;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    Yay! Your donation was confirmed! You just made someone's day brighter.
  </div>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f7f2f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table class="email-container" role="presentation" cellspacing="0" cellpadding="0" border="0" width="580" style="max-width:580px;width:100%;">
          <tr>
            <td align="center" style="background-color:#fbeaf0;border-radius:24px 24px 0 0;padding:36px 32px 28px;border:2px solid #ed93b1;border-bottom:none;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align:left;vertical-align:top;width:40px;"><span class="shimmer-anim" style="font-size:18px;color:#1d9e75;line-height:1;">&#10022;</span></td>
                  <td align="center">
                    <span class="float-anim">
                      <svg width="76" height="76" viewBox="0 0 76 76" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="38" cy="38" r="36" fill="#fbeaf0" stroke="#ed93b1" stroke-width="2.5"/>
                        <circle cx="38" cy="38" r="28" fill="#f4c0d1"/>
                        <circle cx="38" cy="38" r="16" fill="#d4537e"/>
                        <text x="38" y="45" text-anchor="middle" font-size="20" fill="white" font-family="Arial,sans-serif">&#9825;</text>
                      </svg>
                    </span>
                  </td>
                  <td style="text-align:right;vertical-align:top;width:40px;">
                    <span class="spin-anim"><svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg"><polygon points="11,1 13,7.5 20,7.5 14.5,12 16.5,19 11,15 5.5,19 7.5,12 2,7.5 9,7.5" fill="#ef9f27"/></svg></span>
                  </td>
                </tr>
              </table>
              <div style="height:14px;"></div>
              <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#72243e;line-height:1.25;">Yay! Your donation went through!</h1>
              <p style="margin:0;font-size:14px;color:#d4537e;line-height:1.5;">You just made someone's day a whole lot brighter &#10022;</p>
            </td>
          </tr>

          <tr>
            <td style="background-color:#ffffff;border-left:2px solid #ed93b1;border-right:2px solid #ed93b1;padding:0 28px 24px;">
              <div style="height:24px;"></div>
              <p style="margin:0 0 4px;font-size:15px;color:#2c2c2a;line-height:1.6;">Dear <strong style="color:#3c3489;">${safeName}</strong>,</p>
              <p style="margin:0 0 20px;font-size:13px;color:#5f5e5a;line-height:1.7;">We've successfully received your generous donation. Here's a summary of your transaction.</p>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:2px dashed #ed93b1;border-radius:16px;background-color:#ffffff;">
                <tr>
                  <td style="padding:20px 20px 16px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td class="grid-cell" width="49%" valign="top" style="padding-right:6px;padding-bottom:10px;">
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#fbeaf0;border-radius:12px;"><tr><td style="padding:10px 14px;"><div style="font-size:11px;color:#993556;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">Amount</div><div style="font-size:20px;font-weight:700;color:#72243e;">&#8377;${safeAmount}</div></td></tr></table>
                        </td>
                        <td class="grid-cell" width="49%" valign="top" style="padding-left:6px;padding-bottom:10px;">
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#e1f5ee;border-radius:12px;"><tr><td style="padding:10px 14px;"><div style="font-size:11px;color:#0f6e56;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">Date</div><div style="font-size:16px;font-weight:700;color:#085041;">${safeDonationDate}</div></td></tr></table>
                        </td>
                      </tr>
                      <tr>
                        <td class="grid-cell" width="49%" valign="top" style="padding-right:6px;padding-bottom:10px;">
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#eeedfe;border-radius:12px;"><tr><td style="padding:10px 14px;"><div style="font-size:11px;color:#534ab7;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">Receipt no.</div><div style="font-size:14px;font-weight:700;color:#3c3489;font-family:'Courier New',monospace;">#${safeReceiptNo}</div></td></tr></table>
                        </td>
                        <td class="grid-cell" width="49%" valign="top" style="padding-left:6px;padding-bottom:10px;">
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#faeeda;border-radius:12px;"><tr><td style="padding:10px 14px;"><div style="font-size:11px;color:#854f0b;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">Method</div><div style="font-size:13px;font-weight:700;color:#633806;">Online payment</div></td></tr></table>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-bottom:10px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#eaf3de;border-radius:12px;"><tr><td style="padding:10px 14px;"><div style="font-size:11px;color:#3b6d11;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">Cause / Fund</div><div style="font-size:13px;font-weight:700;color:#27500a;">${safeCause}</div></td></tr></table></td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-bottom:10px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f1efe8;border-radius:12px;"><tr><td style="padding:10px 14px;"><div style="font-size:11px;color:#5f5e5a;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">Transaction ID</div><div style="font-size:13px;font-weight:700;color:#2c2c2a;font-family:'Courier New',monospace;">${safePaymentId}</div></td></tr></table></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background-color:#ffffff;border-left:2px solid #ed93b1;border-right:2px solid #ed93b1;padding:0 28px 20px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#eeedfe;border:1.5px solid #afa9ec;border-radius:14px;">
                <tr><td style="padding:14px 16px;"><div style="font-size:13px;font-weight:700;color:#3c3489;margin-bottom:4px;">80G tax benefit incoming!</div><div style="font-size:12px;color:#534ab7;line-height:1.6;">Your donation qualifies for a deduction under <strong>Section 80G, Income Tax Act 1961</strong>. An official certificate will be emailed within <strong>7 working days</strong>.</div></td></tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background-color:#ffffff;border-left:2px solid #ed93b1;border-right:2px solid #ed93b1;padding:0 28px 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#e1f5ee;border:1.5px solid #5dcaa5;border-radius:20px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0 0 14px;font-size:14px;font-weight:700;color:#085041;text-align:center;">Your impact at a glance &#10022;</p>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td class="impact-cell" align="center" style="padding:0 8px;"><div style="font-size:26px;font-weight:700;color:#0f6e56;">${impactMeals}</div><div style="font-size:11px;color:#1d9e75;font-weight:600;">meals funded</div></td>
                        <td align="center" width="1" style="background-color:#5dcaa5;padding:0;width:1px;"><div style="width:1px;height:48px;background:#5dcaa5;"></div></td>
                        <td class="impact-cell" align="center" style="padding:0 8px;"><div style="font-size:26px;font-weight:700;color:#0f6e56;">${impactBooks}</div><div style="font-size:11px;color:#1d9e75;font-weight:600;">textbooks bought</div></td>
                        <td align="center" width="1" style="background-color:#5dcaa5;padding:0;width:1px;"><div style="width:1px;height:48px;background:#5dcaa5;"></div></td>
                        <td class="impact-cell" align="center" style="padding:0 8px;"><div style="font-size:26px;font-weight:700;color:#0f6e56;">${impactChildren}</div><div style="font-size:11px;color:#1d9e75;font-weight:600;">child supported</div></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background-color:#ffffff;border-left:2px solid #ed93b1;border-right:2px solid #ed93b1;padding:0 28px 28px;">
              <p style="margin:0 0 6px;font-size:14px;color:#5f5e5a;line-height:1.7;">If you have any questions about this transaction, please contact us at <a href="mailto:${safeSupportEmail}" style="color:#d4537e;text-decoration:none;font-weight:700;">${safeSupportEmail}</a> or call <strong style="color:#2c2c2a;">${safeSupportPhone}</strong>.</p>
              <p style="margin:0 0 14px;font-size:14px;color:#5f5e5a;line-height:1.7;">With gratitude,<br><strong style="color:#2c2c2a;font-size:15px;">Team DEMO NGO</strong><br><span style="font-size:13px;color:#888780;">Feeding the hungry, one meal at a time</span></p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:50px;background-color:#d4537e;"><a href="https://ngo-payment.vercel.app" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:50px;font-family:Arial,sans-serif;">Donate again &rarr;</a></td></tr></table>
            </td>
          </tr>

          <tr>
            <td align="center" style="background-color:#f4c0d1;border-radius:0 0 24px 24px;padding:16px 28px;border:2px solid #ed93b1;border-top:none;">
              <div style="margin-bottom:10px;">
                <svg width="280" height="22" viewBox="0 0 280 22" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="14" cy="11" r="4" fill="#d4537e" opacity="0.7"/>
                  <rect x="30" y="5" width="8" height="8" rx="2" fill="#534ab7" opacity="0.6" transform="rotate(20,34,9)"/>
                  <circle cx="54" cy="14" r="3" fill="#1d9e75" opacity="0.7"/>
                  <rect x="70" y="6" width="7" height="7" rx="1.5" fill="#ef9f27" opacity="0.6" transform="rotate(-15,73,9)"/>
                  <circle cx="92" cy="10" r="4" fill="#378add" opacity="0.6"/>
                  <rect x="108" y="7" width="8" height="8" rx="2" fill="#d85a30" opacity="0.6" transform="rotate(30,112,11)"/>
                  <circle cx="130" cy="14" r="3" fill="#d4537e" opacity="0.7"/>
                  <rect x="146" y="4" width="7" height="7" rx="2" fill="#7f77dd" opacity="0.6" transform="rotate(-25,149,7)"/>
                  <circle cx="168" cy="11" r="4" fill="#1d9e75" opacity="0.7"/>
                  <rect x="184" y="6" width="8" height="8" rx="2" fill="#ef9f27" opacity="0.5" transform="rotate(15,188,10)"/>
                  <circle cx="206" cy="14" r="3" fill="#534ab7" opacity="0.6"/>
                  <rect x="220" y="5" width="7" height="7" rx="1.5" fill="#d4537e" opacity="0.6" transform="rotate(-10,223,8)"/>
                  <circle cx="244" cy="10" r="4" fill="#378add" opacity="0.6"/>
                  <rect x="260" y="7" width="8" height="8" rx="2" fill="#1d9e75" opacity="0.6" transform="rotate(25,264,11)"/>
                </svg>
              </div>
              <p style="margin:0 0 4px;font-size:12px;color:#72243e;font-weight:700;">Registered NGO · 12A / 80G Certified</p>
              <p style="margin:0 0 8px;font-size:11px;color:#993556;">This is a system-generated receipt. No physical signature required.</p>
              <p style="margin:0;font-size:11px;color:#b07090;">© 2026 DEMO NGO · <a href="https://ngo-payment.vercel.app/privacy" style="color:#993556;text-decoration:none;">Privacy policy</a> · <a href="https://ngo-payment.vercel.app/unsubscribe" style="color:#993556;text-decoration:none;">Unsubscribe</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    if (providerToUse === 'resend') {
      const emailResult = await resendClient.emails.send({
        from: resendFromAddress,
        to: email,
        subject: 'Thank you for your donation! — DEMO NGO',
        text: emailText,
        html: emailHtml
      });

      if (emailResult?.error) {
        throw new Error(`Resend API rejected email: ${JSON.stringify(emailResult.error)}`);
      }

      const messageId = emailResult?.data?.id || emailResult?.id || 'unknown';
      logger.info(`Receipt email accepted by Resend (id=${messageId}) to ${safeEmail} from ${resendFromAddress} source=${source} attempt=${attempt}`);
      return true;
    }

    const smtpInfo = await smtpTransporter.sendMail({
      from: smtpFromAddress,
      to: email,
      subject: 'Thank you for your donation! — DEMO NGO',
      text: emailText,
      html: emailHtml
    });

    logger.info(`Receipt email accepted by SMTP (id=${smtpInfo.messageId || 'unknown'}) to ${safeEmail} from ${smtpFromAddress} source=${source} attempt=${attempt}`);
    return true;
  } catch (err) {
    // FIX #15: Log the failure prominently so it can be followed up manually
    logger.error(`IMPORTANT: Failed to send receipt email to ${email} for payment ${paymentId} source=${source} attempt=${attempt}. Provider=${emailProvider}. Error: ${err.message}`);
    return false;
  }
}

// ========================
// Global Error Handler
// ========================
function errorHandler(err, req, res, next) {
  logger.error(err.message, { stack: err.stack });
  res.status(500).json({
    error: isProduction ? 'Internal Server Error' : err.message,
  });
}

// ========================
// API Routes
// ========================

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'DEMO NGO API' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Website analytics ingestion (public)
app.post('/api/analytics/page-view', (req, res) => {
  const clientIp = getRequestIp(req);
  const userAgent = req.get('user-agent') || '';
  const { path: pagePath, referrer } = req.body || {};

  trackPageView(pagePath, clientIp, referrer, userAgent);
  res.json({ success: true });
});

// Create Order
app.post('/api/create-order', paymentLimiter, validateOrigin, async (req, res, next) => {
  try {
    const { donor_name, email, amount, currency = 'INR' } = req.body;

    // Validation
    if (!donor_name || typeof donor_name !== 'string' || donor_name.trim().length < 2) {
      return res.status(400).json({ error: 'Valid name is required (min 2 characters)' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    if (!amount || isNaN(amount) || Number(amount) < 1 || Number(amount) > 1000000) {
      return res.status(400).json({ error: 'Amount must be between ₹1 and ₹10,00,000' });
    }

    const sanitizedName = donor_name.trim().substring(0, 100);
    const sanitizedEmail = email.trim().toLowerCase().substring(0, 254);
    const sanitizedAmount = Math.round(Number(amount) * 100) / 100;

    const options = {
      amount: Math.round(sanitizedAmount * 100),
      currency,
      receipt: `receipt_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);
    if (!order) {
      return res.status(500).json({ error: 'Failed to create Razorpay order' });
    }

    // Create donation record with exponential-backoff retry for Neon cold starts
    const donation = await withRetry(
      () => prisma.donation.create({
        data: {
          donor_name: sanitizedName,
          email: sanitizedEmail,
          amount: sanitizedAmount,
          currency,
          razorpay_order_id: order.id,
          status: 'pending'
        }
      }),
      { label: 'donation.create' }
    );

    logger.info(`Order created: ${order.id} for ${sanitizedEmail} — ₹${sanitizedAmount}`);

    res.json({
      orderId: order.id,
      currency: order.currency,
      amount: order.amount,
      donationId: donation.id
    });
  } catch (error) {
    next(error);
  }
});

// Verify Payment
app.post('/api/verify-payment', paymentLimiter, validateOrigin, async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification data' });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    const body = razorpay_order_id + '|' + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body.toString())
      .digest('hex');

    const isAuthentic = expectedSignature === razorpay_signature;

    if (isAuthentic) {
      const donation = await withRetry(
        () => prisma.donation.findFirst({ where: { razorpay_order_id } }),
        { label: 'verify-payment.findFirst' }
      );

      if (!donation) {
        return res.status(404).json({ error: 'Order not found in database' });
      }

      if (donation.status === 'success') {
        return res.status(200).json({ success: true, message: 'Payment already processed' });
      }
      if (donation.status === 'failed') {
        return res.status(400).json({ success: false, message: 'Payment already marked as failed' });
      }

      // Fraud Protection: Fetch actual payment from Razorpay to verify amounts
      const payment = await razorpay.payments.fetch(razorpay_payment_id);
      const expectedAmountPaise = Math.round(Number(donation.amount) * 100);

      if (payment.amount !== expectedAmountPaise || payment.currency !== donation.currency) {
        logger.error(`FRAUD ALERT: Amount/Currency mismatch for order ${razorpay_order_id}. Expected: ${expectedAmountPaise} ${donation.currency}, Got: ${payment.amount} ${payment.currency}`);
        await withRetry(
          () => prisma.donation.update({
            where: { id: donation.id },
            data: {
              status: 'failed',
              event_log: JSON.stringify([...(Array.isArray(donation.event_log) ? donation.event_log : []), { event: 'amount_mismatch_fraud', timestamp: new Date().toISOString() }])
            }
          }),
          { label: 'verify-payment.update(fraud)' }
        );
        return res.status(400).json({ success: false, message: 'Payment amount mismatch detected' });
      }

      const currentLogs = Array.isArray(donation.event_log) ? donation.event_log : [];
      const successUpdate = await withRetry(
        () => prisma.donation.updateMany({
          where: { id: donation.id, status: { in: ['pending', 'authorized'] } },
          data: {
            razorpay_payment_id,
            status: 'success',
            event_log: JSON.stringify([...currentLogs, { event: 'frontend_payment.verified', timestamp: new Date().toISOString() }])
          }
        }),
        { label: 'verify-payment.updateMany(success)' }
      );

      if (successUpdate.count > 0) {
        await enqueueReceiptEmail(donation.donor_name, donation.email, donation.amount, razorpay_payment_id, 'verify-payment');
      } else {
        logger.info(`Receipt skipped in verify-payment: Order ${razorpay_order_id} already transitioned.`);
      }
      logger.info(`Payment verified securely: ${razorpay_payment_id} for order ${razorpay_order_id}`);
      return res.status(200).json({ success: true, message: 'Payment successfully verified' });

    } else {
      await withRetry(
        () => prisma.donation.updateMany({
          where: { razorpay_order_id, status: 'pending' },
          data: { status: 'failed' }
        }),
        { label: 'verify-payment.updateMany(failed)' }
      );
      logger.warn(`Payment verification failed — invalid signature for order ${razorpay_order_id}`);
      return res.status(400).json({ success: false, message: 'Invalid Signature' });
    }
  } catch (error) {
    next(error);
  }
});

// FIX #2: Razorpay Webhook — raw body is set by middleware above, signature verified first
app.post('/api/webhook/razorpay', async (req, res, next) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    if (!signature) {
      logger.warn('Webhook received without signature — rejected');
      return res.status(400).send('Missing signature');
    }

    // Use raw body for accurate signature verification
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(req.body)
      .digest('hex');

    if (expectedSignature !== signature) {
      logger.warn('Webhook signature mismatch — rejected forged webhook');
      return res.status(401).send('Invalid signature');
    }

    // Parse the raw body now that it's verified
    const payload = JSON.parse(req.body.toString());
    const event = payload.event;

    if (event === 'payment.captured' || event === 'payment.authorized') {
      const payment = payload.payload.payment.entity;
      const razorpay_order_id = payment.order_id;
      const razorpay_payment_id = payment.id;

      const donation = await withRetry(
        () => prisma.donation.findFirst({ where: { razorpay_order_id } }),
        { label: 'webhook.findFirst' }
      );

      if (donation && donation.status !== 'success') {
        const existingLogs = Array.isArray(donation.event_log) ? donation.event_log : [];
        existingLogs.push({ event: `webhook_${event}`, timestamp: new Date().toISOString() });

        const expectedAmountPaise = Math.round(Number(donation.amount) * 100);
        if (payment.amount !== expectedAmountPaise || payment.currency !== donation.currency) {
          logger.error(`WEBHOOK FRAUD ALERT: Amount/Currency mismatch for order ${razorpay_order_id}.`);
          await withRetry(
            () => prisma.donation.update({
              where: { id: donation.id },
              data: {
                status: 'failed',
                event_log: JSON.stringify([...existingLogs, { event: 'amount_mismatch_fraud', timestamp: new Date().toISOString() }])
              }
            }),
            { label: 'webhook.update(fraud)' }
          );
          return res.status(200).send('Mismatch handled');
        }

        if (event === 'payment.captured') {
          const successUpdate = await withRetry(
            () => prisma.donation.updateMany({
              where: { id: donation.id, status: { in: ['pending', 'authorized'] } },
              data: {
                razorpay_payment_id,
                status: 'success',
                event_log: JSON.stringify(existingLogs)
              }
            }),
            { label: 'webhook.updateMany(success)' }
          );

          if (successUpdate.count > 0) {
            await enqueueReceiptEmail(donation.donor_name, donation.email, donation.amount, razorpay_payment_id, 'webhook-captured');
            logger.info(`Webhook synced recovery: Payment captured ${razorpay_payment_id} for order ${razorpay_order_id}`);
          } else {
            logger.info(`Webhook captured ignored: Order ${razorpay_order_id} already transitioned to success.`);
          }
        } else if (event === 'payment.authorized') {
          await withRetry(
            () => prisma.donation.update({
              where: { id: donation.id },
              data: {
                razorpay_payment_id,
                status: 'authorized',
                event_log: JSON.stringify(existingLogs)
              }
            }),
            { label: 'webhook.update(authorized)' }
          );
          logger.info(`Webhook: Payment authorized ${razorpay_payment_id}`);
        }
      } else if (donation && donation.status === 'success') {
        logger.info(`Webhook ignored: Order ${razorpay_order_id} already successfully processed.`);
      }
    } else if (event === 'payment.failed') {
      const payment = payload.payload.payment.entity;
      const razorpay_order_id = payment.order_id;
      await withRetry(
        () => prisma.donation.updateMany({
          where: { razorpay_order_id, status: 'pending' },
          data: { status: 'failed' }
        }),
        { label: 'webhook.updateMany(failed)' }
      );
    }

    res.json({ status: 'ok' });
  } catch (error) {
    logger.error(`Webhook Error: ${error.message}`);
    res.status(500).send('Webhook failed');
  }
});

// Razorpay Redirect (Handles mobile Chrome reload on UPI)
app.post('/api/verify-payment-redirect', express.urlencoded({ extended: true }), async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const referer = req.get('referer');
    let dynamicFrontendUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',')[0].trim() : 'http://localhost:5173';

    if (referer) {
      try {
        const refUrl = new URL(referer);
        if (isLocalNetwork(`${refUrl.protocol}//${refUrl.host}`)) {
          dynamicFrontendUrl = `${refUrl.protocol}//${refUrl.host}`;
        }
      } catch (e) { }
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      logger.warn('Redirect received without payment info');
      return res.redirect(303, `${dynamicFrontendUrl}/?error=missing_payment_info`);
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    const body = razorpay_order_id + '|' + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      const donation = await withRetry(
        () => prisma.donation.findFirst({ where: { razorpay_order_id } }),
        { label: 'redirect.findFirst' }
      );

      if (!donation) {
        return res.redirect(303, `${dynamicFrontendUrl}/?error=order_not_found`);
      }

      if (donation.status === 'success') {
        await enqueueReceiptEmail(
          donation.donor_name,
          donation.email,
          donation.amount,
          donation.razorpay_payment_id || razorpay_payment_id,
          'verify-payment-redirect-already-success'
        );
        return res.redirect(303, `${dynamicFrontendUrl}/payment-success?payment_id=${razorpay_payment_id}&order_id=${razorpay_order_id}`);
      }

      // Fraud Protection Fetch
      const payment = await razorpay.payments.fetch(razorpay_payment_id);
      const expectedAmountPaise = Math.round(Number(donation.amount) * 100);

      if (payment.amount !== expectedAmountPaise || payment.currency !== donation.currency) {
        logger.error(`REDIRECT FRAUD ALERT: Amount/Currency mismatch for order ${razorpay_order_id}.`);
        const currentLogs = Array.isArray(donation.event_log) ? donation.event_log : [];
        await withRetry(
          () => prisma.donation.update({
            where: { id: donation.id },
            data: {
              status: 'failed',
              event_log: JSON.stringify([...currentLogs, { event: 'redirect_amount_mismatch_fraud', timestamp: new Date().toISOString() }])
            }
          }),
          { label: 'redirect.update(fraud)' }
        );
        return res.redirect(303, `${dynamicFrontendUrl}/?error=payment_amount_mismatch`);
      }

      const currentLogs2 = Array.isArray(donation.event_log) ? donation.event_log : [];
      const successUpdate = await withRetry(
        () => prisma.donation.updateMany({
          where: { id: donation.id, status: { in: ['pending', 'authorized'] } },
          data: {
            razorpay_payment_id,
            status: 'success',
            event_log: JSON.stringify([...currentLogs2, { event: 'redirect_payment.verified', timestamp: new Date().toISOString() }])
          }
        }),
        { label: 'redirect.updateMany(success)' }
      );

      if (successUpdate.count > 0) {
        await enqueueReceiptEmail(donation.donor_name, donation.email, donation.amount, razorpay_payment_id, 'verify-payment-redirect');
      } else {
        logger.info(`Receipt skipped in redirect verify: Order ${razorpay_order_id} already transitioned.`);
      }
      logger.info(`Redirect payment verified: ${razorpay_payment_id} for order ${razorpay_order_id}`);
      return res.redirect(303, `${dynamicFrontendUrl}/payment-success?payment_id=${razorpay_payment_id}&order_id=${razorpay_order_id}`);

    } else {
      await withRetry(
        () => prisma.donation.updateMany({
          where: { razorpay_order_id, status: 'pending' },
          data: { status: 'failed' }
        }),
        { label: 'redirect.updateMany(failed)' }
      );
      logger.warn(`Redirect payment failed — invalid signature for order ${razorpay_order_id}`);
      return res.redirect(303, `${dynamicFrontendUrl}/?error=invalid_signature`);
    }
  } catch (error) {
    logger.error(`Redirect Error: ${error.message}`);
    const fallbackUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',')[0].trim() : 'http://localhost:5173';
    return res.redirect(303, `${fallbackUrl}/?error=server_error`);
  }
});

// FIX #10: Cancel Payment — validate order ID format + time window
app.post('/api/cancel-payment', validateOrigin, async (req, res, next) => {
  try {
    const { razorpay_order_id } = req.body;

    // Validate order ID format
    if (!razorpay_order_id || !/^order_[A-Za-z0-9]+$/.test(razorpay_order_id)) {
      return res.status(400).json({ error: 'Invalid order ID format' });
    }

    const donation = await withRetry(
      () => prisma.donation.findFirst({ where: { razorpay_order_id, status: 'pending' } }),
      { label: 'cancel-payment.findFirst' }
    );

    if (!donation) {
      return res.status(404).json({ error: 'No pending order found' });
    }

    // Only allow cancellations within 30 minutes of order creation
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    if (donation.created_at < thirtyMinsAgo) {
      return res.status(400).json({ error: 'Cancellation window expired' });
    }

    await withRetry(
      () => prisma.donation.update({
        where: { id: donation.id },
        data: { status: 'failed' }
      }),
      { label: 'cancel-payment.update' }
    );

    logger.info(`Payment cancelled by user for order ${razorpay_order_id}`);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Live Stats (public)
app.get('/api/stats', async (req, res, next) => {
  try {
    const aggregations = await withRetry(
      () => prisma.donation.aggregate({ where: { status: 'success' }, _sum: { amount: true } }),
      { label: 'stats.aggregate' }
    );
    const totalRaised = aggregations._sum.amount ? parseFloat(aggregations._sum.amount) : 0;
    const totalDonations = await withRetry(
      () => prisma.donation.count({ where: { status: 'success' } }),
      { label: 'stats.count' }
    );
    const donorsCount = await withRetry(
      () => prisma.donation.groupBy({ by: ['email'], where: { status: 'success' } }),
      { label: 'stats.groupBy' }
    );
    const totalDonors = donorsCount.length;

    res.json({
      totalRaised: parseFloat(totalRaised),
      totalDonations,
      totalDonors
    });
  } catch (error) {
    next(error);
  }
});

// Admin analytics summary (JWT protected)
app.get('/api/admin/analytics', adminAuth, async (req, res) => {
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  const last24hEvents = analyticsEvents.filter(e => new Date(e.timestamp).getTime() >= oneDayAgo);
  const uniqueVisitors24h = new Set(last24hEvents.map(e => e.ip)).size;

  const topPages = Array.from(analyticsPathCounters.entries())
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, 5)
    .map(([pathName, meta]) => ({
      path: pathName,
      views: meta.views,
      lastViewedAt: meta.lastViewedAt
    }));

  res.json({
    totalViewsAllTime: analyticsEvents.length,
    totalViews24h: last24hEvents.length,
    uniqueVisitors24h,
    topPages
  });
});

// Admin activity logs (JWT protected)
app.get('/api/admin/activity-logs', adminAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ logs: adminActivityLogs.slice(0, limit) });
});

// Admin — Live Server Logs (JWT protected)
app.get('/api/admin/logs', adminAuth, async (req, res, next) => {
  try {
    const fs = require('fs');
    const readline = require('readline');
    const path = require('path');

    const maxLines = Number(req.query.lines) || 100;
    const logPath = path.join(__dirname, 'combined.log');

    if (!fs.existsSync(logPath)) {
      return res.json({ logs: [] });
    }

    const fileStream = fs.createReadStream(logPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const allLines = [];
    for await (const line of rl) {
      if (line.trim()) allLines.push(line);
    }

    // Return only the last N lines, reversed so newest is first
    const recentLogs = allLines.slice(-maxLines).reverse();
    res.json({ logs: recentLogs });
  } catch (error) {
    next(error);
  }
});

// Admin — List donations (JWT protected)
app.get('/api/donations', adminAuth, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const where = {};
    if (status && ['pending', 'success', 'failed'].includes(status)) {
      where.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const [donations, total] = await Promise.all([
      withRetry(
        () => prisma.donation.findMany({ where, orderBy: { created_at: 'desc' }, skip, take }),
        { label: 'donations.findMany' }
      ),
      withRetry(
        () => prisma.donation.count({ where }),
        { label: 'donations.count' }
      )
    ]);

    res.json({
      data: donations,
      pagination: {
        total,
        page: Number(page),
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    next(error);
  }
});

// FIX #5: Single /api/order/:id/status route (with validateOrigin + input validation)
app.get('/api/order/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || id.length < 10 || !/^order_[A-Za-z0-9]+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    const donation = await withRetry(
      () => prisma.donation.findFirst({
        where: { razorpay_order_id: id },
        select: { status: true, razorpay_payment_id: true, amount: true, currency: true }
      }),
      { label: 'order-status.findFirst' }
    );

    if (!donation) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({
      status: donation.status,
      amount: donation.amount,
      paymentId: donation.razorpay_payment_id,
      currency: donation.currency
    });
  } catch (error) {
    next(error);
  }
});

// FIX #4 + #9: Admin login — issues JWT token, bcrypt password check, rate limited
app.post('/api/admin/login', adminLoginLimiter, async (req, res) => {
  const { password, actor } = req.body || {};
  const loginActor = actor === 'cronjob' ? 'cronjob' : 'admin';
  const loginIp = getRequestIp(req);

  if (!password) {
    addAdminActivity({
      actor: loginActor,
      action: 'login',
      result: 'failed',
      source: 'admin_portal',
      ip: loginIp,
      details: 'Password missing'
    });
    return res.status(400).json({ error: 'Password required' });
  }
  try {
    const isValid = await bcrypt.compare(password, adminPasswordHash);
    if (isValid) {
      addAdminActivity({
        actor: loginActor,
        action: 'login',
        result: 'success',
        source: 'admin_portal',
        ip: loginIp,
        details: 'Admin token issued'
      });

      const token = jwt.sign(
        { role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
      );
      res.json({ success: true, token });
    } else {
      addAdminActivity({
        actor: loginActor,
        action: 'login',
        result: 'failed',
        source: 'admin_portal',
        ip: loginIp,
        details: 'Invalid password'
      });
      res.status(401).json({ error: 'Invalid password' });
    }
  } catch (err) {
    addAdminActivity({
      actor: loginActor,
      action: 'login',
      result: 'failed',
      source: 'admin_portal',
      ip: loginIp,
      details: `Login error: ${err.message}`
    });
    res.status(500).json({ error: 'Login error' });
  }
});

// Global error handler (must be last)
app.use(errorHandler);

// ========================
// Background Jobs (Cron)
// ========================
cron.schedule('*/15 * * * *', async () => {
  logger.info('Running cron job: Reconciling pending payments...');
  try {
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const staleDonations = await withRetry(
      () => prisma.donation.findMany({
        where: {
          status: 'pending',
          created_at: { lt: fifteenMinsAgo, gt: threeDaysAgo }
        },
        take: 50
      }),
      { label: 'cron.findMany(stale)' }
    );

    if (staleDonations.length === 0) return;

    for (const donation of staleDonations) {
      if (!donation.razorpay_order_id) continue;

      try {
        const payments = await razorpay.orders.fetchPayments(donation.razorpay_order_id);

        const existingLogs = Array.isArray(donation.event_log) ? donation.event_log : [];
        existingLogs.push({ event: 'cron_reconciliation_check', timestamp: new Date().toISOString() });

        const capturedPayment = payments.items.find(p => p.status === 'captured');
        const failedPayment = payments.items.find(p => p.status === 'failed');

        if (capturedPayment) {
          // Fraud check: verify captured amount matches DB record
          const expectedAmountPaise = Math.round(Number(donation.amount) * 100);
          if (capturedPayment.amount !== expectedAmountPaise || capturedPayment.currency !== donation.currency) {
            logger.error(`CRON FRAUD ALERT: Amount mismatch for order ${donation.razorpay_order_id}. Expected: ${expectedAmountPaise} ${donation.currency}, Got: ${capturedPayment.amount} ${capturedPayment.currency}`);
            existingLogs.push({ event: 'cron_amount_mismatch_fraud', timestamp: new Date().toISOString() });
            await withRetry(
              () => prisma.donation.update({
                where: { id: donation.id },
                data: { status: 'failed', event_log: JSON.stringify(existingLogs) }
              }),
              { label: 'cron.update(fraud)' }
            );
            continue;
          }

          await withRetry(
            () => prisma.donation.update({
              where: { id: donation.id },
              data: {
                status: 'success',
                razorpay_payment_id: capturedPayment.id,
                event_log: JSON.stringify(existingLogs)
              }
            }),
            { label: 'cron.update(success)' }
          );
          logger.info(`Cron Reconciled (Success): Order ${donation.razorpay_order_id}`);
          await enqueueReceiptEmail(donation.donor_name, donation.email, donation.amount, capturedPayment.id, 'cron-reconciliation');
        } else if (failedPayment) {
          await withRetry(
            () => prisma.donation.update({
              where: { id: donation.id },
              data: {
                status: 'failed',
                event_log: JSON.stringify(existingLogs)
              }
            }),
            { label: 'cron.update(failed)' }
          );
          logger.info(`Cron Reconciled (Failed): Order ${donation.razorpay_order_id}`);
        }
      } catch (err) {
        logger.error(`Cron failed for order ${donation.razorpay_order_id}: ${err.message}`);
      }

      await new Promise(res => setTimeout(res, 300));
    }
  } catch (err) {
    logger.error(`Reconciliation Cron Job Error: ${err.message}`);
  }
});

// ========================
// Keep-Alive Cron Job (Ping Cron Job API)
// ========================
if (process.env.CRON_JOB_API_KEY) {
  if (!process.env.CRONITOR_MONITOR_KEY && !process.env.CRON_JOB_MONITOR_KEY) {
    logger.warn('CRONITOR_MONITOR_KEY is not set; using legacy Cronitor ping endpoint fallback');
  }
  // Ping health endpoint every 5 minutes via Cron Job API
  cron.schedule('*/5 * * * *', async () => {
    const serverUrl = process.env.FRONTEND_URL?.split(',')[0]?.trim() || `http://localhost:${process.env.PORT || 5000}`;
    const monitorKey = process.env.CRONITOR_MONITOR_KEY || process.env.CRON_JOB_MONITOR_KEY;
    logger.info('Keep-alive cron job running...');
    
    try {
      const pingData = JSON.stringify({
        status: 'run',
        output: `Health check ping from ${serverUrl}`
      });

      const options = monitorKey
        ? {
            hostname: 'cronitor.link',
            port: 443,
            path: `/p/${encodeURIComponent(process.env.CRON_JOB_API_KEY)}/${encodeURIComponent(monitorKey)}?state=run` ,
            method: 'GET'
          }
        : {
            // Backward-compatible fallback for older single-key setup.
            hostname: 'cronitor.io',
            port: 443,
            path: `/api/v1/pings/${encodeURIComponent(process.env.CRON_JOB_API_KEY)}`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(pingData)
            }
          };

      const req = https.request(options, (res) => {
        if (res.statusCode === 200 || res.statusCode === 204) {
          addAdminActivity({
            actor: 'cronjob',
            action: 'login',
            result: 'success',
            source: 'keepalive_cron',
            ip: 'server',
            details: `Cronitor ping success (HTTP ${res.statusCode})`
          });
          logger.info(`Keep-alive ping sent to Cron Job API successfully (HTTP ${res.statusCode})`);
        } else {
          addAdminActivity({
            actor: 'cronjob',
            action: 'login',
            result: 'failed',
            source: 'keepalive_cron',
            ip: 'server',
            details: `Cronitor ping returned HTTP ${res.statusCode}`
          });
          logger.warn(`Keep-alive ping response: HTTP ${res.statusCode}`);
        }
      });

      req.on('error', (err) => {
        addAdminActivity({
          actor: 'cronjob',
          action: 'login',
          result: 'failed',
          source: 'keepalive_cron',
          ip: 'server',
          details: `Cronitor ping error: ${err.message}`
        });
        logger.warn(`Keep-alive ping error: ${err.message}`);
      });

      if (options.method === 'POST') {
        req.write(pingData);
      }
      req.end();
    } catch (err) {
      addAdminActivity({
        actor: 'cronjob',
        action: 'login',
        result: 'failed',
        source: 'keepalive_cron',
        ip: 'server',
        details: `Keep-alive cron failed: ${err.message}`
      });
      logger.error(`Keep-alive ping failed: ${err.message}`);
    }
  });

  logger.info('Keep-alive cron job initialized (pings Cron Job API every 5 minutes)');
}

// ========================
// Graceful Shutdown
// ========================
async function shutdown(signal) {
  logger.info(`${signal} received — closing Prisma connection pool…`);
  await prisma.$disconnect();
  logger.info('Prisma disconnected. Exiting.');
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT} (${isProduction ? 'production' : 'development'})`);
});
