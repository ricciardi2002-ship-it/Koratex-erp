// src/app.js  — Koratex ERP · Servidor principal
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const path     = require('path');

const { initDb }         = require('./config/initDb');
const { errorHandler }   = require('./middleware/errorHandler');

const authRouter        = require('./routes/auth');
const pedidosRouter     = require('./routes/pedidos');
const inventarioRouter  = require('./routes/inventario');
const dashboardRouter   = require('./routes/dashboard');
const { productosRouter, clientesRouter } = require('./routes/productos');
const { cobranzaRouter, despachoRouter  } = require('./routes/cobranza');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Seguridad y parsers ──
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Servir el frontend estático ──
// El archivo koratex-erp.html va en la carpeta /public
app.use(express.static(path.join(__dirname, '../public')));

// ── API Routes ──
app.use('/api/auth',        authRouter);
app.use('/api/pedidos',     pedidosRouter);
app.use('/api/productos',   productosRouter);
app.use('/api/clientes',    clientesRouter);
app.use('/api/inventario',  inventarioRouter);
app.use('/api/cobranza',    cobranzaRouter);
app.use('/api/despacho',    despachoRouter);
app.use('/api/dashboard',   dashboardRouter);

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Koratex ERP',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ── Cualquier otra ruta → devuelve el frontend ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Error handler global ──
app.use(errorHandler);

// ── Arrancar servidor ──
async function start() {
  try {
    await initDb();         // Crea tablas e inserta datos si es primera vez
    app.listen(PORT, () => {
      console.log(`\n🏗️  Koratex ERP corriendo en puerto ${PORT}`);
      console.log(`📡  API:      http://localhost:${PORT}/api`);
      console.log(`🌐  Frontend: http://localhost:${PORT}`);
      console.log(`💾  DB:       ${process.env.DATABASE_URL?.split('@')[1] || 'conectada'}\n`);
    });
  } catch (err) {
    console.error('❌ Error al iniciar:', err);
    process.exit(1);
  }
}

start();
