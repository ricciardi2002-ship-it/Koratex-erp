const { query } = require('./db');

async function initDb() {
  console.log('🔧 Inicializando base de datos Koratex...');

  await query(`CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(120) NOT NULL,
    email VARCHAR(180) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol_id INTEGER NOT NULL REFERENCES roles(id),
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS tipos_cliente (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(30) NOT NULL UNIQUE,
    dias_credito INTEGER NOT NULL DEFAULT 30,
    lista_precios VARCHAR(5) NOT NULL
  )`);

  await query(`CREATE TABLE IF NOT EXISTS zonas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    km_ref NUMERIC(8,2),
    activa BOOLEAN DEFAULT TRUE
  )`);

  await query(`CREATE TABLE IF NOT EXISTS clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(150) NOT NULL,
    ruc VARCHAR(20) UNIQUE,
    tipo_id INTEGER NOT NULL REFERENCES tipos_cliente(id),
    zona_id INTEGER REFERENCES zonas(id),
    direccion TEXT,
    telefono VARCHAR(30),
    email VARCHAR(180),
    lat NUMERIC(10,7),
    lng NUMERIC(10,7),
    limite_credito NUMERIC(12,2) DEFAULT 0,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS tipos_producto (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(60) NOT NULL UNIQUE
  )`);

  await query(`CREATE TABLE IF NOT EXISTS productos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(150) NOT NULL,
    tipo_id INTEGER NOT NULL REFERENCES tipos_producto(id),
    presentacion VARCHAR(80),
    precio_lista_a NUMERIC(10,2) NOT NULL DEFAULT 0,
    precio_lista_b NUMERIC(10,2) NOT NULL DEFAULT 0,
    precio_lista_c NUMERIC(10,2) NOT NULL DEFAULT 0,
    costo_produccion NUMERIC(10,2) DEFAULT 0,
    peso_kg NUMERIC(8,3) DEFAULT 0,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS inventario_pt (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id UUID NOT NULL UNIQUE REFERENCES productos(id),
    stock_total INTEGER NOT NULL DEFAULT 0,
    stock_reservado INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS proveedores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(150) NOT NULL,
    ruc VARCHAR(20) UNIQUE,
    contacto VARCHAR(120),
    telefono VARCHAR(30),
    email VARCHAR(180),
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS materias_primas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(150) NOT NULL,
    unidad VARCHAR(30) NOT NULL DEFAULT 'kg',
    stock_actual NUMERIC(12,3) NOT NULL DEFAULT 0,
    stock_minimo NUMERIC(12,3) NOT NULL DEFAULT 0,
    stock_maximo NUMERIC(12,3) NOT NULL DEFAULT 0,
    consumo_mensual NUMERIC(12,3) DEFAULT 0,
    costo_unitario NUMERIC(10,4) DEFAULT 0,
    proveedor_id UUID REFERENCES proveedores(id),
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS pedidos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero VARCHAR(20) NOT NULL UNIQUE,
    cliente_id UUID NOT NULL REFERENCES clientes(id),
    vendedor_id UUID REFERENCES usuarios(id),
    lista_precios VARCHAR(5) NOT NULL DEFAULT 'C',
    subtotal NUMERIC(12,2) DEFAULT 0,
    descuento NUMERIC(12,2) DEFAULT 0,
    igv NUMERIC(12,2) DEFAULT 0,
    total NUMERIC(12,2) DEFAULT 0,
    estado_pago VARCHAR(20) DEFAULT 'pendiente',
    estado_despacho VARCHAR(20) DEFAULT 'pendiente',
    fecha_pedido DATE DEFAULT CURRENT_DATE,
    fecha_entrega DATE,
    observaciones TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS pedido_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES productos(id),
    linea INTEGER NOT NULL,
    cantidad INTEGER NOT NULL,
    precio_unitario NUMERIC(10,2) NOT NULL,
    descuento_pct NUMERIC(5,2) DEFAULT 0,
    subtotal NUMERIC(12,2),
    notas TEXT,
    UNIQUE(pedido_id, linea)
  )`);

  await query(`CREATE TABLE IF NOT EXISTS facturas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero VARCHAR(20) NOT NULL UNIQUE,
    pedido_id UUID REFERENCES pedidos(id),
    cliente_id UUID NOT NULL REFERENCES clientes(id),
    monto_total NUMERIC(12,2) NOT NULL,
    monto_pagado NUMERIC(12,2) DEFAULT 0,
    fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_vencimiento DATE NOT NULL,
    estado VARCHAR(20) DEFAULT 'vigente',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS pagos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factura_id UUID NOT NULL REFERENCES facturas(id),
    cliente_id UUID NOT NULL REFERENCES clientes(id),
    usuario_id UUID REFERENCES usuarios(id),
    monto NUMERIC(12,2) NOT NULL,
    tipo_pago VARCHAR(30) DEFAULT 'efectivo',
    referencia VARCHAR(100),
    fecha_pago DATE DEFAULT CURRENT_DATE,
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS ordenes_compra (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero VARCHAR(20) NOT NULL UNIQUE,
    proveedor_id UUID NOT NULL REFERENCES proveedores(id),
    materia_prima_id UUID NOT NULL REFERENCES materias_primas(id),
    cantidad NUMERIC(12,3) NOT NULL,
    precio_unitario NUMERIC(10,4) NOT NULL,
    total NUMERIC(12,2),
    estado VARCHAR(20) DEFAULT 'pendiente',
    fecha_oc DATE DEFAULT CURRENT_DATE,
    fecha_entrega DATE,
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS vehiculos (
    id SERIAL PRIMARY KEY,
    placa VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(80),
    conductor VARCHAR(120),
    capacidad_kg NUMERIC(8,2),
    activo BOOLEAN DEFAULT TRUE
  )`);

  await query(`CREATE TABLE IF NOT EXISTS rutas_despacho (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id),
    zona_id INTEGER REFERENCES zonas(id),
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    hora_salida TIME,
    estado VARCHAR(20) DEFAULT 'programado',
    optimizada BOOLEAN DEFAULT FALSE,
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS rutas_despacho_paradas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ruta_id UUID NOT NULL REFERENCES rutas_despacho(id) ON DELETE CASCADE,
    pedido_id UUID NOT NULL REFERENCES pedidos(id),
    orden INTEGER NOT NULL,
    estado VARCHAR(20) DEFAULT 'pendiente',
    UNIQUE(ruta_id, orden)
  )`);

  await query(`CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    usuario_id UUID REFERENCES usuarios(id),
    modulo VARCHAR(50) NOT NULL,
    accion VARCHAR(100) NOT NULL,
    tabla VARCHAR(80),
    registro_id TEXT,
    detalle JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS sesiones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    refresh_token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE SEQUENCE IF NOT EXISTS pedido_seq START 50`);

  await seedData();
  console.log('✅ Base de datos lista.');
}

async function seedData() {
  const check = await query(`SELECT COUNT(*) FROM roles`);
  if (parseInt(check.rows[0].count) > 0) return;

  console.log('🌱 Insertando datos iniciales...');

  await query(`INSERT INTO roles (nombre, descripcion) VALUES
    ('admin','Acceso total'),('comercial','Módulo comercial'),
    ('logistica','Módulo logístico'),('finanzas','Módulo financiero')
    ON CONFLICT DO NOTHING`);

  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('koratex2025', 10);
  await query(`INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES
    ('Administrador','admin@koratex.com',$1,1),
    ('Ana Comercial','comercial@koratex.com',$1,2),
    ('Pedro Logística','logistica@koratex.com',$1,3),
    ('Rosa Finanzas','finanzas@koratex.com',$1,4)
    ON CONFLICT DO NOTHING`,[hash]);

  await query(`INSERT INTO tipos_cliente (nombre, dias_credito, lista_precios) VALUES
    ('oro',60,'A'),('plata',30,'B'),('bronce',15,'C')
    ON CONFLICT DO NOTHING`);

  await query(`INSERT INTO zonas (nombre, km_ref) VALUES
    ('Norte',12),('Sur',18),('Este',22​​​​​​​​​​​​​​​​
