// src/routes/dashboard.js
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { auth } = require('../middleware/auth');

// GET /api/dashboard  — KPIs principales
router.get('/', auth, async (req, res, next) => {
  try {
    const [ventas, pedidos, cobranza, stockCrit, alertas] = await Promise.all([

      // Ventas del mes
      query(`
        SELECT
          COALESCE(SUM(total), 0)   AS ventas_mes,
          COUNT(*)                  AS num_pedidos,
          COALESCE(AVG(total), 0)   AS ticket_promedio
        FROM pedidos
        WHERE DATE_TRUNC('month', fecha_pedido) = DATE_TRUNC('month', CURRENT_DATE)
          AND estado_pago != 'anulado'`),

      // Pedidos por estado
      query(`
        SELECT estado_despacho, COUNT(*) AS cantidad
        FROM pedidos WHERE estado_pago != 'anulado'
        GROUP BY estado_despacho`),

      // Cobranza
      query(`
        SELECT
          COALESCE(SUM(monto_total), 0)                               AS total_facturado,
          COALESCE(SUM(monto_pagado), 0)                             AS total_cobrado,
          COALESCE(SUM(CASE WHEN estado='mora' THEN monto_total-monto_pagado ELSE 0 END),0) AS vencidas,
          COUNT(CASE WHEN estado='mora' THEN 1 END)                  AS facturas_mora
        FROM facturas`),

      // Stock crítico MP
      query(`
        SELECT COUNT(*) AS criticos
        FROM materias_primas
        WHERE stock_actual <= stock_minimo AND activo = true`),

      // Últimas alertas del audit log
      query(`
        SELECT accion, detalle, created_at
        FROM audit_log
        WHERE accion LIKE 'ALERTA%' OR accion LIKE 'CREAR%'
        ORDER BY created_at DESC LIMIT 10`),
    ]);

    const v = ventas.rows[0];
    const c = cobranza.rows[0];

    // Ventas por tipo de cliente
    const ventasTipo = await query(`
      SELECT tc.nombre AS tipo, COALESCE(SUM(p.total), 0) AS total
      FROM pedidos p
      JOIN clientes cl ON cl.id = p.cliente_id
      JOIN tipos_cliente tc ON tc.id = cl.tipo_id
      WHERE DATE_TRUNC('month', p.fecha_pedido) = DATE_TRUNC('month', CURRENT_DATE)
        AND p.estado_pago != 'anulado'
      GROUP BY tc.nombre`);

    // Ventas últimas 7 semanas
    const ventasSemanas = await query(`
      SELECT
        TO_CHAR(DATE_TRUNC('week', fecha_pedido), 'DD/MM') AS semana,
        COALESCE(SUM(total), 0) AS total
      FROM pedidos
      WHERE fecha_pedido >= CURRENT_DATE - INTERVAL '7 weeks'
        AND estado_pago != 'anulado'
      GROUP BY DATE_TRUNC('week', fecha_pedido)
      ORDER BY DATE_TRUNC('week', fecha_pedido)`);

    res.json({
      ventas: {
        mes:             parseFloat(v.ventas_mes),
        num_pedidos:     parseInt(v.num_pedidos),
        ticket_promedio: parseFloat(v.ticket_promedio),
        por_semana:      ventasSemanas.rows,
        por_tipo:        ventasTipo.rows,
      },
      pedidos: {
        por_estado: pedidos.rows.reduce((acc, r) => {
          acc[r.estado_despacho] = parseInt(r.cantidad); return acc;
        }, {})
      },
      cobranza: {
        total_facturado: parseFloat(c.total_facturado),
        total_cobrado:   parseFloat(c.total_cobrado),
        vencidas:        parseFloat(c.vencidas),
        facturas_mora:   parseInt(c.facturas_mora),
        efectividad_pct: c.total_facturado > 0
          ? Math.round(c.total_cobrado / c.total_facturado * 100 * 10) / 10
          : 0,
      },
      inventario: {
        stock_critico_mp: parseInt(stockCrit.rows[0].criticos),
      },
      alertas: alertas.rows,
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/finanzas
router.get('/finanzas', auth, async (req, res, next) => {
  try {
    const [margen, cxp, flujo] = await Promise.all([

      // Margen por producto
      query(`
        SELECT pr.nombre, tp.nombre AS tipo,
          pr.precio_lista_a, pr.costo_produccion,
          CASE WHEN pr.precio_lista_a > 0
            THEN ROUND((pr.precio_lista_a - pr.costo_produccion) / pr.precio_lista_a * 100, 1)
            ELSE 0
          END AS margen_pct
        FROM productos pr
        JOIN tipos_producto tp ON tp.id = pr.tipo_id
        WHERE pr.activo = true
        ORDER BY margen_pct DESC`),

      // CxP
      query(`
        SELECT cp.*, p.nombre AS proveedor_nombre
        FROM cuentas_pagar cp
        JOIN proveedores p ON p.id = cp.proveedor_id
        WHERE cp.estado != 'pagada'
        ORDER BY cp.fecha_vencimiento ASC`),

      // Flujo de caja proyectado (ingresos CxC vs egresos CxP próx. 60 días)
      query(`
        SELECT
          COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto ELSE 0 END), 0) AS ingresos,
          COALESCE(SUM(CASE WHEN tipo='egreso'  THEN monto ELSE 0 END), 0) AS egresos
        FROM (
          SELECT 'ingreso' AS tipo, (monto_total - monto_pagado) AS monto
          FROM facturas WHERE estado IN ('vigente','mora')
            AND fecha_vencimiento <= CURRENT_DATE + INTERVAL '60 days'
          UNION ALL
          SELECT 'egreso', (monto - monto_pagado)
          FROM cuentas_pagar WHERE estado != 'pagada'
            AND fecha_vencimiento <= CURRENT_DATE + INTERVAL '60 days'
        ) t`),
    ]);

    res.json({
      margen_productos: margen.rows,
      cuentas_pagar:    cxp.rows,
      flujo_caja:       flujo.rows[0],
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/trazabilidad
router.get('/trazabilidad', auth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT al.*, u.nombre AS usuario_nombre
      FROM audit_log al
      LEFT JOIN usuarios u ON u.id = al.usuario_id
      ORDER BY al.created_at DESC
      LIMIT 50`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
