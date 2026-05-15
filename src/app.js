require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const path     = require('path');

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

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use(express.static(path.join(__dirname, '../public')));

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
    app.listen(PORT, () => {
      console.log(`🏗️  Koratex ERP corriendo en puerto ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Error al iniciar:', err);
    process.exit(1);
  }
}

start();
