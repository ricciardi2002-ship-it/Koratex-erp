const express  = require('express');
const { query } = require('../config/db');
const { auth }  = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard  — resumen general
router.get('/', auth, async (req, res, next) => {
  try {
    const [pedidos, ventas, inventario, cobranza] = await Promise.all([
      // Pedidos del mes
      query(`
        SELECT
          COUNT(*) FILTER (WHERE estado_despacho = 'pendiente')  as pendientes,
          COUNT(*) FILTER (WHERE estado_despacho = 'despachado') as despachados,
          COUNT(*) FILTER (WHERE estado_despacho = 'entregado')  as entregados,
          COUNT(*) as total
        FROM pedidos
        WHERE fecha_pedido >= date_trunc('month', CURRENT_DATE)
      `),
      // Ventas del mes
      query(`
        SELECT
          COALESCE(SUM(total), 0) as total_ventas,
          COALESCE(SUM(igv), 0)   as total_igv,
          COUNT(*)                as num_pedidos
        FROM pedidos
        WHERE fecha_pedido >= date_trunc('month', CURRENT_DATE)
      `),
      // Alertas de inventario
      query(`
        SELECT COUNT(*) as alertas
        FROM materias_primas
        WHERE activo = TRUE AND stock_actual <= stock_minimo
      `),
      // Cobranza pendiente
      query(`
        SELECT
          COALESCE(SUM(monto_total - monto_pagado), 0) as por_cobrar,
          COUNT(*) FILTER (WHERE fecha_vencimiento < CURRENT_DATE) as vencidas
        FROM facturas
        WHERE estado = 'vigente'
      `),
    ]);

    res.json({
      pedidos: pedidos.rows[0],
      ventas: ventas.rows[0],
      inventario: { alertas: parseInt(inventario.rows[0].alertas) },
      cobranza: cobranza.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/ventas-por-dia  — últimos 30 días
router.get('/ventas-por-dia', auth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT fecha_pedido::date as fecha, COALESCE(SUM(total), 0) as total,
             COUNT(*) as pedidos
      FROM pedidos
      WHERE fecha_pedido >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY fecha_pedido::date
      ORDER BY fecha_pedido::date
    `);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/top-productos  — top 10 productos por volumen
router.get('/top-productos', auth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT pr.codigo, pr.nombre, SUM(pi.cantidad) as unidades_vendidas,
             SUM(pi.subtotal) as monto_total
      FROM pedido_items pi
      JOIN productos pr ON pr.id = pi.producto_id
      JOIN pedidos p ON p.id = pi.pedido_id
      WHERE p.fecha_pedido >= date_trunc('month', CURRENT_DATE)
      GROUP BY pr.id, pr.codigo, pr.nombre
      ORDER BY unidades_vendidas DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/top-clientes  — top 10 clientes por monto
router.get('/top-clientes', auth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT c.codigo, c.nombre, COUNT(p.id) as num_pedidos,
             COALESCE(SUM(p.total), 0) as monto_total
      FROM clientes c
      LEFT JOIN pedidos p ON p.cliente_id = c.id
        AND p.fecha_pedido >= date_trunc('month', CURRENT_DATE)
      GROUP BY c.id, c.codigo, c.nombre
      ORDER BY monto_total DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
