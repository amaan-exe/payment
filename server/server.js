require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const winston = require('winston');

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
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

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

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10kb' })); // Limit body size

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many payment requests, please try again later.' },
});

app.use('/api', generalLimiter);

// Origin validation middleware for payment endpoints
function validateOrigin(req, res, next) {
  const origin = req.get('origin') || req.get('referer') || '';
  const isAllowed = !origin || allowedOrigins.some(o => origin.startsWith(o));
  if (!isAllowed) {
    logger.warn(`Blocked request from unauthorized origin: ${origin}`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Admin authentication middleware
function adminAuth(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized — invalid admin password' });
  }
  next();
}

// ========================
// Database (Prisma Native)
// ========================
const prisma = new PrismaClient({
  log: isProduction ? ['error'] : ['query', 'info', 'warn', 'error'],
});

// ========================
// Razorpay
// ========================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ========================
// Email
// ========================
let transporter = null;
if (process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD) {
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASSWORD.replace(/\s/g, ''),
    },
  });
  transporter.verify()
    .then(() => logger.info('Email transporter verified and ready'))
    .catch(err => logger.error('Email transporter verification failed:', err.message));
}

async function sendReceiptEmail(donorName, email, amount, paymentId) {
  if (!transporter) return;
  try {
    await transporter.sendMail({
      from: `"DEMO NGO" <${process.env.SMTP_EMAIL}>`,
      to: email,
      subject: 'Thank you for your donation! — DEMO NGO',
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">💙 Thank You, ${donorName}!</h1>
          </div>
          <div style="padding: 32px;">
            <p style="font-size: 16px; color: #374151;">Your generous donation of <strong>₹${amount}</strong> has been received successfully.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
              <tr><td style="padding: 8px 0; color: #6b7280;">Payment ID</td><td style="padding: 8px 0; font-weight: 600;">${paymentId}</td></tr>
              <tr><td style="padding: 8px 0; color: #6b7280;">Amount</td><td style="padding: 8px 0; font-weight: 600;">₹${amount}</td></tr>
              <tr><td style="padding: 8px 0; color: #6b7280;">Status</td><td style="padding: 8px 0; font-weight: 600; color: #059669;">✅ Successful</td></tr>
            </table>
            <p style="font-size: 14px; color: #6b7280;">This donation is eligible for 80G tax exemption. A formal receipt will be sent within 7 working days.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="font-size: 12px; color: #9ca3af; text-align: center;">DEMO NGO — Feeding the hungry, one meal at a time.</p>
          </div>
        </div>
      `
    });
    logger.info(`Receipt email sent to ${email}`);
  } catch (err) {
    logger.error(`Failed to send receipt email to ${email}: ${err.message}`);
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

    // Add retry loop for Neon Scale-to-Zero cold starts
    let donation;
    let retries = 3;
    while (retries > 0) {
      try {
        donation = await prisma.donation.create({
          data: {
            donor_name: sanitizedName,
            email: sanitizedEmail,
            amount: sanitizedAmount,
            currency,
            razorpay_order_id: order.id,
            status: 'pending'
          }
        });
        break; // Success
      } catch (dbErr) {
        retries--;
        if (retries === 0) throw dbErr;
        logger.warn(`Database connection sleeping, retrying creation... (${retries} attempts left)`);
        await new Promise(res => setTimeout(res, 1000)); // Wait 1s for Neon to wake up
      }
    }

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
    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body.toString())
      .digest('hex');

    const isAuthentic = expectedSignature === razorpay_signature;

    if (isAuthentic) {
      await prisma.donation.updateMany({
        where: { razorpay_order_id },
        data: { razorpay_payment_id, status: 'success' }
      });

      const donation = await prisma.donation.findFirst({ where: { razorpay_order_id } });
      if (donation) {
        sendReceiptEmail(donation.donor_name, donation.email, donation.amount, razorpay_payment_id);
      }

      logger.info(`Payment verified: ${razorpay_payment_id} for order ${razorpay_order_id}`);
      res.status(200).json({ success: true, message: 'Payment successfully verified' });
    } else {
      await prisma.donation.updateMany({
        where: { razorpay_order_id },
        data: { status: 'failed' }
      });

      logger.warn(`Payment verification failed — invalid signature for order ${razorpay_order_id}`);
      res.status(400).json({ success: false, message: 'Invalid Signature' });
    }
  } catch (error) {
    next(error);
  }
});

// Live Stats (public)
app.get('/api/stats', async (req, res, next) => {
  try {
    const aggregations = await prisma.donation.aggregate({
      where: { status: 'success' },
      _sum: { amount: true }
    });
    const totalRaised = aggregations._sum.amount ? parseFloat(aggregations._sum.amount) : 0;
    const totalDonations = await prisma.donation.count({ where: { status: 'success' } });
    const donorsCount = await prisma.donation.groupBy({
      by: ['email'],
      where: { status: 'success' },
    });
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

// Admin — List donations (password protected)
app.get('/api/donations', adminAuth, async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status && ['pending', 'success', 'failed'].includes(status)) {
      where.status = status;
    }

    const donations = await prisma.donation.findMany({
      where,
      orderBy: { created_at: 'desc' }
    });

    res.json(donations);
  } catch (error) {
    next(error);
  }
});

// Admin — verify password
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Global error handler (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT} (${isProduction ? 'production' : 'development'})`);
});
