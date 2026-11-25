import type { Queryable } from "../db/pool.js";
import { decodeCursor, toPage, type Page } from "../pagination.js";

interface TaskRow {
  seq: string;
  id: string;
  project_id: string;
  title: string;
  status: "todo" | "doing" | "done";
  created_at: Date;
  updated_at: Date;
}
export interface TaskDto {
  id: string;
  projectId: string;
  title: string;
  status: "todo" | "doing" | "done";
  createdAt: string;
  updatedAt: string;
}
const toDto = (r: TaskRow): TaskDto => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
const COLUMNS = "seq, id, project_id, title, status, created_at, updated_at";

export async function insertTask(db: Queryable, tenantId: string, projectId: string, title: string): Promise<TaskDto> {
  const { rows } = await db.query<TaskRow>(
    `insert into tasks (tenant_id, project_id, title) values ($1, $2, $3) returning ${COLUMNS}`,
    [tenantId, projectId, title],
  );
  return toDto(rows[0] as TaskRow);
}

export async function listTasks(
  db: Queryable,
  tenantId: string,
  projectId: string,
  opts: { limit: number; cursor?: string | undefined; status?: string | undefined },
): Promise<Page<TaskDto>> {
  const after = decodeCursor(opts.cursor);
  const { rows } = await db.query<TaskRow>(
    `select ${COLUMNS} from tasks
      where tenant_id = $1 and project_id = $2
        and ($3::bigint is null or seq < $3::bigint)
        and ($4::text is null or status = $4::text)
      order by seq desc limit $5`,
    [tenantId, projectId, after, opts.status ?? null, opts.limit + 1],
  );
  return toPage(rows, opts.limit, toDto);
}

export async function updateTask(
  db: Queryable,
  tenantId: string,
  id: string,
  patch: { title?: string | undefined; status?: string | undefined },
): Promise<TaskDto | undefined> {
  const { rows } = await db.query<TaskRow>(
    `update tasks set title = coalesce($3, title), status = coalesce($4, status), updated_at = now()
      where tenant_id = $1 and id = $2 returning ${COLUMNS}`,
    [tenantId, id, patch.title ?? null, patch.status ?? null],
  );
  return rows[0] ? toDto(rows[0]) : undefined;
}
