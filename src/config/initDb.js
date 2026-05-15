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

  // Migración: renombrar zonas genéricas a zonas reales de operación
  await query(`UPDATE zonas SET nombre='Catia'         WHERE nombre='Norte'`);
  await query(`UPDATE zonas SET nombre='La Guaira'     WHERE nombre='Sur'`);
  await query(`UPDATE zonas SET nombre='La California' WHERE nombre='Este'`);
  await query(`UPDATE zonas SET nombre='La Yaguara'    WHERE nombre='Oeste'`);
  await query(`UPDATE zonas SET nombre='Mariche'       WHERE nombre='Centro'`);
  await query(`UPDATE zonas SET nombre='Guatire'       WHERE nombre='Cono'`);
  // Zonas adicionales
  await query(`INSERT INTO zonas (nombre, km_ref) VALUES
    ('Guarenas',35),('Baruta',18),('Boleita Norte',14),
    ('Los Teques',32),('Catia La Mar',22),('Sabana Grande',10),
    ('San Martín',12),('Bello Monte',15)
    ON CONFLICT (nombre) DO NOTHING`);

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

  // facturas debe crearse ANTES que cobros y cobros_aplicaciones (FK dependencies)
  await query(`CREATE TABLE IF NOT EXISTS facturas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero VARCHAR(20) NOT NULL UNIQUE,
    pedido_id UUID REFERENCES pedidos(id),
    cliente_id UUID NOT NULL REFERENCES clientes(id),
    monto_total NUMERIC(12,2) NOT NULL,
    monto_pagado NUMERIC(12,2) DEFAULT 0,
    fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_vencimiento DATE NOT NULL,
    estado VARCHAR(20) DEFAULT 'pendiente',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  // Migración: unificar estado 'vigente' → 'pendiente'
  await query(`UPDATE facturas SET estado = 'pendiente' WHERE estado = 'vigente'`);

  await query(`CREATE TABLE IF NOT EXISTS cobros (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id  UUID NOT NULL REFERENCES clientes(id),
    usuario_id  UUID REFERENCES usuarios(id),
    monto       NUMERIC(12,2) NOT NULL,
    tipo_pago   VARCHAR(30) DEFAULT 'efectivo',
    referencia  VARCHAR(100),
    fecha_pago  DATE NOT NULL DEFAULT CURRENT_DATE,
    notas       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS cobros_aplicaciones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cobro_id        UUID NOT NULL REFERENCES cobros(id) ON DELETE CASCADE,
    factura_id      UUID NOT NULL REFERENCES facturas(id),
    monto_aplicado  NUMERIC(12,2) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
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
    ('Catia',12),('La Guaira',28),('La California',18),
    ('La Yaguara',15),('Mariche',22),('Guatire',45),
    ('Guarenas',35),('Baruta',18),('Boleita Norte',14),
    ('Los Teques',32),('Catia La Mar',22),('Sabana Grande',10),
    ('San Martín',12),('Bello Monte',15)
    ON CONFLICT DO NOTHING`);

  await query(`INSERT INTO tipos_producto (nombre) VALUES
    ('Adhesivo'),('Estuco'),('Impermeabilizante'),('Mortero'),('Sellador'),('Pintura')
    ON CONFLICT DO NOTHING`);

  await query(`INSERT INTO clientes (codigo,nombre,ruc,tipo_id,zona_id,direccion,lat,lng,limite_credito) VALUES
    ('C001','Constructora Andina SAC','20123456781',1,1,'Av. Túpac Amaru 890',-12.020,-77.050,100000),
    ('C002','Obras Civiles Perú SRL','20123456782',1,2,'Av. Los Álamos 3450',-12.120,-77.020,80000),
    ('C003','Ferretería Central','20123456783',2,5,'Jr. Colón 184',-12.060,-77.040,40000),
    ('C004','Distribuidora Roca Fuerte','20123456784',2,3,'Calle Las Flores 340',-12.050,-76.970,35000),
    ('C005','Maderas y Ferreterías SRL','20123456785',3,4,'Av. Universitaria 1820',-12.080,-77.090,20000),
    ('C006','Acabados Premier','20123456786',1,1,'Jr. Los Pinos 305',-12.010,-77.060,90000)
    ON CONFLICT DO NOTHING`);

  await query(`INSERT INTO productos (codigo,nombre,tipo_id,presentacion,precio_lista_a,precio_lista_b,precio_lista_c,costo_produccion,peso_kg) VALUES
    ('KTX-001','Estuco Fino Interior',2,'Bolsa 20kg',28.00,31.50,35.00,16.00,20.0),
    ('KTX-002','Adhesivo Cerámico Plus',1,'Bolsa 25kg',22.50,25.00,28.00,13.00,25.0),
    ('KTX-003','Impermeabilizante Flex',3,'Balde 20L',85.00,92.00,99.00,48.00,22.0),
    ('KTX-004','Mortero Estructural',4,'Bolsa 30kg',32.00,36.00,40.00,18.50,30.0),
    ('KTX-005','Sellador Multiusos',5,'Galón 4L',45.00,50.00,56.00,25.00,4.5),
    ('KTX-006','Estuco Exterior Renovado',2,'Bolsa 20kg',31.00,35.00,39.00,17.50,20.0),
    ('KTX-007','Pegamax Porcelanato',1,'Bolsa 25kg',26.00,29.50,33.00,14.50,25.0),
    ('KTX-008','Hidrofugante Concentrado',3,'Balde 5L',38.00,43.00,48.00,21.00,6.0)
    ON CONFLICT DO NOTHING`);

  await query(`INSERT INTO inventario_pt (producto_id, stock_total, stock_reservado)
    SELECT p.id,
      CASE p.codigo WHEN 'KTX-001' THEN 480 WHEN 'KTX-002' THEN 620
        WHEN 'KTX-003' THEN 190 WHEN 'KTX-004' THEN 340 WHEN 'KTX-005' THEN 210
        WHEN 'KTX-006' THEN 280 WHEN 'KTX-007' THEN 390 WHEN 'KTX-008' THEN 150 END,
      CASE p.codigo WHEN 'KTX-001' THEN 40 WHEN 'KTX-002' THEN 60
        WHEN 'KTX-003' THEN 20 WHEN 'KTX-004' THEN 30 WHEN 'KTX-005' THEN 10
        WHEN 'KTX-006' THEN 25 WHEN 'KTX-007' THEN 50 WHEN 'KTX-008' THEN 15 END
    FROM productos p ON CONFLICT DO NOTHING`);

  await query(`INSERT INTO proveedores (nombre, ruc) VALUES
    ('Cementos Lima SAC','20100234321'),
    ('Química Industrial Perú','20200567891'),
    ('Minerales Andinos SAC','20300789012'),
    ('Áridos del Sur','20400890123'),
    ('Colorquím SAC','20500012345')
    ON CONFLICT DO NOTHING`);

  await query(`INSERT INTO materias_primas (codigo,nombre,unidad,stock_actual,stock_minimo,stock_maximo,consumo_mensual,costo_unitario,proveedor_id)
    SELECT cod,nom,uni,sa,sm,sx,cm,cu,(SELECT id FROM proveedores WHERE nombre=prov LIMIT 1)
    FROM (VALUES
      ('MP-001','Cemento Portland Tipo I','bolsa 42.5kg',850,200,1200,420,28.50,'Cementos Lima SAC'),
      ('MP-002','Arena Fina Lavada','m³',48,20,100,28,85.00,'Áridos del Sur'),
      ('MP-003','Resina Acrílica','kg',180,100,500,120,12.40,'Química Industrial Perú'),
      ('MP-004','Carbonato de Calcio','kg',2400,800,4000,900,1.80,'Minerales Andinos SAC'),
      ('MP-005','Polvo de Talco','kg',90,150,600,200,3.20,'Minerales Andinos SAC'),
      ('MP-006','Pigmento Blanco TiO2','kg',65,80,300,90,18.60,'Colorquím SAC'),
      ('MP-007','Fibra Poliéster','kg',320,100,600,80,9.40,'Química Industrial Perú'),
      ('MP-008','Acelerante de Fraguado','kg',40,60,200,55,22.00,'Cementos Lima SAC')
    ) AS t(cod,nom,uni,sa,sm,sx,cm,cu,prov)
    ON CONFLICT DO NOTHING`);

  await query(`INSERT INTO vehiculos (placa,nombre,conductor,capacidad_kg) VALUES
    ('ABC-123','Camión A','Pedro Sánchez',5000),
    ('DEF-456','Camión B','Juan Ríos',8000),
    ('GHI-789','Furgón C','Marco Torres',2500)
    ON CONFLICT DO NOTHING`);

  console.log('✅ Datos iniciales insertados.');
}

module.exports = { initDb };
