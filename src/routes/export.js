const express = require('express');
const { query } = require('../config/db');
const { auth, roles } = require('../middleware/auth');

const router = express.Router();

function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ];
  return lines.join('\n');
}

function sendCSV(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv); // BOM for Excel UTF-8 compatibility
}

// ── GET /api/export/ventas  ─────────────────────────────────────────────────
// One row per pedido_item — ideal for Akkio sales forecasting
router.get('/ventas', auth, roles('admin', 'finanzas'), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        p.numero                            AS pedido_numero,
        p.fecha_pedido::date                AS fecha_pedido,
        TO_CHAR(p.fecha_pedido, 'YYYY-MM')  AS anio_mes,
        EXTRACT(DOW  FROM p.fecha_pedido)   AS dia_semana,
        EXTRACT(MONTH FROM p.fecha_pedido)  AS mes,
        EXTRACT(YEAR  FROM p.fecha_pedido)  AS anio,
        c.codigo                            AS cliente_codigo,
        c.nombre                            AS cliente_nombre,
        tc.nombre                           AS cliente_tipo,
        tc.lista_precios                    AS lista_precios,
        tc.dias_credito                     AS dias_credito,
        z.nombre                            AS zona,
        p.lista_precios                     AS lista_usada,
        pr.codigo                           AS producto_codigo,
        pr.nombre                           AS producto_nombre,
        tp.nombre                           AS categoria_producto,
        pr.presentacion                     AS presentacion,
        pi.linea                            AS linea,
        pi.cantidad                         AS cantidad,
        pi.precio_unitario                  AS precio_unitario,
        pi.descuento_pct                    AS descuento_pct,
        pi.subtotal                         AS subtotal_linea,
        p.subtotal                          AS subtotal_pedido,
        p.igv                               AS igv,
        p.total                             AS total_pedido,
        p.estado_pago                       AS estado_pago,
        p.estado_despacho                   AS estado_despacho,
        p.fecha_entrega::date               AS fecha_entrega_prometida,
        CASE WHEN p.fecha_entrega IS NOT NULL
          THEN (p.fecha_entrega::date - p.fecha_pedido::date) END AS dias_lead_time,
        u.nombre                            AS vendedor
      FROM pedido_items pi
      JOIN pedidos p       ON p.id  = pi.pedido_id
      JOIN clientes c      ON c.id  = p.cliente_id
      JOIN tipos_cliente tc ON tc.id = c.tipo_id
      LEFT JOIN zonas z    ON z.id  = c.zona_id
      JOIN productos pr    ON pr.id = pi.producto_id
      JOIN tipos_producto tp ON tp.id = pr.tipo_id
      LEFT JOIN usuarios u ON u.id  = p.vendedor_id
      ORDER BY p.fecha_pedido DESC, p.numero, pi.linea
    `);
    sendCSV(res, 'koratex_ventas_akkio.csv', toCSV(result.rows));
  } catch (err) { next(err); }
});

// ── GET /api/export/clientes  ───────────────────────────────────────────────
// One row per client with aggregated purchase history
router.get('/clientes', auth, roles('admin', 'finanzas'), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        c.codigo                                      AS cliente_codigo,
        c.nombre                                      AS cliente_nombre,
        c.ruc,
        tc.nombre                                     AS tipo_cliente,
        tc.lista_precios,
        tc.dias_credito,
        z.nombre                                      AS zona,
        c.limite_credito,
        c.activo,
        COUNT(DISTINCT p.id)                          AS total_pedidos,
        COALESCE(SUM(p.total), 0)                     AS monto_total_comprado,
        COALESCE(AVG(p.total), 0)                     AS ticket_promedio,
        COALESCE(MAX(p.total), 0)                     AS pedido_maximo,
        COALESCE(MIN(p.fecha_pedido)::date, NULL)     AS primera_compra,
        COALESCE(MAX(p.fecha_pedido)::date, NULL)     AS ultima_compra,
        CASE WHEN MAX(p.fecha_pedido) IS NOT NULL
          THEN (CURRENT_DATE - MAX(p.fecha_pedido)::date) END AS dias_sin_comprar,
        COUNT(DISTINCT p.id) FILTER (
          WHERE p.fecha_pedido >= CURRENT_DATE - INTERVAL '90 days'
        )                                             AS pedidos_ultimos_90d,
        COALESCE(SUM(p.total) FILTER (
          WHERE p.fecha_pedido >= CURRENT_DATE - INTERVAL '90 days'
        ), 0)                                         AS monto_ultimos_90d,
        COUNT(DISTINCT f.id)                          AS total_facturas,
        COALESCE(SUM(f.monto_total), 0)               AS monto_facturado,
        COALESCE(SUM(f.monto_pagado), 0)              AS monto_cobrado,
        COALESCE(SUM(f.monto_total - f.monto_pagado), 0) AS saldo_pendiente,
        COUNT(f.id) FILTER (
          WHERE f.estado IN ('pendiente','abonado') AND f.fecha_vencimiento < CURRENT_DATE
        )                                             AS facturas_en_mora,
        c.telefono,
        c.email
      FROM clientes c
      JOIN tipos_cliente tc ON tc.id = c.tipo_id
      LEFT JOIN zonas z     ON z.id  = c.zona_id
      LEFT JOIN pedidos p   ON p.cliente_id = c.id
      LEFT JOIN facturas f  ON f.cliente_id = c.id
      GROUP BY c.id, c.codigo, c.nombre, c.ruc, tc.nombre, tc.lista_precios,
               tc.dias_credito, z.nombre, c.limite_credito, c.activo,
               c.telefono, c.email
      ORDER BY monto_total_comprado DESC
    `);
    sendCSV(res, 'koratex_clientes_akkio.csv', toCSV(result.rows));
  } catch (err) { next(err); }
});

// ── GET /api/export/productos  ──────────────────────────────────────────────
// One row per product with sales performance
router.get('/productos', auth, roles('admin', 'finanzas'), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        pr.codigo,
        pr.nombre,
        tp.nombre                                     AS categoria,
        pr.presentacion,
        pr.precio_lista_a,
        pr.precio_lista_b,
        pr.precio_lista_c,
        pr.costo_produccion,
        ROUND((pr.precio_lista_a - pr.costo_produccion) / NULLIF(pr.precio_lista_a,0) * 100, 1) AS margen_pct,
        pr.peso_kg,
        COALESCE(i.stock_total, 0)                    AS stock_total,
        COALESCE(i.stock_reservado, 0)                AS stock_reservado,
        COALESCE(i.stock_total - i.stock_reservado,0) AS stock_disponible,
        COUNT(DISTINCT pi.pedido_id)                  AS num_pedidos,
        COALESCE(SUM(pi.cantidad), 0)                 AS unidades_vendidas,
        COALESCE(SUM(pi.subtotal), 0)                 AS monto_vendido,
        COALESCE(AVG(pi.descuento_pct), 0)            AS descuento_promedio_pct,
        COALESCE(SUM(pi.cantidad) FILTER (
          WHERE p.fecha_pedido >= CURRENT_DATE - INTERVAL '30 days'
        ), 0)                                         AS unidades_ultimos_30d,
        COALESCE(SUM(pi.cantidad) FILTER (
          WHERE p.fecha_pedido >= CURRENT_DATE - INTERVAL '90 days'
        ), 0)                                         AS unidades_ultimos_90d
      FROM productos pr
      JOIN tipos_producto tp ON tp.id = pr.tipo_id
      LEFT JOIN inventario_pt i ON i.producto_id = pr.id
      LEFT JOIN pedido_items pi ON pi.producto_id = pr.id
      LEFT JOIN pedidos p ON p.id = pi.pedido_id
      WHERE pr.activo = TRUE
      GROUP BY pr.id, pr.codigo, pr.nombre, tp.nombre, pr.presentacion,
               pr.precio_lista_a, pr.precio_lista_b, pr.precio_lista_c,
               pr.costo_produccion, pr.peso_kg, i.stock_total, i.stock_reservado
      ORDER BY monto_vendido DESC
    `);
    sendCSV(res, 'koratex_productos_akkio.csv', toCSV(result.rows));
  } catch (err) { next(err); }
});

// ── GET /api/export/inventario_mp  ─────────────────────────────────────────
// Materia prima stock for inventory optimization
router.get('/inventario_mp', auth, roles('admin', 'logistica'), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        mp.codigo,
        mp.nombre,
        mp.unidad,
        mp.stock_actual,
        mp.stock_minimo,
        mp.stock_maximo,
        mp.consumo_mensual,
        ROUND(mp.stock_actual::numeric / NULLIF(mp.consumo_mensual,0) * 30, 1) AS cobertura_dias,
        mp.costo_unitario,
        ROUND(mp.stock_actual * mp.costo_unitario, 2)  AS valor_inventario,
        CASE WHEN mp.stock_actual <= mp.stock_minimo THEN 'CRITICO'
             WHEN mp.stock_actual <= mp.stock_minimo * 1.5 THEN 'BAJO'
             ELSE 'OK' END                             AS estado_stock,
        pr.nombre                                      AS proveedor,
        mp.activo
      FROM materias_primas mp
      LEFT JOIN proveedores pr ON pr.id = mp.proveedor_id
      WHERE mp.activo = TRUE
      ORDER BY cobertura_dias ASC NULLS FIRST
    `);
    sendCSV(res, 'koratex_inventario_mp_akkio.csv', toCSV(result.rows));
  } catch (err) { next(err); }
});

// ── GET /api/export/cobranza  ───────────────────────────────────────────────
// Accounts receivable for payment risk analysis
router.get('/cobranza', auth, roles('admin', 'finanzas'), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        f.numero                                      AS factura_numero,
        f.fecha_emision::date                         AS fecha_emision,
        f.fecha_vencimiento::date                     AS fecha_vencimiento,
        GREATEST(0, CURRENT_DATE - f.fecha_vencimiento::date) AS dias_mora,
        c.codigo                                      AS cliente_codigo,
        c.nombre                                      AS cliente_nombre,
        tc.nombre                                     AS tipo_cliente,
        z.nombre                                      AS zona,
        tc.dias_credito                               AS dias_credito_acordados,
        f.monto_total,
        f.monto_pagado,
        ROUND(f.monto_total - f.monto_pagado, 2)     AS saldo_pendiente,
        ROUND(f.monto_pagado / NULLIF(f.monto_total,0) * 100, 1) AS pct_cobrado,
        f.estado,
        COALESCE(COUNT(pg.id), 0)                    AS num_pagos,
        COALESCE(SUM(pg.monto), 0)                   AS total_pagado_historial,
        MIN(pg.fecha_pago::date)                      AS primer_pago,
        MAX(pg.fecha_pago::date)                      AS ultimo_pago
      FROM facturas f
      JOIN clientes c       ON c.id  = f.cliente_id
      JOIN tipos_cliente tc ON tc.id = c.tipo_id
      LEFT JOIN zonas z     ON z.id  = c.zona_id
      LEFT JOIN pagos pg    ON pg.factura_id = f.id
      GROUP BY f.id, f.numero, f.fecha_emision, f.fecha_vencimiento,
               c.codigo, c.nombre, tc.nombre, z.nombre, tc.dias_credito,
               f.monto_total, f.monto_pagado, f.estado
      ORDER BY dias_mora DESC, f.fecha_vencimiento ASC
    `);
    sendCSV(res, 'koratex_cobranza_akkio.csv', toCSV(result.rows));
  } catch (err) { next(err); }
});

module.exports = router;
