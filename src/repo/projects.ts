import type { Queryable } from "../db/pool.js";
import { decodeCursor, toPage, type Page } from "../pagination.js";

interface ProjectRow {
  seq: string;
  id: string;
  name: string;
  created_at: Date;
}
export interface ProjectDto {
  id: string;
  name: string;
  createdAt: string;
}
const toDto = (r: ProjectRow): ProjectDto => ({ id: r.id, name: r.name, createdAt: r.created_at.toISOString() });

export async function insertProject(db: Queryable, tenantId: string, name: string): Promise<ProjectDto> {
  const { rows } = await db.query<ProjectRow>(
    "insert into projects (tenant_id, name) values ($1, $2) returning seq, id, name, created_at",
    [tenantId, name],
  );
  return toDto(rows[0] as ProjectRow);
}

export async function getProject(db: Queryable, tenantId: string, id: string): Promise<ProjectDto | undefined> {
  const { rows } = await db.query<ProjectRow>(
    "select seq, id, name, created_at from projects where tenant_id = $1 and id = $2",
    [tenantId, id],
  );
  return rows[0] ? toDto(rows[0]) : undefined;
}

export async function listProjects(
  db: Queryable,
  tenantId: string,
  opts: { limit: number; cursor?: string | undefined },
): Promise<Page<ProjectDto>> {
  const after = decodeCursor(opts.cursor);
  const { rows } = await db.query<ProjectRow>(
    `select seq, id, name, created_at from projects
      where tenant_id = $1 and ($2::bigint is null or seq < $2::bigint)
      order by seq desc limit $3`,
    [tenantId, after, opts.limit + 1],
  );
  return toPage(rows, opts.limit, toDto);
}
