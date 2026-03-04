require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const prisma = require('./prisma');
const { withRetry } = require('./db');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { Resend } = require('resend');
const winston = require('winston');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

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
    new winston.transports.Console()
  ],
});

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

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
const adminPasswordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'changeme', 10);
logger.info('Admin password hash ready');

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
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_jwt_secret');
    if (decoded.role !== 'admin') throw new Error('Insufficient role');
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
// Email (Resend HTTP API)
// ========================
let resendClient = null;
if (process.env.RESEND_API_KEY) {
  resendClient = new Resend(process.env.RESEND_API_KEY);
  logger.info('Email client configured (Resend API)');
}

// FIX #15: Track email failures and log them
async function sendReceiptEmail(donorName, email, amount, paymentId) {
  if (!resendClient) {
    logger.warn('Email receipt skipped: RESEND_API_KEY not configured.');
    return;
  }

  try {
    // FIX #6: Sanitize all user-supplied values before injecting into HTML
    const safeName = escapeHtml(donorName);
    const safeEmail = escapeHtml(email);
    const safeAmount = escapeHtml(String(amount));
    const safePaymentId = escapeHtml(paymentId);

    const fromAddress = process.env.RESEND_FROM_EMAIL || 'DEMO NGO <onboarding@resend.dev>';

    await resendClient.emails.send({
      from: fromAddress,
      to: email,
      subject: 'Thank you for your donation! — DEMO NGO',
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">💙 Thank You, ${safeName}!</h1>
          </div>
          <div style="padding: 32px;">
            <p style="font-size: 16px; color: #374151;">Your generous donation of <strong>₹${safeAmount}</strong> has been received successfully.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
              <tr><td style="padding: 8px 0; color: #6b7280;">Payment ID</td><td style="padding: 8px 0; font-weight: 600;">${safePaymentId}</td></tr>
              <tr><td style="padding: 8px 0; color: #6b7280;">Amount</td><td style="padding: 8px 0; font-weight: 600;">₹${safeAmount}</td></tr>
              <tr><td style="padding: 8px 0; color: #6b7280;">Status</td><td style="padding: 8px 0; font-weight: 600; color: #059669;">✅ Successful</td></tr>
            </table>
            <p style="font-size: 14px; color: #6b7280;">This donation is eligible for 80G tax exemption. A formal receipt will be sent within 7 working days.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="font-size: 12px; color: #9ca3af; text-align: center;">DEMO NGO — Feeding the hungry, one meal at a time.</p>
          </div>
        </div>
      `
    });
    logger.info(`Receipt email sent to ${safeEmail}`);
  } catch (err) {
    // FIX #15: Log the failure prominently so it can be followed up manually
    logger.error(`IMPORTANT: Failed to send receipt email to ${email} for payment ${paymentId}. Manual follow-up required. Error: ${err.message}`);
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

      if (donation.status !== 'pending') {
        return res.status(200).json({ success: true, message: 'Payment already processed' });
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
      await withRetry(
        () => prisma.donation.update({
          where: { id: donation.id },
          data: {
            razorpay_payment_id,
            status: 'success',
            event_log: JSON.stringify([...currentLogs, { event: 'frontend_payment.verified', timestamp: new Date().toISOString() }])
          }
        }),
        { label: 'verify-payment.update(success)' }
      );

      sendReceiptEmail(donation.donor_name, donation.email, donation.amount, razorpay_payment_id);
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
          await withRetry(
            () => prisma.donation.update({
              where: { id: donation.id },
              data: {
                razorpay_payment_id,
                status: 'success',
                event_log: JSON.stringify(existingLogs)
              }
            }),
            { label: 'webhook.update(success)' }
          );
          sendReceiptEmail(donation.donor_name, donation.email, donation.amount, razorpay_payment_id);
          logger.info(`Webhook synced recovery: Payment captured ${razorpay_payment_id} for order ${razorpay_order_id}`);
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
      await withRetry(
        () => prisma.donation.update({
          where: { id: donation.id },
          data: {
            razorpay_payment_id,
            status: 'success',
            event_log: JSON.stringify([...currentLogs2, { event: 'redirect_payment.verified', timestamp: new Date().toISOString() }])
          }
        }),
        { label: 'redirect.update(success)' }
      );

      sendReceiptEmail(donation.donor_name, donation.email, donation.amount, razorpay_payment_id);
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
        select: { status: true, razorpay_payment_id: true, donor_name: true, email: true, amount: true, currency: true }
      }),
      { label: 'order-status.findFirst' }
    );

    if (!donation) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({
      status: donation.status,
      donor_name: donation.donor_name,
      email: donation.email,
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
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }
  try {
    const isValid = await bcrypt.compare(password, adminPasswordHash);
    if (isValid) {
      const token = jwt.sign(
        { role: 'admin' },
        process.env.JWT_SECRET || 'fallback_jwt_secret',
        { expiresIn: '8h' }
      );
      res.json({ success: true, token });
    } else {
      res.status(401).json({ error: 'Invalid password' });
    }
  } catch (err) {
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
          sendReceiptEmail(donation.donor_name, donation.email, donation.amount, capturedPayment.id);
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
