// src/app.js
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { default: helmet } = require('helmet');
const compression = require('compression');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

// Init shared connections early (Redis, etc.)
// require('./config/redis'); // safe to require; handles its own connect

// Middleware
// const { rateLimitCommon, rateLimitStrict } = require('./middleware/rateLimit');

// Routes
// const webhookRoutes = require('./routes/webhook.routes'); // contains route-scoped raw body for Stripe
// const authRoutes = require('./routes/auth.routes');
// const productRoutes = require('./routes/product.routes');
// const cartRoutes = require('./routes/cart.routes');
// const orderRoutes = require('./routes/order.routes');
// const couponRoutes = require('./routes/coupon.routes');
// const reviewRoutes = require('./routes/review.routes');
// const uploadRoutes = require('./routes/upload.routes');
// const paymentRoutes = require('./routes/payment.routes');
// const adminRoutes = require('./routes/admin.routes');

const app = express();
app.disable('x-powered-by');

const compressionFilter = (req, res) => {
  const accept = String(req.headers.accept || '').toLowerCase();
  if (accept.includes('text/event-stream') || String(req.originalUrl || '').includes('/stream')) {
    return false;
  }
  return compression.filter(req, res);
};

const formatUploadSizeMb = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '1MB';
  const mb = bytes / (1024 * 1024);
  const rounded = Number.isInteger(mb) ? String(mb) : String(Math.round(mb * 10) / 10);
  return `${rounded}MB`;
};

const buildNotFoundPayload = (req, message = 'Route not found') => ({
  status: 'error',
  code: 404,
  message,
  method: req.method,
  path: req.originalUrl
});

const renderNotFoundHtml = (payload) => `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>404 | INOXPRAN API</title>
    <meta name="robots" content="noindex, nofollow" />
    <style>
      :root {
        color-scheme: light;
        font-family: "Nunito", system-ui, -apple-system, sans-serif;
        background: #f6f8f9;
        color: #1f2937;
      }
      body {
        margin: 0;
        display: grid;
        min-height: 100vh;
        place-items: center;
        padding: 24px;
      }
      .card {
        background: #ffffff;
        border-radius: 16px;
        border: 1px solid #e5e7eb;
        padding: 28px 32px;
        max-width: 560px;
        width: 100%;
        box-shadow: 0 16px 30px rgba(15, 23, 42, 0.08);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 6px 12px;
        border-radius: 999px;
        font-weight: 700;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        background: #e8f5ff;
        color: #0f3d57;
      }
      h1 {
        margin: 12px 0 8px;
        font-size: 28px;
      }
      p {
        margin: 0;
        color: #475569;
      }
      code {
        display: inline-block;
        margin-top: 16px;
        padding: 8px 12px;
        border-radius: 8px;
        background: #f1f5f9;
        color: #0f172a;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <span class="badge">404</span>
      <h1>Không tìm thấy endpoint</h1>
      <p>Yêu cầu không khớp với bất kỳ route nào của API.</p>
      <code>${payload.method} ${payload.path}</code>
    </div>
  </body>
</html>`;

const sendNotFound = (req, res, message) => {
  const payload = buildNotFoundPayload(req, message);
  const wantsJson = req.accepts(['json', 'html']) === 'json';
  res.status(404);
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (wantsJson) {
    return res.json(payload);
  }
  return res.type('html').send(renderNotFoundHtml(payload));
};

// Security & logs
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
// morgan("compile");
// morgan("short");
// morgan("tiny");
// morgan(dev);
app.use(compression({ filter: compressionFilter }));


//init db
require("./dbs/init.mongodb")
const { checkOverload } = require('./helpers/check.connect');
checkOverload(); 
// Stripe requires RAW body on its webhook route.
// The route file uses `express.raw` on that specific path,
// so we must mount /webhooks BEFORE the global JSON parser.
// app.use('/webhooks', rateLimitStrict, webhookRoutes);

// Global JSON parser for the rest of the API
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' })); 

// Rate limit (general) for normal API traffic
// app.use(rateLimitCommon);

// Swagger docs
const swaggerDocument = YAML.load(path.join(__dirname, '../docs/swagger.yaml'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Simple 404 route for backend
app.get('/404', (req, res) => sendNotFound(req, res));

// Health check
app.use('/', require('./routes'));

// // Feature routes
// app.use('/api/auth', authRoutes);
// app.use('/api/products', productRoutes);
// app.use('/api/cart', cartRoutes);
// app.use('/api/orders', orderRoutes);
// app.use('/api/coupons', couponRoutes);
// app.use('/api/reviews', reviewRoutes);
// app.use('/api/upload', uploadRoutes);
// app.use('/api/payments', rateLimitStrict, paymentRoutes);
// app.use('/api/admin', adminRoutes);

// Centralized error handler
// eslint-disable-next-line no-unused-vars

app.use((req, res) => {
  sendNotFound(req, res);
});

app.use((error, req, res, next) => {
  const isMulterError = error?.name === 'MulterError';
  const isFileSizeError = error?.code === 'LIMIT_FILE_SIZE';
  const isJwtError =
    error?.name === 'TokenExpiredError' ||
    error?.name === 'JsonWebTokenError' ||
    error?.name === 'NotBeforeError';

  const statusCode = isJwtError ? 401 : error.status || (isMulterError ? 400 : 500);
  if (statusCode === 404) {
    return sendNotFound(req, res, error.message || 'Not found');
  }
  const message = isFileSizeError
    ? `Image size must be ${formatUploadSizeMb(req?.uploadMaxFileSize)} or smaller`
    : isJwtError
      ? 'Session expired. Please login again.'
      : error.message || 'Internal Server Error';

  return res.status(statusCode).json({
    status: 'error',
    code: statusCode,
    stack: error.stack,
    message
  })
})

module.exports = app;
