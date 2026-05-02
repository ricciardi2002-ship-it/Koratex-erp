-- ═══════════════════════════════════════════════
--  KORATEX ERP — Desactivar Row Level Security
--  Ejecutar en: Supabase → SQL Editor → New query
-- ═══════════════════════════════════════════════

ALTER TABLE roles               DISABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios            DISABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_cliente       DISABLE ROW LEVEL SECURITY;
ALTER TABLE zonas               DISABLE ROW LEVEL SECURITY;
ALTER TABLE clientes            DISABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_producto      DISABLE ROW LEVEL SECURITY;
ALTER TABLE productos           DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventario_pt       DISABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores         DISABLE ROW LEVEL SECURITY;
ALTER TABLE materias_primas     DISABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos             DISABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_items        DISABLE ROW LEVEL SECURITY;
ALTER TABLE facturas            DISABLE ROW LEVEL SECURITY;
ALTER TABLE pagos               DISABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_compra      DISABLE ROW LEVEL SECURITY;
ALTER TABLE vehiculos           DISABLE ROW LEVEL SECURITY;
ALTER TABLE rutas_despacho      DISABLE ROW LEVEL SECURITY;
ALTER TABLE rutas_despacho_paradas DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log           DISABLE ROW LEVEL SECURITY;
ALTER TABLE sesiones            DISABLE ROW LEVEL SECURITY;
