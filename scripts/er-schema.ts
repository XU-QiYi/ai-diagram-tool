/**
 * Verified schema of the tool-share system - the single source of truth for the ER
 * figure generators.
 *
 * Where each fact comes from:
 *   - tables and columns: the 2026-09-21 schema dump plus migrations V9 (tool_report),
 *     V10 (credit_appeal + credit_rule streak/appeal columns), V11 (deposit surge +
 *     rental_order.deposit_original), V12 (review dimension scores), V14 (dispute).
 *   - physical foreign keys: 16 constraints, all from the dump / V6.
 *   - tables WITHOUT physical FKs: tool_report (V9), credit_appeal (V10), dispute (V14),
 *     admin_operation_log (V6 declares no FK for admin_id) - their *_id columns are
 *     logical references only, and the figures must say so rather than draw a fake
 *     constraint.
 *   - unique keys: uk_favorite_user_tool, uk_review_order_user, user.username,
 *     tool_report(tool_id,reporter_id), dispute(order_id).
 *
 * AGENTS.md still claims "7 张表"; the code has 15. Do not re-derive this list from that
 * document - that is how the earlier figures ended up with tables that do not exist.
 */

export type ColumnKey = 'PK' | 'FK' | 'UK';
export interface Column {
  name: string;
  type: string;
  key?: ColumnKey;
  note?: string;
}
export interface TableDef {
  name: string;
  label: string;
  columns: Column[];
}

const fk = (name: string, target: string): Column => ({ name, type: 'BIGINT', key: 'FK', note: `→${target}.id` });

export const tables: TableDef[] = [
  {
    name: 'user',
    label: '用户',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      { name: 'username', type: 'VARCHAR(50)', key: 'UK' },
      { name: 'real_name', type: 'VARCHAR(50)' },
      { name: 'password', type: 'VARCHAR(100)' },
      { name: 'phone', type: 'VARCHAR(20)' },
      { name: 'address', type: 'VARCHAR(255)' },
      { name: 'avatar', type: 'VARCHAR(255)' },
      { name: 'role', type: 'TINYINT' },
      { name: 'credit_score', type: 'INT' },
      { name: 'status', type: 'TINYINT' },
      { name: 'token_version', type: 'INT' },
      { name: 'create_time', type: 'DATETIME' },
    ],
  },
  {
    name: 'category',
    label: '分类',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      { name: 'name', type: 'VARCHAR(50)' },
      { name: 'icon', type: 'VARCHAR(255)' },
    ],
  },
  {
    name: 'tool',
    label: '工具',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      fk('owner_id', 'user'),
      fk('category_id', 'category'),
      { name: 'name', type: 'VARCHAR(100)' },
      { name: 'images', type: 'VARCHAR(500)' },
      { name: 'description', type: 'TEXT' },
      { name: 'deposit', type: 'DECIMAL(10,2)' },
      { name: 'status', type: 'TINYINT' },
      { name: 'view_count', type: 'INT' },
      { name: 'create_time', type: 'DATETIME' },
    ],
  },
  {
    name: 'rental_order',
    label: '租借订单',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      fk('tool_id', 'tool'),
      fk('borrower_id', 'user'),
      fk('owner_id', 'user'),
      { name: 'start_time', type: 'DATETIME' },
      { name: 'end_time', type: 'DATETIME' },
      { name: 'extend_end_time', type: 'DATETIME' },
      { name: 'extend_status', type: 'TINYINT' },
      { name: 'actual_return_time', type: 'DATETIME' },
      { name: 'status', type: 'TINYINT' },
      { name: 'purpose', type: 'VARCHAR(255)' },
      { name: 'deposit', type: 'DECIMAL(10,2)' },
      { name: 'deposit_original', type: 'DECIMAL(10,2)' },
      { name: 'reject_reason', type: 'VARCHAR(255)' },
      { name: 'create_time', type: 'DATETIME' },
    ],
  },
  {
    name: 'review',
    label: '评价',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      fk('order_id', 'rental_order'),
      fk('user_id', 'user'),
      { name: 'rating', type: 'TINYINT' },
      { name: 'condition_score', type: 'INT' },
      { name: 'punctuality_score', type: 'INT' },
      { name: 'communication_score', type: 'INT' },
      { name: 'content', type: 'TEXT' },
      { name: 'images', type: 'VARCHAR(500)' },
      { name: 'reply_content', type: 'VARCHAR(200)' },
      { name: 'reply_time', type: 'DATETIME' },
      { name: 'status', type: 'TINYINT' },
      { name: 'report_count', type: 'INT' },
      { name: 'create_time', type: 'DATETIME' },
      { name: 'order_id+user_id', type: '联合唯一', key: 'UK' },
    ],
  },
  {
    name: 'favorite',
    label: '收藏',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      fk('user_id', 'user'),
      fk('tool_id', 'tool'),
      { name: 'create_time', type: 'DATETIME' },
      { name: 'user_id+tool_id', type: '联合唯一', key: 'UK' },
    ],
  },
  {
    name: 'credit_log',
    label: '信用记录',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      fk('user_id', 'user'),
      fk('order_id', 'rental_order'),
      { name: 'change_score', type: 'INT' },
      { name: 'reason', type: 'VARCHAR(100)' },
      { name: 'create_time', type: 'DATETIME' },
    ],
  },
  {
    name: 'order_event',
    label: '订单事件',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      fk('order_id', 'rental_order'),
      { name: 'event', type: 'VARCHAR(30)' },
      { name: 'operator_id', type: 'BIGINT', note: '逻辑引用→user.id' },
      { name: 'operator_name', type: 'VARCHAR(50)' },
      { name: 'remark', type: 'VARCHAR(255)' },
      { name: 'create_time', type: 'DATETIME' },
    ],
  },
  {
    name: 'order_message',
    label: '订单留言',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      fk('order_id', 'rental_order'),
      fk('user_id', 'user'),
      { name: 'content', type: 'VARCHAR(500)' },
      { name: 'create_time', type: 'DATETIME' },
    ],
  },
  {
    name: 'message',
    label: '消息通知',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      fk('user_id', 'user'),
      fk('order_id', 'rental_order'),
      { name: 'title', type: 'VARCHAR(100)' },
      { name: 'content', type: 'VARCHAR(255)' },
      { name: 'is_read', type: 'TINYINT' },
      { name: 'type', type: 'TINYINT' },
      { name: 'create_time', type: 'DATETIME' },
    ],
  },
  {
    name: 'credit_rule',
    label: '信用规则',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK', note: '单行配置' },
      { name: 'min_rent_score', type: 'INT' },
      { name: 'on_time_reward', type: 'INT' },
      { name: 'overdue_penalty', type: 'INT' },
      { name: 'max_concurrent_rentals', type: 'INT' },
      { name: 'overdue_days_threshold', type: 'INT' },
      { name: 'audit_timeout_hours', type: 'INT' },
      { name: 'confirm_return_timeout_hours', type: 'INT' },
      { name: 'due_soon_hours', type: 'INT' },
      { name: 'streak_bonus_count', type: 'INT' },
      { name: 'streak_bonus_score', type: 'INT' },
      { name: 'appeal_min_score', type: 'INT' },
      { name: 'appeal_restore_score', type: 'INT' },
      { name: 'deposit_surge_threshold', type: 'INT' },
      { name: 'deposit_surge_rate', type: 'INT' },
      { name: 'update_time', type: 'DATETIME' },
    ],
  },
  {
    name: 'admin_operation_log',
    label: '审计日志',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      { name: 'admin_id', type: 'BIGINT', note: '逻辑引用→user.id' },
      { name: 'admin_name', type: 'VARCHAR(50)' },
      { name: 'action', type: 'VARCHAR(50)' },
      { name: 'target_type', type: 'VARCHAR(20)' },
      { name: 'target_id', type: 'BIGINT' },
      { name: 'detail', type: 'VARCHAR(500)' },
      { name: 'create_time', type: 'DATETIME' },
    ],
  },
  {
    name: 'tool_report',
    label: '工具举报',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      { name: 'tool_id', type: 'BIGINT', note: '逻辑引用→tool.id' },
      { name: 'reporter_id', type: 'BIGINT', note: '逻辑引用→user.id' },
      { name: 'reason', type: 'VARCHAR(200)' },
      { name: 'status', type: 'TINYINT' },
      { name: 'handle_note', type: 'VARCHAR(255)' },
      { name: 'handler_id', type: 'BIGINT', note: '逻辑引用→user.id' },
      { name: 'handle_time', type: 'DATETIME' },
      { name: 'create_time', type: 'DATETIME' },
      { name: 'tool_id+reporter_id', type: '联合唯一', key: 'UK' },
    ],
  },
  {
    name: 'credit_appeal',
    label: '信用申诉',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      { name: 'user_id', type: 'BIGINT', note: '逻辑引用→user.id' },
      { name: 'reason', type: 'VARCHAR(255)' },
      { name: 'status', type: 'TINYINT' },
      { name: 'review_note', type: 'VARCHAR(255)' },
      { name: 'reviewer_id', type: 'BIGINT', note: '逻辑引用→user.id' },
      { name: 'review_time', type: 'DATETIME' },
      { name: 'create_time', type: 'DATETIME' },
    ],
  },
  {
    name: 'dispute',
    label: '纠纷仲裁',
    columns: [
      { name: 'id', type: 'BIGINT', key: 'PK' },
      { name: 'order_id', type: 'BIGINT', key: 'UK', note: '逻辑引用→rental_order.id，一单一纠纷' },
      { name: 'user_id', type: 'BIGINT', note: '逻辑引用→user.id' },
      { name: 'reason', type: 'VARCHAR(255)' },
      { name: 'status', type: 'TINYINT' },
      { name: 'verdict', type: 'TINYINT' },
      { name: 'handle_note', type: 'VARCHAR(255)' },
      { name: 'handler_id', type: 'BIGINT', note: '逻辑引用→user.id' },
      { name: 'handle_time', type: 'DATETIME' },
      { name: 'create_time', type: 'DATETIME' },
    ],
  },
];

/** The 16 physical foreign keys, exactly as declared in the database: [child, parent, column]. */
export const physicalForeignKeys: Array<[string, string, string]> = [
  ['tool', 'user', 'owner_id'],
  ['tool', 'category', 'category_id'],
  ['rental_order', 'tool', 'tool_id'],
  ['rental_order', 'user', 'borrower_id'],
  ['rental_order', 'user', 'owner_id'],
  ['review', 'rental_order', 'order_id'],
  ['review', 'user', 'user_id'],
  ['favorite', 'user', 'user_id'],
  ['favorite', 'tool', 'tool_id'],
  ['credit_log', 'user', 'user_id'],
  ['credit_log', 'rental_order', 'order_id'],
  ['order_event', 'rental_order', 'order_id'],
  ['order_message', 'rental_order', 'order_id'],
  ['order_message', 'user', 'user_id'],
  ['message', 'user', 'user_id'],
  ['message', 'rental_order', 'order_id'],
];

export const tableOf = (name: string): TableDef => {
  const found = tables.find((t) => t.name === name);
  if (!found) throw new Error(`[er-schema] unknown table "${name}"`);
  return found;
};
export const labelOf = (name: string): string => tableOf(name).label;

/** Modules used to group the per-module figures. */
export const modules: Array<{ id: string; title: string; tables: string[] }> = [
  { id: 'm1-user-tool', title: '用户与工具模块', tables: ['user', 'category', 'tool', 'favorite'] },
  { id: 'm2-order', title: '订单与流转模块', tables: ['rental_order', 'order_event', 'order_message'] },
  { id: 'm3-credit', title: '信用与申诉模块', tables: ['credit_log', 'credit_rule', 'credit_appeal'] },
  {
    id: 'm4-interaction',
    title: '评价、举报、消息与纠纷模块',
    tables: ['review', 'tool_report', 'message', 'dispute', 'admin_operation_log'],
  },
];

/**
 * Conceptual relationships, stated as `a -联系- b` with a cardinality on each side, plus
 * the column(s) that implement it. `physical` means the database enforces at least one of
 * those columns as a real foreign key; otherwise it is an application-level reference and
 * the figures must mark it as such. `overview` marks the eight contacts drawn in the
 * concept E-R: eight entities plus eleven diamonds measured 5 violations, the same eight
 * with eight diamonds measured none.
 */
export interface Relation {
  a: string;
  name: string;
  b: string;
  cardA: '1' | 'N' | 'M';
  cardB: '1' | 'N' | 'M';
  via: Array<{ child: string; column: string }>;
  physical: boolean;
  overview?: boolean;
}
export const relations: Relation[] = [
  {
    a: 'user',
    name: '发布',
    b: 'tool',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'tool', column: 'owner_id' }],
    physical: true,
    overview: true,
  },
  {
    a: 'category',
    name: '归类',
    b: 'tool',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'tool', column: 'category_id' }],
    physical: true,
    overview: true,
  },
  {
    a: 'user',
    name: '承租',
    b: 'rental_order',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'rental_order', column: 'borrower_id' }],
    physical: true,
    overview: true,
  },
  {
    a: 'user',
    name: '出借',
    b: 'rental_order',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'rental_order', column: 'owner_id' }],
    physical: true,
  },
  {
    a: 'tool',
    name: '涉及',
    b: 'rental_order',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'rental_order', column: 'tool_id' }],
    physical: true,
    overview: true,
  },
  {
    a: 'user',
    name: '收藏',
    b: 'tool',
    cardA: 'M',
    cardB: 'N',
    via: [
      { child: 'favorite', column: 'user_id' },
      { child: 'favorite', column: 'tool_id' },
    ],
    physical: true,
  },
  {
    a: 'rental_order',
    name: '评价',
    b: 'review',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'review', column: 'order_id' }],
    physical: true,
    overview: true,
  },
  {
    a: 'user',
    name: '撰写',
    b: 'review',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'review', column: 'user_id' }],
    physical: true,
  },
  {
    a: 'user',
    name: '记分',
    b: 'credit_log',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'credit_log', column: 'user_id' }],
    physical: true,
  },
  {
    a: 'rental_order',
    name: '因单',
    b: 'credit_log',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'credit_log', column: 'order_id' }],
    physical: true,
    overview: true,
  },
  {
    a: 'rental_order',
    name: '产生',
    b: 'order_event',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'order_event', column: 'order_id' }],
    physical: true,
  },
  {
    a: 'rental_order',
    name: '沟通',
    b: 'order_message',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'order_message', column: 'order_id' }],
    physical: true,
  },
  {
    a: 'user',
    name: '发言',
    b: 'order_message',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'order_message', column: 'user_id' }],
    physical: true,
  },
  {
    a: 'user',
    name: '接收',
    b: 'message',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'message', column: 'user_id' }],
    physical: true,
  },
  {
    a: 'rental_order',
    name: '触发',
    b: 'message',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'message', column: 'order_id' }],
    physical: true,
    overview: true,
  },
  {
    a: 'user',
    name: '举报',
    b: 'tool_report',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'tool_report', column: 'reporter_id' }],
    physical: false,
  },
  {
    a: 'tool',
    name: '被举报',
    b: 'tool_report',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'tool_report', column: 'tool_id' }],
    physical: false,
  },
  {
    a: 'user',
    name: '申诉',
    b: 'credit_appeal',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'credit_appeal', column: 'user_id' }],
    physical: false,
  },
  {
    a: 'rental_order',
    name: '涉单',
    b: 'dispute',
    cardA: '1',
    cardB: '1',
    via: [{ child: 'dispute', column: 'order_id' }],
    physical: false,
    overview: true,
  },
  {
    a: 'user',
    name: '发起',
    b: 'dispute',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'dispute', column: 'user_id' }],
    physical: false,
  },
  {
    a: 'user',
    name: '执行',
    b: 'admin_operation_log',
    cardA: '1',
    cardB: 'N',
    via: [{ child: 'admin_operation_log', column: 'admin_id' }],
    physical: false,
  },
];

/** Relations a given table takes part in. */
export const relationsOf = (table: string): Relation[] => relations.filter((r) => r.a === table || r.b === table);
export const overviewRelations = (): Relation[] => relations.filter((r) => r.overview);

/**
 * Audit columns are left out of the per-table 实体图: a textbook entity diagram shows
 * business attributes, and hanging create_time/update_time off an already 15-attribute
 * star is what pushes the figure into a vertical strip. They all appear in the 表结构
 * figures, so nothing is lost from the set.
 */
export const AUDIT_COLUMNS = new Set(['create_time', 'update_time', 'reply_time', 'handle_time', 'review_time']);
