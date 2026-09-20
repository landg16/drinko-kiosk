import type { Order, OrderStatus } from '../domain/types';
import type { Database } from './database';

/** Statuses in which the kiosk is occupied by the order. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ['created', 'paying', 'awaiting_cup', 'pouring'];

export class OrderRepository {
  private readonly upsertStmt;
  private readonly getStmt;
  private readonly activeStmt;
  private readonly listStmt;
  private readonly countSinceStmt;

  constructor(private readonly db: Database) {
    this.upsertStmt = db.prepare(`
      INSERT INTO orders (id, number, status, total, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        status = excluded.status, total = excluded.total, updated_at = excluded.updated_at, data = excluded.data
    `);
    this.getStmt = db.prepare('SELECT data FROM orders WHERE id = ?');
    const placeholders = ACTIVE_ORDER_STATUSES.map(() => '?').join(', ');
    this.activeStmt = db.prepare(
      `SELECT data FROM orders WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`,
    );
    this.listStmt = db.prepare('SELECT data FROM orders ORDER BY created_at DESC LIMIT ?');
    this.countSinceStmt = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE created_at >= ?');
  }

  save(order: Order): void {
    this.upsertStmt.run(
      order.id,
      order.number,
      order.status,
      order.total,
      order.createdAt,
      order.updatedAt,
      JSON.stringify(order),
    );
  }

  get(id: string): Order | undefined {
    const row = this.getStmt.get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Order) : undefined;
  }

  findActive(): Order | undefined {
    const row = this.activeStmt.get(...ACTIVE_ORDER_STATUSES) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Order) : undefined;
  }

  list(limit = 50): Order[] {
    const rows = this.listStmt.all(limit) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as Order);
  }

  /** Orders in one of the statuses whose last update is older than `before` (ISO timestamp). */
  findStale(statuses: OrderStatus[], before: string): Order[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT data FROM orders WHERE status IN (${placeholders}) AND updated_at < ?`)
      .all(...statuses, before) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as Order);
  }

  /** Daily sequence number shown to staff, restarting at 1 each local day. */
  nextNumber(now: Date): number {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const row = this.countSinceStmt.get(dayStart) as { n: number };
    return row.n + 1;
  }
}
