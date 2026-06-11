const rateLimit = require('express-rate-limit');

function make(options) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: 'Too many requests — please try again later' });
    },
    ...options,
  });
}

// Strict limit for authentication endpoints (register, login)
const authLimiter = make({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many authentication attempts',
});

// Checkout and tip creation — prevent checkout session spam
const paymentLimiter = make({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
});

// General API — loose limit to stop hammering
const generalLimiter = make({
  windowMs: 15 * 60 * 1000,
  max: 300,
});

const previewLimiter = make({
  windowMs: 15 * 60 * 1000,
  max: 30,
});

module.exports = { authLimiter, paymentLimiter, generalLimiter, previewLimiter };
