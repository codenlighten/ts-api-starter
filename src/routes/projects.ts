import type { Deps, Registrar } from "../http/route.js";
import { notFound } from "../http/errors.js";
import { runIdempotent, toReply } from "../idempotency.js";
import { getProject, insertProject, listProjects } from "../repo/projects.js";
import { insertTask, listTasks, updateTask } from "../repo/tasks.js";
import {
  createProjectBody,
  createTaskBody,
  idParam,
  page,
  pageQuery,
  project,
  projectIdParam,
  task,
  taskPageQuery,
  updateTaskBody,
} from "../schemas.js";

export function projectRoutes(r: Registrar, { pool }: Deps): void {
  r.route({
    method: "post",
    path: "/v1/projects",
    tag: "projects",
    summary: "Create a project. Send Idempotency-Key to make retries safe.",
    auth: true,
    idempotent: true,
    body: createProjectBody,
    success: { status: 201, schema: project },
    handler: async ({ auth, body, idempotency }) => {
      const out = await runIdempotent(pool, { tenantId: auth.tenantId, ...idempotency }, async (tx) => ({
        status: 201,
        body: await insertProject(tx, auth.tenantId, body.name),
      }));
      return toReply(out);
    },
  });

  r.route({
    method: "get",
    path: "/v1/projects",
    tag: "projects",
    summary: "List projects, newest first, with cursor pagination.",
    auth: true,
    query: pageQuery,
    success: { status: 200, schema: page(project) },
    handler: async ({ auth, query }) => ({ status: 200, body: await listProjects(pool, auth.tenantId, query) }),
  });

  r.route({
    method: "get",
    path: "/v1/projects/:id",
    tag: "projects",
    summary: "Fetch one project.",
    auth: true,
    params: idParam,
    success: { status: 200, schema: project },
    handler: async ({ auth, params }) => {
      const found = await getProject(pool, auth.tenantId, params.id);
      if (!found) throw notFound("Project");
      return { status: 200, body: found };
    },
  });

  r.route({
    method: "post",
    path: "/v1/projects/:projectId/tasks",
    tag: "tasks",
    summary: "Create a task in a project. Send Idempotency-Key to make retries safe.",
    auth: true,
    idempotent: true,
    params: projectIdParam,
    body: createTaskBody,
    success: { status: 201, schema: task },
    handler: async ({ auth, params, body, idempotency }) => {
      const out = await runIdempotent(pool, { tenantId: auth.tenantId, ...idempotency }, async (tx) => {
        if (!(await getProject(tx, auth.tenantId, params.projectId))) throw notFound("Project");
        return { status: 201, body: await insertTask(tx, auth.tenantId, params.projectId, body.title) };
      });
      return toReply(out);
    },
  });

  r.route({
    method: "get",
    path: "/v1/projects/:projectId/tasks",
    tag: "tasks",
    summary: "List a project's tasks, newest first, optionally by status.",
    auth: true,
    params: projectIdParam,
    query: taskPageQuery,
    success: { status: 200, schema: page(task) },
    handler: async ({ auth, params, query }) => {
      if (!(await getProject(pool, auth.tenantId, params.projectId))) throw notFound("Project");
      return { status: 200, body: await listTasks(pool, auth.tenantId, params.projectId, query) };
    },
  });

  r.route({
    method: "patch",
    path: "/v1/tasks/:id",
    tag: "tasks",
    summary: "Change a task's title or status.",
    auth: true,
    params: idParam,
    body: updateTaskBody,
    success: { status: 200, schema: task },
    handler: async ({ auth, params, body }) => {
      const updated = await updateTask(pool, auth.tenantId, params.id, body);
      if (!updated) throw notFound("Task");
      return { status: 200, body: updated };
    },
  });
}
