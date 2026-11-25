import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, signup, startApp, type Account, type TestApp } from "./helpers.js";

let t: TestApp;
let a: Account;
let b: Account;
let aProject: { id: string };
let aTask: { id: string };

beforeAll(async () => {
  t = await startApp();
  a = await signup(t.app, "Tenant A");
  b = await signup(t.app, "Tenant B");
  aProject = await createProject(t.app, a, "A's project");
  const res = await t.app.inject({
    method: "POST",
    url: `/v1/projects/${aProject.id}/tasks`,
    headers: a.auth,
    payload: { title: "A's task" },
  });
  aTask = res.json<{ id: string }>();
  await createProject(t.app, b, "B's project");
});
afterAll(async () => {
  await t.close();
});

describe("tenant isolation", () => {
  it("tenant B cannot read tenant A's project (404, not 403)", async () => {
    const res = await t.app.inject({ method: "GET", url: `/v1/projects/${aProject.id}`, headers: b.auth });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B's list contains only B's projects", async () => {
    const res = await t.app.inject({ method: "GET", url: "/v1/projects", headers: b.auth });
    expect(res.json<{ items: { name: string }[] }>().items.map((p) => p.name)).toEqual(["B's project"]);
  });

  it("tenant B cannot list or add tasks in A's project", async () => {
    const list = await t.app.inject({ method: "GET", url: `/v1/projects/${aProject.id}/tasks`, headers: b.auth });
    expect(list.statusCode).toBe(404);
    const add = await t.app.inject({
      method: "POST",
      url: `/v1/projects/${aProject.id}/tasks`,
      headers: b.auth,
      payload: { title: "intruder" },
    });
    expect(add.statusCode).toBe(404);
  });

  it("tenant B cannot update A's task, and it stays unchanged", async () => {
    const res = await t.app.inject({ method: "PATCH", url: `/v1/tasks/${aTask.id}`, headers: b.auth, payload: { status: "done" } });
    expect(res.statusCode).toBe(404);
    const { rows } = await t.pool.query<{ status: string }>("select status from tasks where id = $1", [aTask.id]);
    expect(rows[0]?.status).toBe("todo");
  });

  it("the database itself refuses a task that points at another tenant's project", async () => {
    const { rows } = await t.pool.query<{ id: string }>("select id from tenants where name = 'Tenant B'");
    await expect(
      t.pool.query("insert into tasks (tenant_id, project_id, title) values ($1, $2, 'x')", [rows[0]?.id, aProject.id]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("the owner still sees and updates their own data", async () => {
    const res = await t.app.inject({ method: "PATCH", url: `/v1/tasks/${aTask.id}`, headers: a.auth, payload: { status: "done" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("done");
  });
});
