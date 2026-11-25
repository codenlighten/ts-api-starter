import { z } from "zod";

export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const password = z.string().min(10, "use at least 10 characters").max(200);

export const signupBody = z.object({
  tenantName: z.string().trim().min(1).max(100),
  email,
  password,
});
export const loginBody = z.object({ email, password: z.string().min(1).max(200) });
export const tokenResponse = z.object({ token: z.string(), expiresInSeconds: z.number().int() });
export const meResponse = z.object({
  userId: z.uuid(),
  email: z.string(),
  tenantId: z.uuid(),
  tenantName: z.string(),
});

export const idParam = z.object({ id: z.uuid() });
export const projectIdParam = z.object({ projectId: z.uuid() });

export const taskStatus = z.enum(["todo", "doing", "done"]);

export const project = z.object({ id: z.uuid(), name: z.string(), createdAt: z.iso.datetime() });
export const task = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  status: taskStatus,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createProjectBody = z.object({ name: z.string().trim().min(1).max(200) });
export const createTaskBody = z.object({ title: z.string().trim().min(1).max(300) });
export const updateTaskBody = z
  .object({ title: z.string().trim().min(1).max(300), status: taskStatus })
  .partial()
  .refine((b) => b.title !== undefined || b.status !== undefined, "send at least one of title, status");

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(100).optional(),
});
export const taskPageQuery = pageQuery.extend({ status: taskStatus.optional() });

export const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const problemSchema = z.object({
  type: z.literal("about:blank"),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string(),
  requestId: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
