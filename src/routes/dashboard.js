const express  = require('express');
const { query } = require('../config/db');
const { auth }  = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard  — resumen general
router.get('/', auth, async (req, res, next) => {
  try {
    const isComercial = req.user.rol === 'comercial';
    const vid = req.user.id;

    const [pedidos, ventas, inventario, cobranza] = await Promise.all([
      // Pedidos del mes
      query(
        `SELECT
          COUNT(*) FILTER (WHERE estado_despacho = 'pendiente')  as pendientes,
          COUNT(*) FILTER (WHERE estado_despacho = 'despachado') as despachados,
          COUNT(*) FILTER (WHERE estado_despacho = 'entregado')  as entregados,
          COUNT(*) as total
        FROM pedidos
        WHERE fecha_pedido >= date_trunc('month', CURRENT_DATE)
          ${isComercial ? 'AND vendedor_id = $1' : ''}`,
        isComercial ? [vid] : []
      ),
      // Ventas del mes
      query(
        `SELECT
          COALESCE(SUM(total), 0) as total_ventas,
          COALESCE(SUM(igv), 0)   as total_igv,
          COUNT(*)                as num_pedidos
        FROM pedidos
        WHERE fecha_pedido >= date_trunc('month', CURRENT_DATE)
          ${isComercial ? 'AND vendedor_id = $1' : ''}`,
        isComercial ? [vid] : []
      ),
      // Alertas de inventario
      query(`
        SELECT COUNT(*) as alertas
        FROM materias_primas
        WHERE activo = TRUE AND stock_actual <= stock_minimo
      `),
      // Cobranza pendiente
      query(
        `SELECT
          COALESCE(SUM(f.monto_total - f.monto_pagado), 0) as por_cobrar,
          COUNT(*) FILTER (WHERE f.fecha_vencimiento < CURRENT_DATE) as vencidas
        FROM facturas f
        ${isComercial ? 'JOIN clientes c ON c.id = f.cliente_id' : ''}
        WHERE f.estado IN ('pendiente','abonado')
          ${isComercial ? 'AND c.vendedor_id = $1' : ''}`,
        isComercial ? [vid] : []
      ),
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
    const isComercial = req.user.rol === 'comercial';
    const result = await query(
      `SELECT fecha_pedido::date as fecha, COALESCE(SUM(total), 0) as total,
             COUNT(*) as pedidos
      FROM pedidos
      WHERE fecha_pedido >= CURRENT_DATE - INTERVAL '30 days'
        ${isComercial ? 'AND vendedor_id = $1' : ''}
      GROUP BY fecha_pedido::date
      ORDER BY fecha_pedido::date`,
      isComercial ? [req.user.id] : []
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/top-productos  — top 10 productos por volumen
router.get('/top-productos', auth, async (req, res, next) => {
  try {
    const isComercial = req.user.rol === 'comercial';
    const result = await query(
      `SELECT pr.codigo, pr.nombre, SUM(pi.cantidad) as unidades_vendidas,
             SUM(pi.subtotal) as monto_total
      FROM pedido_items pi
      JOIN productos pr ON pr.id = pi.producto_id
      JOIN pedidos p ON p.id = pi.pedido_id
      WHERE p.fecha_pedido >= date_trunc('month', CURRENT_DATE)
        ${isComercial ? 'AND p.vendedor_id = $1' : ''}
      GROUP BY pr.id, pr.codigo, pr.nombre
      ORDER BY unidades_vendidas DESC
      LIMIT 10`,
      isComercial ? [req.user.id] : []
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/top-clientes  — top 10 clientes por monto
router.get('/top-clientes', auth, async (req, res, next) => {
  try {
    const isComercial = req.user.rol === 'comercial';
    const result = await query(
      `SELECT c.codigo, c.nombre, COUNT(p.id) as num_pedidos,
             COALESCE(SUM(p.total), 0) as monto_total
      FROM clientes c
      LEFT JOIN pedidos p ON p.cliente_id = c.id
        AND p.fecha_pedido >= date_trunc('month', CURRENT_DATE)
      ${isComercial ? 'WHERE c.vendedor_id = $1' : ''}
      GROUP BY c.id, c.codigo, c.nombre
      ORDER BY monto_total DESC
      LIMIT 10`,
      isComercial ? [req.user.id] : []
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
