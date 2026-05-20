require('dotenv').config();

// ── Seguridad: advertir si JWT_SECRET no está configurado ──────────────
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  ADVERTENCIA: JWT_SECRET no definida. Configurar en Railway → Variables para producción.');
}

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const path     = require('path');
const rateLimit = require('express-rate-limit');

const { initDb }       = require('./config/initDb');
const { errorHandler } = require('./middleware/errorHandler');

const authRouter       = require('./routes/auth');
const pedidosRouter    = require('./routes/pedidos');
const inventarioRouter = require('./routes/inventario');
const dashboardRouter  = require('./routes/dashboard');
const { productosRouter, clientesRouter } = require('./routes/productos');
const { cobranzaRouter, despachoRouter  } = require('./routes/cobranza');
const exportRouter                        = require('./routes/export');
const usuariosRouter                      = require('./routes/usuarios');
const cobrosRouter                        = require('./routes/cobros');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Seguridad HTTP ───────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', 1); // Railway usa proxy

// ── Rate limiting global: 200 req/min por IP ─────────────────────────────
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' },
}));

// ── Rate limiting estricto en login: 10 intentos cada 15 min por IP ──────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos fallidos. Espera 15 minutos.' },
  skipSuccessfulRequests: true,
});

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

app.use(express.static(path.join(__dirname, '../public')));

// Login con rate limit estricto
app.use('/api/auth/login', loginLimiter);

app.use('/api/auth',       authRouter);
app.use('/api/pedidos',    pedidosRouter);
app.use('/api/productos',  productosRouter);
app.use('/api/clientes',   clientesRouter);
app.use('/api/inventario', inventarioRouter);
app.use('/api/cobranza',   cobranzaRouter);
app.use('/api/despacho',   despachoRouter);
app.use('/api/dashboard',  dashboardRouter);
app.use('/api/export',     exportRouter);
app.use('/api/usuarios',   usuariosRouter);
app.use('/api/cobros',     cobrosRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Koratex ERP', version: '1.0.0' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(errorHandler);

async function start() {
  try {
    await initDb();
    console.log('✅ Base de datos lista');
  } catch (err) {
    console.error('❌ Error crítico al inicializar BD:', err.message);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`🏗️  Koratex ERP corriendo en puerto ${PORT}`);
  });
}

start();

